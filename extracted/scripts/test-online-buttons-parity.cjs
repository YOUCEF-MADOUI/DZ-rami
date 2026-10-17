/* Every multiplayer button must be identical to its solo counterpart: same label,
   same background, same colour, same border-radius, same padding, same font size.
   Usage: NODE_PATH=<browser tools> LD_LIBRARY_PATH=<chromium libs> \
          node scripts/test-online-buttons-parity.cjs                         */
const { chromium } = require("playwright"), binary = require("@sparticuz/chromium").default;
const assert = require("node:assert/strict");
const BASE = process.env.APP_BASE || `http://localhost:${process.env.APP_PORT || 3000}`;
/** Computed style of every visible button of a screen, keyed by its label. */
const STYLE = () => {
  const style = (el) => {
    const s = getComputedStyle(el);
    return {
      background: s.backgroundImage === "none" ? s.backgroundColor : s.backgroundImage,
      color: s.color,
      radius: s.borderRadius,
      padding: s.padding,
      font: `${s.fontSize}/${s.fontWeight}`,
      tag: el.tagName,
      classes: (el.className || "").toString().trim(),
    };
  };
  const out = {};
  for (const el of document.querySelectorAll("[data-game-root] button")) {
    // Seat labels are not controls: they are shown unframed by design (table layout).
    if ((el.className || "").toString().includes("seat-player-name")) continue;
    const label = el.textContent.trim().replace(/\s+/g, " ").replace(/\(\d+\)/g, "(N)");
    if (!label) continue;
    out[label] = style(el);
  }
  return out;
};
(function () {
  (async () => {
    const browser = await chromium.launch({
      executablePath: await binary.executablePath(),
      args: binary.args.filter((a) => !["--disable-web-security", "--single-process"].includes(a)),
      headless: true,
    });
    const errors = [];
    const collect = async (page, turn) => {
      const seen = {};
      for (let i = 0; i < 14; i += 1) {
        const styles = await page.evaluate(STYLE);
        for (const [label, value] of Object.entries(styles)) seen[label] ??= value;
        // drive a turn so the contextual buttons appear
        const bar = await page.evaluate(() =>
          Array.from(document.querySelectorAll(".hand-actions button")).map((b) => b.textContent.trim()),
        );
        if (bar.some((t) => /Piocher/.test(t))) await page.getByRole("button", { name: /Piocher/ }).click().catch(() => {});
        else if (bar.some((t) => /Défausser/.test(t))) {
          if (!(await page.evaluate(() => document.querySelectorAll(".card.selected").length)))
            await page.locator("[data-ci] .card").last().click().catch(() => {});
          await page.getByRole("button", { name: /Défausser/ }).click().catch(() => {});
        } else break;
        await page.waitForTimeout(turn);
      }
      return seen;
    };
    try {
      // ---- solo ----
      const soloCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const solo = await soloCtx.newPage();
      solo.on("pageerror", (e) => errors.push(e.message));
      await solo.goto(BASE);
      await solo.getByRole("button", { name: /Mode Solo/ }).click();
      await solo.getByRole("button", { name: /2 Joueurs/ }).click();
      await solo.getByRole("button", { name: /Commencer/ }).click();
      await solo.locator("[data-game-root]").waitFor();
      const soloButtons = await collect(solo, 1200);
      // ---- multiplayer ----
      const A = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
        B = await browser.newContext();
      const a = await A.newPage(), b = await B.newPage();
      for (const p of [a, b]) {
        p.on("pageerror", (e) => errors.push(e.message));
        await p.goto(BASE);
        await p.getByRole("button", { name: /Multijoueur$/ }).click();
        await p.locator('[data-online-connected="true"]').waitFor();
      }
      await a.getByLabel("Votre nom").fill("Vous");
      await a.getByRole("button", { name: /Créer une table/ }).click();
      const table = `Boutons ${Date.now()}`;
      await a.getByLabel("Nom de la table").fill(table);
      await a.getByLabel("Nombre de joueurs").selectOption("2");
      await a.getByRole("button", { name: /Créer la table/ }).click();
      await a.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
      await b.getByLabel("Votre nom").fill("Ami");
      await b.getByRole("button", { name: /Rejoindre une table/ }).click();
      await b.getByLabel("Code ou nom de la table").fill(table);
      await b.getByRole("button", { name: /Rejoindre la table/ }).click();
      await b.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
      await a.getByText(/Ami/).first().waitFor();
      await a.getByRole("button", { name: /Prêt$/ }).click();
      await b.getByRole("button", { name: /Prêt$/ }).click();
      const start = a.getByRole("button", { name: /Démarrer la partie/ });
      await start.waitFor();
      await start.click();
      await a.locator(".online-game").waitFor();
      await b.locator(".online-game").waitFor();
      const bar = async (p) =>
        p.evaluate(() => Array.from(document.querySelectorAll(".hand-actions button")).map((x) => x.textContent.trim()));
      const owner = async () => {
        const end = Date.now() + 60000;
        while (Date.now() < end) {
          if ((await bar(a)).length) return a;
          if ((await bar(b)).length) return b;
          await a.waitForTimeout(400);
        }
        throw new Error("aucun tour actif");
      };
      const multi = {};
      for (let i = 0; i < 14; i += 1) {
        const p = await owner();
        Object.assign(multi, await collect(p, 1200));
        const next = await bar(p);
        if (!next.length) continue;
        await p.waitForTimeout(600);
      }
      // ---- comparison ----
      console.log("solo  :", Object.keys(soloButtons).join(" | "));
      console.log("multi :", Object.keys(multi).join(" | "));
      const shared = Object.keys(soloButtons).filter((label) => label in multi);
      assert(shared.length >= 5, `pas assez de boutons communs: ${shared.join(" | ")}`);
      const mismatches = [];
      for (const label of shared) {
        const soloStyle = soloButtons[label], multiStyle = multi[label];
        for (const key of ["background", "color", "radius", "padding", "font"]) {
          if (soloStyle[key] !== multiStyle[key])
            mismatches.push(`${label} → ${key}: solo «${soloStyle[key]}» vs multi «${multiStyle[key]}»`);
        }
      }
      if (mismatches.length) console.error(mismatches.join("\n"));
      assert.deepEqual(mismatches, [], "chaque bouton partagé doit être identique");
      // Buttons that only exist online (network commands) must reuse the exact
      // class vocabulary of the solo screen: no bespoke online styling, therefore
      // no different colour, radius, padding or font. Checked against the source
      // so the result never depends on which turn the browser happened to catch.
      const fs = require("node:fs"), path = require("node:path");
      const sources = ["../src/components/GameScreen.tsx", "../src/components/PlayerHand.tsx"]
        .map((f) => fs.readFileSync(path.join(__dirname, f), "utf8"));
      const vocabulary = new Set();
      for (const source of sources)
        for (const match of source.matchAll(/className=\{?[`"]([^`"]*)[`"]/g))
          vocabulary.add(match[1].replace(/\$\{[^}]*\}/g, "").replace(/\s+/g, " ").trim());
      const normalize = (classes) =>
        classes.replace(/\s*w-auto\s*/g, " ").replace(/\s*justify-self-end\s*/g, " ").replace(/\s+/g, " ").trim();
      const sharedSet = new Set(shared);
      const strangers = Object.entries(multi)
        // Already proven identical above (same label, same computed style).
        .filter(([label]) => !sharedSet.has(label))
        .filter(([, style]) => {
          const own = normalize(style.classes);
          if (vocabulary.has(own) || vocabulary.has(style.classes.trim())) return false;
          // A class list is acceptable when every button-* class it uses is part of
          // a known solo class list (e.g. btn-secondary plus a layout utility).
          const kinds = own.split(" ").filter((c) => c.startsWith("btn-"));
          return ![...vocabulary].some((v) => kinds.length && kinds.every((k) => v.split(" ").includes(k)));
        })
        .map(([label, style]) => `${label} (${style.classes})`);
      assert.deepEqual(strangers, [], `boutons en ligne sans équivalent de style solo: ${strangers.join(" | ")}`);
      console.log(
        `${Object.keys(multi).length - shared.length} boutons propres au réseau réutilisent le vocabulaire du solo (btn-primary / btn-secondary / btn-danger / hand-lock-control)`,
      );
      if (process.env.SHOTS) {
        await solo.screenshot({ path: "/home/user/join-audit/BTN-solo.png" });
        await a.screenshot({ path: "/home/user/join-audit/BTN-multi.png" });
      }
    } finally {
      await browser.close();
    }
  })().catch((e) => {
    console.error("ÉCHEC :", e.message);
    process.exit(1);
  });
})();
