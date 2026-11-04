// =====================================================
// RAMI ALGÉRIEN - CORE TYPES
// Based on rules from Bordj Bou Arréridj, Algeria
// =====================================================

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

/**
 * Physical places around the table. Turn order is derived from these
 * positions, never from a player id, a player number, an array index or the
 * order in which the players were created.
 */
export type TablePosition = 'south' | 'east' | 'north-east' | 'north' | 'north-west' | 'west';

/** Rotation of the seats, in playing order, for each supported table size. */
export const SEAT_ORDER: Record<number, readonly TablePosition[]> = {
  2: ['south', 'north'],
  3: ['south', 'north-east', 'north-west'],
  4: ['south', 'east', 'north', 'west'],
  5: ['south', 'east', 'north-east', 'north-west', 'west'],
};

export const SEAT_LABELS: Record<TablePosition, string> = {
  south: 'SUD',
  east: 'EST',
  'north-east': 'NORD-EST',
  north: 'NORD',
  'north-west': 'NORD-OUEST',
  west: 'OUEST',
};

export function getSeatOrder(playerCount: number): readonly TablePosition[] {
  return SEAT_ORDER[playerCount] ?? SEAT_ORDER[4];
}

/** The seat that plays immediately after `seat`, following the table rotation. */
export function getNextSeat(seat: TablePosition, playerCount: number): TablePosition {
  const order = getSeatOrder(playerCount);
  const at = order.indexOf(seat);
  if (at < 0) return order[0];
  return order[(at + 1) % order.length];
}

/** The seat that plays immediately before `seat` (the one whose discard you may CHOP). */
export function getPreviousSeat(seat: TablePosition, playerCount: number): TablePosition {
  const order = getSeatOrder(playerCount);
  const at = order.indexOf(seat);
  if (at < 0) return order[0];
  return order[(at - 1 + order.length) % order.length];
}

export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

export const SUIT_COLORS: Record<Suit, 'red' | 'black'> = {
  hearts: 'red',
  diamonds: 'red',
  clubs: 'black',
  spades: 'black',
};

export interface Card {
  id: string;         // Unique identifier (e.g., "h-A-1" for first pack, "h-A-2" for second)
  rank: Rank;
  suit: Suit;
  pack: 1 | 2;       // Which of the two packs this card comes from
  isJoker: false;
}

export interface JokerCard {
  id: string;         // e.g., "joker-1", "joker-2", "joker-3", "joker-4"
  isJoker: true;
  jokerIndex: 1 | 2 | 3 | 4;
}

export type GameCard = Card | JokerCard;

export type CombinationType = 'tierce' | 'carre';

/**
 * Explicit, stable Joker placement inside a combination.
 *
 * A Joker's position and represented card are DATA, never something a sort or
 * an auto-detection pass may silently recompute. It stays identical from the
 * hand draft through the transfer onto the table, and only an explicit game
 * action (recovering the Joker, extending the combination) may change it.
 */
export interface JokerPlacement {
  /** Identifier of the physical Joker card. */
  jokerId: string;
  /** Index of the Joker inside `Combination.cards`. */
  position: number;
  /** The exact natural card this Joker stands for at that position. */
  represents: { rank: Rank; suit: Suit };
}

export interface JokerRepresentation {
  jokerId: string;
  position: number;
  combinationType: CombinationType;
  candidates: { rank: Rank; suit: Suit }[];
  representation: { rank: Rank; suit: Suit } | null;
}

export interface Combination {
  jokerRepresentation?: JokerRepresentation;
  id: string;
  type: CombinationType;
  cards: GameCard[];          // Actual cards in the combination
  /** Explicit Joker placement (source of truth when a Joker is present). */
  jokerPlacement?: JokerPlacement;
  jokerPosition?: number;     // Derived index of the joker in the combination, if any
  jokerRepresents?: { rank: Rank; suit: Suit }; // What the joker represents
  ownerId: string;            // Player who first laid this combination
  completedById?: string;     // Player who made this a 4-card carré, if different from owner
}

/**
 * Precise classification of a meld. A brelan containing a Joker is NEVER a
 * carré: `K + K + Joker` stays `brelan_avec_joker`.
 */
export type CombinationClass =
  | 'brelan_naturel'
  | 'brelan_avec_joker'
  | 'carre_naturel'
  | 'tierce_naturelle'
  | 'tierce_avec_joker'
  | 'invalide';

export type PlayerStatus = 'not_opened' | 'opened';

export interface Player {
  id: string;
  name: string;
  hand: GameCard[];
  status: PlayerStatus;
  isAI: boolean;
  seat: TablePosition;        // Physical place at the table (drives turn order)
  score: number;              // Cumulative score across rounds
  roundScores: number[];      // Score per round
  /** Natural VIERGE score of their opening (joker combinations count 0). */
  openingValue?: number;
  /** TOTAL value of their opening, jokers counted as the card they represent. */
  openingTotal?: number;
  openingSuiteThreshold?: number;
  /** Fixed VIERGE threshold applied to the natural score of this opening. */
  openingThreshold?: number;
  hasChoppedThisRound: boolean;
  usedInitialThreshold: boolean; // Whether they used initial threshold (has joker in hand)
}

export type GamePhase = 
  | 'setup'           // Initial setup
  | 'drawing'         // Tirage to determine first player
  | 'dealing'         // Distributing cards
  | 'playing'         // Main game loop
  | 'round_end'       // Round finished
  | 'game_end';       // Game finished

export type TurnPhase = 
  | 'waiting'
  | 'must_draw'       // Player must draw or chop
  | 'chop_decision'   // Player is deciding whether to chop
  | 'playing'         // Player is arranging/placing cards
  | 'must_discard';   // Player must discard to end turn

export type DrawSource = 'deck' | 'chop';
export type AIDifficulty = 'easy' | 'normal' | 'hard';

export interface TurnState {
  playerId: string;
  phase: TurnPhase;
  drawnCard?: GameCard;
  drawSource?: DrawSource;
  hasDrawn: boolean;
  hasDiscarded: boolean;
  /** The dealt 15-card starter plays without drawing on this turn only. */
  isInitialDealTurn: boolean;
  /** A chopped card that must be included in a valid table combination this turn. */
  mandatoryChopCardId?: string;
  /** Whether the top discard could be CHOPped when this turn's draw choice began. */
  chopWasAvailableAtTurnStart: boolean;
  /** Set after an undone CHOP so mandatory-CHOP cannot trap the player. */
  chopRejectedThisTurn: boolean;
  /** Previous value restored if this CHOP is cancelled. */
  previousHasChoppedThisRound?: boolean;
  /** Identifies the malus fault created by this CHOP, so undo is transactional. */
  chopPenaltyFaultId?: string;
  actionsThisTurn: TurnAction[];
  recoveredJokers: string[];   // IDs of jokers recovered this turn
  reusedJokers: string[];      // IDs of jokers reused this turn
  temporaryCombinations: Combination[]; // Combinations being built during first pose
}

export type TurnActionType = 
  | 'draw'
  | 'chop'
  | 'place_combination'
  | 'add_to_combination'
  | 'recover_joker'
  | 'reuse_joker'
  | 'discard'
  | 'complete_carre'
  | 'report_fault';

export interface TurnAction {
  type: TurnActionType;
  playerId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/** Immutable evidence about the exact completed turn, kept for the next player's accusation window. */
export interface CompletedTurnActionSnapshot {
  readonly endType?: 'RS' | 'RJ';
  readonly id: string;
  readonly roundNumber: number;
  readonly playerId: string;
  readonly discardedCardId: string;
  readonly discardedCard: GameCard;
  readonly handBeforeDiscard?: readonly GameCard[];
  readonly tableBeforeDiscard?: readonly Combination[];
  readonly turnActions?: readonly TurnAction[];
  readonly wasOpenedBeforeDiscard: boolean;
  readonly wasDiscardPlayable: boolean;
  readonly openingTotal?: number;
  readonly openingSuiteThreshold?: number;
  readonly openingValue?: number;
  readonly openingThreshold?: number;
  readonly openingHadNaturalTierce: boolean;
  readonly invalidCombinationIds: readonly string[];
  readonly unrecoveredCarreResponsibleIds: readonly string[];
}

export type RoundEndType =
  | 'RS'            // A player went out normally
  | 'RJ'            // A player went out by discarding a visible Joker
  | 'null_round'    // Nobody opened: genuine draw, everyone at 0
  | 'cycles';       // Available draw cycles exhausted: remaining cards are counted

/** One accusation already filed, so the same completed action is never judged twice. */
export interface ReportRecord {
  accuserId: string;
  accusedId: string;
  snapshotId: string;
  faultType: FaultType;
  confirmed: boolean;
}

export interface ScoreBreakdownItem {
  label: string;
  points: number;
}

export interface RoundResult {
  /** Version of the team RS score policy used for this result. */
  teamScoreVersion?: number;
  /** `null` when nobody went out but the round still counts (cycles exhausted). */
  winnerId?: string | null;
  endType: RoundEndType;
  scores: Record<string, number>;
  /** Itemized rule-based score lines, keyed by player ID. */
  scoreBreakdown?: Record<string, ScoreBreakdownItem[]>;
  faults: Fault[];
}

export interface Fault {
  /** Optional stable identifier used to undo a provisional action's penalty. */
  id?: string;
  playerId: string;
  type: FaultType;
  penalty: number;
  description: string;
}

export type FaultType =
  | 'invalid_combination'
  | 'wrong_point_calculation'
  | 'below_suite'
  | 'insufficient_vierge'
  | 'forgot_discard'
  | 'illegal_joker_use'
  | 'bad_joker_recovery'
  | 'playable_discard'
  | 'carre_not_recovered'
  | 'opened_without_tierce'
  | 'other_violation';

export interface GameConfig {
  /** Missing means classic, for compatibility with existing saves. */
  variant?: 'classic' | 'teams';
  playerCount: 2 | 3 | 4 | 5;
  chopObligatoire: boolean;
  malusChopOuverture: number;       // Default: +50
  malusChopJoueurOuvert: number;    // Default: +10
  malusChopJoueurOuvertActif: boolean; // If false, no malus when an already-opened player chops
  chopSeulementOuverture: boolean;  // If true, a non-opened player who chops MUST open this turn (or cancel)
  chopCarteObligatoireAJouer: boolean; // If true, the chopped card must be played in a valid combination this turn
  carreResponsable: 'detenteur' | 'completeur';  // Who handles completed carré
  tierceObligatoire: boolean;       // If true, opening must include a natural tierce
  aiDifficulty: AIDifficulty;
  faultePenalty: number;            // Default: +100
  faulteJokerPenalty: number;       // Default: +200
  maxCycles: number;                // Default: 3
  rsScorePerCard: number;           // Default: +10
  rjScorePerCard: number;           // Default: +20
  rsNonOpenedPenalty: number;       // Default: +100
  rjNonOpenedPenalty: number;       // Default: +200
  carreNotRecoveredPenalty: number; // Default: +100
  playableDiscardPenalty: number;   // Default: +100
  targetScore?: number;             // Optional: end game when someone reaches this
}

export const DEFAULT_CONFIG: GameConfig = {
  playerCount: 4,
  chopObligatoire: false,
  malusChopOuverture: 50,
  malusChopJoueurOuvert: 10,
  malusChopJoueurOuvertActif: true,
  chopSeulementOuverture: false,
  chopCarteObligatoireAJouer: false,
  carreResponsable: 'completeur',
  tierceObligatoire: false,
  aiDifficulty: 'normal',
  faultePenalty: 100,
  faulteJokerPenalty: 200,
  maxCycles: 3,
  rsScorePerCard: 10,
  rjScorePerCard: 20,
  rsNonOpenedPenalty: 100,
  rjNonOpenedPenalty: 200,
  carreNotRecoveredPenalty: 100,
  playableDiscardPenalty: 100,
};

export const INITIAL_THRESHOLDS: Record<number, number> = {
  2: 111,
  3: 101,
  4: 91,
  5: 71,
};

export const RANK_ORDER: Record<Rank, number> = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5,
  '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13,
};

// For tirage (drawing for first player)
export const TIRAGE_RANKS: Rank[] = ['A', 'K', 'Q', 'J', '10'];
export const TIRAGE_VALUES: Record<string, number> = {
  'A': 5, 'K': 4, 'Q': 3, 'J': 2, '10': 1,
};

export interface GameState {
  config: GameConfig;
  phase: GamePhase;
  players: Player[];
  deck: GameCard[];
  discardPile: GameCard[];
  /** Carrés returned to reserve, available on the next deck recycle. */
  basePile: GameCard[];
  /** Chronological audit history only; never rendered as current physical discard. */
  discardHistory?: GameCard[];
  tableCombinations: Combination[];
  currentPlayerIndex: number;
  firstPlayerIndex: number;
  turnState: TurnState | null;
  /** Total of the latest successful opening, independent of later table additions. */
  lastOpeningTotal?: number;
  suite: number;             // Current SUITE value
  suiteLocked: boolean;      // True once at least one opening succeeded this round
  initialThreshold: number;  // Based on player count
  lastDiscardFaceDown: boolean; // Whether the final RS discard is hidden from the table view
  roundNumber: number;
  cycleCount: number;        // Current draw cycle
  lastOpeningPlayerIndex: number | null; // For cycle reset tracking
  roundResults: RoundResult[];
  actionHistory: TurnAction[];
  /** Most recent completed turn — kept for the UI and for the round recap. */
  lastCompletedTurnAction: CompletedTurnActionSnapshot | null;
  /** Last completed turn of EACH player: evidence for reporting any player at any time. */
  lastCompletedTurnActionsByPlayer: Record<string, CompletedTurnActionSnapshot>;
  /** Accusations already filed, so one completed action can only be judged once per accuser. */
  reports: ReportRecord[];
  faults: Fault[];
}

export function getCardDisplayName(card: GameCard): string {
  if (card.isJoker) {
    return `🃏${card.jokerIndex}`;
  }
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

export function getCardValue(card: Card, context: 'low' | 'high' | 'set'): number {
  if (card.rank === 'A') {
    if (context === 'low') return 1;   // A-2-3
    if (context === 'high') return 11; // A-K-Q
    if (context === 'set') return 11;  // In sets (brelan/carré)
  }
  if (['K', 'Q', 'J', '10'].includes(card.rank)) return 10;
  return RANK_ORDER[card.rank];
}

// Special set values for As
export function getSetValue(rank: Rank, count: number): number {
  if (rank === 'A') {
    if (count === 3) return 33;
    if (count === 4) return 44;
  }
  const baseValue = rank === 'A' ? 11 : getCardValue({ rank, suit: 'hearts', id: '', pack: 1, isJoker: false }, 'set');
  return baseValue * count;
}
