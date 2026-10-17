import { getCombinationDisplayCards, getOpeningHudValues } from '../core/validation';
import { confirmOpening } from '../core/engine';
import { getJokerRepresentation, canRecoverJoker } from '../core/validation';
// Critical engine/rule regression tests.
// Run with: ./node_modules/.bin/tsx src/game/tests/engine-rule-tests.ts
import {
  Card,
  Combination,
  DEFAULT_CONFIG,
  GameCard,
  GameConfig,
  GameState,
  JokerCard,
  Player,
  Rank,
  Suit,
  TurnState,
  INITIAL_THRESHOLDS,
} from '../core/types';
import { getSeatOrder } from '../core/types';
import {
  addToCombination,
  calculateRoundScores,
  chopCard,
  createInitialGameState,
  discard,
  drawCard,
  getAvailableActions,
  getNextSeatIndex,
  getPreviousSeatIndex,
  isChopRequired,
  validateOpening,
  placeCombination,
  recoverJoker,
  rejectChop,
  reportFault,
  returnCarreToBase,
  canReturnCarreToBase,
  startNewRound,
} from '../core/engine';
import {
  calculateCombinationValue,
  calculateTotal,
  canAddToCombination,
  detectCombinationType,
  classifyCombination,
  determineJokerRepresentation,
  determineTierceSequence,
  getCombinationClassLabel,
  getStableJokerPlacement,
  isBrelanWithJoker,
  isTrueCarre,
  resolveJokerPlacement,
  validateCombination,
  validateFirstPose,
} from '../core/validation';
import { executeAITurn } from '../ai/ai-player';
import { GAME_CONFIG_STORAGE_KEY, loadGameConfig, saveGameConfig } from '../core/config-storage';
import { getDrawnCardSelectionId } from '../hooks/useGame';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed++;
    console.error(`❌ ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function card(rank: Rank, suit: Suit, id: string): Card {
  return { id, rank, suit, pack: 1, isJoker: false };
}

function joker(id = 'joker-1', jokerIndex: 1 | 2 | 3 | 4 = 1): JokerCard {
  return { id, isJoker: true, jokerIndex };
}

function combo(
  id: string,
  type: 'tierce' | 'carre',
  cards: GameCard[],
  ownerId = 'player-0',
): Combination {
  const result: Combination = { id, type, cards, ownerId };
  const representation = determineJokerRepresentation(result);
  if (representation) result.jokerRepresents = representation;
  return result;
}

function turnState(
  playerId: string,
  phase: TurnState['phase'] = 'playing',
  overrides: Partial<TurnState> = {},
): TurnState {
  return {
    playerId,
    phase,
    hasDrawn: false,
    hasDiscarded: false,
    isInitialDealTurn: false,
    chopWasAvailableAtTurnStart: false,
    chopRejectedThisTurn: false,
    actionsThisTurn: [],
    recoveredJokers: [],
    reusedJokers: [],
    temporaryCombinations: [],
    ...overrides,
  };
}

function playingState(
  configOverrides: Partial<GameConfig> = {},
  hands: GameCard[][] = [],
): GameState {
  const config: GameConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  const names = Array.from({ length: config.playerCount }, (_, i) => `P${i}`);
  const base = createInitialGameState(config, names);
  const players: Player[] = base.players.map((player, i) => ({
    ...player,
    hand: hands[i] ?? [],
    isAI: i > 0,
  }));
  return {
    ...base,
    phase: 'playing',
    players,
    deck: [],
    discardPile: [],
    tableCombinations: [],
    currentPlayerIndex: 0,
    firstPlayerIndex: 0,
    turnState: turnState(players[0].id),
    suite: INITIAL_THRESHOLDS[config.playerCount],
    suiteLocked: false,
    initialThreshold: INITIAL_THRESHOLDS[config.playerCount],
    lastDiscardFaceDown: false,
    roundNumber: 1,
  };
}

function layCombos(state: GameState, combos: Combination[]): GameState {
  let current = state;
  for (const openingCombo of combos) {
    const before = current;
    current = placeCombination(
      current,
      openingCombo.cards.map(item => item.id),
      openingCombo.type,
    );
    assert(current !== before, `Engine refused expected combination ${openingCombo.id}`);
  }
  return current;
}

function opening69(): Combination[] {
  return [
    combo('10jq-hearts-69', 'tierce', [
      card('10', 'hearts', '69-10h'), card('J', 'hearts', '69-jh'), card('Q', 'hearts', '69-qh'),
    ]),
    combo('10jq-diamonds-69', 'tierce', [
      card('10', 'diamonds', '69-10d'), card('J', 'diamonds', '69-jd'), card('Q', 'diamonds', '69-qd'),
    ]),
    combo('234-clubs-69', 'tierce', [
      card('2', 'clubs', '69-2c'), card('3', 'clubs', '69-3c'), card('4', 'clubs', '69-4c'),
    ]),
  ];
}

function opening71(): Combination[] {
  return [
    combo('qka-hearts-71', 'tierce', [
      card('Q', 'hearts', '71-qh'), card('K', 'hearts', '71-kh'), card('A', 'hearts', '71-ah'),
    ]),
    combo('10jq-spades-71', 'tierce', [
      card('10', 'spades', '71-10s'), card('J', 'spades', '71-js'), card('Q', 'spades', '71-qs'),
    ]),
    combo('a234-clubs-71', 'tierce', [
      card('A', 'clubs', '71-ac'), card('2', 'clubs', '71-2c'), card('3', 'clubs', '71-3c'), card('4', 'clubs', '71-4c'),
    ]),
  ];
}

function opening73(): Combination[] {
  return [
    combo('qka-hearts-73', 'tierce', [
      card('Q', 'hearts', '73-qh'), card('K', 'hearts', '73-kh'), card('A', 'hearts', '73-ah'),
    ]),
    combo('10jq-spades-73', 'tierce', [
      card('10', 'spades', '73-10s'), card('J', 'spades', '73-js'), card('Q', 'spades', '73-qs'),
    ]),
    combo('345-clubs-73', 'tierce', [
      card('3', 'clubs', '73-3c'), card('4', 'clubs', '73-4c'), card('5', 'clubs', '73-5c'),
    ]),
  ];
}

function opening91(): Combination[] {
  return [
    combo('qka-hearts-91', 'tierce', [
      card('Q', 'hearts', '91-qh'), card('K', 'hearts', '91-kh'), card('A', 'hearts', '91-ah'),
    ]),
    combo('10jq-spades-91', 'tierce', [
      card('10', 'spades', '91-10s'), card('J', 'spades', '91-js'), card('Q', 'spades', '91-qs'),
    ]),
    combo('789-diamonds-91', 'tierce', [
      card('7', 'diamonds', '91-7d'), card('8', 'diamonds', '91-8d'), card('9', 'diamonds', '91-9d'),
    ]),
    combo('a23-clubs-91', 'tierce', [
      card('A', 'clubs', '91-ac'), card('2', 'clubs', '91-2c'), card('3', 'clubs', '91-3c'),
    ]),
  ];
}

function aiJokerHeavyUnder71(): Combination[] {
  return [
    combo('ai-q-set', 'carre', [card('Q', 'hearts', 'ai-qh'), card('Q', 'diamonds', 'ai-qd'), card('Q', 'spades', 'ai-qs')]),
    combo('ai-789', 'tierce', [card('7', 'clubs', 'ai-7c'), card('8', 'clubs', 'ai-8c'), card('9', 'clubs', 'ai-9c')]),
    combo('ai-joker-2-4', 'tierce', [card('2', 'hearts', 'ai-2h'), card('4', 'hearts', 'ai-4h'), joker('ai-j1')]),
    combo('ai-joker-3-5', 'tierce', [card('3', 'diamonds', 'ai-3d'), card('5', 'diamonds', 'ai-5d'), joker('ai-j2', 2)]),
  ];
}

function handsWithCombos(combos: Combination[], discardCard: GameCard, reserve: GameCard): GameCard[] {
  return [...combos.flatMap(item => item.cards), discardCard, reserve];
}

test('Opening thresholds remain 71, 91, 101 and 111 for five to two players', () => {
  assert(INITIAL_THRESHOLDS[5] === 71, '5 players: 71');
  assert(INITIAL_THRESHOLDS[4] === 91, '4 players: 91');
  assert(INITIAL_THRESHOLDS[3] === 101, '3 players: 101');
  assert(INITIAL_THRESHOLDS[2] === 111, '2 players: 111');
});

test('Dealing: round starter gets 15, others 14, no first-turn draw/16th card', () => {
  for (const playerCount of [2, 3, 4, 5] as const) {
    const config: GameConfig = { ...DEFAULT_CONFIG, playerCount };
    const names = Array.from({ length: playerCount }, (_, i) => `P${i}`);
    const setup = createInitialGameState(config, names);
    const starterIndex = playerCount - 1;
    const round = startNewRound({ ...setup, firstPlayerIndex: starterIndex });
    assert(round.players[starterIndex].hand.length === 15, `${playerCount}p starter must have 15 cards`);
    assert(round.players.every((player, i) => i === starterIndex || player.hand.length === 14), `${playerCount}p others must have 14 cards`);
    assert(round.currentPlayerIndex === starterIndex, 'The 15-card player starts the round');
    assert(round.turnState?.phase === 'playing' && round.turnState.isInitialDealTurn, 'Starter begins directly in play phase');
    assert(drawCard(round) === round, 'A draw cannot add a 16th card on the opening turn');
  }
});

test('The round starter rotates to the next seat, never keeping the same dealer', () => {
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 4 };
  const setup = createInitialGameState(config, ['P0', 'P1', 'P2', 'P3']);
  // Seats: P0=SUD, P1=EST, P2=NORD, P3=OUEST. Rotation: SUD → EST → NORD → OUEST.
  const previousStarter = 2; // NORD
  const nextRound = startNewRound({ ...setup, roundNumber: 1, firstPlayerIndex: previousStarter });
  assert(nextRound.players[previousStarter].seat === 'north', 'P2 sits NORD');
  assert(nextRound.firstPlayerIndex === 3, 'The starter advances to the next seat (OUEST)');
  assert(nextRound.players[nextRound.firstPlayerIndex].hand.length === 15, 'Rotated starter receives 15 cards');
});

test('Turn order follows the seats: 5p SUD→EST→NE→NO→OUEST, 4p, 3p and 2p', () => {
  const expected: Record<number, string[]> = {
    5: ['south', 'east', 'north-east', 'north-west', 'west'],
    4: ['south', 'east', 'north', 'west'],
    3: ['south', 'north-east', 'north-west'],
    2: ['south', 'north'],
  };
  for (const playerCount of [2, 3, 4, 5] as const) {
    const config: GameConfig = { ...DEFAULT_CONFIG, playerCount };
    const names = Array.from({ length: playerCount }, (_, i) => `P${i}`);
    const state = createInitialGameState(config, names);
    assert(
      state.players.map(player => player.seat).join(' → ') === expected[playerCount].join(' → '),
      `${playerCount}p seats are ${expected[playerCount].join(' → ')}`,
    );

    // Walk a complete rotation using the seat-based helper.
    const visited: string[] = [];
    let index = 0;
    for (let step = 0; step < playerCount; step++) {
      visited.push(state.players[index].seat);
      index = getNextSeatIndex(state, index);
    }
    assert(visited.join(' → ') === expected[playerCount].join(' → '), `${playerCount}p rotation order`);
    assert(index === 0, `${playerCount}p rotation returns to SUD`);
    assert(
      getPreviousSeatIndex(state, 0) === playerCount - 1,
      `${playerCount}p previous seat wraps to the last seat`,
    );
  }
});

test('Discarding really rotates the turn through the seats, seat after seat', () => {
  for (const playerCount of [2, 3, 4, 5] as const) {
    const hands = Array.from({ length: playerCount }, (_, i) => [
      card('2', 'clubs', `rot-${playerCount}-${i}-a`),
      card('3', 'clubs', `rot-${playerCount}-${i}-b`),
    ]);
    let state = playingState({ playerCount }, hands);
    const starter = state.currentPlayerIndex;
    const visited: string[] = [];
    let index = starter;
    for (let turn = 0; turn < playerCount; turn++) {
      visited.push(state.players[index].seat);
      state = {
        ...state,
        currentPlayerIndex: index,
        turnState: turnState(state.players[index].id, 'playing'),
      };
      const next = discard(state, state.players[index].hand[0].id);
      assert(next.currentPlayerIndex !== index, `${playerCount}p: the turn must advance`);
      index = next.currentPlayerIndex;
      state = next;
    }
    assert(index === starter, `${playerCount}p: a full rotation returns to the starter`);
    const rotation = getSeatOrder(playerCount);
    const startPosition = rotation.indexOf(state.players[starter].seat);
    const expectedVisited = Array.from({ length: playerCount }, (_, i) => rotation[(startPosition + i) % rotation.length]);
    assert(visited.join(' → ') === expectedVisited.join(' → '), `${playerCount}p visited seats in order`);
  }
});

test('After the 15-card opening turn, normal turns are draw then discard', () => {
  const setup = createInitialGameState({ ...DEFAULT_CONFIG, playerCount: 3 }, ['P0', 'P1', 'P2']);
  const round = startNewRound(setup);
  const starter = round.players[round.currentPlayerIndex];
  const afterDiscard = discard(round, starter.hand[0].id);
  assert(afterDiscard.currentPlayerIndex !== round.currentPlayerIndex, 'The starter discard advances the turn');
  assert(afterDiscard.turnState?.phase === 'must_draw', 'The next player must draw');
  const nextIndex = afterDiscard.currentPlayerIndex;
  assert(afterDiscard.players[nextIndex].hand.length === 14, 'The next player begins with 14');
  const afterDraw = drawCard(afterDiscard);
  assert(afterDraw.players[nextIndex].hand.length === 15, 'A normal draw adds exactly one card');
  assert(afterDraw.turnState?.drawSource === 'deck', 'Normal draw source is recorded');
});

test('A 69-point opening is refused atomically at threshold 71, without penalty', () => {
  const combos = opening69();
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 5 };
  const result = validateFirstPose(combos, 71, config);
  assert(result.vierge === 69, `Expected VIERGE 69, got ${result.vierge}`);
  assert(!result.valid, '69 must not open at threshold 71');

  const discardCard = card('6', 'clubs', '69-discard');
  const reserve = card('8', 'clubs', '69-reserve');
  let state = playingState({ playerCount: 5 }, [handsWithCombos(combos, discardCard, reserve)]);
  state = layCombos(state, combos);
  assert(state.tableCombinations.length === 0, 'Opening combinations stay out of the shared table until validated');
  assert(state.turnState?.temporaryCombinations.length === combos.length, 'The pose is kept only as a private turn draft');
  const refused = discard(state, discardCard.id);
  assert(refused.players[0].status === 'not_opened', 'An invalid attempt never marks the player opened');
  assert(refused === state, 'Rejected opening leaves draft and all state unchanged');
  assert(refused.turnState?.temporaryCombinations.length === combos.length, 'Draft cards remain in draft');
  assert(refused.faults.length === state.faults.length, 'Illegal opening must not add a penalty');
  assert(refused.actionHistory === state.actionHistory, 'No new history on refusal');
});

test('A refused 69-point draft leaves SUITE unlocked until the same player later opens at 84', () => {
  const draft69 = opening69();
  const completion = combo('84-456-hearts', 'tierce', [
    card('4', 'hearts', '84-4h'), card('5', 'hearts', '84-5h'), card('6', 'hearts', '84-6h'),
  ]);
  const discardCard = card('2', 'spades', '69-84-discard');
  const reserve = card('3', 'spades', '69-84-reserve');
  const allCards = handsWithCombos([...draft69, completion], discardCard, reserve);
  let state = playingState({ playerCount: 5 }, [allCards]);
  state = layCombos(state, draft69);
  const refused = discard(state, discardCard.id);
  assert(refused.players[0].status === 'not_opened', 'The 69-point attempt does not open the player');
  assert(refused.suite === 71 && !refused.suiteLocked, 'A refused opening does not set or lock SUITE');
  assert(refused === state, 'The failed draft is unchanged');

  const completedPose = layCombos(refused, [completion]);
  const accepted = discard(completedPose, discardCard.id);
  assert(accepted.players[0].openingValue === 84, 'The retry is accepted at natural VIERGE 84');
  assert(accepted.suite === 85 && accepted.suiteLocked, 'SUITE locks to 85 only after the valid retry');
});

test('VIERGE excludes the represented Joker values across several Joker combinations', () => {
  const combos = [
    combo('natural-789-27', 'tierce', [card('8', 'hearts', 'jv-8h'), card('9', 'hearts', 'jv-9h'), card('10', 'hearts', 'jv-10h')]),
    combo('joker-a23', 'tierce', [card('A', 'clubs', 'jv-ac'), card('2', 'clubs', 'jv-2c'), joker('jv-1')]),
    combo('joker-234', 'tierce', [card('2', 'diamonds', 'jv-2d'), card('3', 'diamonds', 'jv-3d'), joker('jv-2', 2)]),
    combo('joker-a23-spades', 'tierce', [card('A', 'spades', 'jv-as'), card('3', 'spades', 'jv-3s'), joker('jv-3', 3)]),
    combo('joker-3-5-hearts', 'tierce', [card('3', 'hearts', 'jv-3h'), card('5', 'hearts', 'jv-5h'), joker('jv-4', 4)]),
  ];
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 5 };
  const result = validateFirstPose(combos, 71, config);
  assert(result.vierge === 27, `Only the fully natural 8-9-10 tierce contributes: expected 27, got ${result.vierge}`);
  assert(result.total > result.vierge, 'Joker representations affect total value but not VIERGE');
  assert(!result.valid, 'A Joker-heavy pose below 71 must be rejected');

  const discardCard = card('6', 'diamonds', 'joker-vierge-discard');
  const reserve = card('8', 'diamonds', 'joker-vierge-reserve');
  let state = playingState({ playerCount: 5 }, [handsWithCombos(combos, discardCard, reserve)]);
  state = layCombos(state, combos);
  assert(state.tableCombinations.length === 0, 'Joker opening draft remains uncommitted');
  const refused = discard(state, discardCard.id);
  assert(refused.tableCombinations.length === 0 && refused.players[0].status === 'not_opened', 'Sub-threshold Joker pose is refused');
});

test('VIERGE is zero for every Joker-containing combination while total stays represented', () => {
  const cases: Array<{ label: string; meld: Combination; vierge: number; total: number }> = [
    { label: '10-10-10 naturel', meld: combo('v-a', 'carre', [card('10', 'hearts', 'va-h'), card('10', 'diamonds', 'va-d'), card('10', 'spades', 'va-s')]), vierge: 30, total: 30 },
    { label: '10-10-Joker', meld: combo('v-b', 'carre', [card('10', 'hearts', 'vb-h'), card('10', 'diamonds', 'vb-d'), joker('vb-j')]), vierge: 0, total: 30 },
    { label: '7-8-9 naturel', meld: combo('v-c', 'tierce', [card('7', 'hearts', 'vc-7'), card('8', 'hearts', 'vc-8'), card('9', 'hearts', 'vc-9')]), vierge: 24, total: 24 },
    { label: '7-8-Joker', meld: combo('v-d', 'tierce', [card('7', 'hearts', 'vd-7'), card('8', 'hearts', 'vd-8'), joker('vd-j')]), vierge: 0, total: 21 },
    { label: 'K-K-Joker', meld: combo('v-e', 'carre', [card('K', 'hearts', 've-h'), card('K', 'diamonds', 've-d'), joker('ve-j')]), vierge: 0, total: 30 },
    { label: 'A-K-Q naturel', meld: combo('v-f', 'tierce', [card('A', 'spades', 'vf-a'), card('K', 'spades', 'vf-k'), card('Q', 'spades', 'vf-q')]), vierge: 31, total: 31 },
    { label: 'A-K-Joker', meld: combo('v-g', 'tierce', [card('A', 'spades', 'vg-a'), card('K', 'spades', 'vg-k'), joker('vg-j')]), vierge: 0, total: 31 },
  ];
  for (const item of cases) {
    const value = calculateCombinationValue(item.meld);
    assert(value.vierge === item.vierge, `${item.label}: VIERGE=${item.vierge}`);
    assert(value.total === item.total, `${item.label}: total=${item.total}`);
  }
});

test('A 71-point VIERGE is accepted at threshold 71', () => {
  const combos = opening71();
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 5 };
  const validation = validateFirstPose(combos, 71, config);
  assert(validation.valid && validation.vierge === 71, '71-point natural pose should be valid');
  assert(validateFirstPose(combos, 71, config).requiredThreshold === 71, 'The required threshold is the VIERGE (71)');
  const stricterVierge = validateFirstPose(combos, 75, config);
  assert(!stricterVierge.valid && stricterVierge.requiredThreshold === 75, 'A 71-point pose cannot open when the VIERGE threshold is 75');

  const discardCard = card('6', 'diamonds', '71-discard');
  const reserve = card('8', 'diamonds', '71-reserve');
  let state = playingState({ playerCount: 5 }, [handsWithCombos(combos, discardCard, reserve)]);
  state = layCombos(state, combos);
  const opened = discard(state, discardCard.id);
  assert(opened.players[0].status === 'opened', 'The player should become opened');
  assert(opened.players[0].openingValue === 71, 'Opening value should be exactly 71');
  assert(opened.suite === 72 && opened.suiteLocked, 'The first opening fixes SUITE to 72');
});

test('Four-player threshold refuses 90 and accepts 91', () => {
  const low = [
    combo('90-10jq', 'tierce', [card('10', 'hearts', '90-10h'), card('J', 'hearts', '90-jh'), card('Q', 'hearts', '90-qh')]),
    combo('90-789', 'tierce', [card('7', 'diamonds', '90-7d'), card('8', 'diamonds', '90-8d'), card('9', 'diamonds', '90-9d')]),
    combo('90-567-c', 'tierce', [card('5', 'clubs', '90-5c'), card('6', 'clubs', '90-6c'), card('7', 'clubs', '90-7c')]),
    combo('90-567-s', 'tierce', [card('5', 'spades', '90-5s'), card('6', 'spades', '90-6s'), card('7', 'spades', '90-7s')]),
  ];
  const high = opening91();
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 4 };
  assert(validateFirstPose(low, 91, config).vierge === 90, 'Four-player low pose is 90');
  assert(!validateFirstPose(low, 91, config).valid, '90 is refused for four players');
  assert(validateFirstPose(high, 91, config).vierge === 91, 'Four-player high pose is 91');
  assert(validateFirstPose(high, 91, config).valid, '91 is accepted for four players');
});

test('Tierce obligatoire refuses an opening made only of brelans/carrés', () => {
  const sets = [
    combo('q-set', 'carre', [card('Q', 'hearts', 'q-h'), card('Q', 'diamonds', 'q-d'), card('Q', 'spades', 'q-s')]),
    combo('k-set', 'carre', [card('K', 'hearts', 'k-h'), card('K', 'diamonds', 'k-d'), card('K', 'spades', 'k-s')]),
    combo('a-set', 'carre', [card('A', 'hearts', 'a-h'), card('A', 'diamonds', 'a-d'), card('A', 'spades', 'a-s')]),
  ];
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 5, tierceObligatoire: true };
  const result = validateFirstPose(sets, 71, config);
  assert(result.vierge >= 71, 'Test pose is above the score threshold');
  assert(!result.valid && result.errors.some(error => error.includes('natural tierce')), 'No natural tierce must block the opening');
});

// Three fully natural openings (VIERGE === TOTAL): 75, 84 and 100 points.
function opening75(): Combination[] {
  return [
    combo('o75-10jq-spades', 'tierce', [
      card('10', 'spades', 'o75-10s'), card('J', 'spades', 'o75-js'), card('Q', 'spades', 'o75-qs'),
    ]),
    combo('o75-789-diamonds', 'tierce', [
      card('7', 'diamonds', 'o75-7d'), card('8', 'diamonds', 'o75-8d'), card('9', 'diamonds', 'o75-9d'),
    ]),
    combo('o75-678-clubs', 'tierce', [
      card('6', 'clubs', 'o75-6c'), card('7', 'clubs', 'o75-7c'), card('8', 'clubs', 'o75-8c'),
    ]),
  ]; // 30 + 24 + 21 = 75
}

function opening84(): Combination[] {
  return [
    combo('o84-10jq-spades', 'tierce', [
      card('10', 'spades', 'o84-10s'), card('J', 'spades', 'o84-js'), card('Q', 'spades', 'o84-qs'),
    ]),
    combo('o84-10jq-hearts', 'tierce', [
      card('10', 'hearts', 'o84-10h'), card('J', 'hearts', 'o84-jh'), card('Q', 'hearts', 'o84-qh'),
    ]),
    combo('o84-789-diamonds', 'tierce', [
      card('7', 'diamonds', 'o84-7d'), card('8', 'diamonds', 'o84-8d'), card('9', 'diamonds', 'o84-9d'),
    ]),
  ]; // 30 + 30 + 24 = 84
}

function opening100(): Combination[] {
  return [
    combo('o100-qka-hearts', 'tierce', [
      card('Q', 'hearts', 'o100-qh'), card('K', 'hearts', 'o100-kh'), card('A', 'hearts', 'o100-ah'),
    ]),
    combo('o100-10jq-spades', 'tierce', [
      card('10', 'spades', 'o100-10s'), card('J', 'spades', 'o100-js'), card('Q', 'spades', 'o100-qs'),
    ]),
    combo('o100-789-diamonds', 'tierce', [
      card('7', 'diamonds', 'o100-7d'), card('8', 'diamonds', 'o100-8d'), card('9', 'diamonds', 'o100-9d'),
    ]),
    combo('o100-456-clubs', 'tierce', [
      card('4', 'clubs', 'o100-4c'), card('5', 'clubs', 'o100-5c'), card('6', 'clubs', 'o100-6c'),
    ]),
  ]; // 31 + 30 + 24 + 15 = 100
}

test('SUITE evolves after every successful opening: 71 → 76 → 85 → 101', () => {
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 5 };
  const plan = [
    { combos: opening75(), vierge: 75, suite: 76, discard: card('2', 'spades', 'o75-discard'), reserve: card('3', 'spades', 'o75-reserve') },
    { combos: opening84(), vierge: 84, suite: 85, discard: card('2', 'hearts', 'o84-discard'), reserve: card('3', 'hearts', 'o84-reserve') },
    { combos: opening100(), vierge: 100, suite: 101, discard: card('2', 'clubs', 'o100-discard'), reserve: card('3', 'clubs', 'o100-reserve') },
  ];
  for (const opening of plan) {
    assert(validateFirstPose(opening.combos, 71, config).vierge === opening.vierge, `VIERGE ${opening.vierge}`);
    assert(validateFirstPose(opening.combos, 71, config).total === opening.vierge, `TOTAL ${opening.vierge}`);
  }

  const emptyHands = [[], [], [], []] as GameCard[][];
  let state = playingState({ playerCount: 5 }, [handsWithCombos(plan[0].combos, plan[0].discard, plan[0].reserve), ...emptyHands]);
  assert(state.suite === 71, 'SUITE starts at the 5-player threshold 71');

  state = layCombos(state, plan[0].combos);
  let opened = discard(state, plan[0].discard.id);
  assert(opened.players[0].openingValue === 75, 'Player 1 opened with 75');
  assert(opened.suite === 76, 'SUITE is now 76 (75 + 1)');

  for (const step of [1, 2]) {
    const playerIndex = opened.currentPlayerIndex;
    const opening = plan[step];
    const players = opened.players.map((player, index) => index === playerIndex
      ? { ...player, hand: handsWithCombos(opening.combos, opening.discard, opening.reserve) }
      : player);
    let turnState$: GameState = {
      ...opened,
      players,
      currentPlayerIndex: playerIndex,
      turnState: turnState(players[playerIndex].id),
    };
    turnState$ = layCombos(turnState$, opening.combos);
    const next = discard(turnState$, opening.discard.id);
    assert(next.players[playerIndex].status === 'opened', `Player ${step + 1} opened`);
    assert(next.players[playerIndex].openingValue === opening.vierge, `Player ${step + 1} opened with ${opening.vierge}`);
    assert(next.suite === opening.suite, `SUITE becomes ${opening.suite} after the opening at ${opening.vierge}`);
    opened = next;
  }

  assert(opened.suite === 101, 'The worked example 71 → 76 → 85 → 101 is reproduced exactly');
});

test('Before the first opening SUITE equals the threshold, and a refused opening never changes it', () => {
  for (const playerCount of [2, 3, 4, 5] as const) {
    const state = playingState({ playerCount }, [[]]);
    assert(state.suite === INITIAL_THRESHOLDS[playerCount], `${playerCount}p: SUITE starts at the threshold`);
    assert(!state.suiteLocked, `${playerCount}p: SUITE is not locked before any opening`);
  }

  const draft69 = opening69();
  const discardCard = card('2', 'spades', 'refused-keeps-suite');
  const reserve = card('3', 'spades', 'refused-keeps-suite-reserve');
  let state = playingState({ playerCount: 5 }, [handsWithCombos(draft69, discardCard, reserve)]);
  state = layCombos(state, draft69);
  const refused = discard(state, discardCard.id);
  assert(refused.suite === 71 && !refused.suiteLocked, 'A refused opening leaves SUITE at the threshold');
});

test('An opening below the VIERGE is refused without penalty, whatever the SUITE is', () => {
  const first = opening73();
  const firstDiscard = card('2', 'spades', 'evolve-first-discard');
  const firstReserve = card('6', 'spades', 'evolve-first-reserve');
  let state = playingState({ playerCount: 5 }, [handsWithCombos(first, firstDiscard, firstReserve), [], [], [], []]);
  state = layCombos(state, first);
  const afterFirst = discard(state, firstDiscard.id);
  const currentSuite = afterFirst.suite;
  assert(currentSuite === 74, 'The first opening at VIERGE 73 / total 73 sets SUITE to 74');

  // The next player stages only 69 natural points: below the VIERGE 71.
  const secondIndex = afterFirst.currentPlayerIndex;
  const weak = opening69();
  const weakDiscard = card('4', 'spades', 'evolve-weak-discard');
  const weakReserve = card('5', 'spades', 'evolve-weak-reserve');
  const players = afterFirst.players.map((player, index) => index === secondIndex
    ? { ...player, hand: handsWithCombos(weak, weakDiscard, weakReserve) }
    : player);
  let secondState: GameState = {
    ...afterFirst,
    players,
    currentPlayerIndex: secondIndex,
    turnState: turnState(players[secondIndex].id),
  };
  secondState = layCombos(secondState, weak);
  const refused = discard(secondState, weakDiscard.id);
  assert(refused.players[secondIndex].status === 'not_opened', 'Opening below the SUITE is refused');
  assert(refused.suite === currentSuite, 'A refused opening never changes SUITE');
  assert(refused.initialThreshold === 71, 'The VIERGE threshold stays 71');
  assert(refused.faults.length === afterFirst.faults.length, 'Refusal adds no penalty');
  assert(refused.tableCombinations.length === afterFirst.tableCombinations.length, 'Nothing reaches the shared table');
});

test('VIERGE remains the natural threshold; SUITE checks total separately', () => {
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 5 };
  const opening85 = [
    combo('85-qka', 'tierce', [card('Q', 'hearts', '85-qh'), card('K', 'hearts', '85-kh'), card('A', 'hearts', '85-ah')]),
    combo('85-10jq', 'tierce', [card('10', 'spades', '85-10s'), card('J', 'spades', '85-js'), card('Q', 'spades', '85-qs')]),
    combo('85-789', 'tierce', [card('7', 'diamonds', '85-7d'), card('8', 'diamonds', '85-8d'), card('9', 'diamonds', '85-9d')]),
  ];
  assert(validateFirstPose(opening85, 71, config).vierge === 85, 'Constructed natural pose is exactly 85');
  assert(validateFirstPose(opening85, 71, config).valid, '85 natural points open at VIERGE 71');
  assert(validateFirstPose(opening73(), 71, config).valid, '73 natural points and total 73 open when both thresholds are 71');
  assert(validateFirstPose(opening69(), 71, config).valid === false, '69 natural points are below VIERGE 71');

  // With the initial SUITE equal to VIERGE, the fully natural pose meets both.
  for (const viergeThreshold of [71]) {
    const validation = validateFirstPose(opening73(), viergeThreshold, config);
    assert(validation.valid, `73 ≥ VIERGE ${viergeThreshold} → opening valid`);
    assert(validation.requiredThreshold === viergeThreshold, 'The required threshold is the VIERGE');
  }
  assert(validateFirstPose(opening73(), 91, config).valid === false, '73 < VIERGE 91 → refused');
  assert(validateFirstPose(opening73(), 101, config).valid === false, '73 < VIERGE 101 → refused');
  assert(validateFirstPose(opening73(), 111, config).valid === false, '73 < VIERGE 111 → refused');
});

test('CHOP obligatoire keeps both PIOCHER and CHOP available but blocks first opening after PIOCHER', () => {
  const chopped = card('7', 'hearts', 'mandatory-chop-top');
  const draw = card('2', 'clubs', 'mandatory-draw');
  const state: GameState = {
    ...playingState({ playerCount: 2, chopObligatoire: true }, [[card('3', 'spades', 'm0')], []]),
    deck: [draw],
    discardPile: [chopped],
    turnState: turnState('player-0', 'must_draw'),
  };
  assert(!isChopRequired(state), 'CHOP obligatoire is not a forced-draw lock');
  assert(getAvailableActions(state).canDraw && getAvailableActions(state).canChop, 'The player can choose PIOCHER or CHOP');
  const drawn = drawCard(state);
  assert(drawn.players[0].hand.some(item => item.id === draw.id), 'Engine accepts a normal draw');
  assert(chopCard(state).players[0].hand.some(item => item.id === chopped.id), 'CHOP remains available');
  const wrongTurn = { ...state, turnState: turnState('player-1', 'must_draw') };
  assert(drawCard(wrongTurn) === wrongTurn && chopCard(wrongTurn) === wrongTurn, 'A mismatched turn owner cannot draw or CHOP');
});

test('CHOP-only-opening blocks an unopened chop discard and permits undo without penalty', () => {
  const choppedCard = card('4', 'spades', 'only-open-chopped');
  const inHand = card('2', 'hearts', 'only-open-hand');
  const drawFromDeck = card('3', 'diamonds', 'only-open-draw');
  const base = playingState({ playerCount: 2, chopSeulementOuverture: true }, [[inHand], []]);
  const state: GameState = {
    ...base,
    discardPile: [choppedCard],
    deck: [drawFromDeck],
    turnState: turnState('player-0', 'must_draw'),
  };
  const chopped = chopCard(state);
  const refusedDiscard = discard(chopped, inHand.id);
  assert(refusedDiscard === chopped, 'A non-opened player cannot discard after CHOP without opening');
  assert(refusedDiscard.faults.length === chopped.faults.length, 'Rejected discard creates no additional penalty');
  const cancelled = rejectChop(chopped);
  assert(cancelled.turnState?.phase === 'must_draw', 'Player can cancel the CHOP');
  const drawn = drawCard(cancelled);
  assert(drawn.players[0].hand.some(item => item.id === drawFromDeck.id), 'The player can draw from the deck after cancellation');
});

test('Previous-turn accusation is available before draw and remains bound to the exact discard after draw', () => {
  const q = card('Q', 'spades', 'accuse-q');
  const k = card('K', 'spades', 'accuse-k');
  const a = card('A', 'spades', 'accuse-a');
  const jackDiscarded = { ...card('J', 'spades', 'accuse-j-pack-2'), pack: 2 as const };
  const other = card('2', 'clubs', 'accuse-other');
  const newDraw = card('5', 'diamonds', 'accuser-draw');
  const previousBase = playingState({ playerCount: 2 }, [[], [jackDiscarded, other]]);
  const previousTurn: GameState = {
    ...previousBase,
    currentPlayerIndex: 1,
    tableCombinations: [combo('accuse-qka', 'tierce', [q, k, a], 'player-1')],
    players: previousBase.players.map(player => player.id === 'player-1' ? { ...player, status: 'opened' as const } : player),
    deck: [newDraw],
    turnState: turnState('player-1'),
  };
  const completed = discard(previousTurn, jackDiscarded.id);
  const snapshot = completed.lastCompletedTurnAction;
  assert(snapshot?.discardedCardId === jackDiscarded.id && snapshot.wasDiscardPlayable, 'The exact playable J♠ discard is snapshotted');
  assert(completed.faults.length === previousTurn.faults.length, 'A playable discard is not auto-penalized before anyone signals it');
  assert(completed.currentPlayerIndex === 0 && completed.turnState?.phase === 'must_draw', 'The accusation window opens at the next turn start');
  assert(getAvailableActions(completed).canReportFault, 'Signal is available before PIOCHER');

  const afterDraw = drawCard(completed);
  assert(getAvailableActions(afterDraw).canReportFault, 'PIOCHER does not close the previous-turn accusation window');
  assert(afterDraw.lastCompletedTurnAction?.discardedCardId === jackDiscarded.id, 'The snapshot remains unchanged after the draw');
  const report = reportFault(afterDraw, 'player-0', 'player-1', 'playable_discard');
  assert(report.valid && report.state.phase === 'round_end', 'A genuinely playable previous discard is recognized');
  assert(report.state.roundResults.at(-1)?.scores['player-1'] === 110, 'The valid accusation applies one configured fault penalty, not a duplicate');
});

test('A non-playable previous discard is a false accusation and cannot be reported twice', () => {
  const seven = card('7', 'hearts', 'false-accuse-7');
  const eight = card('8', 'hearts', 'false-accuse-8');
  const nine = card('9', 'hearts', 'false-accuse-9');
  const badDiscard = card('2', 'clubs', 'false-accuse-discard');
  const reserve = card('3', 'diamonds', 'false-accuse-reserve');
  const freshDraw = card('5', 'diamonds', 'false-accuser-draw');
  const base = playingState({ playerCount: 2 }, [[], [badDiscard, reserve]]);
  const previousTurn: GameState = {
    ...base,
    currentPlayerIndex: 1,
    deck: [freshDraw],
    tableCombinations: [combo('false-accuse-run', 'tierce', [seven, eight, nine], 'player-1')],
    players: base.players.map(player => player.id === 'player-1' ? { ...player, status: 'opened' as const } : player),
    turnState: turnState('player-1'),
  };
  const completed = discard(previousTurn, badDiscard.id);
  assert(completed.lastCompletedTurnAction?.wasDiscardPlayable === false, 'The snapshot records that the discard was not playable');
  const afterDraw = drawCard(completed);
  assert(afterDraw.lastCompletedTurnAction?.discardedCardId === badDiscard.id, 'The actual discard remains the evidence after piocher');
  const falseReport = reportFault(afterDraw, 'player-0', 'player-1', 'playable_discard');
  assert(!falseReport.valid && falseReport.state.phase === 'playing', 'The non-playable card is a false accusation');
  const faultsAfterFirst = falseReport.state.faults.length;
  assert(!getAvailableActions(falseReport.state).canReportFault, 'The same completed action can only be reported once');
  const repeated = reportFault(falseReport.state, 'player-0', 'player-1', 'playable_discard');
  assert(repeated.state === falseReport.state && repeated.state.faults.length === faultsAfterFirst, 'A repeated report adds no second penalty');
});

test('CHOP card obligation blocks discard until that exact card is in a valid combination', () => {
  const top = card('5', 'diamonds', 'mandatory-card-top');
  const q = card('Q', 'hearts', 'mandatory-q');
  const k = card('K', 'hearts', 'mandatory-k');
  const a = card('A', 'hearts', 'mandatory-a');
  const discardCard = card('2', 'clubs', 'mandatory-discard');
  const reserve = card('3', 'clubs', 'mandatory-reserve');
  const mandatoryBase = playingState({ playerCount: 2, chopCarteObligatoireAJouer: true }, [[q, k, a, discardCard, reserve], []]);
  const state: GameState = {
    ...mandatoryBase,
    players: mandatoryBase.players.map(player => player.id === 'player-0'
      ? { ...player, status: 'opened' as const }
      : player),
    discardPile: [top],
    turnState: turnState('player-0', 'must_draw'),
  };
  const chopped = chopCard(state);
  assert(chopped.turnState?.mandatoryChopCardId === top.id, 'The identity of the chopped card is recorded');
  const afterUnrelatedPlace = placeCombination(chopped, [q.id, k.id, a.id], 'tierce');
  assert(afterUnrelatedPlace !== chopped, 'An unrelated valid combination is placed');
  assert(discard(afterUnrelatedPlace, discardCard.id) === afterUnrelatedPlace, 'Discard is refused while the chopped card is unused');
  assert(afterUnrelatedPlace.faults.length === chopped.faults.length, 'Refusal adds no fault/penalty');

  const playableTop = card('7', 'hearts', 'mandatory-play-top');
  const six = card('6', 'hearts', 'mandatory-play-6');
  const eight = card('8', 'hearts', 'mandatory-play-8');
  const discardAfterUse = card('2', 'diamonds', 'mandatory-play-discard');
  const reserveAfterUse = card('3', 'diamonds', 'mandatory-play-reserve');
  const playableBase = playingState({ playerCount: 2, chopCarteObligatoireAJouer: true }, [[six, eight, discardAfterUse, reserveAfterUse], []]);
  let playableState: GameState = {
    ...playableBase,
    players: playableBase.players.map(player => player.id === 'player-0'
      ? { ...player, status: 'opened' as const }
      : player),
    discardPile: [playableTop],
    tableCombinations: [],
    turnState: turnState('player-0', 'must_draw'),
  };
  playableState = chopCard(playableState);
  const used = placeCombination(playableState, [playableTop.id, six.id, eight.id], 'tierce');
  assert(used !== playableState, 'The chopped card is laid in a valid combination');
  const ended = discard(used, discardAfterUse.id);
  assert(ended.currentPlayerIndex !== used.currentPlayerIndex, 'The turn can end after the mandatory card is used');
  assert(ended.turnState?.mandatoryChopCardId === undefined, 'The next turn has no stale CHOP obligation');
});

test('Undoing CHOP restores card, malus and prior round marker; then normal draw is allowed', () => {
  const top = card('9', 'clubs', 'undo-chop-top');
  const startingHand = [card('2', 'hearts', 'undo-hand-2'), card('3', 'spades', 'undo-hand-3')];
  const deckCard = card('4', 'diamonds', 'undo-draw-card');
  let state = playingState({ playerCount: 2, chopObligatoire: true }, [startingHand, []]);
  state = {
    ...state,
    deck: [deckCard],
    discardPile: [top],
    players: state.players.map((player, i) => i === 0 ? { ...player, hasChoppedThisRound: true } : player),
    turnState: turnState('player-0', 'must_draw'),
  };
  const chopped = chopCard(state);
  assert(chopped.faults.length === 1, 'CHOP malus was applied provisionally');
  const undone = rejectChop(chopped);
  assert(undone !== chopped, 'Untouched CHOP can be cancelled');
  assert(undone.players[0].hand.length === startingHand.length, 'Hand count returns to its initial value');
  assert(undone.discardPile.at(-1)?.id === top.id, 'The same physical card returns to the discard pile');
  assert(undone.players[0].hasChoppedThisRound, 'Previous hasChoppedThisRound value is restored');
  assert(undone.faults.length === state.faults.length, 'The provisional malus is removed on undo');
  assert(undone.turnState?.chopRejectedThisTurn, 'The player cannot repeat CHOP indefinitely this turn');
  const drawn = drawCard(undone);
  assert(drawn.players[0].hand.length === startingHand.length + 1, 'Normal draw is allowed after cancellation');
});

test('A CHOP cannot be undone after its card has been committed to the table', () => {
  const top = card('7', 'hearts', 'committed-chop-top');
  const six = card('6', 'hearts', 'committed-six');
  const eight = card('8', 'hearts', 'committed-eight');
  const rest = [card('2', 'clubs', 'committed-rest-2'), card('3', 'clubs', 'committed-rest-3')];
  let state = playingState({ playerCount: 2 }, [[six, eight, ...rest], []]);
  state = {
    ...state,
    players: state.players.map(player => player.id === 'player-0' ? { ...player, status: 'opened' as const } : player),
    discardPile: [top],
    turnState: turnState('player-0', 'must_draw'),
  };
  const chopped = chopCard(state);
  const committed = placeCombination(chopped, [top.id, six.id, eight.id], 'tierce');
  assert(committed !== chopped, 'Chopped card is committed to the table');
  assert(rejectChop(committed) === committed, 'Undo is refused after a table action');
});

test('A-K-Joker validates as Q-K-A, with Joker value from its represented rank', () => {
  const ace = card('A', 'spades', 'akj-ace');
  const king = card('K', 'spades', 'akj-king');
  const wild = joker('akj-joker');
  const sequence = combo('akj-combo', 'tierce', [ace, king, wild]);
  const validation = validateCombination(sequence);
  assert(validation.valid, `A-K-Joker should be valid: ${validation.error ?? ''}`);
  const positions = determineTierceSequence(sequence);
  assert(positions?.find(position => position.isJoker)?.position === 12, 'Joker represents Q (sequence position 12)');
  const representation = determineJokerRepresentation(sequence);
  assert(representation?.rank === 'Q' && representation.suit === 'spades', 'Joker representation is Q♠');
  const value = calculateCombinationValue(sequence);
  assert(value.total === 31, `Q-K-A totals 31, not a fixed Joker 20 (got ${value.total})`);
  assert(value.vierge === 0, `A combination containing a Joker contributes 0 to VIERGE (got ${value.vierge})`);
});

test('An already-open player can add a legal card without re-running first-opening threshold checks', () => {
  const seven = card('7', 'hearts', 'already-open-7');
  const eight = card('8', 'hearts', 'already-open-8');
  const nine = card('9', 'hearts', 'already-open-9');
  const ten = card('10', 'hearts', 'already-open-10');
  const discardCard = card('2', 'clubs', 'already-open-discard');
  const reserve = card('3', 'clubs', 'already-open-reserve');
  const base = playingState({ playerCount: 5 }, [[ten, discardCard, reserve], []]);
  const state: GameState = {
    ...base,
    players: base.players.map(player => player.id === 'player-0'
      ? { ...player, status: 'opened' as const, openingValue: 84, openingThreshold: 71 }
      : player),
    tableCombinations: [combo('already-open-run', 'tierce', [seven, eight, nine], 'player-0')],
    suite: 85,
    suiteLocked: true,
  };
  const extended = addToCombination(state, ten.id, 'already-open-run');
  assert(extended !== state && extended.tableCombinations[0].cards.some(item => item.id === ten.id), 'A legal table addition succeeds');
  const ended = discard(extended, discardCard.id);
  assert(ended.currentPlayerIndex !== extended.currentPlayerIndex, 'The opened player can finish without another first-pose check');
  assert(ended.players[0].openingValue === 84 && ended.suite === 85, 'The existing opening and locked SUITE remain unchanged');
});

test('Opened opponents and owners can recover Jokers; unopened opponents cannot', () => {
  const wild = joker('owner-joker');
  const seven = card('7', 'hearts', 'owner-7');
  const nine = card('9', 'hearts', 'owner-9');
  const replacement = card('8', 'hearts', 'owner-8');
  const wild2 = joker('owner-joker-2', 2);
  const ten = card('10', 'hearts', 'owner-10');
  const queen = card('Q', 'hearts', 'owner-q');
  const replacement2 = card('J', 'hearts', 'owner-j');
  const ace = card('A', 'spades', 'owner-a');
  const king = card('K', 'spades', 'owner-k');
  const four = card('4', 'diamonds', 'owner-4');
  const six = card('6', 'diamonds', 'owner-6');
  const discardCard = card('2', 'clubs', 'owner-discard');
  const reserve = card('3', 'diamonds', 'owner-reserve');
  const tableCombo = combo('owner-tierce', 'tierce', [seven, nine, wild], 'player-1');
  const tableCombo2 = combo('owner-tierce-2', 'tierce', [ten, queen, wild2], 'player-1');

  let adversaryState = playingState({ playerCount: 2 }, [[replacement, discardCard, reserve], []]);
  adversaryState = {
    ...adversaryState,
    players: adversaryState.players.map(player => ({ ...player, status: 'opened' as const })),
    tableCombinations: [tableCombo],
  };
  const allowed = recoverJoker(adversaryState, tableCombo.id, replacement.id);
  assert(allowed !== adversaryState && allowed.players[0].hand.some(c=>c.id===wild.id), 'An opened adversary can recover the exact Joker');
  const unopened = {...adversaryState,players:adversaryState.players.map((p,i)=>i===0?{...p,status:'not_opened' as const}:p)};
  assert(recoverJoker(unopened,tableCombo.id,replacement.id)===unopened,'An unopened opponent cannot recover');

  const ownCombo = { ...tableCombo, ownerId: 'player-0' };
  const ownCombo2 = { ...tableCombo2, ownerId: 'player-0' };
  let ownerState = playingState({ playerCount: 2 }, [[replacement, replacement2, ace, king, four, six, discardCard, reserve], []]);
  ownerState = {
    ...ownerState,
    players: ownerState.players.map(player => player.id === 'player-0' ? { ...player, status: 'opened' as const } : player),
    tableCombinations: [ownCombo, ownCombo2],
  };
  const recoveredOnce = recoverJoker(ownerState, ownCombo.id, replacement.id);
  assert(recoveredOnce !== ownerState, 'Owner recovery is accepted');
  assert(recoveredOnce.players[0].hand.some(item => item.id === wild.id), 'First recovered Joker is immediately in hand');
  assert(validateCombination(recoveredOnce.tableCombinations[0]).valid, 'Replacement keeps the first table sequence valid');
  const recovered = recoverJoker(recoveredOnce, ownCombo2.id, replacement2.id);
  assert(recovered !== recoveredOnce, 'A second Joker can be recovered during the same turn');
  assert(recovered.turnState?.recoveredJokers.length === 2, 'Engine tracks multiple recovered Joker IDs');

  const reused = placeCombination(recovered, [ace.id, king.id, wild.id], 'tierce');
  assert(reused !== recovered, 'First recovered Joker can be reused as Q-K-A');
  const reusedTwice = placeCombination(reused, [four.id, six.id, wild2.id], 'tierce');
  assert(reusedTwice !== reused, 'Second recovered Joker can be reused in a separate tierce');
  assert(reusedTwice.turnState?.reusedJokers.length === 2, 'Engine records both Joker reuses');
  const finished = discard(reusedTwice, discardCard.id);
  assert(finished.currentPlayerIndex !== reusedTwice.currentPlayerIndex, 'Turn ends after both recovered Jokers are reused');
});

test('Carré non récupéré penalty follows the configured detenteur/completeur rule', () => {
  const wild = joker('carre-joker');
  const heart = card('7', 'hearts', 'carre-7h');
  const diamond = card('7', 'diamonds', 'carre-7d');
  const spade = card('7', 'spades', 'carre-7s');
  const extra = card('2', 'clubs', 'carre-extra');
  const partial = combo('carre-owned-by-p0', 'carre', [heart, diamond, wild], 'player-0');
  const reserve = card('3', 'spades', 'carre-reserve');
  const base = playingState({ playerCount: 2, carreResponsable: 'completeur', carreNotRecoveredPenalty: 150 }, [[], [spade, extra, reserve]]);
  const state: GameState = {
    ...base,
    players: base.players.map(player => ({ ...player, status: 'opened' as const })),
    currentPlayerIndex: 1,
    turnState: turnState('player-1'),
    tableCombinations: [partial],
  };
  const completed = addToCombination(state, spade.id, partial.id);
  const completedCombo = completed.tableCombinations[0];
  assert(completedCombo.cards.length === 4 && completedCombo.completedById === 'player-1', 'The completing player is recorded');
  const completerTurnEnd = discard(completed, extra.id);
  assert(completerTurnEnd.currentPlayerIndex === 0, 'The next player receives the completer action snapshot');
  const result = reportFault(completerTurnEnd, 'player-0', 'player-1', 'carre_not_recovered');
  assert(result.valid && result.state.phase === 'round_end', 'With completeur mode, the completer is responsible');
  assert(result.state.roundResults.at(-1)?.scores['player-1'] === 160, 'The configured 150-point penalty is itemized on top of one remaining card');

  const detenteurBase = playingState({ playerCount: 2, carreResponsable: 'detenteur' }, [[], [spade, extra, reserve]]);
  const detenteurState: GameState = {
    ...detenteurBase,
    players: detenteurBase.players.map(player => ({ ...player, status: 'opened' as const })),
    currentPlayerIndex: 1,
    turnState: turnState('player-1'),
    tableCombinations: [partial],
  };
  const detenteurCompleted = addToCombination(detenteurState, spade.id, partial.id);
  const detenteurTurnEnd = discard(detenteurCompleted, extra.id);
  const accusation = reportFault(detenteurTurnEnd, 'player-0', 'player-1', 'carre_not_recovered');
  assert(!accusation.valid && accusation.state.phase === 'playing', 'With detenteur mode, the completer is not wrongly accused');
});

test('AI cannot commit QQQ + 987 + Joker melds when natural VIERGE is below 71', () => {
  const playerCount = 5 as const;
  const candidateCombos = aiJokerHeavyUnder71();
  const naturalVierge = candidateCombos.reduce((sum, item) => sum + calculateCombinationValue(item).vierge, 0);
  assert(naturalVierge === 54 && naturalVierge < 71, 'Only QQQ and 9-8-7 count: natural VIERGE 54, Joker melds excluded');
  const discardCard = card('10', 'spades', 'ai-repro-discard');
  const reserve = card('K', 'clubs', 'ai-repro-reserve');
  const candidateHand = handsWithCombos(candidateCombos, discardCard, reserve);
  const state = playingState({ playerCount }, [[], candidateHand, [], [], []]);
  const aiState: GameState = {
    ...state,
    currentPlayerIndex: 1,
    turnState: turnState('player-1', 'playing', { isInitialDealTurn: true }),
  };
  const openingViergeBefore = validateFirstPose(candidateCombos, 71, aiState.config);
  assert(!openingViergeBefore.valid, 'The engine opening validator rejects the AI candidate');
  const afterAI = executeAITurn(aiState);
  assert(afterAI.players[1].status === 'not_opened', 'AI remains unopened after a sub-threshold candidate');
  assert(afterAI.tableCombinations.length === 0, 'No part of the rejected AI opening reaches the table');
  assert(afterAI.suite === 71 && afterAI.players[1].score === aiState.players[1].score, 'Rejected AI opening changes neither SUITE nor score');
  assert(afterAI.faults.length === aiState.faults.length, 'Rejected AI opening creates no penalty');
  assert(candidateCombos.flatMap(item => item.cards).every(c =>
    afterAI.players[1].hand.some(handCard => handCard.id === c.id) || afterAI.discardPile.some(discarded => discarded.id === c.id)
  ), 'Candidate cards remain in hand/discard rather than being consumed by a meld');

  const natural27WithJokers = [
    combo('ai-27-natural', 'tierce', [card('8', 'hearts', 'ai27-8h'), card('9', 'hearts', 'ai27-9h'), card('10', 'hearts', 'ai27-10h')]),
    combo('ai27-j1', 'tierce', [card('2', 'clubs', 'ai27-2c'), card('4', 'clubs', 'ai27-4c'), joker('ai27-j1')]),
    combo('ai27-j2', 'tierce', [card('5', 'diamonds', 'ai27-5d'), card('7', 'diamonds', 'ai27-7d'), joker('ai27-j2', 2)]),
  ];
  const natural27Value = natural27WithJokers.reduce((sum, item) => sum + calculateCombinationValue(item).vierge, 0);
  assert(natural27Value === 27 && natural27Value < 71, 'Only the natural 8-9-10 tierce contributes; Joker melds contribute 0');
  const ai27Hand = handsWithCombos(natural27WithJokers, card('3', 'spades', 'ai27-discard'), card('Q', 'clubs', 'ai27-reserve'));
  const ai27Base = playingState({ playerCount }, [[], ai27Hand, [], [], []]);
  const ai27State: GameState = {
    ...ai27Base,
    currentPlayerIndex: 1,
    turnState: turnState('player-1', 'playing', { isInitialDealTurn: true }),
  };
  const afterAI27 = executeAITurn(ai27State);
  assert(afterAI27.players[1].status === 'not_opened' && afterAI27.tableCombinations.length === 0, 'AI refuses the 27-point natural opening despite multiple Jokers');
  assert(afterAI27.suite === ai27State.suite && afterAI27.players[1].score === ai27State.players[1].score, 'Rejected 27-point AI pose changes neither SUITE nor score');

  const mandatoryConfig: Partial<GameConfig> = { playerCount: 2, chopObligatoire: true };
  const aiTop = card('5', 'diamonds', 'ai-mandatory-top');
  let chopState = playingState(mandatoryConfig, [[], [card('2', 'clubs', 'ai-mandatory-hand')]]);
  chopState = {
    ...chopState,
    currentPlayerIndex: 1,
    discardPile: [aiTop],
    deck: [card('4', 'hearts', 'ai-mandatory-deck')],
    turnState: turnState('player-1', 'must_draw'),
  };
  const aiAfterChop = executeAITurn(chopState);
  assert(aiAfterChop.currentPlayerIndex !== 1 || aiAfterChop.phase === 'round_end', 'AI must not get stuck under the optional CHOP rule');
  assert(aiAfterChop.actionHistory.some(action => action.type === 'chop' || action.type === 'draw'), 'AI chooses one legal draw source without a forced CHOP');
});

test('Engine refuses a directly submitted QQQ/987/Joker opening candidate from an AI', () => {
  const candidate = aiJokerHeavyUnder71();
  const discardCard = card('10', 'spades', 'direct-ai-discard');
  const reserve = card('K', 'clubs', 'direct-ai-reserve');
  const hand = handsWithCombos(candidate, discardCard, reserve);
  const base = playingState({ playerCount: 5 }, [[], hand, [], [], []]);
  let state: GameState = {
    ...base,
    currentPlayerIndex: 1,
    turnState: turnState('player-1', 'playing', { isInitialDealTurn: true }),
  };
  const initialScore = state.players[1].score;
  const initialSuite = state.suite;
  state = layCombos(state, candidate);
  assert(state.tableCombinations.length === 0, 'Unvalidated AI opening candidates are not committed to the public table');
  const rejected = discard(state, discardCard.id);
  assert(rejected.players[1].status === 'not_opened', 'Engine keeps the AI unopened');
  assert(rejected === state, 'AI rejection leaves the same draft');
  assert(rejected.players[1].hand.length + rejected.turnState!.temporaryCombinations.flatMap(c=>c.cards).length === hand.length, 'Every card conserved');
  assert(rejected.suite === initialSuite && rejected.players[1].score === initialScore, 'No SUITE or score mutation occurs');
  assert(rejected.faults.length === 0 && rejected.actionHistory === state.actionHistory, 'No penalty or extra history');
});

test('RS hides its final discard; RJ shows a final Joker and scores as RJ', () => {
  const normalFinal = card('4', 'hearts', 'rs-final');
  let rsState = playingState({ playerCount: 2 }, [[normalFinal], [card('2', 'spades', 'rs-opponent-1')]]);
  rsState = {
    ...rsState,
    players: rsState.players.map(player => ({ ...player, status: 'opened' as const })),
  };
  const rs = discard(rsState, normalFinal.id, false);
  assert(rs.phase === 'round_end' && rs.roundResults.at(-1)?.endType === 'RS', 'A normal final discard ends as RS');
  assert(rs.lastDiscardFaceDown, 'The RS final discard is represented face down');

  const finalJoker = joker('rj-final');
  let rjState = playingState({ playerCount: 2 }, [[finalJoker], [card('2', 'clubs', 'rj-opponent-1')]]);
  rjState = {
    ...rjState,
    players: rjState.players.map(player => ({ ...player, status: 'opened' as const })),
  };
  const rj = discard(rjState, finalJoker.id, false);
  assert(rj.roundResults.at(-1)?.endType === 'RJ', 'A visible final Joker ends as RJ');
  assert(!rj.lastDiscardFaceDown, 'The RJ Joker remains visible');
  assert((rj.roundResults.at(-1)?.scores['player-1'] ?? 0) === DEFAULT_CONFIG.rjScorePerCard, 'RJ applies RJ per-card scoring');
});

test('PIOCHER selects the exact drawn card and the single DÉFAUSSER action discards that copy', () => {
  const firstCopy = { ...card('7', 'spades', 'same-7s-pack-1'), pack: 1 as const };
  const drawnCopy = { ...card('7', 'spades', 'same-7s-pack-2'), pack: 2 as const };
  const reserve = card('2', 'clubs', 'same-copy-reserve');
  const base = playingState({ playerCount: 2 }, [[firstCopy, reserve], []]);
  const waiting: GameState = {
    ...base,
    deck: [drawnCopy],
    turnState: turnState('player-0', 'must_draw'),
  };
  const drawn = drawCard(waiting);
  assert(drawn.turnState?.phase === 'playing' && drawn.turnState.drawSource === 'deck', 'PIOCHER switches the turn to the play phase');
  assert(drawn.turnState.drawnCard?.id === drawnCopy.id, 'The exact card ID is recorded as drawn');
  const selectedId = getDrawnCardSelectionId(drawn);
  assert(selectedId === drawnCopy.id, 'UI selection resolves to the newly drawn physical card');
  const afterDiscard = discard(drawn, selectedId!);
  assert(afterDiscard.players[0].hand.some(card => card.id === firstCopy.id), 'The identical card from pack 1 remains in hand');
  assert(afterDiscard.discardPile.at(-1)?.id === drawnCopy.id, 'DÉFAUSSER discards the pack 2 copy by ID');
});

test('Local configuration persistence uses an injected storage port and restores options', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const config: GameConfig = {
    ...DEFAULT_CONFIG,
    playerCount: 3,
    aiDifficulty: 'hard',
    chopCarteObligatoireAJouer: true,
  };
  saveGameConfig(storage, config);
  assert(values.has(GAME_CONFIG_STORAGE_KEY), 'Settings are written through the storage adapter');
  const restored = loadGameConfig(storage);
  assert(restored.playerCount === 3 && restored.aiDifficulty === 'hard', 'Saved preferences are restored');
  assert(restored.chopCarteObligatoireAJouer, 'New rule toggles survive reload');
});

test('Scoring includes configured card values and an itemized source for every point', () => {
  const config: Partial<GameConfig> = {
    playerCount: 2,
    rsScorePerCard: 7,
    rsNonOpenedPenalty: 130,
  };
  const state = playingState(config, [[], [card('2', 'hearts', 'score-2'), card('3', 'clubs', 'score-3')]]);
  const result = calculateRoundScores(state, 'player-0', 'RS');
  assert(result.scores['player-1'] === 130, 'Non-opened penalty uses configured RS value');
  assert(result.scoreBreakdown?.['player-1']?.[0].label === 'Non ouvert (RS)', 'Score displays its source');

  const openedState: GameState = {
    ...state,
    players: state.players.map(player => player.id === 'player-1' ? { ...player, status: 'opened' as const } : player),
  };
  const openedResult = calculateRoundScores(openedState, 'player-0', 'RS');
  assert(openedResult.scores['player-1'] === 14, 'Two remaining cards at 7 points each gives +14');
  assert(openedResult.scoreBreakdown?.['player-1']?.[0].label.includes('2 cartes restantes'), 'Card remainder is explained');
});

// ============================================================
// FIN DE MANCHE — available cycles exhausted (never a 0-0 draw)
// ============================================================

function exhaustedCycleState(
  playerCount: 2 | 3 | 4 | 5,
  hands: GameCard[][],
  openedFlags: boolean[],
  overrides: Partial<GameState> = {},
): GameState {
  const base = playingState({ playerCount, maxCycles: 1 }, hands);
  return {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      status: openedFlags[index] ? 'opened' as const : 'not_opened' as const,
    })),
    deck: [],
    discardPile: [card('9', 'hearts', 'cycle-top-discard')],
    cycleCount: 0,
    turnState: turnState(base.players[0].id, 'must_draw'),
    ...overrides,
  };
}

test('Exhausted cycles count the remaining cards: 4 cartes = +40, 2 cartes = +20, non ouvert = +100', () => {
  const four = [card('2', 'clubs', 'cy-a'), card('3', 'clubs', 'cy-b'), card('4', 'clubs', 'cy-c'), card('5', 'clubs', 'cy-d')];
  const two = [card('6', 'clubs', 'cy-e'), card('7', 'clubs', 'cy-f')];
  const three = [card('8', 'clubs', 'cy-g'), card('9', 'clubs', 'cy-h'), card('10', 'clubs', 'cy-i')];
  const state = exhaustedCycleState(3, [four, two, three], [true, true, false]);
  const after = drawCard(state);
  assert(after.phase === 'round_end', 'The round ends when the available cycles are exhausted');
  const result = after.roundResults.at(-1)!;
  assert(result.endType === 'cycles', `Expected a counted round, got ${result.endType}`);
  assert(result.scores['player-0'] === 40, `Opened with 4 cards = +40 (got ${result.scores['player-0']})`);
  assert(result.scores['player-1'] === 20, `Opened with 2 cards = +20 (got ${result.scores['player-1']})`);
  assert(result.scores['player-2'] === 100, `Not opened = +100, not 10 per card (got ${result.scores['player-2']})`);
  assert(result.winnerId == null, 'Nobody went out, there is no winner');
  const allScores = Object.values(result.scores);
  assert(allScores.some(score => score > 0), 'It is never a 0-0 draw');
  assert(result.scoreBreakdown?.['player-0']?.some(item => item.label.includes('4 cartes')), 'The card count is itemized');
});

test('The end-of-cycles count adds the configured malus on top of the remaining cards', () => {
  const four = [card('2', 'clubs', 'mal-a'), card('3', 'clubs', 'mal-b'), card('4', 'clubs', 'mal-c'), card('5', 'clubs', 'mal-d')];
  const three = [card('8', 'clubs', 'mal-e'), card('9', 'clubs', 'mal-f'), card('10', 'clubs', 'mal-g')];
  const state = exhaustedCycleState(2, [four, three], [true, false], {
    faults: [
      { playerId: 'player-0', type: 'other_violation', penalty: 50, description: 'Malus ouvert' },
      { playerId: 'player-1', type: 'other_violation', penalty: 25, description: 'Malus non ouvert' },
    ],
  });
  const result = drawCard(state).roundResults.at(-1)!;
  assert(result.scores['player-0'] === 90, `Ouvert: 4 × 10 + 50 malus = 90 (got ${result.scores['player-0']})`);
  assert(result.scores['player-1'] === 125, `Non ouvert: 100 + 25 malus = 125 (got ${result.scores['player-1']})`);
  assert(result.scoreBreakdown?.['player-0']?.some(item => item.label === 'Malus ouvert'), 'The malus is itemized');
});

test('A genuine null round (nobody opened) is the only 0-0 case', () => {
  const state = exhaustedCycleState(3, [
    [card('2', 'clubs', 'nr-a')],
    [card('3', 'clubs', 'nr-b')],
    [card('4', 'clubs', 'nr-c')],
  ], [false, false, false]);
  const after = drawCard(state);
  const result = after.roundResults.at(-1)!;
  assert(result.endType === 'null_round', 'Nobody opened: genuine null round');
  assert(Object.values(result.scores).every(score => score === 0), 'Everybody stays at 0');
});

// ============================================================
// SIGNALEMENT — any player, any moment, no penalty when wrong
// ============================================================

test('Any player can be reported, at any moment, and a wrong report gives no penalty', () => {
  const tableRun = combo('rep-run', 'tierce', [
    card('7', 'hearts', 'rep-7h'), card('8', 'hearts', 'rep-8h'), card('9', 'hearts', 'rep-9h'),
  ], 'player-2');
  const badDiscard = card('2', 'clubs', 'rep-discard');
  const reserve = card('3', 'clubs', 'rep-reserve');
  const otherCard = card('4', 'diamonds', 'rep-other');
  const base = playingState({ playerCount: 4 }, [[otherCard], [otherCard], [badDiscard, reserve], [otherCard]]);
  const played: GameState = {
    ...base,
    currentPlayerIndex: 2,
    tableCombinations: [tableRun],
    players: base.players.map(player => player.id === 'player-2' ? { ...player, status: 'opened' as const } : player),
    turnState: turnState('player-2', 'playing'),
  };
  const completed = discard(played, badDiscard.id);
  assert(completed.lastCompletedTurnActionsByPlayer['player-2']?.discardedCardId === badDiscard.id, 'The evidence is stored per player');
  assert(completed.lastCompletedTurnActionsByPlayer['player-1'] === undefined, 'A player without a completed turn has no evidence');

  // 1. Reporting a player who has not completed any turn: refused, no penalty.
  const noEvidence = reportFault(completed, 'player-0', 'player-1', 'playable_discard');
  assert(!noEvidence.valid, 'No evidence = no confirmed fault');
  assert(noEvidence.state.faults.length === completed.faults.length, 'A report without evidence adds no penalty');

  // 2. Reporting is possible while another player is the active one.
  const duringSomeoneElseTurn = reportFault(completed, 'player-3', 'player-2', 'playable_discard');
  assert(duringSomeoneElseTurn.message !== 'Impossible de signaler maintenant', 'Reporting is not blocked by the active turn');

  // 3. Before drawing: the accuser sees every opponent as reportable.
  let accuserTurn: GameState = {
    ...completed,
    currentPlayerIndex: 0,
    turnState: turnState('player-0', 'must_draw'),
  };
  const beforeDraw = getAvailableActions(accuserTurn, 'player-0');
  assert(beforeDraw.reportablePlayerIds.length === 3, 'Every other player is reportable');
  assert(!beforeDraw.reportablePlayerIds.includes('player-0'), 'A player cannot report themselves');
  assert(beforeDraw.canReportFault, 'A completed turn is available for reporting');

  // 4. After drawing: the window is still open.
  accuserTurn = { ...accuserTurn, deck: [card('5', 'diamonds', 'rep-draw')] };
  const afterDraw = drawCard(accuserTurn);
  assert(getAvailableActions(afterDraw, 'player-0').canReportFault, 'Drawing does not close the reporting window');

  // 5. A wrong report: no fault, no score change, round continues.
  const wrong = reportFault(afterDraw, 'player-0', 'player-2', 'playable_discard');
  assert(!wrong.valid, 'The discard was not playable');
  assert(wrong.state.faults.length === afterDraw.faults.length, 'A wrong report creates NO fault');
  assert(wrong.state.players[0].score === afterDraw.players[0].score, 'A wrong report changes no score');
  assert(wrong.state.reports.length === 1, 'The report is simply recorded');
  assert(wrong.state.phase === 'playing', 'The round continues');

  // 6. The same completed action cannot be judged twice by the same accuser.
  const repeated = reportFault(wrong.state, 'player-0', 'player-2', 'playable_discard');
  assert(repeated.state === wrong.state, 'A repeated report is refused');
  assert(repeated.state.faults.length === afterDraw.faults.length, 'Still no penalty');
});

test('A confirmed fault penalises the accused and ends the round', () => {
  const tableRun = combo('conf-run', 'tierce', [
    card('7', 'hearts', 'conf-7h'), card('8', 'hearts', 'conf-8h'), card('9', 'hearts', 'conf-9h'),
  ], 'player-1');
  const playableDiscard = card('10', 'hearts', 'conf-10h'); // extends 7-8-9♥
  const reserve = card('2', 'clubs', 'conf-reserve');
  const base = playingState({ playerCount: 3 }, [[card('4', 'diamonds', 'conf-other')], [playableDiscard, reserve], []]);
  const played: GameState = {
    ...base,
    currentPlayerIndex: 1,
    tableCombinations: [tableRun],
    players: base.players.map(player => player.id === 'player-1' ? { ...player, status: 'opened' as const } : player),
    turnState: turnState('player-1', 'playing'),
  };
  const completed = discard(played, playableDiscard.id);
  assert(completed.lastCompletedTurnActionsByPlayer['player-1']?.wasDiscardPlayable, 'The discard is recorded as playable');
  const reported = reportFault(completed, 'player-0', 'player-1', 'playable_discard');
  assert(reported.valid, 'The fault is confirmed');
  assert(reported.state.phase === 'round_end', 'The round ends on a confirmed fault');
  assert(reported.state.faults.some(fault => fault.playerId === 'player-1'), 'Only the accused is penalised');
  assert(!reported.state.faults.some(fault => fault.playerId === 'player-0'), 'The accuser is never penalised');
});

// ============================================================
// JOKERS — explicit, stable position and representation
// ============================================================

test('A Joker keeps the exact slot it occupied while the combination was prepared', () => {
  const seven = card('7', 'hearts', 'jkp-7');
  const eight = card('8', 'hearts', 'jkp-8');
  const wild = joker('jkp-joker');
  const discardCard = card('2', 'clubs', 'jkp-discard');
  const base = playingState({ playerCount: 5 }, [[seven, eight, wild, discardCard]]);
  const placed = placeCombination(base, [seven.id, eight.id, wild.id], 'tierce');
  const laid = placed.turnState!.temporaryCombinations[0];
  assert(laid.cards.map(item => item.id).join(',') === [seven.id, eight.id, wild.id].join(','), 'The physical order is preserved');
  assert(laid.jokerPlacement?.position === 2, 'The Joker stays in third position');
  assert(laid.jokerPlacement?.represents.rank === '9' && laid.jokerPlacement?.represents.suit === 'hearts', 'The Joker represents 9♥');
  assert(determineJokerRepresentation(laid)?.rank === '9', 'It is never re-detected as 6');
  assert(determineTierceSequence(laid)?.find(position => position.isJoker)?.position === 9, 'The sequence keeps the Joker at 9');
  const value = calculateCombinationValue(laid);
  assert(value.total === 24 && value.vierge === 0, `7+8+9 = 24 total, 0 vierge (got ${value.total}/${value.vierge})`);
});

test('A Joker prepared in first position stays first (Joker-7-8 → 6)', () => {
  const seven = card('7', 'hearts', 'jkf-7');
  const eight = card('8', 'hearts', 'jkf-8');
  const wild = joker('jkf-joker');
  const discardCard = card('2', 'clubs', 'jkf-discard');
  const base = playingState({ playerCount: 5 }, [[wild, seven, eight, discardCard]]);
  const laid = placeCombination(base, [wild.id, seven.id, eight.id], 'tierce').turnState!.temporaryCombinations[0];
  assert(laid.jokerPlacement?.position === 0, 'The Joker stays first');
  assert(laid.jokerPlacement?.represents.rank === '6' && laid.jokerPlacement?.represents.suit === 'hearts', 'The Joker represents 6♥');
  const value = calculateCombinationValue(laid);
  assert(value.total === 21, `6+7+8 = 21 (got ${value.total})`);
});

test('8 + Joker + 6 keeps the Joker in the middle, representing 7', () => {
  const eight = card('8', 'hearts', 'jkm-8');
  const six = card('6', 'hearts', 'jkm-6');
  const wild = joker('jkm-joker');
  const discardCard = card('2', 'clubs', 'jkm-discard');
  const base = playingState({ playerCount: 5 }, [[eight, wild, six, discardCard]]);
  const laid = placeCombination(base, [eight.id, wild.id, six.id], 'tierce').turnState!.temporaryCombinations[0];
  assert(laid.cards[1].id === wild.id, 'The Joker stays in the middle slot');
  assert(laid.jokerPlacement?.position === 1, 'Position 1 is recorded');
  assert(laid.jokerPlacement?.represents.rank === '7', 'The Joker represents 7, never 5');
  assert(validateCombination(laid).valid, 'The descending arrangement is a valid tierce');
});

test('Replacing a Joker puts the real card in its exact slot and frees the Joker untouched', () => {
  const eight = card('8', 'hearts', 'jr-8');
  const six = card('6', 'hearts', 'jr-6');
  const realSeven = card('7', 'hearts', 'jr-7');
  const wild = joker('jr-joker');
  const five = card('5', 'clubs', 'jr-5c');
  const fiveClubs = card('6', 'clubs', 'jr-6c');
  const discardCard = card('2', 'clubs', 'jr-discard');

  const placement = resolveJokerPlacement([eight, wild, six], 'tierce')!;
  assert(placement.position === 1 && placement.represents.rank === '7', 'Prepared as 8 + Joker(7) + 6');
  const tableCombo: Combination = {
    ...combo('jr-combo', 'tierce', [eight, wild, six], 'player-0'),
    jokerPlacement: placement,
    jokerPosition: placement.position,
    jokerRepresents: placement.represents,
  };

  const base = playingState({ playerCount: 2 }, [[realSeven, five, fiveClubs, discardCard], []]);
  const state: GameState = {
    ...base,
    players: base.players.map(player => player.id === 'player-0' ? { ...player, status: 'opened' as const } : player),
    tableCombinations: [tableCombo],
  };
  const recovered = recoverJoker(state, 'jr-combo', realSeven.id);
  const afterCombo = recovered.tableCombinations[0];
  assert(afterCombo.cards.map(item => item.id).join(',') === [eight.id, realSeven.id, six.id].join(','), 'The real 7 takes the Joker slot');
  assert(afterCombo.jokerPlacement === undefined && afterCombo.jokerRepresents === undefined && afterCombo.jokerPosition === undefined,
    'No stale representation is left on the combination');
  assert(recovered.players[0].hand.some(item => item.id === wild.id), 'The Joker is back in hand');
  assert(!recovered.tableCombinations.some(item => item.cards.some(card => card.id === wild.id)), 'The Joker left the table');
  assert(validateCombination(afterCombo).valid, 'The combination stays valid');
  assert(recovered.turnState?.recoveredJokers.includes(wild.id), 'The recovery is tracked');

  // The freed Joker is NOT re-interpreted: reused in 5♣-6♣-Joker it becomes 7♣, not 5.
  const reused = placeCombination(recovered, [five.id, fiveClubs.id, wild.id], 'tierce');
  const newCombo = reused.tableCombinations[reused.tableCombinations.length - 1];
  assert(newCombo.jokerPlacement?.represents.rank === '7', `The freed Joker represents 7 again (got ${newCombo.jokerPlacement?.represents.rank})`);
  assert(newCombo.jokerPlacement?.position === 2, 'It sits where the player put it');
});

test('An extension that would move a positioned Joker is refused instead of re-interpreting it', () => {
  const seven = card('7', 'hearts', 'jx-7');
  const eight = card('8', 'hearts', 'jx-8');
  const wild = joker('jx-joker');
  const six = card('6', 'hearts', 'jx-6');
  const ten = card('10', 'hearts', 'jx-10');
  const discardCard = card('2', 'clubs', 'jx-discard');
  const base = playingState({ playerCount: 5 }, [[seven, eight, wild, discardCard]]);
  const laid = placeCombination(base, [seven.id, eight.id, wild.id], 'tierce').turnState!.temporaryCombinations[0];
  assert(laid.jokerPlacement?.represents.rank === '9', 'The Joker represents 9');
  // 10♥ extends 7-8-Joker(9) legitimately.
  const legal = { ...laid, cards: [...laid.cards, ten] };
  assert(getStableJokerPlacement(legal)?.represents.rank === '9', 'A legal extension keeps the Joker at 9');
  // 6♥ would force the Joker to become 5: the engine must refuse it.
  const displaced = { ...laid, cards: [...laid.cards, six] };
  assert(getStableJokerPlacement(displaced) === null, 'A displacing extension is detected and refused');
});

// ============================================================
// BRELAN / CARRÉ — classification and the "base" action
// ============================================================

test('A brelan with a Joker is never a carré: K-K-Joker ≠ K-K-K-K', () => {
  const brelanJoker = combo('kk-joker', 'carre', [
    card('K', 'hearts', 'brelan-kh'), card('K', 'diamonds', 'brelan-kd'), joker('brelan-joker'),
  ]);
  assert(classifyCombination(brelanJoker) === 'brelan_avec_joker', 'K-K-Joker is a brelan with a Joker');
  assert(isBrelanWithJoker(brelanJoker), 'isBrelanWithJoker recognises it');
  assert(!isTrueCarre(brelanJoker), 'K-K-Joker is NOT a carré');
  assert(getCombinationClassLabel(brelanJoker) === 'Brelan + Joker', 'The interface label is explicit');

  const brelanNaturel = combo('kkk', 'carre', [
    card('K', 'hearts', 'bn-kh'), card('K', 'diamonds', 'bn-kd'), card('K', 'spades', 'bn-ks'),
  ]);
  assert(classifyCombination(brelanNaturel) === 'brelan_naturel', 'K-K-K is a natural brelan');
  assert(!isTrueCarre(brelanNaturel), 'A brelan is never a carré');

  const carreJoker = combo('kkkj', 'carre', [
    card('K', 'hearts', 'cj-kh'), card('K', 'diamonds', 'cj-kd'), card('K', 'spades', 'cj-ks'), joker('cj-joker'),
  ]);
  assert(classifyCombination(carreJoker) === 'brelan_avec_joker', 'K-K-K-Joker is a carré WITH a Joker');
  assert(!isTrueCarre(carreJoker), 'A Joker never makes a true carré');

  const vraiCarre = combo('kkkk', 'carre', [
    card('K', 'hearts', 'vc-kh'), card('K', 'diamonds', 'vc-kd'), card('K', 'spades', 'vc-ks'), card('K', 'clubs', 'vc-kc'),
  ]);
  assert(classifyCombination(vraiCarre) === 'carre_naturel', 'K-K-K-K is a true carré');
  assert(isTrueCarre(vraiCarre), 'isTrueCarre recognises K-K-K-K');
  assert(getCombinationClassLabel(vraiCarre) === 'Carré', 'The interface label is Carré');
});

test('Only a true carré can be returned to the base', () => {
  const vraiCarre = combo('base-kkkk', 'carre', [
    card('K', 'hearts', 'base-kh'), card('K', 'diamonds', 'base-kd'), card('K', 'spades', 'base-ks'), card('K', 'clubs', 'base-kc'),
  ], 'player-0');
  const brelanJoker = combo('base-kkj', 'carre', [
    card('10', 'hearts', 'base-10h'), card('10', 'diamonds', 'base-10d'), joker('base-joker'),
  ], 'player-0');

  const openedState = (combos: Combination[]): GameState => {
    const base = playingState({ playerCount: 2 }, [[card('2', 'clubs', 'base-discard')], []]);
    return {
      ...base,
      players: base.players.map(player => player.id === 'player-0' ? { ...player, status: 'opened' as const } : player),
      tableCombinations: combos.map(combo => ({ ...combo, completedById: 'player-0' })),
    };
  };

  const carreState = openedState([vraiCarre]);
  assert(canReturnCarreToBase(carreState, vraiCarre.id), 'A true carré can be returned to the base');
  assert(getAvailableActions(carreState, 'player-0').returnableCarreIds.includes(vraiCarre.id), 'The action is exposed to the interface');
  const afterReturn = returnCarreToBase(carreState, vraiCarre.id);
  assert(afterReturn.tableCombinations.length === 0, 'The carré leaves the table');
  assert(afterReturn.basePile.length === 4, 'Its four cards go into the base');
  assert(afterReturn.actionHistory.some(action => action.type === 'complete_carre'), 'The action is recorded');

  const brelanState = openedState([brelanJoker]);
  assert(!canReturnCarreToBase(brelanState, brelanJoker.id), 'A brelan with a Joker can never be returned');
  assert(returnCarreToBase(brelanState, brelanJoker.id) === brelanState, 'The engine refuses the action');
  assert(getAvailableActions(brelanState, 'player-0').returnableCarreIds.length === 0, 'No base action is offered');
});

test('The base action follows the detenteur/completeur setting', () => {
  const vraiCarre = combo('resp-kkkk', 'carre', [
    card('Q', 'hearts', 'resp-qh'), card('Q', 'diamonds', 'resp-qd'), card('Q', 'spades', 'resp-qs'), card('Q', 'clubs', 'resp-qc'),
  ], 'player-1');
  const base = playingState({ carreResponsable: 'completeur' }, [[card('2', 'clubs', 'resp-discard')], []]);
  const state: GameState = {
    ...base,
    players: base.players.map(player => ({ ...player, status: 'opened' as const })),
    tableCombinations: [{ ...vraiCarre, completedById: 'player-0' }],
  };
  assert(canReturnCarreToBase(state, vraiCarre.id), 'With completeur mode, the completer handles the carré');
  assert(getAvailableActions(state, 'player-0').returnableCarreIds.includes(vraiCarre.id), 'The completer sees the base action');
  const ownerTurnCompleteur: GameState = {
    ...state,
    currentPlayerIndex: 1,
    turnState: turnState('player-1', 'playing'),
  };
  assert(!canReturnCarreToBase(ownerTurnCompleteur, vraiCarre.id), 'With completeur mode, the owner cannot act');

  const detenteurState: GameState = {
    ...state,
    config: { ...state.config, carreResponsable: 'detenteur' },
  };
  assert(!canReturnCarreToBase(detenteurState, vraiCarre.id), 'With detenteur mode, the completer cannot act');
  const ownerTurnDetenteur: GameState = {
    ...detenteurState,
    currentPlayerIndex: 1,
    turnState: turnState('player-1', 'playing'),
  };
  assert(canReturnCarreToBase(ownerTurnDetenteur, vraiCarre.id), 'With detenteur mode, the owner handles the carré');
});


// ============================================================
// VIERGE = SEUIL DE LA MANCHE (jamais la valeur d'une ouverture)
// ============================================================

test('VIERGE is the fixed round threshold: 5j=71, 4j=91, 3j=101, 2j=111', () => {
  for (const playerCount of [2, 3, 4, 5] as const) {
    const state = playingState({ playerCount }, [[]]);
    assert(state.initialThreshold === INITIAL_THRESHOLDS[playerCount], `${playerCount}j VIERGE = ${INITIAL_THRESHOLDS[playerCount]}`);
    assert(state.suite === INITIAL_THRESHOLDS[playerCount], `${playerCount}j SUITE starts at the VIERGE threshold`);
  }
});

test('5 players: an opening at 104 gives VIERGE 71 / SUITE 105, then 112 gives VIERGE 71 / SUITE 113', () => {
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 5 };
  // Natural opening worth exactly 104: 10JQ♠ 30 + 10JQ♦ 30 + 9-10-J♣ 29 + 4-5-6♣ 15
  const opening104 = [
    combo('v104-10jq-s', 'tierce', [
      card('10', 'spades', 'v104-10s'), card('J', 'spades', 'v104-js'), card('Q', 'spades', 'v104-qs'),
    ]),
    combo('v104-10jq-d', 'tierce', [
      card('10', 'diamonds', 'v104-10d'), card('J', 'diamonds', 'v104-jd'), card('Q', 'diamonds', 'v104-qd'),
    ]),
    combo('v104-910j-c', 'tierce', [
      card('9', 'clubs', 'v104-9c'), card('10', 'clubs', 'v104-10c'), card('J', 'clubs', 'v104-jc'),
    ]),
    combo('v104-456-c', 'tierce', [
      card('4', 'clubs', 'v104-4c'), card('5', 'clubs', 'v104-5c'), card('6', 'clubs', 'v104-6c'),
    ]),
  ];
  // Natural opening worth exactly 112: QKA♥ 31 + 10JQ♠ 30 + 10JQ♦ 30 + 6-7-8♣ 21
  const opening112 = [
    combo('v112-qka-h', 'tierce', [
      card('Q', 'hearts', 'v112-qh'), card('K', 'hearts', 'v112-kh'), card('A', 'hearts', 'v112-ah'),
    ]),
    combo('v112-10jq-s', 'tierce', [
      card('10', 'spades', 'v112-10s'), card('J', 'spades', 'v112-js'), card('Q', 'spades', 'v112-qs'),
    ]),
    combo('v112-10jq-d', 'tierce', [
      card('10', 'diamonds', 'v112-10d'), card('J', 'diamonds', 'v112-jd'), card('Q', 'diamonds', 'v112-qd'),
    ]),
    combo('v112-678-c', 'tierce', [
      card('6', 'clubs', 'v112-6c'), card('7', 'clubs', 'v112-7c'), card('8', 'clubs', 'v112-8c'),
    ]),
  ];

  const valueOf = (combos: Combination[]) => validateFirstPose(combos, 71, config);
  assert(valueOf(opening104).total === 104, `Opening A totals 104 (got ${valueOf(opening104).total})`);
  assert(valueOf(opening104).vierge === 104, 'Opening A is fully natural');
  assert(valueOf(opening112).total === 112, `Opening B totals 112 (got ${valueOf(opening112).total})`);

  const emptyHands = [[], [], [], []] as GameCard[][];
  const planA = { combos: opening104, total: 104, discard: card('2', 'spades', 'v104-discard'), reserve: card('3', 'spades', 'v104-reserve') };
  const planB = { combos: opening112, total: 112, discard: card('4', 'spades', 'v112-discard'), reserve: card('5', 'spades', 'v112-reserve') };

  let state = playingState({ playerCount: 5 }, [handsWithCombos(planA.combos, planA.discard, planA.reserve), ...emptyHands]);
  assert(state.initialThreshold === 71, 'VIERGE = 71 for 5 players');
  state = layCombos(state, planA.combos);
  const afterA = discard(state, planA.discard.id);

  assert(afterA.initialThreshold === 71, 'VIERGE stays 71 after the opening');
  assert(afterA.players[0].openingTotal === 104, `TOTAL = 104 (got ${afterA.players[0].openingTotal})`);
  assert(JSON.stringify(getOpeningHudValues(afterA, 'player-0')) === JSON.stringify({vierge:71,suite:105,total:104,isDraft:false}), 'HUD after opening 104');
  assert(afterA.suite === 105, `SUITE = 105 (got ${afterA.suite})`);
  assert(afterA.players[0].openingValue === 104, 'The natural score is stored separately from TOTAL');

  const secondIndex = afterA.currentPlayerIndex;
  const players = afterA.players.map((player, index) => index === secondIndex
    ? { ...player, hand: handsWithCombos(planB.combos, planB.discard, planB.reserve) }
    : player);
  let secondState: GameState = {
    ...afterA,
    players,
    currentPlayerIndex: secondIndex,
    turnState: turnState(players[secondIndex].id),
  };
  secondState = layCombos(secondState, planB.combos);
  const afterB = discard(secondState, planB.discard.id);

  assert(afterB.initialThreshold === 71, 'VIERGE is still 71 after the second opening');
  assert(afterB.players[secondIndex].openingTotal === 112, `TOTAL = 112 (got ${afterB.players[secondIndex].openingTotal})`);
  assert(JSON.stringify(getOpeningHudValues(afterB, 'player-0')) === JSON.stringify({vierge:71,suite:113,total:112,isDraft:false}), 'Local HUD shows latest opponent opening, not own old total');
  assert(afterB.suite === 113, `SUITE = 113 (got ${afterB.suite})`);
  assert(afterB.suite !== secondState.suite, 'SUITE keeps evolving after every opening');
  assert(afterB.players[0].openingTotal === 104, 'The first TOTAL is untouched');
  assert(afterB.initialThreshold === 71 && afterB.players[0].openingValue === 104,
    'VIERGE (71) never becomes the value of an opening');
});

test('VIERGE never mixes the natural score with the total: joker combinations count 0', () => {
  const cases: Array<{ label: string; meld: Combination; vierge: number; total: number }> = [
    { label: '10+10+10', meld: combo('vm-a', 'carre', [card('10', 'hearts', 'vm-ah'), card('10', 'diamonds', 'vm-ad'), card('10', 'spades', 'vm-as')]), vierge: 30, total: 30 },
    { label: '10+10+Joker', meld: combo('vm-b', 'carre', [card('10', 'hearts', 'vm-bh'), card('10', 'diamonds', 'vm-bd'), joker('vm-bj')]), vierge: 0, total: 30 },
    { label: '7+8+9', meld: combo('vm-c', 'tierce', [card('7', 'hearts', 'vm-c7'), card('8', 'hearts', 'vm-c8'), card('9', 'hearts', 'vm-c9')]), vierge: 24, total: 24 },
    { label: '7+8+Joker', meld: combo('vm-d', 'tierce', [card('7', 'hearts', 'vm-d7'), card('8', 'hearts', 'vm-d8'), joker('vm-dj')]), vierge: 0, total: 21 },
    { label: 'A+K+Q', meld: combo('vm-e', 'tierce', [card('A', 'spades', 'vm-ea'), card('K', 'spades', 'vm-ek'), card('Q', 'spades', 'vm-eq')]), vierge: 31, total: 31 },
    { label: 'A+K+Joker', meld: combo('vm-f', 'tierce', [card('A', 'spades', 'vm-fa'), card('K', 'spades', 'vm-fk'), joker('vm-fj')]), vierge: 0, total: 31 },
  ];
  for (const item of cases) {
    const value = calculateCombinationValue(item.meld);
    assert(value.vierge === item.vierge, `${item.label}: VIERGE ${item.vierge} (got ${value.vierge})`);
    assert(value.total === item.total, `${item.label}: TOTAL ${item.total} (got ${value.total})`);
    assert(value.vierge <= value.total, `${item.label}: VIERGE can never exceed TOTAL`);
  }
});

// ============================================================
// COMBINAISONS SUR TABLE : plus de limite à 5 cartes, insertion logique
// ============================================================

function openedTableState(combos: Combination[], hand: GameCard[], configOverrides: Partial<GameConfig> = {}): GameState {
  const base = playingState(configOverrides, [hand, []]);
  return {
    ...base,
    players: base.players.map(player => player.id === 'player-0' ? { ...player, status: 'opened' as const } : player),
    tableCombinations: combos.map(item => ({ ...item, ownerId: 'player-0' })),
  };
}

test('A natural card is inserted at its logical position, not where it was dropped', () => {
  const run = combo('ins-run', 'tierce', [
    card('9', 'hearts', 'ins-9'), card('10', 'hearts', 'ins-10'), card('J', 'hearts', 'ins-j'),
    card('Q', 'hearts', 'ins-q'), card('K', 'hearts', 'ins-k'),
  ], 'player-0');
  const eight = card('8', 'hearts', 'ins-8');
  const discardCard = card('2', 'clubs', 'ins-discard');
  const state = openedTableState([run], [eight, discardCard]);
  const after = addToCombination(state, eight.id, run.id);
  const extended = after.tableCombinations[0];
  assert(extended.cards.length === 6, 'The run now holds 6 cards');
  assert(
    extended.cards.map(item => (item as Card).rank).join('-') === '8-9-10-J-Q-K',
    `Expected 8-9-10-J-Q-K, got ${extended.cards.map(item => (item as Card).rank).join('-')}`,
  );
  assert(extended.cards[0].id === eight.id, 'The 8♥ went to the head of the run');
  assert(extended.cards[5].id === 'ins-k', 'The K♥ stayed at the end');
  assert(validateCombination(extended).valid, 'The 6-card run is valid on the table');
});

test('A run on the table can exceed 5 cards: 8-9-10-J-Q then K, then A', () => {
  const run = combo('long-run', 'tierce', [
    card('8', 'hearts', 'long-8'), card('9', 'hearts', 'long-9'), card('10', 'hearts', 'long-10'),
    card('J', 'hearts', 'long-j'), card('Q', 'hearts', 'long-q'),
  ], 'player-0');
  const king = card('K', 'hearts', 'long-k');
  const ace = card('A', 'hearts', 'long-a');
  const discardCard = card('2', 'clubs', 'long-discard');
  let state = openedTableState([run], [king, ace, discardCard]);

  const withKing = addToCombination(state, king.id, 'long-run');
  const sixCards = withKing.tableCombinations[0];
  assert(sixCards.cards.length === 6, '6 cards accepted on the table');
  assert(validateCombination(sixCards).valid, 'A 6-card run is valid');
  assert(sixCards.cards[5].id === king.id, 'The K♥ was appended at the end of the ascending run');

  const withAce = addToCombination(withKing, ace.id, 'long-run');
  const sevenCards = withAce.tableCombinations[0];
  assert(sevenCards.cards.length === 7, '7 cards accepted');
  assert(validateCombination(sevenCards).valid, 'A 7-card run 8-9-10-J-Q-K-A is valid');
  assert(sevenCards.cards.map(item => (item as Card).rank).join('-') === '8-9-10-J-Q-K-A',
    sevenCards.cards.map(item => (item as Card).rank).join('-'));

  // A prepared hand pose stays limited to 5 cards.
  const sixPrepared = [
    card('3', 'clubs', 'prep-3'), card('4', 'clubs', 'prep-4'), card('5', 'clubs', 'prep-5'),
    card('6', 'clubs', 'prep-6'), card('7', 'clubs', 'prep-7'), card('8', 'clubs', 'prep-8'),
  ];
  const preparedCombo = combo('prep-run', 'tierce', sixPrepared, 'player-0');
  assert(!validateCombination(preparedCombo, { maxTierceLength: 5 }).valid, 'A hand pose keeps the 5-card limit');
  assert(detectCombinationType(sixPrepared) === null, 'Hand auto-detection stays limited to 5 cards');
  assert(validateCombination(preparedCombo).valid, 'The same 6 cards are legal once on the table');
});

test('Ace low: A-2-3 accepts 4 and refuses K', () => {
  const run = combo('ace-low', 'tierce', [
    card('A', 'hearts', 'al-a'), card('2', 'hearts', 'al-2'), card('3', 'hearts', 'al-3'),
  ], 'player-0');
  const four = card('4', 'hearts', 'al-4');
  const king = card('K', 'hearts', 'al-k');
  const discardCard = card('9', 'clubs', 'al-discard');

  const accepted = addToCombination(openedTableState([run], [four, discardCard]), four.id, 'ace-low');
  assert(accepted.tableCombinations[0].cards.length === 4, 'A-2-3 + 4 is accepted');
  assert(accepted.tableCombinations[0].cards.map(item => (item as Card).rank).join('-') === 'A-2-3-4',
    accepted.tableCombinations[0].cards.map(item => (item as Card).rank).join('-'));

  const refused = addToCombination(openedTableState([run], [king, discardCard]), king.id, 'ace-low');
  assert(refused.tableCombinations[0].cards.length === 3, 'A-2-3 + K is refused');
  assert(!canAddToCombination(run, king), 'canAddToCombination refuses a King after an Ace-low run');
});

test('Ace high: Q-K-A accepts J and refuses 2 (no circular K-A-2 run)', () => {
  const run = combo('ace-high', 'tierce', [
    card('Q', 'hearts', 'ah-q'), card('K', 'hearts', 'ah-k'), card('A', 'hearts', 'ah-a'),
  ], 'player-0');
  const jack = card('J', 'hearts', 'ah-j');
  const two = card('2', 'hearts', 'ah-2');
  const discardCard = card('9', 'clubs', 'ah-discard');

  const accepted = addToCombination(openedTableState([run], [jack, discardCard]), jack.id, 'ace-high');
  assert(accepted.tableCombinations[0].cards.length === 4, 'Q-K-A + J is accepted');
  assert(accepted.tableCombinations[0].cards.map(item => (item as Card).rank).join('-') === 'J-Q-K-A',
    accepted.tableCombinations[0].cards.map(item => (item as Card).rank).join('-'));

  const refused = addToCombination(openedTableState([run], [two, discardCard]), two.id, 'ace-high');
  assert(refused.tableCombinations[0].cards.length === 3, 'Q-K-A + 2 is refused');
  assert(!canAddToCombination(run, two), 'A circular K-A-2 run is never built');
});

test('The Joker keeps its chosen position while naturals are re-ordered', () => {
  // Joker-8-7 → the Joker is the head of the descending run and represents 9♥.
  const headPlacement = resolveJokerPlacement([
    joker('jk-head-j'), card('8', 'hearts', 'jk-h8'), card('7', 'hearts', 'jk-h7'),
  ], 'tierce')!;
  assert(headPlacement.position === 0, 'The Joker is in first position');
  assert(headPlacement.represents.rank === '9' && headPlacement.represents.suit === 'hearts',
    `Joker-8-7 → 9♥ (got ${JSON.stringify(headPlacement.represents)})`);

  // 8-7-Joker → the Joker ends the descending run and represents 6♥.
  const tailPlacement = resolveJokerPlacement([
    card('8', 'hearts', 'jk-t8'), card('7', 'hearts', 'jk-t7'), joker('jk-tail-j'),
  ], 'tierce')!;
  assert(tailPlacement.position === 2, 'The Joker is in last position');
  assert(tailPlacement.represents.rank === '6', `8-7-Joker → 6♥ (got ${tailPlacement.represents.rank})`);

  // Extending with a natural card never moves the Joker: the natural takes its
  // logical slot and the Joker keeps the card it represents.
  const six = card('6', 'hearts', 'jk-h6');
  const nine = card('9', 'hearts', 'jk-t9');
  const discardCard = card('2', 'clubs', 'jk-discard');

  const headCombo: Combination = {
    id: 'jk-head', type: 'tierce', ownerId: 'player-0',
    cards: [joker('jk-head-j'), card('8', 'hearts', 'jk-h8'), card('7', 'hearts', 'jk-h7')],
    jokerPlacement: headPlacement, jokerPosition: 0, jokerRepresents: headPlacement.represents,
  };
  const afterHead = addToCombination(openedTableState([headCombo], [six, discardCard]), six.id, 'jk-head');
  const head = afterHead.tableCombinations[0];
  assert(head.cards.map(item => item.isJoker ? 'JOKER' : (item as Card).rank).join('-') === 'JOKER-8-7-6',
    head.cards.map(item => item.isJoker ? 'JOKER' : (item as Card).rank).join('-'));
  assert(head.jokerPlacement?.represents.rank === '9', 'The Joker still represents 9♥');
  assert(head.jokerPlacement?.position === 0, 'The Joker is still first');
  assert(validateCombination(head).valid, 'The combination stays valid');

  const tailCombo: Combination = {
    id: 'jk-tail', type: 'tierce', ownerId: 'player-0',
    cards: [card('8', 'hearts', 'jk-t8'), card('7', 'hearts', 'jk-t7'), joker('jk-tail-j')],
    jokerPlacement: tailPlacement, jokerPosition: 2, jokerRepresents: tailPlacement.represents,
  };
  const afterTail = addToCombination(openedTableState([tailCombo], [nine, discardCard]), nine.id, 'jk-tail');
  const tail = afterTail.tableCombinations[0];
  assert(tail.cards.map(item => item.isJoker ? 'JOKER' : (item as Card).rank).join('-') === '9-8-7-JOKER',
    tail.cards.map(item => item.isJoker ? 'JOKER' : (item as Card).rank).join('-'));
  assert(tail.jokerPlacement?.represents.rank === '6', 'The Joker still represents 6♥');
  assert(tail.jokerPlacement?.position === 3, 'The Joker is still last');

  // The real 9♥ cannot be ADDED to a run where the Joker already stands for 9:
  // that slot is taken (the correct move is to recover the Joker).
  const refused = addToCombination(openedTableState([headCombo], [card('9', 'hearts', 'jk-real9'), discardCard]), 'jk-real9', 'jk-head');
  assert(refused.tableCombinations[0].cards.length === 3, 'Adding the real 9♥ over a Joker(9) is refused');
});

test('Replacing a Joker by its exact card: 8-7-6-5-Joker(4) + 4♣ → 8-7-6-5-4', () => {
  const placement = resolveJokerPlacement([
    card('8', 'clubs', 'rp-8'), card('7', 'clubs', 'rp-7'), card('6', 'clubs', 'rp-6'),
    card('5', 'clubs', 'rp-5'), joker('rp-joker'),
  ], 'tierce')!;
  assert(placement.position === 4 && placement.represents.rank === '4' && placement.represents.suit === 'clubs',
    `The Joker represents 4♣ (got ${JSON.stringify(placement)})`);

  const tableCombo: Combination = {
    id: 'rp-combo',
    type: 'tierce',
    cards: [
      card('8', 'clubs', 'rp-8'), card('7', 'clubs', 'rp-7'), card('6', 'clubs', 'rp-6'),
      card('5', 'clubs', 'rp-5'), joker('rp-joker'),
    ],
    ownerId: 'player-0',
    jokerPlacement: placement,
    jokerPosition: placement.position,
    jokerRepresents: placement.represents,
  };
  const realFour = card('4', 'clubs', 'rp-4');
  const discardCard = card('2', 'spades', 'rp-discard');
  const state = openedTableState([tableCombo], [realFour, discardCard]);

  const after = recoverJoker(state, 'rp-combo', realFour.id);
  const natural = after.tableCombinations[0];
  assert(natural.cards.length === 5, 'The combination still holds 5 cards');
  assert(natural.cards.every(item => !item.isJoker), 'The Joker left the combination');
  assert(
    natural.cards.map(item => (item as Card).rank).join('-') === '8-7-6-5-4',
    `The 4♣ took the Joker slot: ${natural.cards.map(item => (item as Card).rank).join('-')}`,
  );
  assert(natural.jokerPlacement === undefined && natural.jokerRepresents === undefined, 'No stale Joker metadata');
  assert(validateCombination(natural).valid, 'The natural run is valid');
  const recoveredJoker = after.players[0].hand.find(item => item.id === 'rp-joker');
  assert(recoveredJoker?.isJoker === true, 'The recovered card is still a Joker');
  assert(after.turnState?.recoveredJokers.includes('rp-joker'), 'The recovery is tracked by the engine');
});


test('A Joker added to a table run keeps the slot it is given', () => {
  const ascending = combo('aj-asc', 'tierce', [
    card('8', 'hearts', 'aj-8'), card('9', 'hearts', 'aj-9'), card('10', 'hearts', 'aj-10'),
  ], 'player-0');
  const descending = combo('aj-desc', 'tierce', [
    card('10', 'hearts', 'aj-d10'), card('9', 'hearts', 'aj-d9'), card('8', 'hearts', 'aj-d8'),
  ], 'player-0');
  const wildA = joker('aj-joker-a');
  const wildB = joker('aj-joker-b');
  const discardCard = card('2', 'clubs', 'aj-discard');

  const afterAsc = addToCombination(openedTableState([ascending], [wildA, discardCard]), wildA.id, 'aj-asc', 'higher');
  const ascCombo = afterAsc.tableCombinations[0];
  assert(ascCombo.cards[0]?.id === wildA.id, 'The higher Joker is at the high end of the descending table view');
  assert(ascCombo.jokerPlacement?.represents.rank === 'J', `It represents J♥ (got ${ascCombo.jokerPlacement?.represents.rank})`);
  assert(ascCombo.jokerPlacement?.position === 0, 'Its confirmed position is recorded');
  assert(validateCombination(ascCombo).valid, 'The run stays valid');

  const afterDesc = addToCombination(openedTableState([descending], [wildB, discardCard]), wildB.id, 'aj-desc', 'lower');
  const descCombo = afterDesc.tableCombinations[0];
  assert(descCombo.jokerPlacement?.represents.rank === '7', `It represents 7♥ (got ${descCombo.jokerPlacement?.represents.rank})`);
  assert(descCombo.cards[3]?.id === wildB.id, 'The Joker stays at the end of the descending run');
  assert(validateCombination(descCombo).valid, 'The run stays valid');
  assert(calculateCombinationValue(descCombo).vierge === 0, 'A run holding a Joker counts 0 in VIERGE');
});


// ============================================================
// OUVERTURE : seul le seuil VIERGE compte, jamais la SUITE
// ============================================================

/** Natural 78 (10JQ♠ 30 + 10JQ♦ 30 + 567♣ 18) + 9-9-Joker(9) 27 → total 105. */
function poseNatural78Total105(): Combination[] {
  return [
    combo('o78-10jq-s', 'tierce', [
      card('10', 'spades', 'o78-10s'), card('J', 'spades', 'o78-js'), card('Q', 'spades', 'o78-qs'),
    ]),
    combo('o78-10jq-d', 'tierce', [
      card('10', 'diamonds', 'o78-10d'), card('J', 'diamonds', 'o78-jd'), card('Q', 'diamonds', 'o78-qd'),
    ]),
    combo('o78-567-c', 'tierce', [
      card('5', 'clubs', 'o78-5c'), card('6', 'clubs', 'o78-6c'), card('7', 'clubs', 'o78-7c'),
    ]),
    combo('o78-99joker', 'carre', [
      card('9', 'hearts', 'o78-9h'), card('9', 'diamonds', 'o78-9d'), joker('o78-joker'),
    ]),
  ];
}

/** Natural 70 (QKA♥ 31 + 789♦ 24 + 456♣ 15) + 10-10-Joker(10) 30 → total 100. */
function poseNatural70Total100(): Combination[] {
  return [
    combo('o70-qka-h', 'tierce', [
      card('Q', 'hearts', 'o70-qh'), card('K', 'hearts', 'o70-kh'), card('A', 'hearts', 'o70-ah'),
    ]),
    combo('o70-789-d', 'tierce', [
      card('7', 'diamonds', 'o70-7d'), card('8', 'diamonds', 'o70-8d'), card('9', 'diamonds', 'o70-9d'),
    ]),
    combo('o70-456-c', 'tierce', [
      card('4', 'clubs', 'o70-4c'), card('5', 'clubs', 'o70-5c'), card('6', 'clubs', 'o70-6c'),
    ]),
    combo('o70-1010joker', 'carre', [
      card('10', 'hearts', 'o70-10h'), card('10', 'diamonds', 'o70-10d'), joker('o70-joker'),
    ]),
  ];
}

test('VIERGE 71 / SUITE 82 / natural 78 / total 105 → the opening is VALID', () => {
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 5 };
  const combos = poseNatural78Total105();
  const values = validateFirstPose(combos, 71, config);
  assert(values.vierge === 78, `Natural VIERGE is 78 (got ${values.vierge})`);
  assert(values.total === 105, `TOTAL is 105 (got ${values.total})`);
  assert(values.requiredThreshold === 71, 'The natural requirement is the VIERGE 71');
  assert(values.valid, '78 natural points ≥ VIERGE 71 → opening VALID although 78 < SUITE 82');

  // Same situation through the engine, with the SUITE explicitly at 82.
  const discardCard = card('2', 'spades', 'o78-discard');
  const reserve = card('3', 'spades', 'o78-reserve');
  const emptyHands = [[], [], [], []] as GameCard[][];
  let state: GameState = {
    ...playingState({ playerCount: 5 }, [handsWithCombos(combos, discardCard, reserve), ...emptyHands]),
    suite: 82,
    suiteLocked: true,
  };
  assert(state.initialThreshold === 71, 'VIERGE stays 71');
  const validation = validateOpening(state, 'player-0', combos, state.players[0].hand.filter(item => item.id !== discardCard.id));
  assert(validation.valid, 'The engine accepts the opening: the SUITE is not a natural threshold');
  assert(validation.requiredThreshold === 71, 'The engine compares against the VIERGE');

  state = layCombos(state, combos);
  const opened = discard(state, discardCard.id);
  assert(opened.players[0].status === 'opened', 'The player is opened');
  assert(opened.players[0].openingValue === 78, `NATUREL = 78 (got ${opened.players[0].openingValue})`);
  assert(opened.players[0].openingTotal === 105, `TOTAL = 105 (got ${opened.players[0].openingTotal})`);
  assert(opened.players[0].openingThreshold === 71, 'The applied threshold is the VIERGE 71');
  assert(opened.suite === 106, `SUITE becomes 106 (105 + 1), got ${opened.suite}`);
});

test('VIERGE 71 / SUITE 82 / natural 70 / total 100 → INVALID (70 < 71)', () => {
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 5 };
  const combos = poseNatural70Total100();
  const values = validateFirstPose(combos, 71, config);
  assert(values.vierge === 70, `Natural VIERGE is 70 (got ${values.vierge})`);
  assert(values.total === 100, `TOTAL is 100 (got ${values.total})`);
  assert(!values.valid, '70 natural points < VIERGE 71 → refused');
  assert(values.errors.some(error => error.includes('VIERGE (70)')), values.errors.join(' | '));

  const discardCard = card('2', 'spades', 'o70-discard');
  const reserve = card('3', 'spades', 'o70-reserve');
  const emptyHands = [[], [], [], []] as GameCard[][];
  let state: GameState = {
    ...playingState({ playerCount: 5 }, [handsWithCombos(combos, discardCard, reserve), ...emptyHands]),
    suite: 82,
    suiteLocked: true,
  };
  state = layCombos(state, combos);
  const refused = discard(state, discardCard.id);
  assert(refused.players[0].status === 'not_opened', 'The player stays unopened');
  assert(refused.tableCombinations.length === 0, 'No draft reaches the public table');
  assert(refused.faults.length === 0, 'No penalty for a refused opening');
  assert(refused.suite === 82, 'The refused opening never changes the SUITE');
});

test('Natural 71 meets VIERGE, but total 71 fails SUITE 82', () => {
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 5 };
  const combos = opening71();
  const values = validateFirstPose(combos, 71, config);
  assert(values.vierge === 71, `Natural VIERGE is 71 (got ${values.vierge})`);
  const underSuite = validateFirstPose(combos, 71, config, 82);
  assert(!underSuite.valid && underSuite.errors.some(e=>e.includes('TOTAL')), 'Total 71 is below SUITE 82');
});

test('natural 78 with SUITE 100 → never refused only because 78 < 100', () => {
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 5 };
  const combos = poseNatural78Total105();
  assert(validateFirstPose(combos, 71, config).valid, '78 ≥ VIERGE 71 → valid with SUITE 100');

  const discardCard = card('2', 'spades', 'o78b-discard');
  const reserve = card('3', 'spades', 'o78b-reserve');
  const emptyHands = [[], [], [], []] as GameCard[][];
  let state: GameState = {
    ...playingState({ playerCount: 5 }, [handsWithCombos(combos, discardCard, reserve), ...emptyHands]),
    suite: 100,
    suiteLocked: true,
  };
  state = layCombos(state, combos);
  const opened = discard(state, discardCard.id);
  assert(opened.players[0].status === 'opened', 'The SUITE 100 does not block an opening at 78 natural points');
  assert(opened.players[0].openingValue === 78, 'NATUREL = 78');
  assert(opened.players[0].openingTotal === 105, 'TOTAL = 105');
});

test('No remaining engine condition compares the natural points with the SUITE', () => {
  // A pose can meet VIERGE while failing the independent TOTAL requirement.
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 5 };
  for (const suite of [82, 100, 113, 200]) {
    const state = { ...playingState(config), suite };
    const validation = validateOpening(state, 'player-0', opening73());
    assert(!validation.valid && validation.errors.some(e => e.includes('TOTAL')), `Natural 73 sufficient but TOTAL below SUITE ${suite}`);
    assert(validation.requiredThreshold === 71, `Required threshold is the VIERGE, not ${suite}`);
  }
});



test('Fatima opens then discards playable A♠; evidence survives subsequent changes', () => {
  const melds = opening78ForReport();
  const ace = card('A', 'spades', 'fatima-ace');
  const spare = card('2', 'clubs', 'fatima-spare');
  let state = playingState({ playerCount: 5 }, [[], [], [], [], handsWithCombos(melds, ace, spare)]);
  state = { ...state, currentPlayerIndex: 4, turnState: turnState('player-4'),
    players: state.players.map(p => p.id === 'player-4' ? { ...p, name: 'Fatima' } : p),
    tableCombinations: [combo('opponent-qk', 'tierce', [card('J','spades','fq-j'),card('Q','spades','fq-q'),card('K','spades','fq-k')], 'player-1')] };
  state = layCombos(state, melds);
  const finished = discard(state, ace.id);
  const evidence = finished.lastCompletedTurnActionsByPlayer['player-4'];
  assert(evidence.wasOpenedBeforeDiscard && evidence.wasDiscardPlayable, 'Opening counts before discard');
  assert(evidence.handBeforeDiscard?.some(c => c.id === ace.id), 'Pre-discard hand saved');
  assert(evidence.tableBeforeDiscard?.length === 4, 'Opening and prior table captured');
  assert(evidence.turnActions?.length === 3, 'Turn actions captured');
  const changed = { ...finished, tableCombinations: [], discardPile: [], deck: [card('3','clubs','next-draw')] };
  const report = reportFault(drawCard(changed), 'player-0', 'player-4', 'playable_discard');
  assert(report.valid, 'Report uses immutable evidence, not current table');
});

function opening78ForReport(): Combination[] {
  return poseNatural78Total105().slice(0, 3);
}

test('Explicit opening commits atomically and allows opponent extension in the SAME turn', () => {
  const melds = opening78ForReport();
  const ace = card('A','spades','same-turn-a');
  const spare = card('2','clubs','same-turn-discard');
  let state = playingState({playerCount:5}, [handsWithCombos(melds, ace, spare)]);
  state = { ...state, players: state.players.map(p => p.id === 'player-1' ? {...p,status:'opened' as const} : p),
    tableCombinations: [combo('other-run','tierce',[card('J','spades','other-j'),card('Q','spades','other-q'),card('K','spades','other-k')],'player-1')] };
  state = layCombos(state, melds);
  const opened = confirmOpening(state);
  assert(opened.players[0].status === 'opened' && opened.currentPlayerIndex === 0, 'Opened without advancing');
  assert(opened.turnState?.temporaryCombinations.length === 0, 'Draft committed atomically');
  const extended = addToCombination(opened, ace.id, 'other-run');
  assert(extended !== opened && extended.tableCombinations[0].cards.length === 4, 'Opponent extension immediately legal');
  const finished = discard(extended, spare.id);
  assert(finished.phase === 'round_end' && finished.suite === opened.suite, 'Discard succeeds without recalculating opening');
});

test('Returned carré moves only to reserve, not current discard/history', () => {
  const cards = ['hearts','clubs','diamonds','spades'].map((s,i) => card('J',s as Suit,`base-visible-${i}`));
  const state = openedTableState([combo('base-visible','carre',cards)], [card('2','clubs','base-spare')]);
  const next = returnCarreToBase(state, 'base-visible');
  assert(!next.tableCombinations.length, 'Removed from table');
  assert(next.basePile.map(c => c.id).join() === cards.map(c => c.id).join(), 'Reserve preserves order');
  assert(next.discardPile === state.discardPile && next.discardHistory === state.discardHistory, 'No duplicate in discard/history');
  assert(new Set([...next.basePile, ...next.discardPile].map(c => c.id)).size === 4, 'Four physical cards, no duplicate');
});

test('Brelan Joker has two candidates; neither single card can recover it', () => {
  const cards = [card('J','hearts','amb-h'),card('J','clubs','amb-c'),joker('amb-j')];
  const meld = combo('amb','carre',cards);
  const info = getJokerRepresentation(meld)!;
  assert(info.representation === null, 'No arbitrary unique representation');
  assert(info.candidates.map(c => c.suit).sort().join() === ['diamonds','spades'].join(), 'Exactly J♦ and J♠');
  const diamond = card('J','diamonds','amb-d'), spade = card('J','spades','amb-s');
  for (const only of [diamond,spade]) {
    const state = openedTableState([meld],[only,card('2','clubs','amb-spare')]);
    assert(recoverJoker(state,'amb',only.id) === state, 'One missing card refused');
  }
  const split = openedTableState([meld],[diamond,card('2','clubs','amb-spare')]);
  split.players[1] = {...split.players[1],hand:[spade]};
  assert(recoverJoker(split,'amb',[diamond.id,spade.id]) === split, 'Cards held by separate players refused');
  const both = openedTableState([meld],[diamond,spade,card('2','clubs','amb-spare')]);
  const next = recoverJoker(both,'amb',[diamond.id,spade.id]);
  assert(next !== both && isTrueCarre(next.tableCombinations[0]), 'Two replacements make natural carré');
  assert(next.players[0].hand.some(c => c.id === 'amb-j' && c.isJoker), 'Plain Joker returned');
  assert(!next.tableCombinations[0].jokerRepresentation && !next.tableCombinations[0].jokerPlacement, 'Ambiguity removed');
  const four = {...meld,cards:[...cards,diamond]};
  assert(getJokerRepresentation(four)?.representation?.suit === 'spades', 'Four-card set uniquely represents J♠');
  assert(canRecoverJoker(four,spade), 'Single exact card recovers four-card set Joker');
  const run = {...combo('exact','tierce',[card('8','hearts','ex8'),joker('exj'),card('6','hearts','ex6')]),
    jokerPlacement: resolveJokerPlacement([card('8','hearts','ex8'),joker('exj'),card('6','hearts','ex6')],'tierce')!};
  assert(getJokerRepresentation(run)?.representation?.rank === '7', 'Tierce remains precise');
});


test('Natural replacement displays ascending without moving a positioned Joker beforehand', () => {
  const cards = [card('8','clubs','display8'),card('7','clubs','display7'),card('6','clubs','display6'),card('5','clubs','display5'),joker('displayJ')];
  const placement = resolveJokerPlacement(cards,'tierce')!;
  const meld: Combination = {...combo('display','tierce',cards),jokerPlacement:placement,jokerRepresents:placement.represents};
  assert(getCombinationDisplayCards(meld).map(c=>c.id).join() === cards.map(c=>c.id).join(), 'Joker run physical order unchanged');
  const replacement = card('4','clubs','display4');
  const state = openedTableState([meld],[replacement,card('2','hearts','displaySpare')]);
  const after = recoverJoker(state,'display',replacement.id);
  assert(after !== state, 'Authorized replacement succeeds');
  const natural = after.tableCombinations[0];
  assert(getCombinationDisplayCards(natural).map(c=>!c.isJoker && c.rank).join('-') === '4-5-6-7-8', 'Natural-only display ascending');
  assert(natural.cards.at(-1)?.id === replacement.id, 'Engine preserves exact replacement slot');
  assert(after.players[0].hand.some(c=>c.id === 'displayJ' && c.isJoker), 'Plain Joker returned');
});

test('Explicit invalid Joker representation is rejected rather than silently changed', () => {
  const cards = [card('7','hearts','bad7'),card('8','hearts','bad8'),joker('badJ')];
  const state = openedTableState([], [...cards,card('2','clubs','badSpare')]);
  const badPlacement = {jokerId:'badJ',position:2,represents:{rank:'6' as const,suit:'hearts' as const}};
  assert(placeCombination(state,cards.map(c=>c.id),'tierce',badPlacement) === state, 'Explicit 6 at slot of 9 refused without mutation');
});

console.log(`\nRule tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
