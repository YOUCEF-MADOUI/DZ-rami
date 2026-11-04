/* Real app + real authoritative API. Only failure scenarios intercept transport/cookie delivery.
   Start Next on port 3000 (ideally a separate MULTIPLAYER_STORE_PATH), then:
   LD_LIBRARY_PATH=/path/to/chromium/libs node scripts/test-online-form-browser.cjs
   Optional unsaved dev dependencies: playwright @sparticuz/chromium. Requires openssl. */
const { chromium } = require("playwright"),
  binary = require("@sparticuz/chromium").default;
const assert = require("node:assert/strict"),
  http = require("node:http"),
  https = require("node:https"),
  net = require("node:net");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dz-form-browser-"));
  let browser, proxy, parent;
  const sockets = new Set();
  let checks = 0;
  const port = Number(process.env.APP_PORT || 3000);
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
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        path.join(tmp, "key.pem"),
        "-out",
        path.join(tmp, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
      ],
      { stdio: "ignore" },
    );
    proxy = tracked(
      https.createServer(
        {
          key: fs.readFileSync(path.join(tmp, "key.pem")),
          cert: fs.readFileSync(path.join(tmp, "cert.pem")),
        },
        (req, res) => {
          const upstream = http.request(
            {
              hostname: "127.0.0.1",
              port,
              path: req.url,
              method: req.method,
              headers: { ...req.headers, "x-forwarded-proto": "https" },
            },
            (r) => {
              res.writeHead(r.statusCode, r.headers);
              r.pipe(res);
            },
          );
          req.pipe(upstream);
          res.on("close", () => upstream.destroy());
          upstream.on("error", () => {
            if (!res.headersSent) res.writeHead(502);
            res.end();
          });
        },
      ),
    );
    proxy.on("upgrade", (req, socket, head) => {
      const up = net.connect(port, "127.0.0.1", () => {
        up.write(
          `${req.method} ${req.url} HTTP/1.1\r\n` +
            Object.entries(req.headers)
              .map(([k, v]) => `${k}: ${v}\r\n`)
              .join("") +
            "\r\n",
        );
        if (head.length) up.write(head);
        socket.pipe(up);
        up.pipe(socket);
      });
      socket.on("error", () => up.destroy());
      up.on("error", () => socket.destroy());
      socket.on("close", () => up.destroy());
    });
    const origin = `https://localhost:${await listen(proxy)}`;
    parent = tracked(
      http.createServer((_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(
          `<iframe title="preview" src="${origin}" style="width:95vw;height:95vh"></iframe>`,
        );
      }),
    );
    const parentURL = `http://127.0.0.1:${await listen(parent)}`;
    browser = await chromium.launch({
      executablePath: await binary.executablePath(),
      args: binary.args.filter(
        (a) => !["--disable-web-security", "--single-process"].includes(a),
      ),
      headless: true,
    });
    const errors = [];
    let serial = 0;
    async function open({ embedded = false, intercept } = {}) {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      if (intercept) await intercept(context);
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(embedded ? parentURL : origin);
      const ui = embedded ? page.frameLocator("iframe") : page;
      await ui.getByRole("button", { name: /Multijoueur$/ }).click();
      await ui
        .getByRole("button", { name: /Créer une table/ })
        .click();
      return { page, ui, context };
    }
    const connected = (ui) =>
      ui.getByText("● Connecté", { exact: true }).waitFor();
    const createButton = (ui) =>
      ui.getByRole("button", { name: /Créer la table/ });
    async function fill(ui) {
      const table = `Form audit ${Date.now()}-${serial++}`;
      await ui.getByLabel("Votre nom").fill("Test formulaire");
      await ui.getByLabel("Nom de la table").fill(table);
      return table;
    }
    async function create(ui) {
      await createButton(ui).click();
      await ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
    }
    async function leave(ui) {
      await ui
        .getByRole("button", { name: /Quitter la table/ })
        .click();
      await ui
        .getByRole("button", { name: /Créer une table/ })
        .waitFor();
    }
    // Valid/incomplete public and private forms. All successful creates hit the real API.
    {
      const { context, ui, page } = await open();
      await connected(ui);
      let creates = 0;
      page.on("request", (r) => {
        if (r.postData()?.includes('"command":"create"')) creates++;
      });
      assert(await createButton(ui).isDisabled());
      await ui
        .getByText("Renseignez votre nom de joueur.", { exact: true })
        .waitFor();
      await ui
        .getByText("Renseignez le nom de la table.", { exact: true })
        .waitFor();
      checks++;
      await ui.getByLabel("Votre nom").fill("Alice");
      assert(await createButton(ui).isDisabled());
      await ui.getByLabel("Nom de la table").fill("   ");
      assert(await createButton(ui).isDisabled());
      assert.equal(creates, 0);
      checks++;
      const table = await fill(ui);
      assert(await createButton(ui).isEnabled());
      checks++;
      await ui.getByLabel("Table privée").check();
      assert(await createButton(ui).isDisabled());
      await ui.getByLabel("Mot de passe (8 caractères minimum)").fill("short");
      assert(await createButton(ui).isDisabled());
      await ui
        .getByText(
          "Une table privée exige un mot de passe de 8 à 128 caractères.",
          { exact: true },
        )
        .waitFor();
      checks++;
      await ui
        .getByLabel("Mot de passe (8 caractères minimum)")
        .fill("secret-form-password");
      assert(await createButton(ui).isEnabled());
      await create(ui);
      assert.equal(creates, 1);
      assert(
        (
          await ui.getByRole("heading", { name: /Salle d’attente/ }).innerText()
        ).includes(table),
      );
      checks++;
      await leave(ui);
      await context.close();
    }
    // Actual cross-site iframe, TLS proxy and partitioned HttpOnly cookie; no mocked API.
    {
      const { context, ui, page } = await open({ embedded: true });
      await connected(ui);
      await ui
        .getByText(/Synchronisation en temps réel active \(long-poll POST authentifié\)|actualisation HTTP authentifiée/)
        .waitFor();
      const cookie = (await context.cookies()).find(
        (c) => c.name === "dz-rami-online",
      );
      assert(cookie && cookie.secure && cookie.httpOnly);
      assert.equal(cookie.sameSite, "None");
      assert(cookie.partitionKey);
      checks++;
      const frame = page.frames().find((f) => f.url().startsWith(origin));
      assert(
        !(await frame.evaluate(() => document.cookie)).includes(
          "dz-rami-online",
        ),
      );
      checks++;
      await fill(ui);
      assert(await createButton(ui).isEnabled());
      await create(ui);
      const before = await frame.evaluate(() =>
        fetch("/api/multiplayer").then((r) => r.json()),
      );
      assert(before.snapshot.room);
      checks++;
      await page.reload();
      const resumed = page.frameLocator("iframe");
      await resumed.getByRole("button", { name: /Multijoueur$/ }).click();
      await resumed.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
      const newFrame = page.frames().find((f) => f.url().startsWith(origin));
      const after = await newFrame.evaluate(() =>
        fetch("/api/multiplayer").then((r) => r.json()),
      );
      assert.equal(after.snapshot.room.id, before.snapshot.room.id);
      checks++;
      await leave(resumed);
      await context.close();
    }
    // NOTE: cookie-less browsers (session-token fallback) are covered
    // deterministically by scripts/test-online-session-browser.cjs, where a
    // request without the token gets the server's real 401.
    // Server unavailable on first entry, then restored without losing form values.
    {
      const unavailable = (route) => route.abort("connectionrefused");
      const { context, ui } = await open({
        intercept: (c) => c.route("**/api/multiplayer", unavailable),
      });
      await ui
        .getByRole("alert")
        .filter({ hasText: "Impossible de joindre le serveur" })
        .waitFor();
      const table = await fill(ui);
      assert(await createButton(ui).isDisabled());
      checks++;
      await context.unroute("**/api/multiplayer", unavailable);
      await ui
        .getByRole("button", { name: "Reconnecter", exact: true })
        .click();
      await connected(ui);
      assert.equal(await ui.getByLabel("Nom de la table").inputValue(), table);
      await create(ui);
      await leave(ui);
      checks++;
      await context.close();
    }
    // Real-time channel refused while authentication stays valid: the client must
    // keep working through its authenticated 5 s refresh instead of pretending
    // to be offline. (The 5 s heartbeat is covered by test-online-session-browser.)
    {
      const { context, ui } = await open({
        intercept: (c) =>
          c.route("**/api/multiplayer", async (route) => {
            const payload = route.request().postData() ?? "";
            if (payload.includes('"watch"'))
              return route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({ error: "Watch indisponible." }),
              });
            return route.continue();
          }),
      });
      await connected(ui);
      await fill(ui);
      assert(await createButton(ui).isEnabled());
      await create(ui);
      await leave(ui);
      checks++;
      await context.close();
    }
    // Outage after connecting: keep the valid form, disable commands and diagnose heartbeat failure.
    {
      const { context, ui } = await open();
      await connected(ui);
      await fill(ui);
      await context.route("**/api/multiplayer", (route) =>
        route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "Service Unavailable",
        }),
      );
      await ui.getByRole("alert").filter({ hasText: "HTTP 503" }).waitFor();
      assert(await createButton(ui).isDisabled());
      checks++;
      await context.close();
    }
    assert.deepEqual(errors, []);
    checks++;
    console.log(
      `${checks} form/auth Chromium checks passed, including real cross-site HTTPS iframe, creation and reconnection`,
    );
  } finally {
    await browser?.close();
    for (const s of sockets) s.destroy();
    proxy?.close();
    parent?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
