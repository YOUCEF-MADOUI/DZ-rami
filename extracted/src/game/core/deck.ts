// =====================================================
// DECK - Card creation, shuffling, dealing
// =====================================================
import { Card, GameCard, JokerCard, Rank, Suit, RANKS, SUITS } from './types';

export function createDeck(): GameCard[] {
  const cards: GameCard[] = [];
  
  // Two packs of 52 cards
  for (const pack of [1, 2] as const) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const card: Card = {
          id: `${suit[0]}-${rank}-${pack}`,
          rank,
          suit,
          pack,
          isJoker: false,
        };
        cards.push(card);
      }
    }
  }
  
  // 4 Jokers
  for (let i = 1; i <= 4; i++) {
    const joker: JokerCard = {
      id: `joker-${i}`,
      isJoker: true,
      jokerIndex: i as 1 | 2 | 3 | 4,
    };
    cards.push(joker);
  }
  
  return cards; // Total: 108 cards
}

export function shuffleDeck(deck: GameCard[], rng?: () => number): GameCard[] {
  const shuffled = [...deck];
  const random = rng || Math.random;
  
  // Fisher-Yates shuffle
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

export function dealCards(
  deck: GameCard[],
  playerCount: number,
  firstPlayerIndex: number
): { hands: GameCard[][]; remainingDeck: GameCard[] } {
  const hands: GameCard[][] = Array.from({ length: playerCount }, () => []);
  let deckCopy = [...deck];
  
  // First player gets 15 cards, others get 14
  for (let i = 0; i < playerCount; i++) {
    // Anti-clockwise order from first player
    const playerIdx = (firstPlayerIndex + (playerCount - i)) % playerCount;
    // Actually, let's deal starting from first player going anti-clockwise
    // In anti-clockwise: firstPlayer, then firstPlayer-1, etc.
    const actualIdx = (firstPlayerIndex - i + playerCount) % playerCount;
    const cardCount = actualIdx === firstPlayerIndex ? 15 : 14;
    
    hands[actualIdx] = deckCopy.splice(0, cardCount);
  }
  
  return { hands, remainingDeck: deckCopy };
}

// Simpler dealing: first player = 15, rest = 14, deal in order
export function dealCardsSimple(
  deck: GameCard[],
  playerCount: number,
  firstPlayerIndex: number
): { hands: GameCard[][]; remainingDeck: GameCard[] } {
  const hands: GameCard[][] = Array.from({ length: playerCount }, () => []);
  let cardIndex = 0;
  
  // Deal to each player
  for (let p = 0; p < playerCount; p++) {
    // Anti-clockwise from first player
    const playerIdx = (firstPlayerIndex - p + playerCount) % playerCount;
    const cardCount = playerIdx === firstPlayerIndex ? 15 : 14;
    
    for (let c = 0; c < cardCount; c++) {
      if (cardIndex < deck.length) {
        hands[playerIdx].push(deck[cardIndex]);
        cardIndex++;
      }
    }
  }
  
  return { hands, remainingDeck: deck.slice(cardIndex) };
}

export function drawFromDeck(deck: GameCard[]): { card: GameCard; remainingDeck: GameCard[] } | null {
  if (deck.length === 0) return null;
  const [card, ...remaining] = deck;
  return { card, remainingDeck: remaining };
}

// Create tirage cards for determining first player
export function createTirageCards(playerCount: number): Card[] {
  const tirageRanks: Rank[] = ['A', 'K', 'Q', 'J', '10'];
  const selected = tirageRanks.slice(0, playerCount);
  
  return selected.map((rank, i) => ({
    id: `tirage-${rank}`,
    rank,
    suit: 'spades' as Suit, // Suit doesn't matter for tirage
    pack: 1 as const,
    isJoker: false as const,
  }));
}

export function performTirage(playerCount: number, rng?: () => number): number[] {
  const cards = createTirageCards(playerCount);
  const shuffled = shuffleDeck(cards, rng) as Card[];
  
  // Return indices sorted by tirage value (A is highest)
  const tirageValues: Record<Rank, number> = {
    'A': 5, 'K': 4, 'Q': 3, 'J': 2, '10': 1,
    '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0,
  };
  
  // Each player gets one card; the one with highest value goes first
  // Returns seat order: index 0 = first player seat, etc.
  const playerCards = shuffled.map((card, idx) => ({
    playerIndex: idx,
    rank: card.rank,
    value: tirageValues[card.rank],
  }));
  
  // Sort by value descending - highest goes first
  playerCards.sort((a, b) => b.value - a.value);
  
  // Return the order: first element is the first player
  return playerCards.map(pc => pc.playerIndex);
}
