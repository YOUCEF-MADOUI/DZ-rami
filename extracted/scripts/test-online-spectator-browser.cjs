/* Real-browser scenario for seats, spectators and replacement.
   Usage: NODE_PATH=<browser tools> LD_LIBRARY_PATH=<chromium libs> \
          node scripts/test-online-spectator-browser.cjs                      */
const { chromium } = require("playwright"), binary = require("@sparticuz/chromium").default;
const assert = require("node:assert/strict");
const BASE = process.env.APP_BASE || `http://localhost:${process.env.APP_PORT || 3000}`;
(async () => {
  const browser = await chromium.launch({
    executablePath: await binary.executablePath(),
    args: binary.args.filter((a) => !["--disable-web-security", "--single-process"].includes(a)),
    headless: true,
  });
  const errors = [];
  let checks = 0;
  const open = async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    // « Quitter la table » asks for confirmation: accept it in the test.
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(BASE);
    await page.getByRole("button", { name: /Multijoueur$/ }).click();
    await page.locator('[data-online-connected="true"]').waitFor({ timeout: 30000 });
    return { context, page };
  };
  const view = (page) =>
    page.evaluate(async () => {
      const token = sessionStorage.getItem("dz-rami:online-token:v1");
      const identity = localStorage.getItem("dz-rami:player-identity:v1");
      const response = await fetch("/api/multiplayer", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "heartbeat", sessionToken: token, playerIdentity: identity }),
      });
      const data = await response.json();
      return data.snapshot.room;
    });
  const mark = (page, value) => page.evaluate((v) => localStorage.setItem("dz-rami:player-identity:v1", v), value);
  try {
    // ---- table with the replacement option enabled ----
    const host = await open(), guest = await open(), watcher = await open();
    await host.page.getByLabel("Votre nom").fill("Alice");
    await host.page.getByRole("button", { name: /Créer une table/ }).click();
    const table = `Spectateurs ${Date.now()}`;
    await host.page.getByLabel("Nom de la table").fill(table);
    await host.page.getByLabel("Nombre de joueurs").selectOption("2");
    await host.page.getByLabel(/Remplacement d’un joueur/).check();
    await host.page.getByRole("button", { name: /Créer la table/ }).click();
    await host.page.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
    const room = await view(host.page);
    assert.equal(room.allowReplacement, true);
    checks++;
    await guest.page.getByLabel("Votre nom").fill("Bob");
    await guest.page.getByRole("button", { name: /Rejoindre une table/ }).click();
    await guest.page.getByLabel("Code ou nom de la table").fill(table);
    await guest.page.getByRole("button", { name: /Rejoindre la table/ }).click();
    await guest.page.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
    // ---- a spectator joins from the table list, without taking a seat ----
    await watcher.page.getByLabel("Votre nom").fill("Wael");
    await watcher.page
      .locator("div.bg-slate-800")
      .filter({ hasText: table })
      .getByRole("button", { name: /Spectateur/ })
      .click();
    await watcher.page.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
    const watcherView = await view(watcher.page);
    assert.equal(watcherView.viewerRole, "spectator");
    assert.equal(watcherView.count, 2, "the spectator did not take a seat");
    assert.equal(watcherView.spectators.length, 1);
    await host.page.locator("[data-room-spectators]").getByText(/Wael/).waitFor({ timeout: 20000 });
    checks++;
    // the table list shows the watcher count
    const listed = await host.page.evaluate(async () => {
      const token = sessionStorage.getItem("dz-rami:online-token:v1");
      const identity = localStorage.getItem("dz-rami:player-identity:v1");
      const r = await fetch("/api/multiplayer", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "heartbeat", sessionToken: token, playerIdentity: identity }),
      });
      return (await r.json()).snapshot.tables;
    });
    assert.equal(listed.find((t) => t.name === table).spectatorCount, 1);
    checks++;
    // ---- start the game: the watcher sees the table but has no hand ----
    await host.page.getByRole("button", { name: /Prêt$/ }).click();
    await guest.page.getByRole("button", { name: /Prêt$/ }).click();
    const start = host.page.getByRole("button", { name: /Démarrer la partie/ });
    await start.waitFor();
    await start.click();
    await watcher.page.locator(".online-game, [data-spectator-banner]").first().waitFor({ timeout: 30000 });
    await watcher.page.locator("[data-spectator-banner]").waitFor({ timeout: 30000 });
    assert.equal(await watcher.page.locator(".hand-actions").count(), 0, "a spectator has no action bar");
    assert.equal(await watcher.page.locator(".hand-fan").count(), 0, "a spectator has no hand");
    const spectatorGame = (await view(watcher.page)).game;
    assert.equal(spectatorGame.localHand.length, 0);
    assert.equal(spectatorGame.actions, null);
    checks++;
    // ---- Bob leaves: the seat becomes replaceable, then Wael takes it ----
    await guest.page.getByRole("button", { name: /Quitter la table/ }).click();
    await watcher.page.getByRole("button", { name: /Prendre le siège de Bob/ }).waitFor({ timeout: 30000 });
    await watcher.page.getByRole("button", { name: /Prendre le siège de Bob/ }).click();
    await watcher.page.locator(".hand-fan").waitFor({ timeout: 30000 });
    const taken = await view(watcher.page);
    assert.equal(taken.viewerRole, "player");
    assert.equal(taken.viewerId, "player-1", "same seat as the player who left");
    assert.equal(taken.leftSeats.length, 0);
    assert(taken.game.localHand.length > 0, "the hand of the left player continues");
    assert.equal(await watcher.page.locator("[data-spectator-banner]").count(), 0);
    checks++;
    // ---- the new owner reloads: same seat, found again through its identity ----
    await watcher.page.reload();
    await watcher.page.getByRole("button", { name: /Multijoueur$/ }).click();
    // The game is running: the playing screen is what comes back, not the lobby.
    await watcher.page.locator(".online-game").waitFor({ timeout: 30000 });
    const reclaimed = await view(watcher.page);
    assert.equal(reclaimed.id, room.id, "the same table");
    assert.equal(reclaimed.viewerId, "player-1", "the same seat is reclaimed through the identity");
    assert.equal(reclaimed.viewerRole, "player");
    checks++;
    // ---- the player who left does not get a duplicate seat either ----
    await guest.page.reload();
    await guest.page.getByRole("button", { name: /Multijoueur$/ }).click();
    await guest.page.locator('[data-online-connected="true"]').waitFor({ timeout: 30000 });
    const backAsGuest = await view(guest.page);
    assert.equal(backAsGuest, null, "no seat is duplicated for the browser that left");
    checks++;
    // ---- a brand new browser identity never steals that seat ----
    const stranger = await open();
    await mark(stranger.page, "f".repeat(64));
    const stolen = await stranger.page.evaluate(async () => {
      const identity = localStorage.getItem("dz-rami:player-identity:v1");
      const r = await fetch("/api/multiplayer", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "join", name: "Intrus", tableId: location.href, playerIdentity: identity }),
      });
      return r.status;
    });
    assert.notEqual(stolen, 200, "a foreign identity cannot take a held seat");
    checks++;
    assert.deepEqual(errors, []);
    checks++;
    console.log(`${checks} spectator/seat Chromium checks passed (watch without a hand, replacement, identity reclaim)`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("ÉCHEC :", e.message);
  process.exit(1);
});
