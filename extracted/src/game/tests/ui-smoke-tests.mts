// =====================================================
// INTERFACE SMOKE TEST — mounts the real React tree in a DOM
// and drives real clicks (seats, VIERGE/SUITE, PIOCHER → DÉFAUSSER,
// reporting any player, opponent public combinations zoom).
// Run with: ./node_modules/.bin/tsx src/game/tests/ui-smoke-tests.mts
// =====================================================
import { JSDOM } from 'jsdom';
import type { Card, JokerCard, Rank, Suit } from '../core/types';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000/',
  pretendToBeVisual: true,
});

const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.getComputedStyle = dom.window.getComputedStyle;
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16);
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const React = await import('react');
const PageModule = await import('../../app/page');
const Page = PageModule.default;

let passed = 0;
let failed = 0;
function check(name: string, condition: unknown, detail = ''): void {
  if (condition) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.error(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const container = document.getElementById('root')!;
const root = createRoot(container);

const flush = async (ms = 30) => {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
};

async function click(element: Element | null | undefined, label: string) {
  if (!element) { check(`click ${label}`, false, 'element not found'); return; }
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
}

function findByText(selector: string, text: string): Element | null {
  return Array.from(document.querySelectorAll(selector)).find(el =>
    (el.textContent ?? '').replace(/\s+/g, ' ').includes(text)
  ) ?? null;
}

await act(async () => { root.render(React.createElement(Page)); });
await flush(80);

// ── Start a 5-player solo game ────────────────────────────────────────────
const buttons = Array.from(document.querySelectorAll('button')).map(b => (b.textContent ?? '').trim());
console.log('   Home buttons:', buttons.slice(0, 12).join(' | '));

await click(findByText('button', 'Mode Solo'), 'Mode Solo');
await flush(60);
await click(findByText('button', '5 Joueurs'), '5 Joueurs');
await flush(60);
await click(findByText('button', 'Commencer'), 'Commencer');
await flush(200);

const piocherButton = () => Array.from(document.querySelectorAll('button'))
  .find(b => /piocher/i.test(b.textContent ?? ''));
const defausserButtons = () => Array.from(document.querySelectorAll('button'))
  .filter(b => /défausser/i.test(b.textContent ?? ''));

async function waitFor(condition: () => boolean, budget = 40000): Promise<boolean> {
  let waited = 0;
  while (waited < budget) {
    if (condition()) return true;
    await flush(400);
    waited += 400;
  }
  return condition();
}

// The local player may be the round starter: they then receive 15 cards and
// begin directly in the play phase, without any PIOCHER step.
await waitFor(() => Boolean(piocherButton()) || defausserButtons().length > 0);
if (!piocherButton()) {
  // The 15-card starter plays without drawing: select one hand card and discard.
  await click(document.querySelector('[data-ci] .card'), 'first hand card');
  check('A hand card can be selected', document.querySelectorAll('.card.selected').length === 1);
  await click(defausserButtons()[0], 'Défausser (15-card starter turn)');
  await waitFor(() => Boolean(piocherButton()));
}

// ── 1. VIERGE / SUITE / TOTAL are permanently visible ─────────────────────
const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
check('VIERGE is displayed', /VIERGE : \d+/.test(text), text.slice(0, 200));
check('SUITE is displayed', /SUITE : \d+/.test(text), text.slice(0, 200));
check('TOTAL is displayed', /TOTAL : \d+/.test(text), text.slice(0, 200));
// With 5 players the VIERGE threshold is 71, and it is never the value of an
// opening: VIERGE, SUITE and TOTAL are three distinct notions.
check('5 players: the HUD shows VIERGE : 71', /VIERGE : 71/.test(text), text.slice(0, 300));
const chips = Array.from(document.querySelectorAll('span'))
  .map(span => (span.textContent ?? '').replace(/\s+/g, ' ').trim())
  .filter(label => /^(VIERGE|SUITE|TOTAL) : \d+$/.test(label));
check('The three values VIERGE / SUITE / TOTAL are shown together', chips.length === 3, chips.join(' | '));

// ── 2. Seats ──────────────────────────────────────────────────────────────
for (const seat of ['SUD', 'EST', 'NORD-EST', 'NORD-OUEST', 'OUEST']) {
  check(`Seat ${seat} is present`, text.includes(seat), text.slice(0, 300));
}
const sections = Array.from(document.querySelectorAll('section[aria-label^="Zone de"]'));
const areaOf = (label: string) => (sections.find(s => s.getAttribute('aria-label') === label) as HTMLElement | undefined)?.getAttribute('data-seat');
check('EST sits in the east cell', areaOf('Zone de Amine') === 'east', String(areaOf('Zone de Amine')));
check('NORD-EST sits in the north-east cell', areaOf('Zone de Karim') === 'north-east', String(areaOf('Zone de Karim')));
check('NORD-OUEST sits in the north-west cell', areaOf('Zone de Yacine') === 'north-west', String(areaOf('Zone de Yacine')));
check('OUEST sits in the west cell', areaOf('Zone de Fatima') === 'west', String(areaOf('Zone de Fatima')));
check('SUD (local) sits in the south cell', areaOf('Zone de Vous') === 'south' || areaOf('Zone de pose de Vous') === 'south', String(areaOf('Zone de pose de Vous')));

// ── 2a. Opening HUD: the VIERGE decides, never the SUITE ──────────────────
const { buildGridAreas, sortCards, openingStatusText } = await import('../../components/GameScreen');
const status78 = openingStatusText({ opened: false, naturalScore: 78, total: 105, vierge: 71, suite: 82, hasCombos: true });
check('78 naturals with VIERGE 71 / SUITE 82 does not claim missing points',
  !/il manque/.test(status78), status78);
check('The valid status mentions the VIERGE, not the SUITE',
  /VIERGE 71/.test(status78) && !/SUITE/.test(status78), status78);
const status78Suite100 = openingStatusText({ opened: false, naturalScore: 78, total: 105, vierge: 71, suite: 100, hasCombos: true });
check('78 naturals with SUITE 100 are not refused either', !/il manque/.test(status78Suite100), status78Suite100);
const status70 = openingStatusText({ opened: false, naturalScore: 70, total: 90, vierge: 71, suite: 82, hasCombos: true });
check('70 naturals are refused against the VIERGE 71', /il manque 1 points naturels/.test(status70), status70);
check('The shortfall is measured against the VIERGE', /VIERGE 71/.test(status70) && !/SUITE 82/.test(status70), status70);

// ── 2b. Grid areas for every table size ───────────────────────────────────
const { resolveJokerPlacement } = await import('../../game/core/validation');
const makeCard = (rank: Rank, suit: Suit, id: string): Card => ({ id, rank, suit, pack: 1, isJoker: false });
const makeJoker = (id: string): JokerCard => ({ id, isJoker: true, jokerIndex: 1 });

// The Joker takes the card of the SLOT it occupies in the prepared meld:
// 7-8-Joker → 9 (it ends the ascending run), Joker-8-7 → 9 (it heads the
// descending run). Nothing is re-sorted or re-detected after the drop.
const ascending = [makeCard('7', 'hearts', 'ui-7h'), makeCard('8', 'hearts', 'ui-8h'), makeJoker('ui-joker-1')];
const ascendingPlacement = resolveJokerPlacement(ascending, 'tierce');
check('7-8-Joker resolves the Joker as 9♥ in slot 3',
  ascendingPlacement?.represents.rank === '9' && ascendingPlacement.represents.suit === 'hearts' && ascendingPlacement.position === 2,
  JSON.stringify(ascendingPlacement));
const descending = [makeJoker('ui-joker-1'), makeCard('8', 'hearts', 'ui-8h'), makeCard('7', 'hearts', 'ui-7h')];
const descendingPlacement = resolveJokerPlacement(descending, 'tierce');
check('Joker-8-7 resolves the Joker as 9♥ in slot 1',
  descendingPlacement?.represents.rank === '9' && descendingPlacement.position === 0,
  JSON.stringify(descendingPlacement));
const trailing = [makeCard('8', 'hearts', 'ui-8h'), makeCard('7', 'hearts', 'ui-7h'), makeJoker('ui-joker-1')];
const trailingPlacement = resolveJokerPlacement(trailing, 'tierce');
check('8-7-Joker resolves the Joker as 6♥ (the slot it occupies)',
  trailingPlacement?.represents.rank === '6', JSON.stringify(trailingPlacement));
const sortedHand = sortCards(
  [makeJoker('ui-joker-1'), makeCard('7', 'hearts', 'ui-7h'), makeCard('8', 'hearts', 'ui-8h')],
  'rank',
);
check('Value sort places Joker at the left of the hand', sortedHand[0].isJoker === true,
  sortedHand.map(c => c.id).join(','));
const expectedAreas: Record<number, string> = {
  5: '"north-west . north-east" "west hub east" ". south ."',
  4: '". north ." "west hub east" ". south ."',
  3: '"north-west . north-east" ". hub ." ". south ."',
  2: '". north ." ". hub ." ". south ."',
};
for (const count of [2, 3, 4, 5]) {
  check(`${count}p grid areas match the seat layout`, buildGridAreas(count) === expectedAreas[count], buildGridAreas(count));
}

// ── 3. Single PIOCHER / DÉFAUSSER button, no JETER ────────────────────────
const barButtons = Array.from(document.querySelectorAll('button')).map(b => (b.textContent ?? '').replace(/\s+/g, ' ').trim());
check('No "Jeter" button exists', !barButtons.some(label => /jeter/i.test(label)), barButtons.join(' | '));

const piocher = barButtons.findIndex(label => /piocher/i.test(label));
if (piocher >= 0) {
  const piocherEl = piocherButton()!;
  const box = piocherEl.getBoundingClientRect();
  await click(piocherEl, 'Piocher');
  await flush(120);
  const after = Array.from(document.querySelectorAll('button'));
  const defausser = after.find(b => /défausser/i.test(b.textContent ?? ''));
  check('PIOCHER becomes DÉFAUSSER', Boolean(defausser));
  const box2 = defausser?.getBoundingClientRect();
  check('The button does not move', Boolean(box2) && Math.abs((box2?.left ?? 0) - box.left) < 1 && Math.abs((box2?.top ?? 0) - box.top) < 1,
    `${JSON.stringify(box)} → ${JSON.stringify(box2)}`);
  check('Only one discard action exists', after.filter(b => /défausser|jeter/i.test(b.textContent ?? '')).length === 1);
  check('The drawn card is auto-selected', document.querySelectorAll('.card.selected').length === 1,
    `${document.querySelectorAll('.card.selected').length} selected`);
} else {
  check('PIOCHER button present', false, barButtons.join(' | '));
}

// ── 4. Reporting any opponent by clicking their name ──────────────────────
for (const name of ['Amine', 'Karim', 'Yacine', 'Fatima']) {
  const nameButton = Array.from(document.querySelectorAll('button'))
    .find(b => (b.textContent ?? '').includes(name) && !/agrandir/i.test(b.textContent ?? ''));
  check(`${name} can be clicked to report`, Boolean(nameButton) && !(nameButton as HTMLButtonElement).disabled);
}
const amineButton = Array.from(document.querySelectorAll('button'))
  .find(b => (b.textContent ?? '').includes('Amine') && !/agrandir/i.test(b.textContent ?? ''));
await click(amineButton, 'Amine name');
await flush(60);
const modalText = (document.body.textContent ?? '').replace(/\s+/g, ' ');
check('The report menu opens for Amine', modalText.includes('Signaler une faute') && modalText.includes('Contre Amine'), modalText.slice(0, 200));
check('The menu states there is no penalty', /aucune pénalité/i.test(modalText), modalText.slice(0, 300));
const cancel = findByText('button', 'Annuler');
await click(cancel, 'Annuler');
await flush(40);

// ── 5. Zoom on an opponent public combinations ───────────────────────────────────────────
const zoomButton = Array.from(document.querySelectorAll('button'))
  .find(b => /agrandir les combinaisons/i.test(b.getAttribute('aria-label') ?? ''));
check('An opponent public combinations can be enlarged', Boolean(zoomButton));
await click(zoomButton, 'zoom main');
await flush(60);
const zoomText = (document.body.textContent ?? '').replace(/\s+/g, ' ');
check('The zoom overlay shows public combinations', /Combinaisons de (Amine|Karim|Yacine|Fatima)/.test(zoomText), zoomText.slice(0, 200));
check('The zoom overlay can be closed', /Réduire/.test(zoomText));
await click(findByText('button', 'Réduire'), 'Réduire');
await flush(40);

// ── 6. No vertical scrollbar inside the opponent zones ────────────────────
const overflowing = Array.from(document.querySelectorAll('section[aria-label^="Zone de"]'))
  .filter(section => {
    const style = (section as HTMLElement).style;
    return /auto|scroll/.test(style.overflowY);
  });
check('No opponent zone scrolls vertically', overflowing.length === 0, `${overflowing.length} scrolling zones`);

// ── 7. The discard hub is a dedicated grid cell ───────────────────────────
const hub = document.querySelector('[data-discard-zone]');
check('The discard hub exists in its own cell', Boolean(hub));
check('The hub is not absolutely positioned over other zones',
  Boolean(hub) && !(hub as HTMLElement).className.includes('absolute'), (hub as HTMLElement)?.className ?? '');

// Deterministic real component clicks: opening, immediate extension and visible base.
const engine = await import('../core/engine');
const { DEFAULT_CONFIG } = await import('../core/types');
const { default: GameScreen } = await import('../../components/GameScreen');
const cfg = { ...DEFAULT_CONFIG, playerCount: 5 as const };
let fixture = engine.startNewRound(engine.createInitialGameState(cfg, ['Vous','Amine','Karim','Yacine','Fatima']));
const naturalRuns = [
  ['10','J','Q'], ['10','J','Q'], ['5','6','7'],
].map((ranks,i) => ranks.map((rank,j) => makeCard(rank as Rank, (['hearts','diamonds','clubs'] as const)[i],`ui-open-${i}-${j}`)));
const aceCard = makeCard('A','spades','ui-add-ace');
const baseCards = (['hearts','diamonds','clubs','spades'] as const).map((s,i) => makeCard('4',s,`ui-base-${i}`));
fixture = { ...fixture, players: fixture.players.map((p,i) => ({...p,isAI:false,
  status: i === 0 ? 'not_opened' as const : 'opened' as const,
  hand: i === 0 ? [...naturalRuns.flat(),aceCard,makeCard('2','clubs','ui-spare'),makeCard('3','clubs','ui-spare2')] : p.hand })),
  tableCombinations: [{id:'ui-target',type:'tierce',ownerId:'player-1',cards:['J','Q','K'].map((r,i) => makeCard(r as Rank,'spades',`ui-target-${i}`))},
    {id:'ui-base',type:'carre',ownerId:'player-0',cards:baseCards}],
};
for (const run of naturalRuns) fixture = engine.placeCombination(fixture,run.map(c => c.id),'tierce');
await act(async () => root.render(React.createElement(GameScreen,{initialState:fixture,config:cfg,playerNames:fixture.players.map(p=>p.name),onBack:()=>{}})));
await click(findByText('button','Valider l’ouverture'),'confirm opening');
check('Opening button commits without ending local turn', !findByText('button','Valider l’ouverture') && !!findByText('button','Défausser'));
await click(document.querySelector('[data-ci] [aria-label="A spades"]'),'select ace');
await click(document.querySelector('[data-combo-id="ui-target"]'),'extend opponent run');
check('Opponent combination extends immediately after opening',document.querySelectorAll('[data-combo-id="ui-target"] .card').length === 4);
await click(findByText('button','Rentrer le carré dans la base'),'return carré');
check('Returned carré disappears from table', !document.querySelector('[data-combo-id="ui-base"]'));
await click(document.querySelector('button[aria-label^="Ouvrir la défausse"]'),'open discard history');
check('Reserve cards do not appear in current discard',!!findByText('h3','Défausse actuelle (0)'));
check('Current discard contains no reserve cards',Array.from(document.querySelectorAll('h3')).find(h=>h.textContent?.includes('Défausse actuelle'))?.parentElement?.parentElement?.querySelectorAll('.card').length === 0);



const ambiguousCards = [makeCard('J','hearts','ui-amb-h'),makeCard('J','clubs','ui-amb-c'),makeJoker('ui-amb-j')];
const ambiguousFixture = { ...fixture,
  turnState: { ...fixture.turnState!, temporaryCombinations: [] },
  players: fixture.players.map((p,i) => i === 0 ? { ...p, status: 'opened' as const,
    hand: [makeCard('J','diamonds','ui-amb-d'),makeCard('J','spades','ui-amb-s'),makeCard('2','clubs','ui-amb-spare')] } : p),
  tableCombinations: [{id:'ui-amb',type:'carre' as const,ownerId:'player-0',cards:ambiguousCards}],
};
await act(async () => root.render(React.createElement(GameScreen,{key:'ambiguous',initialState:ambiguousFixture,config:cfg,playerNames:fixture.players.map(p=>p.name),onBack:()=>{}})));
check('Ambiguous Joker displays BOTH missing suits',document.querySelector('[data-combo-id="ui-amb"]')?.textContent?.includes('J♦ / J♠'));
await click(document.querySelector('[data-ci] [aria-label="J diamonds"]'),'select first missing jack');
check('One card does not offer ambiguous recovery',!findByText('button','Récupérer le Joker'));
await click(document.querySelector('[data-ci] [aria-label="J spades"]'),'select second missing jack');
await click(findByText('button','Récupérer le Joker'),'recover ambiguous Joker');
check('UI recovery creates natural carré',document.querySelectorAll('[data-combo-id="ui-amb"] .card').length === 4 && !document.querySelector('[data-combo-id="ui-amb"] .joker-card'));
check('Recovered Joker appears in local hand',!!document.querySelector('[data-ci] .joker-card'));

async function mountScenario(key: string, state: typeof fixture) {
  await act(async () => root.render(React.createElement(GameScreen,{key,initialState:state,config:state.config,playerNames:state.players.map(p=>p.name),onBack:()=>{}})));
}
const readRun = () => Array.from(document.querySelectorAll('[data-combo-id="test-run"] .card')).map(c => c.querySelector('div > span')?.textContent ?? 'JOKER').join('-');
function runScenario(ranks: Rank[], hand: Card[], suit: Suit = 'hearts') {
  return {...ambiguousFixture,
    players: ambiguousFixture.players.map((p,i)=> i === 0 ? {...p,hand:[...hand,makeCard('2','diamonds','keep-one')]} : p),
    tableCombinations:[{id:'test-run',type:'tierce' as const,ownerId:'player-0',cards:ranks.map((r,i)=>makeCard(r,suit,`scenario-${i}`))}],
  };
}
await mountScenario('long-run',runScenario(['9','10','J','Q','K'],[makeCard('8','hearts','add8'),makeCard('A','hearts','addA')]));
await click(document.querySelector('[data-ci] [aria-label="8 hearts"]'),'select 8');
await click(document.querySelector('[data-combo-id="test-run"]'),'insert 8');
check('UI inserts 8 at logical start of six-card run',readRun() === 'K-Q-J-10-9-8',readRun());
await click(document.querySelector('[data-ci] [aria-label="A hearts"]'),'select ace high');
await click(document.querySelector('[data-combo-id="test-run"]'),'extend to seven cards');
check('UI extends table run to seven cards with ace high',readRun() === 'A-K-Q-J-10-9-8',readRun());
for (const [ranks,forbidden] of [[['A','2','3'],'K'],[['Q','K','A'],'2']] as [Rank[],Rank][]) {
  await mountScenario(`ace-${forbidden}`,runScenario(ranks,[makeCard(forbidden,'hearts','forbidden')]));
  await click(document.querySelector(`[data-ci] [aria-label="${forbidden} hearts"]`),'select forbidden extension');
  await click(document.querySelector('[data-combo-id="test-run"]'),'attempt forbidden extension');
  check(`UI refuses ${ranks.join('-')} + ${forbidden}`,document.querySelectorAll('[data-combo-id="test-run"] .card').length === 3);
}
const descendingCards = [makeCard('8','clubs','u8'),makeCard('7','clubs','u7'),makeCard('6','clubs','u6'),makeCard('5','clubs','u5'),makeJoker('uJ')];
const placement4 = resolveJokerPlacement(descendingCards,'tierce')!;
const replaceFixture = {...runScenario(['5','6','7'],[makeCard('4','clubs','real4')]),
  tableCombinations:[{id:'test-run',type:'tierce' as const,ownerId:'player-0',cards:descendingCards,jokerPlacement:placement4,jokerRepresents:placement4.represents}],
};
await mountScenario('replace4',replaceFixture);
check('UI preserves Joker in final slot before recovery',document.querySelectorAll('[data-combo-id="test-run"] .card')[4]?.classList.contains('joker-card'));
await click(document.querySelector('[data-ci] [aria-label="4 clubs"]'),'select replacement 4');
await click(findByText('button','Récupérer le Joker'),'recover precise Joker');
check('UI displays recovered natural run descending',readRun() === '8-7-6-5-4',readRun());
check('Recovered tierce Joker remains Joker in hand',!!document.querySelector('[data-ci] .joker-card'));

for (const total of [104,112]) {
  const rankLists: Rank[][] = total === 104 ? [['10','J','Q'],['10','J','Q'],['9','10','J'],['4','5','6']] : [['Q','K','A'],['10','J','Q'],['10','J','Q'],['6','7','8']];
  const runs = rankLists.map((ranks,i)=>ranks.map((r,j)=>makeCard(r,(['hearts','spades','diamonds','clubs'] as const)[i],`hud-${total}-${i}-${j}`)));
  let hudState = {...fixture,tableCombinations:[],turnState:{...fixture.turnState!,temporaryCombinations:[]},
    players:fixture.players.map((p,i)=>i === 0 ? {...p,status:'not_opened' as const,hand:[...runs.flat(),makeCard('2','spades','hud-spare')]} : p)} as typeof fixture;
  for (const run of runs) hudState = engine.placeCombination(hudState,run.map(c=>c.id),'tierce');
  await mountScenario(`hud-${total}`,hudState);
  await click(findByText('button','Valider l’ouverture'),'validate HUD opening');
  const text = document.body.textContent?.replace(/\s+/g,' ') ?? '';
  check(`HUD after opening ${total}: VIERGE 71, SUITE ${total+1}, TOTAL ${total}`,text.includes('VIERGE : 71') && text.includes(`SUITE : ${total+1}`) && text.includes(`TOTAL : ${total}`));
}

// P0: current physical discard is not historical evidence or reserve.
const physicalSeven = Array.from({length:7},(_,i)=>makeCard(String(i+2) as Rank,'diamonds',`current-${i}`));
const fiftyEvents = Array.from({length:50},(_,i)=>makeCard('3','hearts',`event-${i%2}`));
const discardScenario = {...ambiguousFixture,tableCombinations:[],discardPile:physicalSeven,discardHistory:fiftyEvents,
  basePile:[makeCard('K','hearts','reserve-only')]};
await mountScenario('current-discard',discardScenario);
await click(document.querySelector('button[aria-label^="Ouvrir la défausse"]'),'inspect physical discard');
const discardModal = findByText('h3','Défausse actuelle (7)')?.parentElement?.parentElement;
check('50 historical events and seven current cards: exactly seven displayed',discardModal?.querySelectorAll('.card').length === 7);
check('Historical repeated 3♥ cards never rendered in current discard',!discardModal?.textContent?.includes('K'));

// P1: zoom only PUBLIC melds, not the remaining hidden hand.
const publicCards=[makeCard('8','hearts','public8'),makeCard('9','hearts','public9'),makeCard('10','hearts','public10')];
const privateFixture={...ambiguousFixture,
  players:ambiguousFixture.players.map(p=>p.id==='player-4'?{...p,hand:[makeCard('A','spades','secretAce')]}:p),
  tableCombinations:[{id:'fatima-public',type:'tierce' as const,ownerId:'player-4',cards:publicCards}],
};
const beforeZoom=JSON.stringify(privateFixture);
await mountScenario('public-zoom',privateFixture);
await click(document.querySelector('[aria-label="Agrandir les combinaisons de Fatima"]'),'zoom Fatima public melds');
const zoomModal=findByText('h3','Combinaisons de Fatima')?.parentElement?.parentElement;
check('Fatima zoom contains exactly her three public cards',zoomModal?.querySelectorAll('.card').length===3);
check('Fatima hidden ace is never displayed',!Array.from(zoomModal?.querySelectorAll('.card')??[]).some(c=>c.querySelector('div > span')?.textContent==='A'));
check('Zoom is read-only',JSON.stringify(privateFixture)===beforeZoom);

// P0: exact authorized 8♦ recovery from three natural eights plus Joker.
const eightFixture={...ambiguousFixture,
  players:ambiguousFixture.players.map((p,i)=>i===0?{...p,hand:[makeCard('8','diamonds','ui-real8'),makeCard('2','clubs','ui-keep8')]}:p),
  tableCombinations:[{id:'test-run',type:'carre' as const,ownerId:'player-0',cards:[makeCard('8','hearts','ui-8h'),makeCard('8','clubs','ui-8c'),makeCard('8','spades','ui-8s'),makeJoker('ui-8joker')]}],
};
await mountScenario('eight-recovery',eightFixture);
check('Three naturals plus Joker never enables reserve carré action',!findByText('button','Rentrer le carré dans la base'));
await click(document.querySelector('[data-ci] [aria-label="8 diamonds"]'),'select exact 8♦');
await click(findByText('button','Récupérer le Joker'),'recover eight Joker');
check('Exact eight recovery produces four natural cards',document.querySelectorAll('[data-combo-id="test-run"] .card').length===4&&!document.querySelector('[data-combo-id="test-run"] .joker-card'));
check('Recovered eight Joker remains a Joker in the hand',!!document.querySelector('[data-ci] .joker-card'));
check('Natural four eights enable reserve action',!!findByText('button','Rentrer le carré dans la base'));
const shortTotal=openingStatusText({opened:false,naturalScore:80,total:80,vierge:71,suite:82,hasCombos:true});
check('Natural sufficient but total insufficient gives TOTAL shortfall',shortTotal.includes('TOTAL 80')&&shortTotal.includes('manque 2')&&!shortTotal.includes('points naturels'));


// Presentation sorting must never mutate engine state or Joker metadata.
const { tableCards, tableCombinations, combinationStrength } = await import('../../components/presentation/table-order');
const lowRun = {id:'low',type:'tierce' as const,ownerId:'player-0',cards:['6','7','8'].map((r,i)=>makeCard(r as Rank,'hearts',`sort-${i}`))};
const highRun = {id:'high',type:'tierce' as const,ownerId:'player-0',cards:['Q','K','A'].map((r,i)=>makeCard(r as Rank,'hearts',`high-${i}`))};
const aceLowRun = {...lowRun,id:'ace-low',cards:['A','2','3'].map((r,i)=>makeCard(r as Rank,'clubs',`lowace-${i}`))};
const tied = {...lowRun,id:'tied'};
const frozenMeld = Object.freeze({...replaceFixture.tableCombinations[0],cards:Object.freeze([...descendingCards])});
const beforeDisplay = JSON.stringify(frozenMeld);
check('Natural run displays 8-7-6',tableCards(lowRun).map(c=>!c.isJoker&&c.rank).join('-')==='8-7-6');
check('High ace displays A-K-Q',tableCards(highRun).map(c=>!c.isJoker&&c.rank).join('-')==='A-K-Q');
check('Low ace keeps sequence meaning in descending view',tableCards(aceLowRun).map(c=>!c.isJoker&&c.rank).join('-')==='3-2-A'&&combinationStrength(aceLowRun)===3);
const sorted = tableCombinations([lowRun,highRun,tied]);
check('Meld strength sorting is stable',sorted.map(c=>c.id).join(',')==='high,low,tied');
check('Sorting preserves physical objects',sorted[1]===lowRun&&sorted[2]===tied);
const jokerView = tableCards({...frozenMeld,cards:[...frozenMeld.cards]});
check('Joker display keeps physical slot and representation',jokerView[4].isJoker&&JSON.stringify(frozenMeld)===beforeDisplay);
check('Hand is rendered using compact fan layout',!!document.querySelector('.hand-fan'));
check('Table melds use compact fan layout',!!document.querySelector('[data-combo-id] .meld-fan'));


// Interface-only regression: disabling actions must not dim natural cards or Jokers.
const {default:CardView} = await import('../../components/CardView');
const viewCards = [makeCard('10','hearts','opacity-card'),makeJoker('opacity-joker')];
for (const card of viewCards) {
  await act(async()=>root.render(React.createElement(CardView,{card,onClick:()=>{},disabled:false})));
  const activeClass=document.querySelector('.card')!.className;
  await act(async()=>root.render(React.createElement(CardView,{card,onClick:()=>{},disabled:true})));
  const disabledCard=document.querySelector('.card')!;
  check(`${card.isJoker?'Joker':'Natural card'} stays opaque when actions disabled`,!/opacity-|brightness-|saturate-|grayscale/.test(disabledCard.className));
  check('Only cursor changes on disabled card',disabledCard.className.replace('cursor-not-allowed','').trim()===activeClass.trim());
  check('Disabled state remains accessible',disabledCard.getAttribute('aria-disabled')==='true');
}
const {default:PlayerHand} = await import('../../components/PlayerHand');
const {detectHandGroups} = await import('../core/hand-groups');
const lockCards=[makeCard('6','clubs','lock6'),makeCard('7','clubs','lock7'),makeCard('8','clubs','lock8')];
const group=detectHandGroups(lockCards);
let unlocked=false;
const handProps={cards:lockCards,selectedCards:[],groups:group,sortMode:'manual' as const,onSortChange:()=>{},onSelectCard:()=>{},onSelectGroup:()=>{},onReorder:()=>{}};
await act(async()=>root.render(React.createElement(PlayerHand,handProps)));
const bandBefore=document.querySelector('[data-card-group-band]')?.getAttribute('style');
await act(async()=>root.render(React.createElement(PlayerHand,{...handProps,lockedSetForCard:()=>lockCards.map(c=>c.id),onUnlockSet:()=>{unlocked=true;}})));
check('Original color band exists',!!bandBefore);
check('Locked group retains original color band',document.querySelector('[data-card-group-band]')?.getAttribute('style')===bandBefore);
check('Locked group has no amber overlay',!Array.from(document.querySelectorAll('.hand-fan [style]')).some(el=>/245,\s*158|#f59e0b/.test(el.getAttribute('style')??'')));
check('Discrete lock indicator is present',!!document.querySelector('[aria-label="Groupe verrouillé"]'));
await click(document.querySelector('[title="Déverrouiller ces cartes"]'),'unlock neutral group');
check('Neutral unlock control still works',unlocked);


// Reordering updates actual game state without changing rules or physical cards.
const {reorderHand,handInsertionIndex} = await import('../../components/presentation/hand-order');
const baseOrder=fixture.players[0].hand.map(c=>c.id);
const permuted=[...baseOrder].reverse();
const reordered=reorderHand(fixture,fixture.players[0].id,permuted);
check('Reorder persists in GameState.hand',reordered.players[0].hand.map(c=>c.id).join()===permuted.join());
check('Reorder preserves physical card references',reordered.players[0].hand.every(c=>fixture.players[0].hand.includes(c)));
check('Reorder leaves table stock discard and turn untouched',reordered.tableCombinations===fixture.tableCombinations&&reordered.deck===fixture.deck&&reordered.discardPile===fixture.discardPile&&reordered.turnState===fixture.turnState);
check('Reorder leaves score and opponents untouched',reordered.players[0].score===fixture.players[0].score&&reordered.players.slice(1).every((p,i)=>p===fixture.players[i+1]));
check('Incomplete order is refused',reorderHand(fixture,fixture.players[0].id,baseOrder.slice(1))===fixture);
check('Duplicated order is refused',reorderHand(fixture,fixture.players[0].id,[baseOrder[0],...baseOrder.slice(0,-1)])===fixture);
check('Unknown physical ID is refused',reorderHand(fixture,fixture.players[0].id,['unknown',...baseOrder.slice(1)])===fixture);
check('Insertion uses exposed strip rather than full card width',handInsertionIndex(12+16*7,0,0,12,16,15)===7);
check('Insertion compensates horizontal scroll',handInsertionIndex(12+16*2,0,16*5,12,16,40)===7);
check('Insertion endpoints clamp correctly',handInsertionIndex(-200,0,0,12,16,15)===0&&handInsertionIndex(900,0,0,12,16,15)===15);


// Hand layout is shared by card positions, group bands and the live projection.
const {handLayout,insertionFromOffsets}=await import('../../components/presentation/hand-layout');
const groupedCards=[...lockCards,makeCard('10','hearts','g10'),makeCard('J','hearts','gJ'),makeCard('Q','hearts','gQ')];
const geometry=handLayout(groupedCards,[]);
check('70% overlap throughout each group',Math.abs(geometry.offsets[1]-geometry.offsets[0]-.30)<1e-9&&Math.abs(geometry.offsets[4]-geometry.offsets[3]-.30)<1e-9);
check('50% overlap across group boundaries without empty space',Math.abs(geometry.offsets[3]-geometry.offsets[2]-.50)<1e-9);
check('Group controls span the group bounds',geometry.segments.every(g=>Math.abs(geometry.offsets[g.end]-geometry.offsets[g.start]+1-1.6)<1e-9));
check('Insertion detects slots using actual grouped geometry',insertionFromOffsets(geometry.offsets[3]*64,geometry.offsets,64)===3);
let individual: string[]=[];let groupSelection:string[]=[];
const interactionProps={...handProps,cards:groupedCards,groups:detectHandGroups(groupedCards),onSelectCard:(id:string)=>{individual.push(id);},onSelectGroup:(ids:string[])=>{groupSelection=ids;}};
await act(async()=>root.render(React.createElement(PlayerHand,interactionProps)));
await click(document.querySelector('[data-card-id="lock6"] .card'),'click detected but unlocked card');
check('Detected unlocked card selects individually',individual.join()==='lock6'&&groupSelection.length===0);
await click(document.querySelector('[data-card-id="lock7"]'),'retargeted pointer-capture click on wrapper');
check('Pointer capture retarget still selects individual card',individual.join()==='lock6,lock7');
await click(document.querySelector('[data-group-select]'),'explicit detected group selection');
check('Detected group has separate selection control',groupSelection.join()===lockCards.map(c=>c.id).join());
individual=[];groupSelection=[];
await act(async()=>root.render(React.createElement(PlayerHand,{...interactionProps,lockedSetForCard:(id:string)=>lockCards.some(c=>c.id===id)?lockCards.map(c=>c.id):null})));
await click(document.querySelector('[data-card-id="lock6"]'),'locked wrapper click');
check('Locked card selects its whole group exactly once',individual.length===0&&groupSelection.join()===lockCards.map(c=>c.id).join());
check('White insertion-line element is absent',document.querySelector('.hand-insertion-target')===null);


// Joker extension dialog on the real GameScreen: preview/cancel is not a game action.
const choiceFixture={...ambiguousFixture,
 players:ambiguousFixture.players.map((p,i)=>i===0?{...p,hand:[makeJoker('choose-J'),makeCard('2','clubs','choose-spare')]}:p),
 tableCombinations:[{id:'test-run',type:'tierce' as const,ownerId:'player-0',cards:[makeCard('8','hearts','choose8'),makeCard('7','hearts','choose7'),makeCard('6','hearts','choose6')]}],
};
await mountScenario('joker-cancel',choiceFixture);
await click(document.querySelector('[data-ci] [aria-label="Joker"]'),'select Joker for existing run');
const beforeChoice=document.querySelector('[data-combo-id="test-run"]')!.innerHTML;
await click(document.querySelector('[data-combo-id="test-run"]'),'request Joker choices');
check('Existing run offers both 9 and 5',!!findByText('button','Joker = 9')&&!!findByText('button','Joker = 5'));
check('Opening Joker dialog changes no table cards',document.querySelector('[data-combo-id="test-run"]')!.innerHTML===beforeChoice);
await click(findByText('button','Annuler'),'cancel Joker extension');
check('Cancelling preserves table and Joker in hand',document.querySelector('[data-combo-id="test-run"]')!.innerHTML===beforeChoice&&!!document.querySelector('[data-ci] .joker-card'));
for(const rank of [9,5]){
 await mountScenario(`joker-${rank}`,choiceFixture);
 await click(document.querySelector('[data-ci] [aria-label="Joker"]'),'select Joker');
 await click(document.querySelector('[data-combo-id="test-run"]'),'choose side');
 await click(findByText('button',`Joker = ${rank}`),'confirm Joker extension');
 const cards=document.querySelectorAll('[data-combo-id="test-run"] .card');
 check(`Confirmed Joker ${rank} occupies chosen endpoint`,cards.length===4&&cards[rank===9?0:3].classList.contains('joker-card')&&cards[rank===9?0:3].textContent?.includes(`${rank}♥`));
}
// Groups of 3, 4 and 5 cards, including a manually grouped Joker.
for(const size of [3,4,5])for(const withJoker of [false,true]){
 const cards=Array.from({length:size},(_,i)=>withJoker&&i===size-1?makeJoker('band-J'):makeCard(String(i+3) as Rank,'hearts',`band-${i}`));
 const ids=cards.map(c=>c.id);
 await act(async()=>root.render(React.createElement(PlayerHand,{...handProps,cards,groups:detectHandGroups(cards),lockedSetForCard:withJoker?()=>ids:undefined})));
 check(`${size}-card group ${withJoker?'with Joker':'natural'} has one integrated band per card`,document.querySelectorAll('.card [data-card-group-band]').length===size);
 check('No external colored band remains',!document.querySelector('[data-group-band],.hand-group-band'));
 const positions=handLayout(cards,withJoker?[ids]:[]).offsets;
 check('All links in a group use 30% advance',positions.slice(1).every((x,i)=>Math.abs(x-positions[i]-.3)<1e-9));
}


// Exact screenshot: 9♠ | 8♦ 7♦ 6♦ | 4♥. Boundaries overlap 50%, inner links 70%.
const screenshotCards=[makeCard('9','spades','shot9'),makeCard('8','diamonds','shot8'),makeCard('7','diamonds','shot7'),makeCard('6','diamonds','shot6'),makeCard('4','hearts','shot4')];
for(const locked of [false,true]){
 const layout=handLayout(screenshotCards,locked?[["shot8","shot7","shot6"]]:[]);
 const advances=layout.offsets.slice(1).map((x,i)=>x-layout.offsets[i]);
 check(`Screenshot overlaps ${locked?'locked':'unlocked'}: 50/70/70/50`,advances.every((x,i)=>Math.abs(x-[.5,.3,.3,.5][i])<1e-9));
 check('Group boundary insertion uses compact geometry',insertionFromOffsets(layout.offsets[1]*80,layout.offsets,80)===1);
}


// Exact public opponent replacement: tap path must recover, not attempt a fifth card.
const fatimaFixture={...eightFixture,tableCombinations:eightFixture.tableCombinations.map(c=>({...c,ownerId:'player-4'}))};
await mountScenario('fatima-eight',fatimaFixture);
await click(document.querySelector('[data-ci] [aria-label="8 diamonds"]'),'select 8♦ for Fatima');
check('Recovery button available for opened opponent meld',!!findByText('button','Récupérer le Joker'));
await click(document.querySelector('[data-combo-id="test-run"]'),'replace Fatima Joker');
check('Tap replaces rather than adds fifth card',document.querySelectorAll('[data-combo-id="test-run"] .card').length===4&&!document.querySelector('[data-combo-id="test-run"] .joker-card'));
check('Opponent Joker returns to local hand',!!document.querySelector('[data-ci] .joker-card'));


const suitOrderTest=sortCards([makeCard('Q','hearts','sort-qh'),makeCard('J','spades','sort-js'),makeCard('J','hearts','sort-jh1'),makeCard('J','hearts','sort-jh2'),makeJoker('sort-joker')],'rank');
check('Value sort groups hearts after Q♥ while preserving rank and all IDs',suitOrderTest.map(c=>c.id).join()==='sort-joker,sort-qh,sort-jh1,sort-jh2,sort-js');
const {default:SettingsScreen}=await import('../../components/SettingsScreen');
let savedConfig: typeof DEFAULT_CONFIG | null=null;
await act(async()=>root.render(React.createElement(SettingsScreen,{config:DEFAULT_CONFIG,onSave:c=>{savedConfig=c;},onBack:()=>{}})));
const cycleButtons=document.querySelectorAll('[data-setting="maxCycles"] button');
await click(cycleButtons[1],'cycles plus one');
check('Cycles increase from 3 to 4',document.querySelector('[data-setting="maxCycles"]')?.textContent?.includes('4'));
await click(cycleButtons[0],'cycles minus one');await click(cycleButtons[0],'cycles minus one again');
check('Cycles decrease from 3 to 2',document.querySelector('[data-setting="maxCycles"]')?.textContent?.includes('2'));
for(let i=0;i<31;i++)await click(document.querySelectorAll('[data-setting="targetScore"] button')[1],'increase point limit');
check('Point limit is capped at 3000',document.querySelector('[data-setting="targetScore"]')?.textContent?.includes('3000'));
await click(findByText('button','Sauvegarder'),'save preferences');
check('Saved preferences contain requested cycles and score target',savedConfig!==null&&(savedConfig as typeof DEFAULT_CONFIG).maxCycles===2&&(savedConfig as typeof DEFAULT_CONFIG).targetScore===3000);


// Team screen exposes exactly two score entries and only count-based opponent backs.
const teamConfig={...DEFAULT_CONFIG,playerCount:4 as const,variant:'teams' as const};
const teamBase=engine.startNewRound(engine.createInitialGameState(teamConfig,['Vous','Amine','Karim','Yacine']));
const teamState={...teamBase,players:teamBase.players.map(p=>({...p,isAI:false}))};
await mountScenario('team-backs',teamState);
check('Team opponents show 42 anonymous backs after the deal',document.querySelectorAll('.opponent-card-back').length===42);
check('Hidden backs have no card identity or image',Array.from(document.querySelectorAll('[data-opponent-hand]')).every(el=>!el.querySelector('[data-card-id],img')));
await click(findByText('button','📊'),'team scoreboard');
check('Team scoreboard has only two team columns',document.querySelectorAll('.score-table thead th').length===3&&document.querySelector('.score-table')?.textContent?.includes('Sud + Nord')&&document.querySelector('.score-table')?.textContent?.includes('Est + Ouest'));
const last=teamState.players[0].hand.find(c=>!c.isJoker)!;
const teamEndInput={...teamState,deck:[...teamState.deck,...teamState.players[0].hand.filter(c=>c.id!==last.id)],players:teamState.players.map((p,i)=>i===0?{...p,status:'opened' as const,hand:[last]}:p)};
const teamEnd=engine.discard(teamEndInput,last.id,false);
await mountScenario('team-rs-result',teamEnd);
check('Team RS summary renders exactly two blocks',document.querySelector('[data-round-scores]')?.children.length===2);
check('RS team penalty is 200, not two independent 200s',document.querySelector('[data-round-scores]')?.textContent?.includes('+200'));
check('RS last discard is face down even with animations unavailable',!!document.querySelector('[data-last-discard] .card-back'));
check('RS flight cannot render the face in its fallback DOM',!!document.querySelector('[data-discard-flight="RS"] .card-back')&&!document.querySelector('[data-discard-flight="RS"] img'));


// Motion geometry and public-only draw metadata.
const motion=await import('../../components/presentation/table-motion');
check('RS/RJ celebration lasts exactly five seconds',motion.ROUND_CELEBRATION_MS===5000);
for(const size of [[500,320],[90,190]]){
 const positions=motion.discardPositions(24,size[0],size[1],38,54);
 check('All current discard cards receive an in-bounds position',positions.length===24&&positions.every(p=>p.left>=0&&p.top>=0&&p.left+38<=size[0]&&p.top+54<=size[1]));
 check('Discard spread uses both available axes',Math.max(...positions.map(p=>p.top))-Math.min(...positions.map(p=>p.top))>(size[1]-54)*.6&&Math.max(...positions.map(p=>p.left))>Math.min(...positions.map(p=>p.left)));
}
const {projectPlayerView}=await import('../core/public-view');
const dealView=projectPlayerView(teamBase,'player-0');
check('Dealer is the fifteen-card starter',motion.visualDealer(dealView.players,dealView.firstPlayerId).id===dealView.firstPlayerId);
for(const count of [2,3,4,5] as const){
 const state=engine.startNewRound(engine.createInitialGameState({...DEFAULT_CONFIG,playerCount:count},Array.from({length:count},(_,i)=>`P${i}`)));
 const view=projectPlayerView(state,'player-0');
 check(`${count} players: cinematic recipient counts match real deal`,motion.dealRecipients(view.players,view.firstPlayerId).length===14*count+1);
}
const recipients=motion.dealRecipients(dealView.players,dealView.firstPlayerId);
check('Deal animation represents exactly the dealt count',recipients.length===57&&dealView.players.every(p=>recipients.filter(id=>id===p.id).length===p.handCount));
const visualDrawState={...teamBase,actionHistory:[{type:'draw' as const,playerId:'player-1',data:{cardId:'private-card-id'},timestamp:1}]};
check('Opponent draw animation has no private card identity',!JSON.stringify(motion.drawVisualEvent(visualDrawState,'player-0')).includes('private-card-id'));
check('Own draw animation can target the authorized hand card',motion.drawVisualEvent({...visualDrawState,actionHistory:[{...visualDrawState.actionHistory[0],playerId:'player-0'}]},'player-0')?.targetCardId==='private-card-id');
await mountScenario('compact-layout',teamState);
check('Circled counters removed from local pose zone',!!document.querySelector('[data-local-hand-panel]')&&!document.querySelector('[data-local-hand-panel]')!.textContent?.includes('VIERGE'));
check('Four-player table uses larger melds and side grids',!!document.querySelector('[data-game-root].table-large'));


const {dealCards,createDeck}=await import('../core/deck');
const orderedDeck=createDeck();const dealt=dealCards(orderedDeck,[0,1,2,3],2);
check('Actual deal proceeds one card at a time from the starter',dealt.hands[2][0]===orderedDeck[0]&&dealt.hands[3][0]===orderedDeck[1]&&dealt.hands[0][0]===orderedDeck[2]&&dealt.hands[1][0]===orderedDeck[3]&&dealt.hands[2][1]===orderedDeck[4]);
check('Dealer receives fifteenth card without loss or duplication',dealt.hands[2].length===15&&dealt.hands[2][14]===orderedDeck[56]&&new Set([...dealt.hands.flat(),...dealt.remainingDeck].map(c=>c.id)).size===108);
const scattered=motion.discardFractions(20,orderedDeck.slice(0,20).map(c=>c.id));
check('Discard has varied rotations rather than aligned rows',new Set(scattered.map(p=>p.angle)).size>10&&scattered.some(p=>p.angle<0)&&scattered.some(p=>p.angle>0));
check('Discard positions stay stable when another card is added',JSON.stringify(scattered)===JSON.stringify(motion.discardFractions(21,orderedDeck.slice(0,21).map(c=>c.id)).slice(0,20)));


// New table layout: shared ordered public area, per-owner stripes, discard before the hand.
const {playerColor,PLAYER_COLORS}=await import('../../components/presentation/table-order');
await mountScenario('colored-public-table',eightFixture);
const localPanel=document.querySelector('[data-local-hand-panel]')!;
const dock=document.querySelector('[data-discard-hub]')!;
check('Discard is immediately before the local hand in document flow',dock.nextElementSibling===localPanel);
check('Public melds are in the shared table, not the opponent badges',!!document.querySelector('[aria-label="Combinaisons publiques sur la table"] [data-combo-id]')&&!document.querySelector('.opponent-strip [data-combo-id]'));
const ownerColor=playerColor(eightFixture.players,'player-0');
check('Every card in the meld carries its original owner color',Array.from(document.querySelectorAll('[data-combo-id="test-run"] [data-card-group-band]')).every(el=>(el as HTMLElement).style.backgroundColor==='rgb(56, 189, 248)')&&ownerColor===PLAYER_COLORS[0]);
check('Each player has a distinct stable color',new Set(eightFixture.players.map(p=>playerColor(eightFixture.players,p.id))).size===eightFixture.players.length);
check('Reordering the player array does not change colors',eightFixture.players.every(p=>playerColor([...eightFixture.players].reverse(),p.id)===playerColor(eightFixture.players,p.id)));
check('Distribution is slower than the previous 50ms cadence',motion.DEAL_INTERVAL_MS===120&&motion.DEAL_FLIGHT_MS===300);


check('Menu and counters are below the hand as in the reference sketch',!!(document.querySelector('[data-local-hand-panel]')!.compareDocumentPosition(document.querySelector('.game-info-bar')!)&Node.DOCUMENT_POSITION_FOLLOWING));
check('Opponents use compact perimeter panels',document.querySelectorAll('.seat-panel').length===eightFixture.players.length-1);

console.log(`\nUI smoke: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
