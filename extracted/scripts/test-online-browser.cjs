/* Optional real-browser integration: npm install --no-save --package-lock=false playwright @sparticuz/chromium
   BASE_URL=http://localhost:3000  APP_PORT=3100 (dedicated test server) NODE_PATH=./node_modules LD_LIBRARY_PATH=/path/to/chromium-libs node scripts/test-online-browser.cjs */
const { chromium } = require("playwright");
const binary = require("@sparticuz/chromium").default;
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: await binary.executablePath(),
    args: binary.args.filter(
      (a) => !["--disable-web-security", "--single-process"].includes(a),
    ),
    headless: true,
  });
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () => browser.newContext()),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const errors = [];
  let checks = 0;
  const base = process.env.BASE_URL || "http://localhost:3000",
    suffix = Date.now();
  async function menu(p) {
    await p.goto(base);
    await p.getByRole("button", { name: /Multijoueur$/ }).click();
    await p.getByText("● Connecté", { exact: true }).waitFor();
  }
  const state = (p) =>
    p.evaluate(() =>
      fetch("/api/multiplayer")
        .then((r) => r.json())
        .then((d) => d.snapshot),
    );
  for (const p of pages) {
    p.on("pageerror", (e) => errors.push(e.message));
    await menu(p);
  }
  const [a, b, c, d] = pages;
  assert.equal(
    await a
      .getByRole("button", { name: /Créer une table/ })
      .count(),
    1,
  );
  checks++;
  await a.getByLabel("Votre nom").fill("Alice");
  await a.getByRole("button", { name: /Créer une table/ }).click();
  await a.getByLabel("Nom de la table").fill(`Browser public ${suffix}`);
  await a.getByLabel("Nombre de joueurs").selectOption("2");
  await a.getByRole("button", { name: /Créer la table/ }).click();
  await a.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
  checks++;
  await b.getByLabel("Votre nom").fill("Bob");
  // Join the exact table created above (other public tables may exist).
  await b
    .locator("div.bg-slate-800")
    .filter({ hasText: `Browser public ${suffix}` })
    .getByRole("button", { name: /^Rejoindre$/ })
    .click();
  await b.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
  assert(
    await a.getByRole("button", { name: /Démarrer la partie/ }).isDisabled(),
  );
  checks++;
  await a.getByText(/Bob/).first().waitFor();
  await a.getByRole("button", { name: /Prêt$/ }).click();
  await b.getByText(/south · Prêt · connecté/).waitFor();
  await b.getByRole("button", { name: /Prêt$/ }).click();
  await a.getByRole("button", { name: /Démarrer la partie/ }).click();
  await a.locator(".online-game").waitFor();
  await b.locator(".online-game").waitFor();
  checks++;
  let sa = await state(a),
    sb = await state(b);
  assert(sa.room.game.localHand.length >= 14);
  for (const card of sb.room.game.localHand)
    assert(!JSON.stringify(sa).includes(`"${card.id}"`));
  assert.equal(
    await a.locator("[data-opponent-hand] [data-card-id]").count(),
    0,
  );
  checks++;
  const current = sa.room.game.currentPlayerId === sa.room.viewerId ? a : b,
    other = current === a ? b : a;
  // The waiting player has no actionable button, exactly like the solo screen.
  assert.equal(
    await other.evaluate(() =>
      Array.from(document.querySelectorAll(".hand-actions button")).length,
    ),
    0,
  );
  // Genuine pointer reorder, keeping game state and table untouched.
  const before = await state(current),
    ids = before.room.game.localHand.map((c) => c.id);
  const slots = current.locator(".hand-slot");
  const x = await slots.nth(0).boundingBox(),
    y = await slots.nth(3).boundingBox();
  await current.mouse.move(x.x + 3, x.y + 24);
  await current.mouse.down();
  await current.mouse.move(y.x + 3, y.y + 24, { steps: 15 });
  await current.mouse.up();
  assert.equal((await state(current)).room.revision, before.room.revision);
  assert(
    await current.locator(".hand-sortbar").getByText("Manuel").isVisible(),
  );
  checks++;
  await current
    .locator(`[data-card-id="${ids[0]}"]`)
    .click({ position: { x: 3, y: 24 } });
  await current.getByRole("button", { name: /Défausser/ }).click();
  // The next player now sees only the draw button, like the solo screen.
  await other.getByRole("button", { name: /Piocher/ }).click();
  await other
    .getByRole("button", { name: /Défausser/ })
    .waitFor();
  await other.waitForFunction(
    () => document.querySelectorAll(".hand-slot").length === 15,
  );
  checks++;
  const reconnectBefore = await state(other);
  await other.reload();
  await other.getByRole("button", { name: /Multijoueur$/ }).click();
  await other.locator(".online-game").waitFor();
  const reconnectAfter = await state(other);
  assert.deepEqual(
    reconnectAfter.room.game.localHand,
    reconnectBefore.room.game.localHand,
  );
  assert.equal(reconnectAfter.room.viewerId, reconnectBefore.room.viewerId);
  checks++;
  const otherContext = other.context();
  await otherContext.setOffline(true);
  await current.waitForTimeout(17000);
  const disconnected = await state(current);
  assert.equal(
    disconnected.room.members.find(
      (m) => m.playerId === reconnectBefore.room.viewerId,
    ).connected,
    false,
  );
  await otherContext.setOffline(false);
  await other.getByText("● Connecté", { exact: true }).waitFor();
  assert.deepEqual(
    (await state(other)).room.game.localHand,
    reconnectBefore.room.game.localHand,
  );
  checks++;
  // Private room protection in two more isolated browser sessions.
  await c.getByLabel("Votre nom").fill("Cara");
  await c.getByRole("button", { name: /Créer une table/ }).click();
  await c.getByLabel("Nom de la table").fill(`Browser private ${suffix}`);
  await c.getByLabel("Nombre de joueurs").selectOption("2");
  await c.getByLabel("Table privée").check();
  await c
    .getByLabel("Mot de passe (8 caractères minimum)")
    .fill("secret-browser-password");
  await c.getByRole("button", { name: /Créer la table/ }).click();
  await c.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
  const privateState = await state(c);
  assert(!(await state(d)).tables.some((t) => t.id === privateState.room.id));
  checks++;
  await d.getByLabel("Votre nom").fill("David");
  await d
    .getByRole("button", { name: /Rejoindre une table/ })
    .click();
  await d.getByLabel("Code ou nom de la table").fill(privateState.room.id);
  await d.getByLabel("Mot de passe (table privée)").fill("wrong-password");
  await d.getByRole("button", { name: /^🔑 Rejoindre la table$/ }).click();
  await d
    .getByRole("alert")
    .filter({ hasText: "Mot de passe incorrect" })
    .waitFor();
  await d
    .getByLabel("Mot de passe (table privée)")
    .fill("secret-browser-password");
  await d.getByRole("button", { name: /^🔑 Rejoindre la table$/ }).click();
  await d.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
  checks++;
  // Capacity refusal through HTTP with a genuinely different session.
  const request = await browser.newContext();
  const api = request.request;
  const session = await api.post(`${base}/api/multiplayer`, {
    headers: { Origin: base },
    data: { command: "session" },
  });
  assert.equal(session.status(), 200);
  const full = await api.post(`${base}/api/multiplayer`, {
    headers: { Origin: base },
    data: {
      command: "join",
      requestId: crypto.randomUUID(),
      name: "Extra",
      tableId: privateState.room.id,
      password: "secret-browser-password",
    },
  });
  assert.equal(full.status(), 409);
  checks++;
  const csrf = await api.post(`${base}/api/multiplayer`, {
    headers: { Origin: "https://untrusted.example" },
    data: { command: "session" },
  });
  assert.equal(csrf.status(), 403);
  checks++;
  await a.setViewportSize({ width: 390, height: 950 });
  assert(await a.locator(".online-game").isVisible());
  await a.screenshot({ path: "/home/user/online-mobile.png", fullPage: true });
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} online Chromium integration checks passed (4 isolated browsers + API session)`,
  );
  await request.close();
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
