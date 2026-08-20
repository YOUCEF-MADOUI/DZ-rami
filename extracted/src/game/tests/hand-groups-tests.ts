// =====================================================
// TESTS — Automatic hand group detection & block moving
// Run with: npx tsx src/game/tests/hand-groups-tests.ts
// =====================================================
import { detectHandGroups, findGroupForCard, moveBlock } from '../core/hand-groups';
import { Card, JokerCard, GameCard } from '../core/types';
let passed = 0, failed = 0;
function assertEqual<T>(a: T, e: T, m: string) {
  if (a === e) { passed++; console.log(`  ✅ ${m}`); }
  else { failed++; console.log(`  ❌ FAILED: ${m}  (expected=${e}, got=${a})`); }
}
function assertArr(a: string[], e: string[], m: string) {
  const ok = a.length === e.length && a.every((v, i) => v === e[i]);
  if (ok) { passed++; console.log(`  ✅ ${m}`); }
  else { failed++; console.log(`  ❌ FAILED: ${m}`); console.log(`     expected=[${e}]`); console.log(`     got     =[${a}]`); }
}
function card(r: string, s: string, p: 1|2 = 1): Card {
  return { id: `${r}${s[0]}${p}`, rank: r as Card['rank'], suit: s as Card['suit'], pack: p, isJoker: false };
}
function joker(i: 1|2|3|4 = 1): JokerCard {
  return { id: `J${i}`, isJoker: true, jokerIndex: i };
}
console.log('\n========================================');
console.log('HAND GROUPS — DETECTION & MOVE');
console.log('========================================\n');
console.log('TEST 1 — Brelan adjacent détecté');
{
  const hand: GameCard[] = [card('Q','spades'), card('Q','hearts'), card('Q','diamonds'), card('7','clubs')];
  const groups = detectHandGroups(hand);
  assertEqual(groups.length, 1, '1 groupe détecté');
  assertEqual(groups[0]?.type, 'carre', 'Type = carre (brelan)');
  assertEqual(groups[0]?.startIndex, 0, 'Début à index 0');
  assertEqual(groups[0]?.endIndex, 2, 'Fin à index 2');
}
console.log('\nTEST 2 — Tierce adjacente détectée');
{
  const hand: GameCard[] = [card('A','clubs'), card('7','hearts'), card('8','hearts'), card('9','hearts')];
  const groups = detectHandGroups(hand);
  assertEqual(groups.length, 1, '1 groupe détecté');
  assertEqual(groups[0]?.type, 'tierce', 'Type = tierce');
  assertEqual(groups[0]?.startIndex, 1, 'Début à index 1');
  assertEqual(groups[0]?.endIndex, 3, 'Fin à index 3');
}
console.log('\nTEST 3 — Deux groupes séparés');
{
  const hand: GameCard[] = [
    card('7','hearts'), card('8','hearts'), card('9','hearts'),  // tierce
    card('2','clubs'),                                            // isolée
    card('K','spades'), card('K','hearts'), card('K','diamonds'), // brelan
  ];
  const groups = detectHandGroups(hand);
  assertEqual(groups.length, 2, '2 groupes détectés');
  assertEqual(groups[0]?.type, 'tierce', 'Groupe 1 = tierce');
  assertEqual(groups[1]?.type, 'carre', 'Groupe 2 = brelan');
  assertEqual(groups[1]?.startIndex, 4, 'Groupe 2 commence à index 4');
}
console.log('\nTEST 4 — Carré (4 cartes)');
{
  const hand: GameCard[] = [card('5','spades'), card('5','hearts'), card('5','diamonds'), card('5','clubs')];
  const groups = detectHandGroups(hand);
  assertEqual(groups.length, 1, '1 groupe');
  assertEqual(groups[0]?.cardIds.length, 4, '4 cartes dans le groupe');
}
console.log('\nTEST 5 — Tierce de 5 cartes');
{
  const hand: GameCard[] = [card('5','hearts'), card('6','hearts'), card('7','hearts'), card('8','hearts'), card('9','hearts')];
  const groups = detectHandGroups(hand);
  assertEqual(groups.length, 1, '1 groupe');
  assertEqual(groups[0]?.cardIds.length, 5, '5 cartes (tierce max)');
}
console.log('\nTEST 6 — Combinaison avec Joker');
{
  const hand: GameCard[] = [card('A','hearts'), card('K','hearts'), joker(1)];
  const groups = detectHandGroups(hand);
  assertEqual(groups.length, 1, 'Groupe avec Joker détecté');
  assertEqual(groups[0]?.type, 'tierce', 'A♥ K♥ JOKER = tierce');
}
console.log('\nTEST 7 — Aucun groupe si non adjacent');
{
  const hand: GameCard[] = [card('7','hearts'), card('2','clubs'), card('8','hearts'), card('9','hearts')];
  const groups = detectHandGroups(hand);
  assertEqual(groups.length, 0, 'Aucun groupe (cartes non adjacentes)');
}
console.log('\nTEST 8 — findGroupForCard');
{
  const hand: GameCard[] = [card('Q','spades'), card('Q','hearts'), card('Q','diamonds'), card('7','clubs')];
  const groups = detectHandGroups(hand);
  const g = findGroupForCard(groups, 'Qh1');
  assertEqual(g !== null, true, 'Q♥ appartient à un groupe');
  assertEqual(g?.cardIds.length, 3, 'Le groupe a 3 cartes');
  const none = findGroupForCard(groups, '7c1');
  assertEqual(none, null, '7♣ n\'appartient à aucun groupe');
}
console.log('\nTEST 9 — moveBlock: déplacer un groupe vers la fin');
{
  // A | Q Q Q | 7 8 9  →  A | 7 8 9 | Q Q Q
  const ids = ['A', 'Q1', 'Q2', 'Q3', '7', '8', '9'];
  const result = moveBlock(ids, ['Q1', 'Q2', 'Q3'], 7);
  assertArr(result, ['A', '7', '8', '9', 'Q1', 'Q2', 'Q3'], 'Groupe déplacé à la fin');
}
console.log('\nTEST 10 — moveBlock: déplacer un groupe au début');
{
  const ids = ['A', '7', '8', '9', 'Q1', 'Q2', 'Q3'];
  const result = moveBlock(ids, ['Q1', 'Q2', 'Q3'], 0);
  assertArr(result, ['Q1', 'Q2', 'Q3', 'A', '7', '8', '9'], 'Groupe déplacé au début');
}
console.log('\nTEST 11 — moveBlock: carte simple');
{
  const ids = ['A', 'B', 'C', 'D'];
  const result = moveBlock(ids, ['A'], 3);
  assertArr(result, ['B', 'C', 'A', 'D'], 'Carte simple déplacée');
}
console.log('\nTEST 12 — moveBlock: groupe au milieu');
{
  const ids = ['A', 'B', 'X1', 'X2', 'X3', 'C', 'D'];
  const result = moveBlock(ids, ['X1', 'X2', 'X3'], 6);
  assertArr(result, ['A', 'B', 'C', 'X1', 'X2', 'X3', 'D'], 'Groupe inséré entre C et D');
}
console.log('\n========================================');
console.log('RÉSUMÉ');
console.log('========================================');
console.log(`✅ Réussis: ${passed}`);
console.log(`❌ Échoués: ${failed}`);
console.log(`📊 Total: ${passed + failed}`);
console.log('========================================\n');
if (failed > 0) process.exit(1);
