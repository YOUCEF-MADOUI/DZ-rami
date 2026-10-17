// Local pass-and-play: engine seats, active player, accusations and masking.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  getSeatOrder,
  type Combination,
  type GameCard,
  type GameConfig,
  type GameState,
  type Rank,
  type Suit,
} from '../core/types';
import { createDeck } from '../core/deck';
import {
  createInitialGameState,
  discard,
  getAvailableActions,
  isHumanSeat,
  performDrawing,
  reportFault,
  startNewRound,
} from '../core/engine';
import { projectPlayerView } from '../core/public-view';
import {
  activeAccuserId,
  activeHumanIndex,
  activeHumanPlayer,
  maskedHandSlots,
  shouldPassDevice,
  turnSerial,
  visibleHand,
} from '../core/hotseat';

const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 3 };
const names = ['Amine', 'Sofia', 'Yacine'];
const deck = createDeck();
const card = (rank: Rank, suit: Suit, pack: 1 | 2 = 1) =>
  deck.find(c => !c.isJoker && c.rank === rank && c.suit === suit && c.pack === pack)!;

function hotseatGame(count = 3): GameState {
  const setup = createInitialGameState(
    { ...DEFAULT_CONFIG, playerCount: count as 2 | 3 | 4 | 5 },
    names.slice(0, count),
    { humans: 'all' },
  );
  return startNewRound(performDrawing(setup));
}

/** Put the game on a chosen seat, ready to play (no draw required). */
function atSeat(state: GameState, index: number): GameState {
  return {
    ...state,
    phase: 'playing',
    currentPlayerIndex: index,
    turnState: {
      ...state.turnState!,
      playerId: state.players[index].id,
      phase: 'playing',
      hasDrawn: true,
      isInitialDealTurn: false,
      drawSource: undefined,
      mandatoryChopCardId: undefined,
      temporaryCombinations: [],
      actionsThisTurn: [],
    },
  };
}

/** Deterministic 3-player table whose first seat just discarded a real carré. */
function afterDiscardWithUnrecoveredCarre() {
  const base = hotseatGame(3);
  const combo: Combination = {
    id: 'table-carre',
    type: 'carre',
    ownerId: 'player-0',
    completedById: 'player-0',
    cards: [card('8', 'hearts'), card('8', 'diamonds'), card('8', 'clubs'), deck.find(c => c.isJoker)!],
  };
  const hand: GameCard[] = [card('2', 'clubs'), card('3', 'clubs')];
  const used = new Set([...combo.cards, ...hand].map(c => c.id));
  let state: GameState = {
    ...base,
    phase: 'playing',
    players: base.players.map((player, index) => ({
      ...player,
      status: index === 0 ? ('opened' as const) : ('not_opened' as const),
      hand: index === 0 ? hand : [],
    })),
    deck: deck.filter(c => !used.has(c.id)),
    discardPile: [],
    basePile: [],
    tableCombinations: [combo],
    currentPlayerIndex: 0,
    actionHistory: [],
    turnState: {
      ...base.turnState!,
      playerId: 'player-0',
      phase: 'playing',
      hasDrawn: true,
      isInitialDealTurn: false,
      drawSource: undefined,
      temporaryCombinations: [],
      actionsThisTurn: [],
    },
  };
  state = discard(state, hand[0].id);
  return state;
}

describe('human seats', () => {
  it('a 3-human game contains no robot at all', () => {
    const state = hotseatGame(3);
    expect(state.players).toHaveLength(3);
    expect(state.players.map(p => p.isAI)).toEqual([false, false, false]);
    expect(state.players.every(p => !p.isAI)).toBe(true);
  });

  it('solo keeps exactly one human, as before', () => {
    const solo = createInitialGameState(
      { ...DEFAULT_CONFIG, playerCount: 4 },
      ['Vous', 'Amine', 'Karim', 'Yacine'],
    );
    expect(solo.players.map(p => p.isAI)).toEqual([false, true, true, true]);
  });

  it('isHumanSeat understands first / all / explicit indices', () => {
    expect(isHumanSeat(undefined, 0, 3)).toBe(true);
    expect(isHumanSeat('first', 1, 3)).toBe(false);
    expect(isHumanSeat('all', 2, 3)).toBe(true);
    expect(isHumanSeat([0, 2], 1, 3)).toBe(false);
    expect(isHumanSeat([0, 2], 2, 3)).toBe(true);
  });
});

describe('active human and turn handover', () => {
  it('follows the current seat in hot-seat and stays on the first seat in solo', () => {
    const state = atSeat(hotseatGame(3), 1);
    expect(activeHumanIndex(state, 'hotseat')).toBe(1);
    expect(activeHumanPlayer(state, 'hotseat').id).toBe('player-1');
    // Solo never hands the device over: the first seat remains the only human.
    expect(activeHumanIndex(state, 'solo')).toBe(0);
    expect(activeHumanPlayer(state, 'solo').id).toBe('player-0');
  });

  it('the pass screen is required for every new turn only', () => {
    const state = hotseatGame(3);
    const serial = turnSerial(state);
    expect(shouldPassDevice(state, 'hotseat', null)).toBe(true);
    expect(shouldPassDevice(state, 'hotseat', serial)).toBe(false);
    expect(shouldPassDevice(state, 'solo', null)).toBe(false);
    // A further turn changes the serial, so the screen comes back.
    const moved = atSeat({ ...state, roundNumber: state.roundNumber + 1 }, 0);
    expect(shouldPassDevice(moved, 'hotseat', serial)).toBe(true);
  });

  it('the active player really changes when a turn ends', () => {
    const before = atSeat(hotseatGame(3), 0);
    const nextIndex = getSeatOrder(3).indexOf(getSeatOrder(3)[1]);
    const discarded = discard(before, before.players[0].hand[0].id);
    expect(discarded.currentPlayerIndex).not.toBe(before.currentPlayerIndex);
    expect(discarded.currentPlayerIndex).toBe(1);
    expect(nextIndex).toBe(1);
    expect(activeHumanPlayer(discarded, 'hotseat').id).toBe('player-1');
    expect(turnSerial(discarded)).not.toBe(turnSerial(before));
  });
});

describe('accusations come from the human holding the device', () => {
  it('the accused can be reported by the active player only', () => {
    const state = afterDiscardWithUnrecoveredCarre();
    expect(state.players[state.currentPlayerIndex].id).toBe('player-1');
    // The real fault exists in the finished turn of player 0.
    expect(state.lastCompletedTurnActionsByPlayer['player-0']?.unrecoveredCarreResponsibleIds).toContain('player-0');
    expect(activeAccuserId(state, 'hotseat')).toBe('player-1');

    const available = getAvailableActions(state, activeAccuserId(state, 'hotseat'));
    expect(available.reportablePlayerIds).toEqual(['player-0', 'player-2']);
    expect(available.reportablePlayerIds).not.toContain('player-1');
    expect(available.canReportFault).toBe(true);

    const result = reportFault(
      state,
      activeAccuserId(state, 'hotseat'),
      'player-0',
      'carre_not_recovered',
    );
    expect(result.valid).toBe(true);
    const lastReport = result.state.reports[result.state.reports.length - 1];
    expect(lastReport.accuserId).toBe('player-1');
    expect(lastReport.accusedId).toBe('player-0');
    expect(result.state.phase).toBe('round_end');
  });

  it('a player cannot accuse himself, and solo still accuses from the first seat', () => {
    const hotseat = afterDiscardWithUnrecoveredCarre();
    const self = reportFault(hotseat, 'player-1', 'player-1', 'carre_not_recovered');
    expect(self.valid).toBe(false);
    expect(self.message).toContain('vous signaler vous-même');

    const solo = { ...hotseat, players: hotseat.players.map((p, i) => ({ ...p, isAI: i > 0 })) };
    expect(activeAccuserId(solo, 'solo')).toBe('player-0');
  });
});

describe('hands are masked', () => {
  it('only the active human has a visible hand', () => {
    const state = atSeat(hotseatGame(3), 1);
    expect(visibleHand(state, 'hotseat', 1)).toHaveLength(state.players[1].hand.length);
    expect(visibleHand(state, 'hotseat', 0)).toEqual([]);
    expect(visibleHand(state, 'hotseat', 2)).toEqual([]);
    expect(maskedHandSlots(state, 'hotseat', 0)).toHaveLength(state.players[0].hand.length);
    expect(maskedHandSlots(state, 'hotseat', 1)).toEqual([]);
  });

  it('a public projection only carries the active hand', () => {
    const state = atSeat(hotseatGame(3), 1);
    const view = projectPlayerView(state, activeAccuserId(state, 'hotseat'));
    expect(view.localHand.map(c => c.id)).toEqual(state.players[1].hand.map(c => c.id));
    for (const index of [0, 2]) {
      const otherIds = state.players[index].hand.map(c => c.id);
      expect(otherIds.length).toBeGreaterThan(0);
      for (const id of otherIds) {
        expect(view.localHand.map(c => c.id)).not.toContain(id);
      }
      // Only a count is exposed for everyone else.
      expect(view.players[index]).not.toHaveProperty('hand');
      expect(view.players[index].handCount).toBe(state.players[index].hand.length);
    }
    // The whole serialized view never contains another player's physical cards.
    const serialized = JSON.stringify(view);
    for (const index of [0, 2]) {
      for (const id of state.players[index].hand.map(c => c.id)) {
        expect(serialized).not.toContain(`"${id}"`);
      }
    }
  });
});
