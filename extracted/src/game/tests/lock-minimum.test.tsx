// A lock only ever freezes a real combination (three cards or more).
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, RANK_ORDER, type GameCard, type GameConfig, type GameState, type Rank, type Suit } from '../core/types';
import { createInitialGameState, performDrawing, startNewRound } from '../core/engine';
import { handLayout } from '@/components/presentation/hand-layout';
import GameScreen from '@/components/GameScreen';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

type Natural = GameCard & { rank: Rank; suit: Suit };
let serial = 0;
const card = (rank: Rank, suit: Suit): GameCard => ({
  id: `pair-${rank}-${suit}-${++serial}`,
  rank,
  suit,
  pack: 1,
  isJoker: false,
});

const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 2 };

/**
 * A playing game on the local seat. The hand is taken from the real stock, so
 * the 108-card audit always passes whatever the deal produced (a fixed rank may
 * well sit in the opponent's hand).
 */
function gameWithHand(): { state: GameState; hand: Natural[]; run: Natural[] } {
  const base = startNewRound(performDrawing(createInitialGameState(config, ['Vous', 'Amine'])));
  const stock = base.deck.filter((card): card is Natural => !card.isJoker);
  // Find any three consecutive ranks of the same suit in the stock.
  let run: Natural[] | null = null;
  for (const suit of ['hearts', 'spades', 'clubs', 'diamonds'] as const) {
    const suitCards = stock
      .filter(card => card.suit === suit)
      .sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
    for (let i = 0; i + 2 < suitCards.length && !run; i++) {
      if (
        RANK_ORDER[suitCards[i + 1].rank] === RANK_ORDER[suitCards[i].rank] + 1 &&
        RANK_ORDER[suitCards[i + 2].rank] === RANK_ORDER[suitCards[i].rank] + 2
      )
        run = [suitCards[i], suitCards[i + 1], suitCards[i + 2]];
    }
    if (run) break;
  }
  if (!run) throw new Error('no run available in the stock');
  const runIds = new Set(run.map(c => c.id));
  const spare = stock.filter(c => !runIds.has(c.id)).slice(0, 2);
  const hand = [...run, ...spare];
  const handIds = new Set(hand.map(c => c.id));
  return {
    hand,
    run,
    state: {
      ...base,
      deck: base.deck.filter(c => !handIds.has(c.id)),
      currentPlayerIndex: 0,
      phase: 'playing',
      players: base.players.map((p, i) => (i === 0 ? { ...p, hand } : p)),
      turnState: {
        ...base.turnState!,
        playerId: base.players[0].id,
        phase: 'playing',
        hasDrawn: true,
        isInitialDealTurn: false,
        temporaryCombinations: [],
        actionsThisTurn: [],
      },
    },
  };
}

function renderGame(state: GameState, lockedSets: string[][]) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const hand = state.players[0].hand.map(c => c.id);
  act(() => {
    root!.render(
      <GameScreen
        initialState={state}
        initialView={{ sortMode: 'manual', manualOrder: hand, lockedSets, selectedCards: [] }}
        config={state.config}
        playerNames={state.players.map(p => p.name)}
        onBack={() => {}}
      />,
    );
  });
  return host;
}

const lockedSlots = (container: ParentNode) =>
  container.querySelectorAll('[data-card-id][data-locked="true"]').length;

describe('locked combinations need three cards', () => {
  it('never renders a two-card set as a locked block', () => {
    const run = [card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')];
    const layout = handLayout(run, [run.slice(0, 2).map(c => c.id)]);
    expect(layout.segments.filter(segment => segment.locked)).toHaveLength(0);
    // The real combination still locks normally.
    expect(handLayout(run, [run.map(c => c.id)]).segments.filter(segment => segment.locked)).toHaveLength(1);
  });

  it('releases a stored two-card lock when the game is opened', () => {
    const { state, hand } = gameWithHand();
    const container = renderGame(state, [hand.slice(0, 2).map(c => c.id)]);
    expect(lockedSlots(container)).toBe(0);
    expect(container.querySelectorAll('.hand-lock-control svg[aria-label="Groupe verrouillé"]')).toHaveLength(0);
  });

  it('does not offer to lock a two-card selection', () => {
    const { state, hand } = gameWithHand();
    const container = renderGame(state, []);
    for (const cardItem of hand.slice(0, 2)) {
      act(() => {
        container
          .querySelector(`[data-card-id="${cardItem.id}"]`)!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    }
    const lockButton = Array.from(container.querySelectorAll('button')).find(b =>
      (b.textContent ?? '').includes('Verrouiller la sélection'),
    );
    expect(lockButton).toBeUndefined();
  });

  it('still locks a real three-card combination', () => {
    const { state, hand } = gameWithHand();
    const container = renderGame(state, [hand.slice(0, 3).map(c => c.id)]);
    expect(lockedSlots(container)).toBe(3);
  });
});
