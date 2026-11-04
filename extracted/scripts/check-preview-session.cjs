/* End-to-end preview check, driving the REAL interface:
   - a TLS proxy and a cross-site parent reproduce the preview embedding;
   - every API request loses its cookie and its credential headers, exactly like a
     rewriting preview proxy — only the POST body survives.
   The app must still connect, create a real table and keep its seat after a reload.
   Usage: APP_PORT=3000 NODE_PATH=<browser-tools> LD_LIBRARY_PATH=<chromium-libs> \
          node scripts/check-preview-session.cjs
   Browser tools (playwright + @sparticuz/chromium) must be installed OUTSIDE this
   project: installing them here removes a transitive Tailwind dependency and
   breaks the dev server CSS build. */
const { chromium } = require("playwright"), binary = require("@sparticuz/chromium").default;
const assert = require("node:assert/strict"), http = require("node:http"), https = require("node:https");
const net = require("node:net"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFileSync } = require("node:child_process");
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dz-preview-")), sockets = new Set();
  let browser, proxy, parent;
  const listen = s => new Promise(r => s.listen(0, "127.0.0.1", () => r(s.address().port)));
  const tracked = s => s.on("connection", c => { sockets.add(c); c.on("close", () => sockets.delete(c)); });
  try {
    execFileSync("openssl", ["req","-x509","-newkey","rsa:2048","-nodes","-keyout",path.join(tmp,"k.pem"),"-out",path.join(tmp,"c.pem"),"-days","1","-subj","/CN=localhost"],{stdio:"ignore"});
    proxy = tracked(https.createServer({key:fs.readFileSync(path.join(tmp,"k.pem")),cert:fs.readFileSync(path.join(tmp,"c.pem"))},(req,res)=>{
      const up=http.request({hostname:"127.0.0.1",port:Number(process.env.APP_PORT||3000),path:req.url,method:req.method,headers:{...req.headers,"x-forwarded-proto":"https"}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
      req.pipe(up);res.on("close",()=>up.destroy());up.on("error",()=>{if(!res.headersSent)res.writeHead(502);res.end()});
    }));
    proxy.on("upgrade",(req,socket,head)=>{const up=net.connect(3000,"127.0.0.1",()=>{up.write(`${req.method} ${req.url} HTTP/1.1\r\n`+Object.entries(req.headers).map(([k,v])=>`${k}: ${v}\r\n`).join("")+"\r\n");if(head.length)up.write(head);socket.pipe(up);up.pipe(socket)});socket.on("error",()=>up.destroy());up.on("error",()=>socket.destroy());socket.on("close",()=>up.destroy())});
    const origin = `https://localhost:${await listen(proxy)}`;
    parent = tracked(http.createServer((_q,res)=>{res.setHeader("Content-Type","text/html");res.end(`<!doctype html><iframe src="${origin}" style="width:96vw;height:92vh"></iframe>`)}));
    const parentURL = `http://127.0.0.1:${await listen(parent)}`;
    browser = await chromium.launch({executablePath: await binary.executablePath(), args: binary.args.filter(a=>!["--disable-web-security","--single-process"].includes(a)), headless:true});
    const context = await browser.newContext({ignoreHTTPSErrors:true});
    const log = [];
    await context.route("**/api/multiplayer", async route => {
      const request = route.request(), headers = await request.allHeaders(), payload = request.postData() ?? "";
      const bodyToken = /"sessionToken":"([A-Za-z0-9_-]{16,200})"/.exec(payload)?.[1];
      const stripped = Object.fromEntries(Object.entries(headers).filter(([k]) => !["authorization","x-dz-session","cookie"].includes(k.toLowerCase())));
      log.push(`${request.method()} ${bodyToken ? "body-token" : "anonymous"} → ${bodyToken || payload.includes('"session"') ? "sent" : "401 by proxy"}`);
      if (bodyToken || payload.includes('"session"')) return route.continue({headers: stripped});
      return route.fulfill({status:401,contentType:"application/json",body:JSON.stringify({error:"Session requise (proxy d’aperçu simulé)."})});
    });
    const page = await context.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(parentURL);
    const ui = page.frameLocator("iframe");
    await ui.getByRole("button", {name:/Multijoueur$/}).click();
    await ui.locator('[data-online-connected="true"]').waitFor({timeout:30000});
    const transport = await ui.locator("[data-online-transport]").getAttribute("data-online-transport");
    console.log("statut affiché :", (await ui.locator(".online-status").innerText()).replace(/\n/g, " | "));
    assert.equal(transport, "token");
    await ui.getByRole("button", {name:/Créer une table/}).click();
    const name = `Interface ${Date.now()}`;
    await ui.getByLabel("Votre nom").fill("Vous"); await ui.getByLabel("Nom de la table").fill(name);
    await ui.getByLabel("Nombre de joueurs").selectOption("2");
    const create = ui.getByRole("button", {name:/Créer la table/});
    assert.equal(await create.isEnabled(), true, "le bouton Créer doit être actif");
    await create.click();
    await ui.getByRole("heading", {name:/Salle d’attente/}).waitFor();
    console.log("table créée depuis l’interface :", name);
    await ui.getByRole("button", {name:/Quitter la table/}).click();
    await ui.getByRole("button", {name:/Créer une table/}).waitFor();
    await page.reload();
    const ui2 = page.frameLocator("iframe");
    await ui2.getByRole("button", {name:/Multijoueur$/}).click();
    await ui2.locator('[data-online-connected="true"]').waitFor({timeout:30000});
    console.log("après actualisation :", await ui2.locator("[data-online-transport]").getAttribute("data-online-transport"));
    assert.deepEqual(errors, []);
    console.log("requêtes :", log.slice(0, 6).join(" | "));
    console.log("VERDICT : interface connectée et création réelle réussie malgré cookie et en-têtes supprimés");
  } finally { await browser?.close(); for (const s of sockets) s.destroy(); proxy?.close(); parent?.close(); fs.rmSync(tmp,{recursive:true,force:true}); }
})().catch(e => { console.error("ÉCHEC :", e.message); process.exit(1); });
