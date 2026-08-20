// =====================================================
// RAMI ALGÉRIEN - CORE TYPES
// Based on rules from Bordj Bou Arréridj, Algeria
// =====================================================

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

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

export interface Combination {
  id: string;
  type: CombinationType;
  cards: GameCard[];          // Actual cards in the combination
  jokerPosition?: number;     // Index of the joker in the combination, if any
  jokerRepresents?: { rank: Rank; suit: Suit }; // What the joker represents
  ownerId: string;            // Player who first laid this combination
}

export type PlayerStatus = 'not_opened' | 'opened';

export interface Player {
  id: string;
  name: string;
  hand: GameCard[];
  status: PlayerStatus;
  isAI: boolean;
  seatIndex: number;          // Position at the table (0-based)
  score: number;              // Cumulative score across rounds
  roundScores: number[];      // Score per round
  openingValue?: number;      // Value of their opening play (VIERGE)
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

export interface TurnState {
  playerId: string;
  phase: TurnPhase;
  drawnCard?: GameCard;
  drawSource?: DrawSource;
  hasDrawn: boolean;
  hasDiscarded: boolean;
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
  | 'complete_carre';

export interface TurnAction {
  type: TurnActionType;
  playerId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export type RoundEndType = 'RS' | 'RJ' | 'null_round';

export interface RoundResult {
  winnerId?: string;
  endType: RoundEndType;
  scores: Record<string, number>;
  faults: Fault[];
}

export interface Fault {
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
  | 'other_violation';

export interface GameConfig {
  playerCount: 2 | 3 | 4 | 5;
  chopObligatoire: boolean;
  malusChopOuverture: number;       // Default: +50
  malusChopJoueurOuvert: number;    // Default: +10
  carreResponsable: 'detenteur' | 'completeur';  // Who handles completed carré
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
  carreResponsable: 'completeur',
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
  tableCombinations: Combination[];
  currentPlayerIndex: number;
  firstPlayerIndex: number;
  turnState: TurnState | null;
  suite: number;             // Current SUITE value
  initialThreshold: number;  // Based on player count
  roundNumber: number;
  cycleCount: number;        // Current draw cycle
  lastOpeningPlayerIndex: number | null; // For cycle reset tracking
  roundResults: RoundResult[];
  actionHistory: TurnAction[];
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
