import { GameCard, GameState } from './types';
import { createDeck } from './deck';

/** Historical copies are evidence, not physical zones. Include the uncommitted draft. */
export function assertDeckIntegrity(state: GameState): void {
  const zones: [string, readonly GameCard[]][] = [
    ['stock', state.deck], ['discard', state.discardPile], ['base', state.basePile],
    ...state.players.map(p => [`hand:${p.id}`, p.hand] as [string, GameCard[]]),
    ...state.tableCombinations.map(c => [`table:${c.id}`, c.cards] as [string, GameCard[]]),
    ...(state.turnState?.temporaryCombinations ?? []).map(c => [`draft:${c.id}`, c.cards] as [string, GameCard[]]),
  ];
  const manifest = new Map(createDeck().map(c => [c.id, c]));
  const locations = new Map<string, string>();
  const naturalCounts = new Map<string, number>();
  let total = 0, jokers = 0;
  for (const [zone, cards] of zones) for (const card of cards) {
    if (locations.has(card.id)) throw new Error(`Duplicate ${card.id}: ${locations.get(card.id)} and ${zone}`);
    locations.set(card.id, zone);
    const expected = manifest.get(card.id);
    if (!expected || expected.isJoker !== card.isJoker) throw new Error(`Unknown/mutated card ${card.id} in ${zone}`);
    if (card.isJoker) {
      if (!expected.isJoker || card.jokerIndex !== expected.jokerIndex) throw new Error(`Mutated Joker ${card.id}`);
      jokers++;
    } else {
      if (expected.isJoker || card.rank !== expected.rank || card.suit !== expected.suit || card.pack !== expected.pack) throw new Error(`Mutated natural card ${card.id}`);
      const key = `${card.rank}:${card.suit}`;
      const count = (naturalCounts.get(key) ?? 0) + 1;
      if (count > 2) throw new Error(`More than two ${key}`);
      naturalCounts.set(key, count);
    }
    total++;
  }
  if (total !== 108 || jokers !== 4 || locations.size !== 108) {
    throw new Error(`Deck integrity: ${total}/108 cards, ${jokers}/4 jokers; missing: ${[...manifest.keys()].filter(id => !locations.has(id)).join(',')}`);
  }
}
