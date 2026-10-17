import { assertDeckIntegrity } from '../core/deck-integrity';
import { setTransitionAuditor } from '../core/engine';
// Deterministic all-AI turn-progression smoke test (2–5 players).
// Run with: ./node_modules/.bin/tsx src/game/tests/ai-simulation-tests.ts
import {
  DEFAULT_CONFIG,
  GameConfig,
} from '../core/types';
import {
  createInitialGameState, getNextSeatIndex, getPlayOrder, performDrawing, startNewRound,
} from '../core/engine';
import { executeAITurn } from '../ai/ai-player';
import { validateCombination } from '../core/validation';
import { getSeatOrder, INITIAL_THRESHOLDS } from '../core/types';

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

const strictChopRules: Partial<GameConfig> = {
  chopObligatoire: true,
  chopSeulementOuverture: true,
  chopCarteObligatoireAJouer: true,
  tierceObligatoire: true,
};
let auditedTransitions = 0;
let simulatedGames = 0;
let boundedGames = 0;
let aiTurns = 0;
let seatRotations = 0;
let suiteChecks = 0;

for (const playerCount of [2, 3, 4, 5] as const) {
  for (let seed = 1; seed <= 125; seed++) {
    const originalRandom = Math.random;
    Math.random = mulberry32(playerCount * 10000 + seed);
    try {
      const config: GameConfig = { ...DEFAULT_CONFIG, ...(seed <= 100 ? strictChopRules : {}), playerCount };
      const names = Array.from({ length: playerCount }, (_, i) => `AI-${i + 1}`);
      const setup = createInitialGameState(config, names);
      const drawn = performDrawing(setup);
      const allAI = { ...drawn, players: drawn.players.map(player => ({ ...player, isAI: true })) };
      setTransitionAuditor((state) => { assertDeckIntegrity(state); auditedTransitions++; });
      let state = startNewRound(allAI);
      const maxTurns = 800;

      // Every seat must be occupied exactly once, in the table rotation order.
      const seats = getSeatOrder(playerCount);
      const occupied = getPlayOrder(state)
        .map(index => state.players[index].seat)
        .join(' \u2192 ');
      if (occupied !== seats.join(' \u2192 ')) {
        throw new Error(`Seed ${seed}, ${playerCount}p: seats ${occupied} do not follow ${seats.join(' \u2192 ')}`);
      }

      for (let turn = 0; turn < maxTurns && state.phase === 'playing'; turn++) {
        const previousPlayerIndex = state.currentPlayerIndex;
        const currentPlayer = state.players[previousPlayerIndex];
        if (!currentPlayer.isAI) throw new Error(`Seed ${seed}, ${playerCount}p: unexpected human seat`);

        state = executeAITurn(state);
        aiTurns++;

        // The turn must move to the next SEAT, never to an arbitrary index.
        if (state.phase === 'playing' && state.currentPlayerIndex !== previousPlayerIndex) {
          const expectedIndex = getNextSeatIndex(state, previousPlayerIndex);
          if (state.currentPlayerIndex !== expectedIndex) {
            throw new Error(`Seed ${seed}, ${playerCount}p: turn jumped from ${state.players[previousPlayerIndex].seat} to ${state.players[state.currentPlayerIndex].seat} instead of ${state.players[expectedIndex].seat}`);
          }
          seatRotations++;
        }
        // SUITE always stays at or above the table threshold.
        if (state.suite < INITIAL_THRESHOLDS[playerCount]) {
          throw new Error(`Seed ${seed}, ${playerCount}p: SUITE ${state.suite} fell below the threshold ${INITIAL_THRESHOLDS[playerCount]}`);
        }
        suiteChecks++;

        const invalidCombo = state.tableCombinations.find(combo => !validateCombination(combo).valid);
        if (invalidCombo) throw new Error(`Seed ${seed}, ${playerCount}p: AI left invalid combo ${invalidCombo.id}`);
        const invalidOpening = state.players.find(player =>
          player.status === 'opened' &&
          (player.openingValue == null || player.openingThreshold == null || player.openingValue < player.openingThreshold)
        );
        if (invalidOpening) throw new Error(`Seed ${seed}, ${playerCount}p: ${invalidOpening.id} opened below engine threshold`);
        if (state.phase === 'playing' && state.currentPlayerIndex === previousPlayerIndex) {
          throw new Error(`Seed ${seed}, ${playerCount}p: AI turn stuck on ${currentPlayer.id}; phase=${state.turnState?.phase}, draw=${state.turnState?.drawSource}, hand=${state.players[previousPlayerIndex].hand.map(card => card.id).join(',')}, mandatory=${state.turnState?.mandatoryChopCardId ?? '-'}, actions=${state.turnState?.actionsThisTurn.map(action => `${action.type}:${JSON.stringify(action.data)}`).join('|') ?? '-'}, combos=${state.tableCombinations.map(combo => `${combo.id}/${combo.ownerId}/${combo.cards.map(card => card.id).join(',')}`).join('|')}`);
        }
      }
      assertDeckIntegrity(state);
      if (state.phase === 'playing') boundedGames++;
      simulatedGames++;
    } finally {
      setTransitionAuditor();
      Math.random = originalRandom;
    }
  }
}

console.log(`✅ ${simulatedGames} 100% IA games simulated (125 seeds × 2–5 players; 400 strict CHOP, 100 default rules)`);
console.log(`✅ ${aiTurns} AI turns advanced with no stuck turn`);
console.log(`✅ ${seatRotations} turn handovers followed the seat rotation`);
console.log(`✅ ${suiteChecks} SUITE values stayed at or above the table threshold`);

console.log(`✅ ${auditedTransitions} intermediate engine states passed full 108-card integrity audit`);

console.log(`✅ ${simulatedGames - boundedGames} rounds ended; ${boundedGames} default-rule simulations reached the 800-turn cap (all states audited)`);
