/* Interface parity: the online playing screen must match the solo one.
   Compares the DOM structure, the discard dock (card back + « Pioche · N »), the
   bottom info bar, the player summary and the contextual action buttons.
   Usage: NODE_PATH=<browser tools> LD_LIBRARY_PATH=<chromium libs> \
          node scripts/test-online-ui-parity.cjs
   Playwright and @sparticuz/chromium must be installed OUTSIDE this project. */
/* Compares the multiplayer playing screen with the solo one, structurally. */
const {chromium}=require('playwright'),bin=require('@sparticuz/chromium').default;
const assert=require('node:assert/strict');
const BASE=process.env.APP_BASE||`http://localhost:${process.env.APP_PORT||3000}`;
const FINGERPRINT=()=>{
  const q=s=>document.querySelector(s);
  const all=s=>Array.from(document.querySelectorAll(s));
  const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
  const classes=e=>e?e.className.replace(/\s+/g,' ').trim():null;
  return {
    order: all('[data-game-root] > *').map(e=>`${e.tagName}.${(e.className||'').toString().split(' ')[0]}`),
    infoBar: classes(q('.game-info-bar')),
    infoBarBox: box(q('.game-info-bar')),
    infoBarText: q('.game-info-bar')?.innerText.replace(/\s+/g,' ').replace(/[0-9]+/g,'N'),
    discardDock: classes(q('.discard-dock')),
    dockText: q('.discard-dock')?.innerText.replace(/\s+/g,' ').replace(/[0-9]+/g,'N'),
    hasStockCard: !!q('[data-stock-zone] .card'),
    actions: classes(q('.hand-actions')),
    actionButtons: all('.hand-actions button').map(b=>b.textContent.trim()),
    hand: classes(q('.game-hand-panel')),
    summary: classes(q('.local-player-summary')),
    summaryParts: all('.local-player-summary > *').map(e=>e.tagName),
  };
};
(async()=>{
const b=await chromium.launch({executablePath:await bin.executablePath(),args:bin.args.filter(a=>!['--disable-web-security','--single-process'].includes(a)),headless:true});
// --- Solo, 2 players ---
const soloCtx=await b.newContext({viewport:{width:1280,height:900}});const solo=await soloCtx.newPage();
await solo.goto(BASE);
await solo.getByRole('button',{name:/Mode Solo/}).click();
await solo.getByRole('button',{name:/2 Joueurs/}).click();
await solo.getByRole('button',{name:/Commencer/}).click();
await solo.locator('[data-game-root]').waitFor();
await solo.waitForTimeout(2500);
const soloPrint=await solo.evaluate(FINGERPRINT);
console.log('SOLO     ordre:',soloPrint.order.join(' → '));
console.log('SOLO     boutons:',JSON.stringify(soloPrint.actionButtons));
console.log('SOLO     dock:',JSON.stringify(soloPrint.dockText),'| carte de pioche:',soloPrint.hasStockCard);
console.log('SOLO     barre info:',JSON.stringify(soloPrint.infoBarText));
console.log('SOLO     résumé:',soloPrint.summaryParts.join(','),soloPrint.summary?'':'(absent)');
// --- Multiplayer, 2 players, joined by a second context ---
const A=await b.newContext({viewport:{width:1280,height:900}}),B=await b.newContext();
const a=await A.newPage(),bb=await B.newPage();
for(const p of [a,bb]){await p.goto(BASE);await p.getByRole('button',{name:/Multijoueur$/}).click();await p.locator('[data-online-connected="true"]').waitFor();}
await a.getByLabel('Votre nom').fill('Vous');
await a.getByRole('button',{name:/Créer une table/}).click();
const table='Parité '+Date.now();
await a.getByLabel('Nom de la table').fill(table);await a.getByLabel('Nombre de joueurs').selectOption('2');
await a.getByRole('button',{name:/Créer la table/}).click();
await a.getByRole('heading',{name:/Salle d’attente/}).waitFor();
await bb.getByLabel('Votre nom').fill('Ami');
await bb.getByRole('button',{name:/Rejoindre une table/}).click();
await bb.getByLabel('Code ou nom de la table').fill(table);
await bb.getByRole('button',{name:/Rejoindre la table/}).click();
await bb.getByRole('heading',{name:/Salle d’attente/}).waitFor();
await a.getByText(/Ami/).first().waitFor();
await a.getByRole('button',{name:/Prêt$/}).click();
await bb.getByRole('button',{name:/Prêt$/}).click();
const start=a.getByRole('button',{name:/Démarrer la partie/});
await start.waitFor();await start.click();
await a.locator('.online-game').waitFor();await bb.locator('.online-game').waitFor();
await a.waitForTimeout(2500);
const multiPrint=await a.evaluate(FINGERPRINT);
console.log('MULTI    ordre:',multiPrint.order.join(' → '));
console.log('MULTI    boutons:',JSON.stringify(multiPrint.actionButtons));
console.log('MULTI    dock:',JSON.stringify(multiPrint.dockText),'| carte de pioche:',multiPrint.hasStockCard);
console.log('MULTI    barre info:',JSON.stringify(multiPrint.infoBarText));
console.log('MULTI    résumé:',multiPrint.summaryParts.join(','));
// --- structural equality ---
assert.deepEqual(multiPrint.order,soloPrint.order,'same top-level order');
assert.equal(multiPrint.infoBar,soloPrint.infoBar,'same info bar classes');
assert.equal(multiPrint.infoBarText,soloPrint.infoBarText,'same info bar text');
assert.equal(multiPrint.discardDock,soloPrint.discardDock,'same discard dock classes');
assert.equal(multiPrint.dockText,soloPrint.dockText,'same discard dock text');
assert.equal(multiPrint.hasStockCard,true,'the stock shows a card back, not a text button');
assert.equal(multiPrint.actions,soloPrint.actions,'same action bar classes');
assert.deepEqual(multiPrint.summaryParts.slice(0,3),soloPrint.summaryParts,'same summary structure (the online row adds the leave control)');
console.log('\nParité structurelle OK : ordre, dock de pioche, barre d’info et résumé identiques');
const activeIsA=await a.evaluate(()=>!document.querySelector('.hand-actions')?.innerText.includes('Défausser'));
console.log('boutons contextuels actifs (premier tour) :',JSON.stringify(multiPrint.actionButtons));
await a.screenshot({path:'/home/user/join-audit/multi-partie.png'});
await solo.screenshot({path:'/home/user/join-audit/solo-partie.png'});
await b.close()})().catch(e=>{console.error('ÉCHEC',e.message);process.exit(1)});

