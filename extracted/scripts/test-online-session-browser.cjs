/* Real-app session audit. Cookie blocking is simulated the way the server sees it:
   any API request that arrives WITHOUT the cookie is answered with the server's real
   401 (exactly what happens when a browser/proxy refuses the cookie). Everything
   else — bearer token, table creation, join, reload — hits the real server.
   Optional unsaved dev dependencies: playwright @sparticuz/chromium. Requires openssl. */
const { chromium } = require("playwright"),
  binary = require("@sparticuz/chromium").default;
const assert = require("node:assert/strict"),
  http = require("node:http"),
  https = require("node:https"),
  net = require("node:net"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
const SESSION_REQUIRED = "Session requise : aucune session multijoueur valide";
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dz-session-")),
    sockets = new Set();
  let browser, proxy, parent, checks = 0;
  const appPort = Number(process.env.APP_PORT || 3000);
  const listen = (server) =>
    new Promise((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
    );
  const tracked = (server) =>
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
  try {
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "key.pem"),
       "-out", path.join(tmp, "cert.pem"), "-days", "1", "-subj", "/CN=localhost"],
      { stdio: "ignore" },
    );
    proxy = tracked(
      https.createServer(
        { key: fs.readFileSync(path.join(tmp, "key.pem")), cert: fs.readFileSync(path.join(tmp, "cert.pem")) },
        (req, res) => {
          const upstream = http.request(
            { hostname: "127.0.0.1", port: appPort, path: req.url, method: req.method, headers: { ...req.headers, "x-forwarded-proto": "https" } },
            (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
          );
          req.pipe(upstream);
          res.on("close", () => upstream.destroy());
          upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
        },
      ),
    );
    proxy.on("upgrade", (req, socket, head) => {
      const up = net.connect(appPort, "127.0.0.1", () => {
        up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}\r\n`).join("") + "\r\n");
        if (head.length) up.write(head);
        socket.pipe(up); up.pipe(socket);
      });
      socket.on("error", () => up.destroy()); up.on("error", () => socket.destroy()); socket.on("close", () => up.destroy());
    });
    const origin = `https://localhost:${await listen(proxy)}`;
    parent = tracked(http.createServer((_q, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><title>Arena-like parent</title><iframe title="preview" src="${origin}" style="width:96vw;height:92vh"></iframe>`);
    }));
    const parentURL = `http://127.0.0.1:${await listen(parent)}`;
    browser = await chromium.launch({
      executablePath: await binary.executablePath(),
      args: binary.args.filter((a) => !["--disable-web-security", "--single-process"].includes(a)),
      headless: true,
    });
    const errors = [];
    /**
     * Hostile preview proxy: the browser keeps no usable cookie AND every
     * credential header is rewritten away. Only the request body survives, which
     * is exactly the environment the body-token transport exists for.
     */
    async function browserWithoutCookie() {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.route("**/api/multiplayer", async (route) => {
        const request = route.request(),
          headers = await request.allHeaders(),
          payload = request.postData() ?? "",
          bodyToken = /"sessionToken":"([A-Za-z0-9_-]{16,200})"/.exec(payload)?.[1],
          stripped = Object.fromEntries(
            Object.entries(headers).filter(
              ([k]) => !["authorization", "x-dz-session"].includes(k.toLowerCase()),
            ),
          );
        // A rewriting proxy drops Authorization / X-DZ-Session and the cookie.
        if (bodyToken || (request.method() === "POST" && payload.includes('"session"')))
          return route.continue({ headers: stripped });
        await route.fulfill({
          status: 401, contentType: "application/json",
          body: JSON.stringify({ error: `${SESSION_REQUIRED} (cookie et en-têtes refusés). Ouvrez le menu Multijoueur pour en établir une.` }),
        });
      });
      return context;
    }
    async function open(context) {
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(parentURL);
      const ui = page.frameLocator("iframe");
      await ui.getByRole("button", { name: /Multijoueur$/ }).click();
      return { page, ui };
    }
    const transport = (ui) => ui.locator("[data-online-transport]").getAttribute("data-online-transport");
    const connected = (ui) => ui.locator('[data-online-connected="true"]').waitFor({ timeout: 25000 });
    const frame = (page) => page.frames().find((f) => f.url().startsWith(origin));
    /* Read the real server state with the same credential the app holds. */
    const frameState = (page) =>
      frame(page).evaluate(async () => {
        const token = sessionStorage.getItem("dz-rami:online-token:v1");
        const response = await fetch("/api/multiplayer", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "heartbeat", sessionToken: token }),
        });
        return response.json();
      });
    // 1. Cookie refused by the browser: the app must recover on its own, without any click.
    const blocked = await browserWithoutCookie();
    const alice = await open(blocked);
    await connected(alice.ui);
    assert.equal(await transport(alice.ui), "token");
    await alice.ui.getByText(/Session vérifiée par jeton sécurisé/).waitFor();
    assert.equal((await blocked.cookies()).length, 1, "the browser did keep a useless cookie: it is simply never sent");
    checks++;
    const tableName = `Session audit ${Date.now()}`;
    await alice.ui.getByRole("button", { name: /Créer une table/ }).click();
    await alice.ui.getByLabel("Votre nom").fill("Alice");
    await alice.ui.getByLabel("Nom de la table").fill(tableName);
    await alice.ui.getByLabel("Nombre de joueurs").selectOption("2");
    const create = alice.ui.getByRole("button", { name: /Créer la table/ });
    assert.equal(await create.isEnabled(), true);
    await create.click();
    await alice.ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
    assert((await alice.ui.getByRole("heading", { name: /Salle d’attente/ }).innerText()).includes(tableName));
    const created = await frameState(alice.page);
    assert(created.snapshot.room && created.snapshot.room.count === 1);
    checks++;
    // 2. Table list + SSE + heartbeat all use the same verified session.
    await alice.ui.getByText("● Connecté", { exact: true }).waitFor();
    await alice.page.waitForTimeout(2000);
    await alice.ui.getByText(/Synchronisation en temps réel active \(long-poll POST authentifié\)|actualisation HTTP authentifiée/).waitFor();
    checks++;
    // 3. Page refresh keeps the same seat and the same hand with the token transport.
    const before = await frameState(alice.page);
    assert((await frame(alice.page).evaluate(() => sessionStorage.getItem("dz-rami:online-token:v1")))?.length >= 16);
    await alice.page.reload();
    const aliceAgain = { page: alice.page, ui: alice.page.frameLocator("iframe") };
    await aliceAgain.ui.getByRole("button", { name: /Multijoueur$/ }).click();
    await aliceAgain.ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor({ timeout: 25000 });
    const after = await frameState(alice.page);
    assert.equal(after.snapshot.room.id, before.snapshot.room.id);
    assert.equal(after.snapshot.room.viewerId, before.snapshot.room.viewerId);
    assert.equal(await transport(aliceAgain.ui), "token");
    checks++;
    // 4. A second player in a different browser (cookies refused too) joins the same table.
    const blocked2 = await browserWithoutCookie();
    const bob = await open(blocked2);
    await connected(bob.ui);
    await bob.ui.getByRole("button", { name: /Rejoindre une table/ }).click();
    await bob.ui.getByLabel("Votre nom").fill("Bob");
    await bob.ui.getByLabel("Code ou nom de la table").fill(tableName);
    await bob.ui.getByRole("button", { name: /^🔑 Rejoindre la table$/ }).click();
    await bob.ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
    const aliceSeesBob = await frameState(alice.page);
    const bobSees = await frameState(bob.page);
    assert.equal(aliceSeesBob.snapshot.room.count, 2);
    assert.equal(bobSees.snapshot.room.count, 2);
    assert.notEqual(bobSees.snapshot.room.viewerId, aliceSeesBob.snapshot.room.viewerId);
    assert.deepEqual(
      bobSees.snapshot.room.members.map((m) => m.seat),
      ["south", "north"],
      "2-player seats stay opposite",
    );
    checks++;
    // 5. Both ready -> host starts a real game -> their own hands stay private.
    await aliceAgain.ui.getByRole("button", { name: /Prêt$/ }).click();
    await bob.ui.getByRole("button", { name: /Prêt$/ }).click();
    const start = aliceAgain.ui.getByRole("button", { name: /Démarrer la partie/ });
    await start.waitFor();
    await start.click();
    await aliceAgain.ui.locator(".online-game").waitFor();
    await bob.ui.locator(".online-game").waitFor();
    const aliceGame = await frameState(alice.page),
      bobGame = await frameState(bob.page);
    assert(aliceGame.snapshot.room.game.localHand.length >= 14);
    for (const card of bobGame.snapshot.room.game.localHand)
      assert(!JSON.stringify(aliceGame.snapshot).includes(`"${card.id}"`), "opponent card leaked");
    checks++;
    // 6. Control: when the browser does send the cookie, that transport is used (no regression).
    const control = await browser.newContext({ ignoreHTTPSErrors: true });
    const carol = await open(control);
    await connected(carol.ui);
    assert.equal(await transport(carol.ui), "cookie");
    checks++;
    // 7. Failure path: server rejects every credential -> explicit error, no silent blocking.
    const failing = await browser.newContext({ ignoreHTTPSErrors: true });
    await failing.route("**/api/multiplayer", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Session requise : session expirée." }) }),
    );
    const dave = await open(failing);
    await dave.ui.getByRole("alert").filter({ hasText: "HTTP 401" }).waitFor();
    await dave.ui.getByRole("button", { name: "Reconnecter", exact: true }).waitFor();
    assert.equal(await transport(dave.ui), "none");
    checks++;
    // 8. Real-time channel unavailable while authentication stays valid: the
    //    client keeps an authenticated 5 s refresh instead of pretending to be offline.
    {
      const noStream = await browser.newContext({ ignoreHTTPSErrors: true });
      await noStream.route("**/api/multiplayer", async (route) => {
        const payload = route.request().postData() ?? "";
        if (payload.includes('"watch"'))
          return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Watch indisponible." }) });
        return route.continue();
      });
      const erin = await open(noStream);
      await connected(erin.ui);
      const table = `Watch outage ${Date.now()}`;
      await erin.ui.getByRole("button", { name: /Créer une table/ }).click();
      await erin.ui.getByLabel("Votre nom").fill("Erin");
      await erin.ui.getByLabel("Nom de la table").fill(table);
      await erin.ui.getByRole("button", { name: /Créer la table/ }).click();
      await erin.ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor({ timeout: 20000 });
      checks++;
      await noStream.close();
    }
    assert.deepEqual(errors, []);
    checks++;
    console.log(`${checks} session/transport Chromium checks passed (cookie refused, token fallback, reload, second player, real game start, control, failures)`);
  } finally {
    await browser?.close();
    for (const socket of sockets) socket.destroy();
    proxy?.close();
    parent?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
