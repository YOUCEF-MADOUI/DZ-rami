/* Real-browser check of the table-creation flow and its rules.
   - the real app is served behind a TLS proxy and embedded in a cross-site parent;
   - the session cookie is refused (hostile preview proxy), so the token path is exercised;
   - every creation, join and reload goes through the real server.
   Usage: APP_PORT=3000 NODE_PATH=<browser tools> LD_LIBRARY_PATH=<chromium libs> \
          node scripts/test-online-rules-browser.cjs                                  */
const { chromium } = require("playwright"), binary = require("@sparticuz/chromium").default;
const assert = require("node:assert/strict"), http = require("node:http"), https = require("node:https");
const net = require("node:net"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const APP = Number(process.env.APP_PORT || 3000);
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dz-rules-")), sockets = new Set();
  let browser, proxy, parent, checks = 0;
  const listen = s => new Promise(r => s.listen(0, "127.0.0.1", () => r(s.address().port)));
  const tracked = s => s.on("connection", c => { sockets.add(c); c.on("close", () => sockets.delete(c)); });
  try {
    execFileSync("openssl", ["req","-x509","-newkey","rsa:2048","-nodes","-keyout",path.join(tmp,"k.pem"),"-out",path.join(tmp,"c.pem"),"-days","1","-subj","/CN=localhost"],{stdio:"ignore"});
    proxy = tracked(https.createServer({key:fs.readFileSync(path.join(tmp,"k.pem")),cert:fs.readFileSync(path.join(tmp,"c.pem"))},(req,res)=>{
      const up=http.request({hostname:"127.0.0.1",port:APP,path:req.url,method:req.method,headers:{...req.headers,"x-forwarded-proto":"https"}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
      req.pipe(up);res.on("close",()=>up.destroy());up.on("error",()=>{if(!res.headersSent)res.writeHead(502);res.end()});
    }));
    proxy.on("upgrade",(req,socket,head)=>{const up=net.connect(APP,"127.0.0.1",()=>{up.write(`${req.method} ${req.url} HTTP/1.1\r\n`+Object.entries(req.headers).map(([k,v])=>`${k}: ${v}\r\n`).join("")+"\r\n");if(head.length)up.write(head);socket.pipe(up);up.pipe(socket)});socket.on("error",()=>up.destroy());up.on("error",()=>socket.destroy());socket.on("close",()=>up.destroy())});
    const origin = `https://localhost:${await listen(proxy)}`;
    parent = tracked(http.createServer((_q,res)=>{res.setHeader("Content-Type","text/html");res.end(`<!doctype html><iframe title="preview" src="${origin}" style="width:96vw;height:92vh"></iframe>`)}));
    const parentURL = `http://127.0.0.1:${await listen(parent)}`;
    browser = await chromium.launch({executablePath: await binary.executablePath(), args: binary.args.filter(a=>!["--disable-web-security","--single-process"].includes(a)), headless:true});
    const errors = [];
    /** Each browser refuses the cookie and every credential header (worst preview case). */
    async function browserWithoutCookie() {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.route("**/api/multiplayer", async route => {
        const request = route.request(), headers = await request.allHeaders(), payload = request.postData() ?? "";
        const bodyToken = /"sessionToken":"([A-Za-z0-9_-]{16,200})"/.exec(payload)?.[1];
        const stripped = Object.fromEntries(Object.entries(headers).filter(([k]) => !["authorization","x-dz-session","cookie"].includes(k.toLowerCase())));
        if (bodyToken || (request.method() === "POST" && payload.includes('"session"'))) return route.continue({ headers: stripped });
        return route.fulfill({status:401,contentType:"application/json",body:JSON.stringify({error:"Session requise (proxy d’aperçu simulé)."})});
      });
      return context;
    }
    async function open(context) {
      const page = await context.newPage();
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(parentURL);
      const ui = page.frameLocator("iframe");
      await ui.getByRole("button", { name: /Multijoueur$/ }).click();
      await ui.locator('[data-online-connected="true"]').waitFor({ timeout: 30000 });
      return { page, ui };
    }
    const frame = page => page.frames().find(f => f.url().startsWith(origin));
    /** Reads the authoritative server state with the credential the app holds. */
    const serverRoom = page => frame(page).evaluate(async () => {
      const token = sessionStorage.getItem("dz-rami:online-token:v1");
      const response = await fetch("/api/multiplayer", {method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:"heartbeat",sessionToken:token})});
      const data = await response.json();
      return data.snapshot.room ?? null;
    });
    const rules = room => ({
      variant: room.config.variant, playerCount: room.config.playerCount,
      chopObligatoire: room.config.chopObligatoire, chopSeulementOuverture: room.config.chopSeulementOuverture,
      chopCarteObligatoireAJouer: room.config.chopCarteObligatoireAJouer, tierceObligatoire: room.config.tierceObligatoire,
      rsScorePerCard: room.config.rsScorePerCard, maxCycles: room.config.maxCycles, targetScore: room.config.targetScore,
    });
    const NUMBER_LABEL = { maxCycles: "Nombre max de cycles", malusChopOuverture: "Malus CHOP ouverture", rsScorePerCard: "RS par carte restante" };
    const setNumber = async (ui, field, direction, times) => {
      const label = NUMBER_LABEL[field];
      for (let i = 0; i < times; i += 1)
        await ui.locator(`[data-setting="${field}"]`).getByRole("button", { name: direction === "up" ? `Augmenter ${label}` : `Diminuer ${label}` }).click();
    };
    const switchOf = {
      chopObligatoire: "CHOP obligatoire",
      chopSeulementOuverture: "CHOP uniquement pour ouverture",
      chopCarteObligatoireAJouer: "Carte CHOP obligatoire à jouer ce tour",
      tierceObligatoire: "Tierce obligatoire à l'ouverture",
    };
    const clickToggle = async (ui, field) => ui.locator(`[data-setting="${field}"]`).getByRole("switch", { name: switchOf[field] }).click();
    const openCreate = async (ui, name) => {
      await ui.getByLabel("Votre nom").fill(name);
      await ui.getByRole("button", { name: /Créer une table/ }).click();
    };
    // ---- 1. Public table with the default rules -----------------------------
    {
      const context = await browserWithoutCookie();
      const { page, ui } = await open(context);
      await openCreate(ui, "Alice");
      const tableName = `Défaut ${Date.now()}`;
      await ui.getByLabel("Nom de la table").fill(tableName);
      await ui.getByLabel("Nombre de joueurs").selectOption("3");
      // The summary is visible before creating, and the confirm button is explicit.
      await ui.locator("[data-create-rules-summary]").waitFor();
      const confirm = ui.getByRole("button", { name: "➕ Créer la table" });
      assert.equal(await confirm.isEnabled(), true);
      await confirm.click();
      await ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
      const room = await serverRoom(page);
      assert.equal(room.config.playerCount, 3);
      assert.equal(room.config.chopObligatoire, false);
      assert.equal(room.config.tierceObligatoire, false);
      assert.equal(room.config.maxCycles, 3);
      assert.equal(room.id && room.name === tableName, true);
      checks++;
      await context.close();
    }
    // ---- 2. Custom rules ------------------------------------------------------
    let customA;
    {
      const context = await browserWithoutCookie();
      const { page, ui } = await open(context);
      await openCreate(ui, "Bob");
      const tableName = `Personnalisée ${Date.now()}`;
      await ui.getByLabel("Nom de la table").fill(tableName);
      await ui.getByLabel("Nombre de joueurs").selectOption("2");
      await ui.locator("[data-create-rules-toggle]").click();
      await clickToggle(ui, "tierceObligatoire");
      await clickToggle(ui, "chopSeulementOuverture");
      await setNumber(ui, "maxCycles", "up", 2);
      await setNumber(ui, "rsScorePerCard", "up", 1);
      await ui.getByRole("button", { name: "➕ Créer la table" }).click();
      await ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
      const room = await serverRoom(page);
      assert.equal(room.config.tierceObligatoire, true);
      assert.equal(room.config.chopSeulementOuverture, true);
      assert.equal(room.config.maxCycles, 5);
      assert.equal(room.config.rsScorePerCard, 20);
      customA = { context, page, ui, room, tableName, rules: rules(room) };
      // The waiting room shows the host rules, read-only, to everyone.
      await ui.locator("[data-room-rules-summary]").waitFor();
      assert((await ui.locator("[data-room-rules-summary]").innerText()).includes("Tierce obligatoire : oui"));
      checks++;
    }
    // ---- 3. A second browser joins and gets exactly those rules --------------
    {
      const context = await browserWithoutCookie();
      const { page, ui } = await open(context);
      await ui.getByLabel("Votre nom").fill("Carol");
      await ui.getByRole("button", { name: /Rejoindre une table/ }).click();
      await ui.getByLabel("Code ou nom de la table").fill(String(customA.room.id));
      await ui.getByRole("button", { name: "🔑 Rejoindre la table" }).click();
      await ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
      const joined = await serverRoom(page);
      assert.deepEqual(rules(joined), customA.rules, "the joiner must use the host rules");
      assert.notEqual(joined.viewerId, customA.room.viewerId);
      // Everything is read-only for the joiner: no editable rule control.
      await ui.locator("[data-room-rules-summary]").waitFor();
      assert.equal(await ui.locator('[data-setting] input, [data-setting] button:not([disabled])').count(), 0, "a joiner cannot edit the host rules");
      checks++;
      // The two players really see each other.
      assert.equal((await serverRoom(customA.page)).count, 2);
      checks++;
      await context.close();
    }
    // ---- 4. Reload keeps the same table and the same rules -------------------
    {
      await customA.page.reload();
      const ui = customA.page.frameLocator("iframe");
      await ui.getByRole("button", { name: /Multijoueur$/ }).click();
      await ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor({ timeout: 30000 });
      const afterReload = await serverRoom(customA.page);
      assert.equal(afterReload.id, customA.room.id);
      assert.deepEqual(rules(afterReload), customA.rules, "a reload must not change the table rules");
      checks++;
      await customA.context.close();
    }
    // ---- 5. Two tables stay independent --------------------------------------
    {
      const contextA = await browserWithoutCookie(), contextB = await browserWithoutCookie();
      const a = await open(contextA), b = await open(contextB);
      await openCreate(a.ui, "Dan");
      await a.ui.getByLabel("Nom de la table").fill(`Indépendante A ${Date.now()}`);
      await a.ui.getByLabel("Nombre de joueurs").selectOption("2");
      await a.ui.locator("[data-create-rules-toggle]").click();
      await clickToggle(a.ui, "tierceObligatoire");
      await a.ui.getByRole("button", { name: "➕ Créer la table" }).click();
      await a.ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
      await openCreate(b.ui, "Eve");
      await b.ui.getByLabel("Nom de la table").fill(`Indépendante B ${Date.now()}`);
      await b.ui.getByLabel("Nombre de joueurs").selectOption("5");
      await b.ui.locator("[data-create-rules-toggle]").click();
      await setNumber(b.ui, "maxCycles", "up", 3);
      await b.ui.getByRole("button", { name: "➕ Créer la table" }).click();
      await b.ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
      const roomA = await serverRoom(a.page), roomB = await serverRoom(b.page);
      assert.equal(roomA.config.tierceObligatoire, true);
      assert.equal(roomA.config.playerCount, 2);
      assert.equal(roomA.config.maxCycles, 3);
      assert.equal(roomB.config.tierceObligatoire, false);
      assert.equal(roomB.config.playerCount, 5);
      assert.equal(roomB.config.maxCycles, 6);
      assert.notEqual(roomA.id, roomB.id);
      // Changing the general settings afterwards cannot touch existing tables.
      await a.page.goto(parentURL);
      const home = a.page.frameLocator("iframe");
      await home.getByRole("button", { name: /Paramètres/ }).click();
      await home.locator('[data-setting="maxCycles"]').getByRole("button", { name: "Augmenter Nombre max de cycles" }).click();
      await home.getByRole("button", { name: /Sauvegarder/ }).click();
      assert.equal((await serverRoom(a.page)).config.maxCycles, 3, "general settings must not alter a created table");
      checks++;
      await contextA.close(); await contextB.close();
    }
    // ---- 5b. Private table with a password ----------------------------------
    {
      const context = await browserWithoutCookie(), guestContext = await browserWithoutCookie();
      const { page, ui } = await open(context);
      await openCreate(ui, "Ghania");
      const privateName = `Privée ${Date.now()}`;
      await ui.getByLabel("Nom de la table").fill(privateName);
      await ui.getByLabel("Nombre de joueurs").selectOption("2");
      await ui.getByLabel("Table privée").check();
      await ui.getByLabel("Mot de passe (8 caractères minimum)").fill("secret-regles-1");
      await ui.locator("[data-create-rules-toggle]").click();
      await clickToggle(ui, "chopCarteObligatoireAJouer");
      await ui.getByRole("button", { name: "➕ Créer la table" }).click();
      await ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
      const privateRoom = await serverRoom(page);
      assert.equal(privateRoom.config.chopCarteObligatoireAJouer, true);
      // A private table never appears in the public list.
      const guest = await open(guestContext);
      await guest.ui.getByLabel("Votre nom").fill("Hicham");
      const listed = await frame(guest.page).evaluate(async () => {
        const token = sessionStorage.getItem("dz-rami:online-token:v1");
        const response = await fetch("/api/multiplayer", {method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:"heartbeat",sessionToken:token})});
        const data = await response.json();
        return data.snapshot.tables;
      });
      assert.equal(listed.some(t => t.id === privateRoom.id), false, "a private table must not be listed");
      await guest.ui.getByRole("button", { name: /Rejoindre une table/ }).click();
      await guest.ui.getByLabel("Code ou nom de la table").fill(privateName);
      await guest.ui.getByLabel("Mot de passe (table privée)").fill("mauvais-mot-de-passe");
      await guest.ui.getByRole("button", { name: "🔑 Rejoindre la table" }).click();
      await guest.ui.getByRole("alert").filter({ hasText: "Mot de passe incorrect" }).waitFor();
      await guest.ui.getByLabel("Mot de passe (table privée)").fill("secret-regles-1");
      await guest.ui.getByRole("button", { name: "🔑 Rejoindre la table" }).click();
      await guest.ui.getByRole("heading", { name: /Salle d’attente/ }).waitFor();
      assert.equal((await serverRoom(guest.page)).config.chopCarteObligatoireAJouer, true);
      checks++;
      await context.close(); await guestContext.close();
    }
    // ---- 5c. Navigation and buttons match the historic screens --------------
    {
      const context = await browserWithoutCookie();
      const page = await context.newPage();
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(parentURL);
      const ui = page.frameLocator("iframe");
      const readChrome = target => target.evaluate(() => {
        const back = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim().replace(/\s+/g, " ") === "← Retour");
        const header = Array.from(document.querySelectorAll("div")).find(d => /p-4/.test(d.className) && /border-b/.test(d.className));
        const style = back ? getComputedStyle(back) : null;
        const title = document.querySelector("h2");
        return {
          headerClass: header?.className ?? "",
          color: style?.color ?? "",
          weight: style?.fontWeight ?? "",
          title: title?.textContent?.trim() ?? "",
          titleColor: title ? getComputedStyle(title).color : "",
        };
      });
      // Reference: the Paramètres screen, unchanged by the multiplayer work.
      await ui.getByRole("button", { name: /Paramètres/ }).click();
      await ui.getByRole("heading", { name: /Paramètres/ }).waitFor();
      const reference = await readChrome(frame(page));
      await ui.getByRole("button", { name: "← Retour" }).click();
      await ui.getByRole("button", { name: /Multijoueur$/ }).click();
      await ui.locator('[data-online-connected="true"]').waitFor({ timeout: 30000 });
      const lobby = await readChrome(frame(page));
      assert.equal(lobby.headerClass, reference.headerClass, "same header bar as Settings");
      assert.equal(lobby.color, reference.color, "← Retour keeps the amber colour");
      assert.equal(lobby.weight, reference.weight, "← Retour keeps its weight");
      assert.equal(lobby.titleColor, reference.titleColor, "screen title keeps the amber colour");
      assert(lobby.title.includes("Multijoueur"));
      // Menu buttons share the app button classes and one single width.
      const menu = frame(page).locator("[data-lobby-menu] button.btn-primary");
      assert(await menu.count() >= 2);
      const widths = await menu.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().width)));
      assert.equal(new Set(widths).size, 1, `menu buttons must share one width: ${widths.join(",")}`);
      // Same navigation path as before: create → ← Retour returns to the menu list.
      await frame(page).getByRole("button", { name: /Créer une table/ }).click();
      await frame(page).getByRole("button", { name: "← Retour" }).click();
      assert(await frame(page).getByRole("button", { name: /Créer une table/ }).isVisible());
      checks++;
      await context.close();
    }
    assert.deepEqual(errors, []);
    checks++;
    console.log(`${checks} table-rules Chromium checks passed (default, custom, private/join, reload, two independent tables, 2v2 locks, settings isolation)`);
  } finally {
    await browser?.close();
    for (const s of sockets) s.destroy();
    proxy?.close(); parent?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error("ÉCHEC :", e.message); process.exit(1); });
