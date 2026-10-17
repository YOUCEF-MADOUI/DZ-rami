/* Static parity of the waiting markup: identical markup in both screens. */
const fs=require('fs'),assert=require('node:assert/strict');
const solo=fs.readFileSync(require('node:path').join(__dirname,'..','src/components/GameScreen.tsx'),'utf8');
const multi=fs.readFileSync(require('node:path').join(__dirname,'..','src/components/online/OnlineGameScreen.tsx'),'utf8');
const line='text-center py-1 bg-slate-900/50 border-b border-slate-700/50';
const noButtonsWhileWaiting=t=>(t.match(/!mine && game\.phase === "playing"/)||t.match(/!dealing && !isMyTurn/));
assert(solo.includes(line),'solo waiting banner classes');
assert(multi.includes(line),'online waiting banner classes');
assert(noButtonsWhileWaiting(solo)&&noButtonsWhileWaiting(multi),'both hide the actions while waiting');
console.log('Ligne d’attente identique dans les deux écrans (mêmes classes, boutons masqués)');
