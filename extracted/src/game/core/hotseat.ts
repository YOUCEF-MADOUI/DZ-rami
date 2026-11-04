// =====================================================
// LOCAL HOT-SEAT ("pass the device") — pure helpers
// No rules live here: only who is holding the device, which turn it is, and
// what may be shown to that person. Everything is derived from the engine state
// so the UI and the tests share the exact same definitions.
// =====================================================
import type { GameCard, GameState, Player } from './types';

export type PlayMode = 'solo' | 'hotseat';

/**
 * Index of the human who is holding the device right now.
 *  - solo: the only human is the first seat, whatever the current player is;
 *  - hotseat: every seat is human, so the current player holds the device.
 */
export function activeHumanIndex(
  state: Pick<GameState, 'players' | 'currentPlayerIndex'>,
  mode: PlayMode,
): number {
  if (mode === 'hotseat') {
    return Math.min(
      Math.max(0, state.currentPlayerIndex),
      Math.max(0, state.players.length - 1),
    );
  }
  return 0;
}

export function activeHumanPlayer(
  state: Pick<GameState, 'players' | 'currentPlayerIndex'>,
  mode: PlayMode,
): Player {
  return state.players[activeHumanIndex(state, mode)];
}

/** The accuser is whoever holds the device: the human who clicked. */
export function activeAccuserId(
  state: Pick<GameState, 'players' | 'currentPlayerIndex'>,
  mode: PlayMode,
): string {
  return activeHumanPlayer(state, mode).id;
}

/**
 * Stable identifier of one turn: it changes when the round, the player or the
 * number of completed turns changes, and never during a single turn.
 */
export function turnSerial(
  state: Pick<GameState, 'roundNumber' | 'currentPlayerIndex' | 'actionHistory'>,
): string {
  const discards = state.actionHistory.filter(action => action.type === 'discard').length;
  return `${state.roundNumber}:${state.currentPlayerIndex}:${discards}`;
}

/**
 * True when the device must be handed over before the next action.
 * `readyKey` is the last turn serial that was explicitly acknowledged.
 */
export function shouldPassDevice(
  state: Pick<GameState, 'phase' | 'roundNumber' | 'currentPlayerIndex' | 'actionHistory'>,
  mode: PlayMode,
  readyKey: string | null,
): boolean {
  if (mode !== 'hotseat') return false;
  if (state.phase !== 'playing') return false;
  return readyKey !== turnSerial(state);
}

/**
 * What may be shown of a hand: the physical cards only for the person holding
 * the device; a bare count for everybody else (rendered as card backs).
 */
export function visibleHand(
  state: Pick<GameState, 'players' | 'currentPlayerIndex'>,
  mode: PlayMode,
  playerIndex: number,
): GameCard[] {
  return playerIndex === activeHumanIndex(state, mode)
    ? state.players[playerIndex].hand
    : [];
}

/**
 * Card-back placeholders for the hand of the player who is NOT holding the
 * device any more. No identity, no rank, no suit leaves the engine.
 */
export function maskedHandSlots(
  state: Pick<GameState, 'players' | 'currentPlayerIndex'>,
  mode: PlayMode,
  playerIndex: number,
): number[] {
  if (playerIndex === activeHumanIndex(state, mode)) return [];
  const count = state.players[playerIndex]?.hand.length ?? 0;
  return Array.from({ length: count }, (_, index) => index);
}

/** The active human is allowed to act only while holding the device. */
export function canActForActiveHuman(
  state: Pick<GameState, 'phase' | 'players' | 'currentPlayerIndex'>,
  mode: PlayMode,
  ready: boolean,
): boolean {
  if (state.phase !== 'playing') return false;
  if (mode === 'hotseat' && !ready) return false;
  return true;
}
