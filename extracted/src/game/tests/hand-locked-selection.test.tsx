// Hand UI: several locked combinations can be selected together, and a small
// arrow merges a neighbouring card into a locked combination.
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type GameCard, type GameConfig, type GameState, type Rank, type Suit } from '../core/types';
import { createInitialGameState, performDrawing, startNewRound } from '../core/engine';
import GameScreen from '@/components/GameScreen';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

let serial = 0;
const card = (rank: Rank, suit: Suit): GameCard => ({
  id: `hand-${rank}-${suit}-${++serial}`,
  rank,
  suit,
  pack: 1,
  isJoker: false,
});

const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 2 };

/**
 * A playing game on the local seat, with a hand prepared in the given order.
 * The engine state stays consistent: the cards are taken out of the stock.
 */
function gameWithHand(wantedHand: GameCard[]): { state: GameState; hand: GameCard[] } {
  // Only natural cards are prepared here; a Joker has no rank/suit to match.
  const hand: GameCard[] = [...wantedHand];
  const base = startNewRound(performDrawing(createInitialGameState(config, ['Vous', 'Amine'])));
  const used = new Set(hand.map(c => c.id));
  const stock = [...base.deck];
  for (const wanted of hand) {
    if (wanted.isJoker) continue;
    const index = stock.findIndex(
      c => !c.isJoker && c.rank === wanted.rank && c.suit === wanted.suit && !used.has(c.id),
    );
    if (index >= 0) {
      // The real card from the deck replaces the fabricated one (same identity).
      const real = stock.splice(index, 1)[0];
      hand[hand.indexOf(wanted)] = real;
      used.delete(wanted.id);
      used.add(real.id);
    }
  }
  return {
    hand,
    state: {
    ...base,
    deck: stock,
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

function renderGame(state: GameState) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <GameScreen
        initialState={state}
        config={state.config}
        playerNames={state.players.map(p => p.name)}
        onBack={() => {}}
      />,
    );
  });
  return host;
}

function button(container: ParentNode, label: string) {
  return Array.from(container.querySelectorAll('button')).find(b =>
    (b.getAttribute('aria-label') ?? b.textContent ?? '').includes(label),
  );
}

function press(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  act(() => {
    element!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function clickCard(container: ParentNode, cardId: string) {
  const slot = container.querySelector(`[data-card-id="${cardId}"]`);
  expect(slot, `card ${cardId}`).toBeTruthy();
  act(() => {
    slot!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

const selectedIds = (container: ParentNode) =>
  Array.from(container.querySelectorAll('.card.selected')).map(el => el.getAttribute('aria-label'));

/** Which edge of the locked block a card sits on, from the rendered hand order. */
function expectedSide(container: ParentNode, cardId: string, blockFirstId: string) {
  const cardIndex = Number(container.querySelector(`[data-card-id="${cardId}"]`)!.getAttribute('data-ci'));
  const blockIndex = Number(container.querySelector(`[data-card-id="${blockFirstId}"]`)!.getAttribute('data-ci'));
  return cardIndex < blockIndex ? 'before' : 'after';
}

/** Select cards one by one (a locked block selects as a whole), then lock them. */
function lockCards(container: ParentNode, cards: GameCard[]) {
  for (const cardItem of cards) clickCard(container, cardItem.id);
  const lock = Array.from(container.querySelectorAll('button')).find(b =>
    (b.textContent ?? '').includes('Verrouiller la sélection'),
  );
  expect(lock, 'bouton Verrouiller la sélection').toBeTruthy();
  press(lock);
}

describe('locked combinations in the hand', () => {
  it('selects several locked combinations together', () => {
    const run1 = [card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts')];
    const run2 = [card('J', 'clubs'), card('Q', 'clubs'), card('K', 'clubs')];
    const { state, hand } = gameWithHand([...run1, card('2', 'diamonds'), ...run2]);
    const [five, six, seven, , jack, queen, king] = hand;
    const container = renderGame(state);

    // Freeze both combinations, one after the other.
    lockCards(container, [five, six, seven]);
    lockCards(container, [jack, queen, king]);
    const lockedSlots = Array.from(container.querySelectorAll('[data-card-id][data-locked="true"]'));
    expect(lockedSlots).toHaveLength(6);

    // Selecting a locked combination selects the whole block…
    clickCard(container, five.id);
    expect(selectedIds(container)).toHaveLength(3);
    // …and selecting a second one ADDS to the selection instead of replacing it.
    clickCard(container, queen.id);
    expect(selectedIds(container)).toHaveLength(6);
    // Clicking an already selected block removes only that block.
    clickCard(container, queen.id);
    expect(selectedIds(container)).toHaveLength(3);
    const remaining = selectedIds(container).join(' | ');
    expect(remaining).toContain('5 hearts');
    expect(remaining).toContain('6 hearts');
    expect(remaining).toContain('7 hearts');
  });

  it('shows an arrow for the neighbouring card that extends a locked combination', () => {
    const { state, hand } = gameWithHand([
      card('5', 'hearts'),
      card('6', 'hearts'),
      card('7', 'hearts'),
      card('8', 'hearts'),
    ]);
    const [five, six, seven, eight] = hand;
    const container = renderGame(state);

    lockCards(container, [five, six, seven]);
    const arrows = Array.from(container.querySelectorAll('[data-locked-extension]'));
    expect(arrows).toHaveLength(1);
    expect(arrows[0].getAttribute('data-extension-card')).toBe(eight.id);
    expect(arrows[0].getAttribute('data-extension-type')).toBe('tierce');
    // The side follows the visual hand order (value sort is descending).
    expect(arrows[0].getAttribute('data-extension-side')).toBe(expectedSide(container, eight.id, five.id));
    expect((arrows[0] as HTMLElement).className).toContain('hand-locked-extension');
    expect(arrows[0].getAttribute('aria-label')).toContain('Ajouter 8');

    press(arrows[0]);
    // The four cards now form ONE locked block and the arrow is gone.
    expect(container.querySelectorAll('[data-locked-extension]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-card-id][data-locked="true"]')).toHaveLength(4);
  });

  it('offers the arrow on the left side too, and never for a foreign card', () => {
    const { state, hand } = gameWithHand([
      card('4', 'spades'),
      card('5', 'spades'),
      card('6', 'spades'),
      card('7', 'spades'),
      card('9', 'hearts'),
    ]);
    const [four, five, six, seven] = hand;
    const container = renderGame(state);
    lockCards(container, [five, six, seven]);

    const arrows = Array.from(container.querySelectorAll('[data-locked-extension]'));
    expect(arrows).toHaveLength(1);
    expect(arrows[0].getAttribute('data-extension-card')).toBe(four.id);
    expect(arrows[0].getAttribute('data-extension-side')).toBe(expectedSide(container, four.id, five.id));
    // The 9♥ is not adjacent to the run and could never join it.
    expect(arrows.some(a => a.getAttribute('data-extension-card') === hand[4].id)).toBe(false);
  });
});
