// =====================================================
// VALIDATION ENGINE
// Validates combinations, moves, first pose, etc.
// =====================================================
import {
  GameCard, Card, Combination, CombinationType, CombinationClass,
  Rank, Suit, RANK_ORDER, SUITS,
  getCardValue, getSetValue, GameState, Player, GameConfig,
  INITIAL_THRESHOLDS, Fault, FaultType,
  JokerPlacement, SEAT_ORDER, getNextSeat, getPreviousSeat,
} from './types';

// ---- Card Utilities ----

export function isJoker(card: GameCard): card is import('./types').JokerCard {
  return card.isJoker;
}

export function getNonJokerCards(cards: GameCard[]): Card[] {
  return cards.filter((c): c is Card => !c.isJoker);
}

export function getJokerCount(cards: GameCard[]): number {
  return cards.filter(c => c.isJoker).length;
}

// ---- Combination Validation ----

/**
 * Detect whether a raw list of cards (in order) forms a valid combination.
 * Returns the combination type ('tierce' | 'carre') if valid, otherwise null.
 *
 * - carré/brelan: 3 or 4 cards of the same rank, different suits (max 1 joker)
 * - tierce: 3+ consecutive cards of the same suit (max 1 joker)
 *
 * This is the HAND preparation detector: it stays limited to 3-5 cards.
 */
export function detectCombinationType(cards: GameCard[]): CombinationType | null {
  if (cards.length < 3 || cards.length > 5) return null;

  const baseCombo: Omit<Combination, 'type'> = {
    id: '__detect__',
    cards,
    ownerId: '__detect__',
  };

  // A carré/brelan has 3 or 4 cards (same rank, different suits).
  if (cards.length <= 4 && validateCarre({ ...baseCombo, type: 'carre' }).valid) {
    return 'carre';
  }

  // A tierce is a run of same-suit consecutive cards (3, 4 or 5 cards).
  if (validateTierce({ ...baseCombo, type: 'tierce' }).valid) {
    return 'tierce';
  }

  return null;
}

/**
 * Options for the strictness of a validation.
 *
 * `maxTierceLength` only applies while the meld is being PREPARED IN THE HAND
 * (first placement poses are limited to 5 cards). Once a meld lives on the
 * TABLE it may be extended to 6, 7, 8 cards and more.
 */
export interface CombinationValidationOptions {
  maxTierceLength?: number;
}

export function validateCombination(
  combo: Combination,
  options: CombinationValidationOptions = {},
): { valid: boolean; error?: string } {
  if (combo.cards.length < 3) {
    return { valid: false, error: 'Combination must have at least 3 cards' };
  }
  if (new Set(combo.cards.map(card => card.id)).size !== combo.cards.length) {
    return { valid: false, error: 'A physical card cannot appear twice in one combination' };
  }
  if (options.maxTierceLength && combo.type === 'tierce' && combo.cards.length > options.maxTierceLength) {
    return { valid: false, error: `A prepared tierce can have at most ${options.maxTierceLength} cards` };
  }
  if (combo.type === 'carre' && combo.cards.length > 4) {
    return { valid: false, error: 'A carré can have at most 4 cards' };
  }

  const jokerCount = getJokerCount(combo.cards);
  if (jokerCount > 1) {
    return { valid: false, error: 'A combination can contain at most ONE joker' };
  }

  if (combo.type === 'tierce') {
    return validateTierce(combo);
  } else if (combo.type === 'carre') {
    return validateCarre(combo);
  }

  return { valid: false, error: 'Unknown combination type' };
}

export function validateTierce(combo: Combination): { valid: boolean; error?: string } {
  const cards = combo.cards;
  const nonJokers = getNonJokerCards(cards);
  const jokerCount = getJokerCount(cards);

  // No upper limit: a run already on the table can grow to 6, 7, 8 cards…
  if (cards.length < 3) {
    return { valid: false, error: 'A tierce must contain at least 3 cards' };
  }
  if (jokerCount > 1) {
    return { valid: false, error: 'Tierce can have at most 1 joker' };
  }

  // All non-joker cards must be same suit.
  const suits = new Set(nonJokers.map(c => c.suit));
  if (suits.size > 1) {
    return { valid: false, error: 'All cards in a tierce must be the same suit' };
  }

  const suit = nonJokers[0]?.suit;
  if (!suit || nonJokers.length < 2) {
    return { valid: false, error: 'Tierce must have at least 2 non-joker cards' };
  }

  if (combo.jokerPlacement && !isExplicitPlacementValid(combo, combo.jokerPlacement)) {
    return { valid: false, error: 'Explicit Joker placement does not match the run' };
  }
  return validateConsecutiveWithJoker(cards, suit);
}

function validateConsecutiveWithJoker(
  cards: GameCard[],
  _suit: Suit
): { valid: boolean; error?: string } {
  const jokerCount = getJokerCount(cards);
  const nonJokers = getNonJokerCards(cards);
  const lowPositions = nonJokers.map(c => RANK_ORDER[c.rank]);
  const highPositions = nonJokers.map(c => c.rank === 'A' ? 14 : RANK_ORDER[c.rank]);

  if (
    tryConsecutive(lowPositions, cards.length, jokerCount) ||
    tryConsecutive(highPositions, cards.length, jokerCount)
  ) {
    return { valid: true };
  }

  return { valid: false, error: 'Cards are not consecutive' };
}

function tryConsecutive(positions: number[], totalCards: number, jokerCount: number): boolean {
  if (positions.length === 0) return false;
  const sorted = [...positions].sort((a, b) => a - b);
  const uniquePositions = new Set(sorted);
  if (uniquePositions.size !== sorted.length) return false;

  const minPos = sorted[0];
  const maxPos = sorted[sorted.length - 1];
  if (maxPos - minPos + 1 > totalCards) return false;

  // Try every valid interval that contains the natural cards. This deliberately
  // allows the joker to precede the lowest card (Q-K-A with Joker=Q) or to follow
  // the highest card, while keeping Ace-low and Ace-high runs non-wrapping.
  for (let start = maxPos - totalCards + 1; start <= minPos; start++) {
    const end = start + totalCards - 1;
    if (start < 1 || end > 14) continue;
    let gaps = 0;
    for (let position = start; position <= end; position++) {
      if (!uniquePositions.has(position)) gaps++;
    }
    if (gaps === jokerCount) return true;
  }
  return false;
}

export function validateCarre(combo: Combination): { valid: boolean; error?: string } {
  const cards = combo.cards;
  const nonJokers = getNonJokerCards(cards);
  const jokerCount = getJokerCount(cards);

  if (cards.length > 4) {
    return { valid: false, error: 'Carré can have at most 4 cards' };
  }

  if (cards.length < 3) {
    return { valid: false, error: 'Carré/Brelan must have at least 3 cards' };
  }

  if (jokerCount > 1) {
    return { valid: false, error: 'Carré can have at most 1 joker' };
  }

  // All non-joker cards must have the same rank
  const ranks = new Set(nonJokers.map(c => c.rank));
  if (ranks.size > 1) {
    return { valid: false, error: 'All cards in a carré must have the same rank' };
  }

  // All non-joker cards must have different suits
  const suitSet = new Set(nonJokers.map(c => c.suit));
  if (suitSet.size !== nonJokers.length) {
    return { valid: false, error: 'All cards in a carré must have different suits' };
  }

  return { valid: true };
}

// ---- Combination classification (brelan vs carré) ----

/**
 * Exact class of a meld. A Joker never upgrades a brelan into a carré:
 * `K + K + Joker` is a `brelan_avec_joker`, and `K + K + K + Joker` is a
 * `brelan_avec_joker`, not a true carré.
 */
export function classifyCombination(combo: Combination): CombinationClass {
  if (!validateCombination(combo).valid) return 'invalide';
  const jokerCount = getJokerCount(combo.cards);
  if (combo.type === 'tierce') {
    return jokerCount > 0 ? 'tierce_avec_joker' : 'tierce_naturelle';
  }
  if (combo.cards.length >= 4) {
    return jokerCount > 0 ? 'brelan_avec_joker' : 'carre_naturel';
  }
  return jokerCount > 0 ? 'brelan_avec_joker' : 'brelan_naturel';
}

/** A true carré: four natural cards of the same rank, no Joker at all. */
export function isTrueCarre(combo: Combination): boolean {
  return classifyCombination(combo) === 'carre_naturel';
}

/** A three-card set whose third card is a Joker. It is NOT a carré. */
export function isBrelanWithJoker(combo: Combination): boolean {
  return classifyCombination(combo) === 'brelan_avec_joker';
}

export function isBrelan(combo: Combination): boolean {
  const kind = classifyCombination(combo);
  return kind === 'brelan_naturel' || kind === 'brelan_avec_joker';
}

/** Human readable class, shared by the engine, the AI and the interface. */
export function getCombinationClassLabel(combo: Combination): string {
  switch (classifyCombination(combo)) {
    case 'brelan_naturel': return 'Brelan';
    case 'brelan_avec_joker': return 'Brelan + Joker';
    case 'carre_naturel': return 'Carré';
    case 'tierce_naturelle': return 'Tierce';
    case 'tierce_avec_joker': return 'Tierce + Joker';
    default: return 'Invalide';
  }
}

// ---- Canonical order, orientation and logical insertion ----

/** Orientation of a run: +1 ascending (8-9-10), -1 descending (10-9-8). */
export function getTierceOrientation(combo: Combination): 1 | -1 {
  const sequence = determineTierceSequence(combo);
  if (!sequence || sequence.length < 2) return 1;
  return sequence[1].position < sequence[0].position ? -1 : 1;
}

/** Keep the Joker metadata in sync with the physical index of the Joker. */
function syncJokerPosition(combo: Combination, cards: GameCard[]): Combination {
  const placement = combo.jokerPlacement;
  if (!placement) return { ...combo, cards };
  const index = cards.findIndex(card => card.id === placement.jokerId);
  if (index < 0) return { ...combo, cards };
  return {
    ...combo,
    cards,
    jokerPlacement: { ...placement, position: index },
    jokerPosition: index,
    jokerRepresents: placement.represents,
  };
}

/** Canonical suit order used for brelans/carrés. */
const setOrder = (combo: Combination) => (card: GameCard): number => card.isJoker
  ? SUITS.indexOf(combo.jokerPlacement?.represents.suit ?? 'spades')
  : SUITS.indexOf(card.suit);

/**
 * CANONICAL ORDER of a combination.
 *
 * Natural cards are always ordered along the run (or by suit for a set). The
 * Joker is never re-interpreted: it simply stays on the slot of the card it
 * represents, so its chosen position survives any re-ordering.
 */
export function canonicalizeCombination(combo: Combination): Combination {
  if (combo.cards.length < 2) return combo;

  if (combo.type === 'carre') {
    const cards = [...combo.cards].sort((a, b) => setOrder(combo)(a) - setOrder(combo)(b));
    return syncJokerPosition(combo, cards);
  }

  const sequence = determineTierceSequence(combo);
  if (!sequence || sequence.length !== combo.cards.length) return combo;
  const step = sequence.length >= 2 && sequence[1].position < sequence[0].position ? -1 : 1;
  const indexed = combo.cards.map((card, index) => ({ card, position: sequence[index].position }));
  indexed.sort((a, b) => step * (a.position - b.position));
  return syncJokerPosition(combo, indexed.map(item => item.card));
}

/**
 * True when the Joker already placed in `before` still stands for exactly the
 * same card in `after`. A Joker is never silently re-interpreted, even to make
 * an extension legal.
 */
function keepsJokerRepresentation(before: Combination, after: Combination): boolean {
  const previous = getStableJokerPlacement(before);
  if (!previous) return true;
  const next = getStableJokerPlacement(after);
  return Boolean(
    next &&
    next.jokerId === previous.jokerId &&
    next.represents.rank === previous.represents.rank &&
    next.represents.suit === previous.represents.suit
  );
}

/**
 * Insert a card at its LOGICAL position inside an existing combination.
 *
 * A natural card is never placed where it was dropped: it takes its place in
 * the run (`9-10-J-Q-K` + `8♥` → `8-9-10-J-Q-K`). The Joker is the only
 * exception — it keeps the explicit placement chosen by the player, so it is
 * appended and its represented card is derived from that slot.
 *
 * Returns null when the insertion would break the combination.
 */
export function insertCardAtLogicalPosition(
  combo: Combination,
  card: GameCard
): Combination | null {
  if (combo.cards.some(existing => existing.id === card.id)) return null;

  if (card.isJoker) {
    // A Joker keeps the slot it is given: its represented card is resolved
    // from THAT slot, before any re-ordering, and it is never re-derived.
    const cards = [...combo.cards, card];
    const placement = resolveJokerPlacement(cards, combo.type);
    if (!placement) return null;
    const withPlacement = syncJokerPosition({ ...combo, jokerPlacement: placement }, cards);
    const candidate = canonicalizeCombination(withPlacement);
    return validateCombination(candidate).valid && keepsJokerRepresentation(combo, candidate)
      ? candidate
      : null;
  }

  if (combo.type === 'carre') {
    const cards = [...combo.cards, card];
    const candidate = canonicalizeCombination(syncJokerPosition(combo, cards));
    return validateCombination(candidate).valid && keepsJokerRepresentation(combo, candidate)
      ? candidate
      : null;
  }

  // Tierce: try every sequence position the card can occupy (Ace low / high).
  const sequence = determineTierceSequence(combo);
  if (!sequence || sequence.length !== combo.cards.length) return null;
  const step = sequence.length >= 2 && sequence[1].position < sequence[0].position ? -1 : 1;
  const candidates = card.rank === 'A' ? [1, 14] : [RANK_ORDER[card.rank]];

  for (const position of candidates) {
    let index = combo.cards.length;
    for (let i = 0; i < sequence.length; i++) {
      if (step * (position - sequence[i].position) < 0) { index = i; break; }
    }
    const cards = [...combo.cards.slice(0, index), card, ...combo.cards.slice(index)];
    const candidate = canonicalizeCombination(syncJokerPosition(combo, cards));
    if (!validateCombination(candidate).valid) continue;
    // A natural card may never silently re-interpret a positioned Joker:
    // if the Joker would have to represent another card, the move is refused.
    if (!keepsJokerRepresentation(combo, candidate)) continue;
    // The card must really land on the slot its rank occupies in the run:
    // this is what rejects an Ace placed at the wrong end (A high dropped
    // before an ascending run, Ace low dropped after a descending one).
    const finalSequence = determineTierceSequence(candidate);
    const finalIndex = candidate.cards.findIndex(item => item.id === card.id);
    if (!finalSequence || finalSequence[finalIndex]?.position !== position) continue;
    return candidate;
  }
  return null;
}

// ---- Combination Value Calculation ----

export function calculateCombinationValue(combo: Combination): {
  total: number;
  vierge: number; // Value without jokers
} {
  const nonJokers = getNonJokerCards(combo.cards);
  const jokerCount = getJokerCount(combo.cards);

  if (combo.type === 'carre') {
    return calculateCarreValue(combo);
  }

  return calculateTierceValue(combo);
}

function calculateTierceValue(combo: Combination): { total: number; vierge: number } {
  const cards = combo.cards;
  const nonJokers = getNonJokerCards(cards);
  
  // Determine the sequence positions
  const sequence = determineTierceSequence(combo);
  if (!sequence) return { total: 0, vierge: 0 };

  let total = 0;
  let vierge = 0;

  for (const pos of sequence) {
    const rank = positionToRank(pos.position);
    let value: number;
    
    if (rank === 'A') {
      // Determine if Ace is low or high based on position
      value = pos.position === 1 ? 1 : 11;
    } else if (['K', 'Q', 'J', '10'].includes(rank)) {
      value = 10;
    } else {
      value = RANK_ORDER[rank];
    }

    total += value;
    if (!pos.isJoker) {
      vierge += value;
    }
  }

  // VIERGE is all-or-nothing: a tierce containing any Joker contributes zero,
  // even though the total still counts the rank represented by that Joker.
  return { total, vierge: getJokerCount(cards) > 0 ? 0 : vierge };
}

function calculateCarreValue(combo: Combination): { total: number; vierge: number } {
  const nonJokers = getNonJokerCards(combo.cards);
  const jokerCount = getJokerCount(combo.cards);
  
  if (nonJokers.length === 0) return { total: 0, vierge: 0 };
  
  const rank = nonJokers[0].rank;
  const totalCount = combo.cards.length;
  
  if (rank === 'A') {
    // Special values for Aces. Any Joker makes the complete combination worth
    // zero in VIERGE, not merely the Joker's own 11 points.
    if (totalCount === 3) return { total: 33, vierge: jokerCount > 0 ? 0 : 33 };
    if (totalCount === 4) return { total: 44, vierge: jokerCount > 0 ? 0 : 44 };
  }
  
  const cardValue = getCardValue(nonJokers[0], 'set');
  const total = cardValue * totalCount;
  return { total, vierge: jokerCount > 0 ? 0 : total };
}

export interface SequencePosition {
  position: number; // 1-13 (1=Ace low) or 14 (Ace high)
  isJoker: boolean;
  card?: GameCard;
}

export function determineTierceSequence(combo: Combination): SequencePosition[] | null {
  const cards = combo.cards;
  const nonJokers = getNonJokerCards(cards);
  const jokerCount = getJokerCount(cards);
  if (nonJokers.length === 0) return null;

  // An explicit placement keeps the Joker exactly where the player put it:
  // the sequence follows the physical order, it is never re-sorted.
  const placement = combo.jokerPlacement;
  if (placement && jokerCount > 0) {
    const explicitSequence = buildExplicitSequence(cards, placement);
    if (explicitSequence) return explicitSequence;
  }

  const lowResult = buildSequence(cards, card => RANK_ORDER[card.rank], cards.length);
  if (lowResult) return lowResult;
  return buildSequence(cards, card => (card.rank === 'A' ? 14 : RANK_ORDER[card.rank]), cards.length);
}

/**
 * Build the tierce sequence for one Ace interpretation.
 *
 * The returned sequence follows the PHYSICAL order of `cards`, so
 * `sequence[i]` always describes `cards[i]`. That is what lets the engine keep
 * the orientation of a run and the explicit slot of a Joker.
 */
function buildSequence(
  cards: GameCard[],
  scaleOf: (card: Card) => number,
  totalCards: number
): SequencePosition[] | null {
  const naturals = cards.filter((card): card is Card => !card.isJoker);
  if (naturals.length === 0) return null;

  const jokerCount = cards.length - naturals.length;
  const naturalPositions = naturals.map(scaleOf);
  const sorted = [...naturalPositions].sort((a, b) => a - b);
  if (new Set(sorted).size !== sorted.length) return null;

  const minPos = sorted[0];
  const maxPos = sorted[sorted.length - 1];
  if (maxPos - minPos + 1 > totalCards) return null;

  for (let start = maxPos - totalCards + 1; start <= minPos; start++) {
    const end = start + totalCards - 1;
    if (start < 1 || end > 14) continue;

    const used = new Set(naturalPositions);
    const gaps: number[] = [];
    for (let position = start; position <= end; position++) {
      if (!used.has(position)) gaps.push(position);
    }
    if (gaps.length !== jokerCount) continue;

    const byPosition = new Map<number, Card>();
    for (const card of naturals) byPosition.set(scaleOf(card), card);

    const sequence: SequencePosition[] = [];
    let gapIndex = 0;
    for (const card of cards) {
      if (card.isJoker) {
        sequence.push({ position: gaps[gapIndex++], isJoker: true });
      } else {
        const position = scaleOf(card);
        if (!byPosition.has(position)) return null;
        sequence.push({ position, isJoker: false, card });
      }
    }
    return sequence;
  }
  return null;
}

function positionToRank(position: number): Rank {
  if (position === 14) return 'A';
  const entries = Object.entries(RANK_ORDER);
  const found = entries.find(([, v]) => v === position);
  return found ? found[0] as Rank : 'A';
}

// ---- First Pose Validation ----

/**
 * Validate an opening pose.
 *
 * The NATURAL threshold is the VIERGE (71 / 91 / 101 / 111 according to the
 * number of players). The SUITE is the required TOTAL threshold, never a natural threshold.
 *
 * A combination holding a Joker contributes 0 to the VIERGE but still counts
 * in the TOTAL at the value of the card the Joker represents.
 */
export function validateFirstPose(
  combinations: Combination[],
  viergeThreshold: number,
  config: GameConfig,
  suiteThreshold: number = viergeThreshold,
): { valid: boolean; vierge: number; total: number; requiredThreshold: number; errors: string[] } {
  const errors: string[] = [];
  if(!combinations.length)errors.push('At least one valid opening combination is required');
  
  let totalVierge = 0;
  let totalValue = 0;
  const cardIds = new Set<string>();

  for (const combo of combinations) {
    // An opening pose is prepared in the hand: a run is capped at 5 cards.
    const validation = validateCombination(combo, { maxTierceLength: 5 });
    if (!validation.valid) {
      errors.push(validation.error || 'Invalid combination');
      continue;
    }
    for (const card of combo.cards) {
      if (cardIds.has(card.id)) errors.push(`Card ${card.id} is used in more than one opening combination`);
      cardIds.add(card.id);
    }

    const value = calculateCombinationValue(combo);
    totalVierge += value.vierge;
    totalValue += value.total;
  }

  if (config.tierceObligatoire) {
    const hasNaturalTierce = combinations.some(combo =>
      combo.type === 'tierce' &&
      getJokerCount(combo.cards) === 0 &&
      validateCombination(combo, { maxTierceLength: 5 }).valid
    );
    if (!hasNaturalTierce) {
      errors.push('Opening requires at least one natural tierce in the VIERGE');
    }
  }

  // Natural points are compared only with VIERGE; TOTAL is compared with SUITE below.
  const requiredThreshold = viergeThreshold;

  if (totalVierge < requiredThreshold) {
    errors.push(`VIERGE (${totalVierge}) must be >= VIERGE seuil (${requiredThreshold})`);
  }

  if (totalValue < suiteThreshold) {
    errors.push(`TOTAL (${totalValue}) must be >= SUITE (${suiteThreshold})`);
  }

  // Check tierce max 5 cards when first placed
  for (const combo of combinations) {
    if (combo.type === 'tierce' && combo.cards.length > 5) {
      errors.push('A tierce cannot exceed 5 cards when first placed');
    }
  }

  return {
    valid: errors.length === 0,
    vierge: totalVierge,
    total: totalValue,
    requiredThreshold,
    errors,
  };
}

// ---- Can Card Be Added to Combination ----

export function canAddToCombination(
  combo: Combination,
  card: GameCard
): boolean {
  if (card.isJoker && combo.type === 'tierce') return getJokerExtensionChoices(combo,card).some(c=>c.valid);
  // The card is inserted at its logical place, never where it was dropped.
  return insertCardAtLogicalPosition(combo, card) !== null;
}

// ---- Check if discard is playable (fault detection) ----

export function isCardPlayableOnTable(
  card: GameCard,
  tableCombinations: Combination[]
): boolean {
  if (card.isJoker) return false; // Joker discard is a separate rule
  
  for (const combo of tableCombinations) {
    if (canAddToCombination(combo, card)) {
      return true;
    }
  }
  return false;
}

// ---- Joker Recovery Validation ----

export function getJokerRepresentation(combo: Combination): import('./types').JokerRepresentation | null {
  const position = combo.cards.findIndex(card => card.isJoker);
  if (position < 0) return null;
  const naturals = getNonJokerCards(combo.cards);
  const exact = combo.jokerPlacement?.represents ?? combo.jokerRepresents ?? determineJokerRepresentation(combo);
  const candidates = combo.type === 'carre'
    ? SUITS.filter(suit => !naturals.some(card => card.suit === suit))
      .map(suit => ({ rank: naturals[0].rank, suit }))
    : exact ? [exact] : [];
  return { jokerId: combo.cards[position].id, position, combinationType: combo.type,
    candidates, representation: candidates.length === 1 ? candidates[0] : null };
}

export function refreshJokerMetadata(combo: Combination): Combination {
  const jokerRepresentation = getJokerRepresentation(combo);
  if (combo.type !== 'carre') return { ...combo, jokerRepresentation: jokerRepresentation ?? undefined };
  return { ...combo, jokerRepresentation: jokerRepresentation ?? undefined,
    jokerRepresents: jokerRepresentation?.representation ?? undefined,
    jokerPlacement: undefined, jokerPosition: jokerRepresentation?.position };
}

export function canRecoverJoker(combo: Combination, replacement: GameCard | GameCard[]): boolean {
  const cards = Array.isArray(replacement) ? replacement : [replacement];
  const metadata = getJokerRepresentation(combo);
  if (!validateCombination(combo).valid || getJokerCount(combo.cards) !== 1 || !metadata) return false;
  if (cards.length !== metadata.candidates.length || new Set(cards.map(c => c.id)).size !== cards.length) return false;
  if (cards.some(c => c.isJoker || combo.cards.some(existing => existing.id === c.id))) return false;
  return metadata.candidates.every(candidate => cards.some(c => !c.isJoker && c.rank === candidate.rank && c.suit === candidate.suit));
}

// ---- Explicit Joker placement ----

/** Sequence positions a natural card may occupy (Ace is low OR high). */
function rankPositions(rank: Rank): number[] {
  return rank === 'A' ? [1, 14] : [RANK_ORDER[rank]];
}

/**
 * Build the tierce sequence implied by an explicit Joker placement.
 *
 * The Joker sits at `placement.position` inside the physical `cards` array and
 * stands for `placement.represents`. Both ascending (7-8-Joker→9) and
 * descending (8-Joker-6, Joker=7) hand arrangements are supported, so the
 * physical order chosen while preparing the meld is preserved verbatim.
 */
function buildExplicitSequence(
  cards: GameCard[],
  placement: JokerPlacement
): SequencePosition[] | null {
  const jokerIndex = cards.findIndex(card => card.id === placement.jokerId);
  if (jokerIndex < 0 || jokerIndex !== placement.position) return null;

  const naturalPositions: { index: number; rank: Rank }[] = [];
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index];
    if (card.isJoker) continue;
    if (card.suit !== placement.represents.suit) return null;
    naturalPositions.push({ index, rank: card.rank });
  }
  if (naturalPositions.length < 2) return null;

  const jokerCandidates = rankPositions(placement.represents.rank);
  for (const step of [1, -1] as const) {
    for (const jokerSeqPos of jokerCandidates) {
      const start = jokerSeqPos - step * placement.position;
      let consistent = true;
      for (const natural of naturalPositions) {
        const expected = start + step * natural.index;
        if (!rankPositions(natural.rank).includes(expected)) { consistent = false; break; }
      }
      if (!consistent) continue;

      const positions = cards.map((_, index) => start + step * index);
      if (positions.some(position => position < 1 || position > 14)) continue;
      if (new Set(positions).size !== positions.length) continue;

      return cards.map((card, index) => card.isJoker
        ? { position: positions[index], isJoker: true }
        : { position: positions[index], isJoker: false, card });
    }
  }
  return null;
}

/** The placement recorded on a combination, when it still matches the physical cards. */
export function getStableJokerPlacement(combo: Combination): JokerPlacement | null {
  const placement = combo.jokerPlacement;
  if (!placement) return null;
  if (getJokerCount(combo.cards) === 0) return null;
  const index = combo.cards.findIndex(card => card.id === placement.jokerId);
  if (index < 0 || index !== placement.position) return null;
  return isExplicitPlacementValid(combo, placement) ? placement : null;
}

/** Does the recorded placement describe a genuinely valid combination? */
export function isExplicitPlacementValid(
  combo: Combination,
  placement: JokerPlacement
): boolean {
  if (combo.type === 'tierce') return buildExplicitSequence(combo.cards, placement) !== null;

  const nonJokers = getNonJokerCards(combo.cards);
  if (nonJokers.length === 0) return false;
  if (nonJokers.some(card => card.rank !== placement.represents.rank)) return false;
  const usedSuits = new Set(nonJokers.map(card => card.suit));
  if (usedSuits.size !== nonJokers.length) return false;
  return !usedSuits.has(placement.represents.suit);
}

/**
 * Derive the Joker placement from the physical order of the cards, i.e. from
 * the arrangement the player prepared in their hand.
 *
 * The Joker's own slot decides the card it represents: `7-8-Joker` → 9,
 * `Joker-7-8` → 6, `8-Joker-6` → 7. Nothing is sorted and nothing is moved.
 */
export function resolveJokerPlacement(
  cards: GameCard[],
  type: CombinationType
): JokerPlacement | null {
  const jokerIndex = cards.findIndex(card => card.isJoker);
  if (jokerIndex < 0) return null;
  const joker = cards[jokerIndex];
  if (!joker.isJoker) return null;
  const naturals: { index: number; card: Card }[] = [];
  cards.forEach((card, index) => {
    if (!card.isJoker) naturals.push({ index, card });
  });
  if (naturals.length < 2) return null;

  if (type === 'carre') {
    const rank = naturals[0].card.rank;
    if (naturals.some(natural => natural.card.rank !== rank)) return null;
    const usedSuits = new Set(naturals.map(natural => natural.card.suit));
    if (usedSuits.size !== naturals.length) return null;
    if (SUITS.filter(suit => !usedSuits.has(suit)).length !== 1) return null;
    const missingSuit = SUITS.find(suit => !usedSuits.has(suit));
    if (!missingSuit) return null;
    return { jokerId: joker.id, position: jokerIndex, represents: { rank, suit: missingSuit } };
  }

  const suit = naturals[0].card.suit;
  if (naturals.some(natural => natural.card.suit !== suit)) return null;

  for (const step of [1, -1] as const) {
    const anchor = naturals[0];
    for (const anchorPos of rankPositions(anchor.card.rank)) {
      const start = anchorPos - step * anchor.index;
      let consistent = true;
      for (const natural of naturals) {
        const expected = start + step * natural.index;
        if (!rankPositions(natural.card.rank).includes(expected)) { consistent = false; break; }
      }
      if (!consistent) continue;
      const jokerSeqPos = start + step * jokerIndex;
      if (jokerSeqPos < 1 || jokerSeqPos > 14) continue;
      return {
        jokerId: joker.id,
        position: jokerIndex,
        represents: { rank: positionToRank(jokerSeqPos), suit },
      };
    }
  }
  return null;
}

/**
 * Attach the explicit Joker placement of a meld (if it holds one), keeping the
 * derived `jokerPosition` / `jokerRepresents` fields in sync.
 */
export function applyJokerPlacement(combo: Combination): Combination {
  const placement = combo.jokerPlacement ?? resolveJokerPlacement(combo.cards, combo.type);
  if (placement && isExplicitPlacementValid(combo, placement)) {
    return {
      ...combo,
      jokerPlacement: placement,
      jokerPosition: placement.position,
      jokerRepresents: placement.represents,
    };
  }
  if (getJokerCount(combo.cards) === 0) return combo;

  // The prepared order is not a consistent run (e.g. 8-Joker-7). Fall back to
  // the canonical order and freeze the representation the Joker takes there,
  // so it still owns an explicit, stable placement and stays recoverable.
  const canonical = canonicalizeCombination(combo);
  const representation = determineJokerRepresentation(canonical);
  const index = canonical.cards.findIndex(card => card.isJoker);
  if (!representation || index < 0) return canonical;
  const jokerId = canonical.cards[index].id;
  return {
    ...canonical,
    jokerPlacement: { jokerId, position: index, represents: representation },
    jokerPosition: index,
    jokerRepresents: representation,
  };
}

// ---- Determine Joker Representation ----

/**
 * What the Joker stands for. An explicit, still-valid placement always wins:
 * auto-detection may never move or re-interpret a Joker that a player already
 * positioned in a valid combination.
 */
export function determineJokerRepresentation(
  combo: Combination
): { rank: Rank; suit: Suit } | null {
  const stable = getStableJokerPlacement(combo);
  if (stable) return stable.represents;

  const sequence = determineTierceSequence(combo);
  if (combo.type === 'tierce' && sequence) {
    const jokerPos = sequence.find(s => s.isJoker);
    if (!jokerPos) return null;
    
    const nonJokers = getNonJokerCards(combo.cards);
    const suit = nonJokers[0]?.suit;
    if (!suit) return null;
    
    return { rank: positionToRank(jokerPos.position), suit };
  }
  
  if (combo.type === 'carre') {
    const nonJokers = getNonJokerCards(combo.cards);
    if (nonJokers.length === 0) return null;
    
    const rank = nonJokers[0].rank;
    const usedSuits = new Set(nonJokers.map(c => c.suit));
    if (SUITS.filter(suit => !usedSuits.has(suit)).length !== 1) return null;
    const missingSuit = SUITS.find(s => !usedSuits.has(s));
    
    if (!missingSuit) return null;
    return { rank, suit: missingSuit };
  }
  
  return null;
}

// ---- Aggregate opening values (shared by the engine and the UI display) ----

/** VIERGE of a set of combinations: 0 for any combination holding a Joker. */
export function calculateVierge(combos: Combination[]): number {
  return combos.reduce((sum, combo) => sum + calculateCombinationValue(combo).vierge, 0);
}

/** VALEUR TOTALE of a set of combinations: Jokers count for the card they represent. */
export function calculateTotal(combos: Combination[]): number {
  return combos.reduce((sum, combo) => sum + calculateCombinationValue(combo).total, 0);
}

// ---- Turn order (driven by the seats around the table) ----

/**
 * Turn order is derived from the physical seats, never from a player id, a
 * player number, an array index or a creation order. When no explicit seat is
 * available we fall back to the canonical seat of that index, which is the
 * very same rotation: SUD → EST → NORD-EST → NORD-OUEST → OUEST → SUD.
 */
export function getNextPlayerIndex(currentIndex: number, playerCount: number): number {
  const order = SEAT_ORDER[playerCount];
  if (!order || order.length === 0) return (currentIndex + 1) % Math.max(playerCount, 1);
  const currentSeat = order[currentIndex] ?? order[0];
  return order.indexOf(getNextSeat(currentSeat, playerCount));
}

export function getPreviousPlayerIndex(currentIndex: number, playerCount: number): number {
  const order = SEAT_ORDER[playerCount];
  if (!order || order.length === 0) return (currentIndex - 1 + playerCount) % Math.max(playerCount, 1);
  const currentSeat = order[currentIndex] ?? order[0];
  return order.indexOf(getPreviousSeat(currentSeat, playerCount));
}

// ---- Create Fault ----

export function createFault(
  playerId: string,
  type: FaultType,
  config: GameConfig,
  hasJokerOnly: boolean = false
): Fault {
  const penalty = type === 'playable_discard'
    ? config.playableDiscardPenalty
    : type === 'carre_not_recovered'
      ? config.carreNotRecoveredPenalty
      : hasJokerOnly
        ? config.faulteJokerPenalty
        : config.faultePenalty;
  const descriptions: Record<FaultType, string> = {
    invalid_combination: 'Combinaison invalide',
    wrong_point_calculation: 'Mauvais calcul de points',
    below_suite: 'TOTAL de l’ouverture sous la SUITE',
    insufficient_vierge: 'VIERGE finale insuffisante',
    forgot_discard: 'Oubli de défausse',
    illegal_joker_use: 'Utilisation interdite d\'un Joker',
    bad_joker_recovery: 'Mauvaise récupération de Joker',
    playable_discard: 'Défausse jouable après ouverture',
    carre_not_recovered: 'Carré non récupéré',
    opened_without_tierce: 'Ouverture sans tierce (tierce obligatoire)',
    other_violation: 'Autre violation des règles',
  };

  return {
    playerId,
    type,
    penalty,
    description: descriptions[type],
  };
}

/** Natural runs display ascending; any Joker preserves the physical prepared order. */
export function getCombinationDisplayCards(combo: Combination): GameCard[] {
  if (combo.type !== 'tierce' || getJokerCount(combo.cards) > 0) return [...combo.cards];
  const sequence = determineTierceSequence(combo);
  if (!sequence) return [...combo.cards];
  return [...sequence].sort((a, b) => a.position - b.position).map(item => item.card!);
}

/** HUD values share the engine's fixed VIERGE and latest committed opening total. */
export function getOpeningHudValues(state: GameState, playerId: string) {
  const draft = state.turnState?.playerId === playerId ? state.turnState.temporaryCombinations : [];
  return { vierge: state.initialThreshold, suite: state.suite,
    total: draft.length ? calculateTotal(draft) : state.lastOpeningTotal ?? 0,
    isDraft: draft.length > 0 };
}

export type JokerExtensionSide = 'higher' | 'lower';
export interface JokerExtensionChoice {
  side: JokerExtensionSide;
  rank: Rank | null;
  suit?: Suit;
  valid: boolean;
  error?: string;
  combination?: Combination;
}
/** Enumerate both legal ends without touching the source meld or the Joker. */
export function getJokerExtensionChoices(combo: Combination, joker: GameCard): JokerExtensionChoice[] {
  const sequence = determineTierceSequence(combo);
  const naturals = getNonJokerCards(combo.cards);
  const suit = naturals[0]?.suit;
  const positions = sequence?.map(p => p.position) ?? [];
  // Public natural runs are displayed descending. Freeze that order before adding the Joker.
  const ordered = sequence ? [...sequence].sort((a,b)=>b.position-a.position).map(p=>p.card!) : combo.cards;
  return (['higher', 'lower'] as const).map(side => {
    const position = side === 'higher' ? Math.max(...positions) + 1 : Math.min(...positions) - 1;
    const rank = position >= 1 && position <= 14 ? positionToRank(position) : null;
    const base = {side, rank, suit, valid:false};
    if (combo.type !== 'tierce' || !joker.isJoker || !validateCombination(combo).valid || !positions.length)
      return {...base,error:'La combinaison ciblée ne permet pas cette extension.'};
    if (getJokerCount(combo.cards)) return {...base,error:'Cette suite contient déjà un Joker.'};
    if (!rank || combo.cards.length >= 13) return {...base,error:'Extension interdite à cette extrémité de la suite.'};
    const cards = side === 'higher' ? [joker,...ordered] : [...ordered,joker];
    const placement = resolveJokerPlacement(cards,'tierce');
    if (!placement || placement.represents.rank !== rank) return {...base,error:'Orientation de l’As incompatible.'};
    const candidate = applyJokerPlacement({...combo,cards,jokerPlacement:placement});
    const validation = validateCombination(candidate);
    return {...base, valid:validation.valid, error:validation.error, combination:validation.valid?candidate:undefined};
  });
}
