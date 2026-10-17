// Local pass-and-play UI: pass screen, active hand, hidden hands and CHOP.
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type GameConfig, type GameState } from '../core/types';
import { createInitialGameState, discard, performDrawing, startNewRound } from '../core/engine';
import { getSeatOrder } from '../core/types';
import GameScreen from '@/components/GameScreen';

const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 3 };
const names = ['Amine', 'Sofia', 'Yacine'];

/** Real 3-human game, placed on the first seat, ready to discard. */
function dealtHotseatGame(): GameState {
  const base = startNewRound(
    performDrawing(createInitialGameState(config, names, { humans: 'all' })),
  );
  const seat = base.players.findIndex(p => !p.isAI);
  return {
    ...base,
    phase: 'playing',
    currentPlayerIndex: seat,
    turnState: {
      ...base.turnState!,
      playerId: base.players[seat].id,
      phase: 'playing',
      hasDrawn: true,
      isInitialDealTurn: false,
      drawSource: undefined,
      temporaryCombinations: [],
      actionsThisTurn: [],
    },
  };
}

/** Player 0 discards: player 1 is now on turn, at must_draw with a CHOP window. */
function stateOnSecondSeat(): GameState {
  const base = dealtHotseatGame();
  const discarded = discard(base, base.players[0].hand[base.players[0].hand.length - 1].id);
  expect(discarded.currentPlayerIndex).toBe(1);
  return discarded;
}

function renderGame(state: GameState) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => {
    root.render(
      <GameScreen
        initialState={state}
        hotseat
        config={state.config}
        playerNames={state.players.map(p => p.name)}
        onBack={() => {}}
      />,
    );
  });
  return { host, root };
}

function buttonByText(text: string, scope: ParentNode = document): HTMLButtonElement | null {
  return (
    (Array.from(scope.querySelectorAll('button')).find(b =>
      (b.textContent ?? '').replace(/\s+/g, ' ').includes(text),
    ) as HTMLButtonElement | undefined) ?? null
  );
}

async function click(element: HTMLElement | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
}

const mounted: Root[] = [];
function render(state: GameState) {
  const result = renderGame(state);
  mounted.push(result.root);
  return result;
}

afterEach(() => {
  act(() => mounted.splice(0).forEach(root => root.unmount()));
  document.body.innerHTML = '';
});

describe('pass-the-device screen', () => {
  it('asks the incoming player and hides every physical card', () => {
    const state = stateOnSecondSeat();
    render(state);
    const gate = document.querySelector('[data-hotseat-gate]');
    expect(gate).not.toBeNull();
    expect(gate!.textContent).toContain('Passe l’appareil à');
    expect(gate!.textContent).toContain('Sofia');
    // No hand is rendered while the screen is up.
    expect(document.querySelectorAll('.hand-slot').length).toBe(0);
    expect(document.querySelectorAll('.hand-factions, .hand-actions').length).toBe(0);
    // Card backs only.
    expect(
      document.querySelectorAll('[data-hotseat-hidden-hand] .card-back').length,
    ).toBeGreaterThan(0);
    // The previous player's physical cards are nowhere in the DOM.
    const html = document.body.innerHTML;
    for (const card of state.players[0].hand) expect(html).not.toContain(`"${card.id}"`);
    for (const card of state.players[1].hand) expect(html).not.toContain(`"${card.id}"`);
  });

  it('reveals only the active hand once ready, and the CHOP window belongs to it', async () => {
    const state = stateOnSecondSeat();
    render(state);
    await click(buttonByText('Je suis prêt'));
    expect(document.querySelector('[data-hotseat-gate]')).toBeNull();
    const slots = document.querySelectorAll('[data-local-hand-panel] .hand-slot');
    expect(slots.length).toBe(state.players[1].hand.length);
    expect(
      document.querySelector('[data-local-hand-panel]')!.getAttribute('aria-label'),
    ).toContain('Sofia');
    // CHOP is offered to the player whose turn it is (the incoming one).
    const actions = document.querySelector('.hand-actions')!;
    expect(actions.textContent).toContain('CHOP');
  });

  it('hands the device over again when the turn ends', async () => {
    const state = stateOnSecondSeat();
    render(state);
    await click(buttonByText('Je suis prêt'));
    await click(buttonByText('Piocher'));
    // The drawn card is auto-selected, as in solo.
    await click(buttonByText('Défausser'));
    const gate = document.querySelector('[data-hotseat-gate]');
    expect(gate).not.toBeNull();
    const nextSeat = getSeatOrder(3)[2];
    expect(gate!.textContent).toContain(names[2]);
    expect(nextSeat).toBe('north-west');
    expect(document.querySelectorAll('.hand-slot').length).toBe(0);
  });
});

describe('hidden opponent hands', () => {
  it('never exposes another player hand or card identity', async () => {
    const state = stateOnSecondSeat();
    render(state);
    await click(buttonByText('Je suis prêt'));
    const zones = document.querySelectorAll('[data-opponent-hand]');
    expect(zones.length).toBe(2);
    for (const zone of zones) {
      expect(zone.querySelectorAll('[data-card-id]').length).toBe(0);
      expect(zone.querySelectorAll('img').length).toBe(0);
    }
    const html = document.body.innerHTML;
    for (const index of [0, 2]) {
      for (const card of state.players[index].hand) {
        expect(html).not.toContain(`"${card.id}"`);
      }
    }
  });
});
