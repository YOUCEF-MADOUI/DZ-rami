import { isDiscardPlayable, isTeamMode, teamOfPlayer } from '../core/team-rules';
import { findHardPlan, futurePotential } from './hard-planner';
// =====================================================
// AI PLAYER - Decision Engine for Computer Players
// =====================================================
import {
  GameState, GameCard, Player, Combination, Card,
  Rank, Suit, RANK_ORDER, SUITS, RANKS,
  getCardValue, INITIAL_THRESHOLDS,
} from '../core/types';
import {
  validateCombination, detectCombinationType,
  canAddToCombination, canRecoverJoker,
  getJokerCount, getNonJokerCards,
  isCardPlayableOnTable, determineJokerRepresentation,
} from '../core/validation';
import {
  drawCard, chopCard, placeCombination,
  addToCombination, recoverJoker, discard,
  getAvailableActions, canChop, rejectChop, takeBackCombinations, validateOpening,
  returnCarreToBase, hasPlayedMandatoryChopCard,
} from '../core/engine';

export interface AIDecision {
  jokerExtension?: import('../core/validation').JokerExtensionSide;
  action: 'draw' | 'chop' | 'place' | 'add' | 'recover_joker' | 'return_carre' | 'discard';
  cardId?: string;
  cardIds?: string[];
  combinationId?: string;
  combinationType?: 'tierce' | 'carre';
  faceDown?: boolean;
}

export function makeAIDecision(state: GameState): AIDecision[] {
  const currentPlayer = state.players[state.currentPlayerIndex];
  const decisions: AIDecision[] = [];

  if (!state.turnState) return decisions;

  const phase = state.turnState.phase;

  if (phase === 'must_draw') {
    // Decide whether to draw or chop
    const chopDecision = shouldChop(state, currentPlayer);
    if (chopDecision) {
      decisions.push({ action: 'chop' });
    } else {
      decisions.push({ action: 'draw' });
    }
    return decisions;
  }

  if (phase === 'playing') {
    // Try to play cards
    const playDecisions = planPlay(state, currentPlayer);
    decisions.push(...playDecisions);

    // Always end with discard
    const discardDecision = chooseDiscard(state, currentPlayer);
    decisions.push(discardDecision);
    return decisions;
  }

  return decisions;
}

function shouldChop(state: GameState, player: Player): boolean {
  if (!canChop(state)) return false;

  const chopCardValue = state.discardPile[state.discardPile.length - 1];
  if (!chopCardValue) return false;

  if (state.config.chopSeulementOuverture && player.status === 'not_opened') {
    const testHand = [...player.hand, chopCardValue];
    if (!findBestCombinations(testHand, state).canOpen) return false;
  }

  // Avoid taking a card under the independent "CHOP card must be played"
  // setting unless a legal combination/addition can actually use it.
  if (
    state.config.chopCarteObligatoireAJouer &&
    !canUseCardInCombination(state, player, chopCardValue)
  ) return false;

  const helpfulness = evaluateCardForHand(chopCardValue, player.hand, state);
  const malusRisk = player.status === 'not_opened'
    ? state.config.malusChopOuverture
    : (state.config.malusChopJoueurOuvertActif ? state.config.malusChopJoueurOuvert : 0);
  const difficulty = state.config.aiDifficulty ?? 'normal';
  const usefulnessThreshold = difficulty === 'easy' ? 65 : difficulty === 'hard' ? 30 : 50;
  const lowMalusThreshold = difficulty === 'easy' ? 0 : 10;

  if (helpfulness >= usefulnessThreshold) return true;
  if (helpfulness > 20 && malusRisk <= lowMalusThreshold) return true;
  if (player.status === 'not_opened') {
    return findBestCombinations([...player.hand, chopCardValue], state).canOpen;
  }
  return false;
}

function canUseCardInCombination(state: GameState, player: Player, target: GameCard): boolean {
  const available = getAvailableActions(state);
  if (available.possibleAdditions.some(action => action.cardId === target.id)) return true;

  const others = player.hand.filter(card => card.id !== target.id);
  const choose = (start: number, needed: number, picked: GameCard[]): boolean => {
    if (needed === 0) return detectCombinationType([...picked, target]) !== null;
    for (let i = start; i <= others.length - needed; i++) {
      picked.push(others[i]);
      if (choose(i + 1, needed - 1, picked)) return true;
      picked.pop();
    }
    return false;
  };
  for (let size = 2; size <= Math.min(4, others.length); size++) {
    if (choose(0, size, [])) return true;
  }
  return false;
}

function evaluateCardForHand(card: GameCard, hand: GameCard[], state: GameState): number {
  if (card.isJoker) return 80; // Jokers are very valuable

  let score = 0;
  const c = card as Card;

  // Check if it completes a pair to brelan
  const sameRank = hand.filter(h => !h.isJoker && (h as Card).rank === c.rank);
  if (sameRank.length >= 2) score += 60;
  else if (sameRank.length >= 1) score += 30;

  // Check if it extends a sequence
  const sameSuit = hand.filter(h => !h.isJoker && (h as Card).suit === c.suit);
  const positions = sameSuit.map(h => RANK_ORDER[(h as Card).rank]);
  const cardPos = RANK_ORDER[c.rank];

  for (const pos of positions) {
    if (Math.abs(pos - cardPos) === 1) score += 25;
    if (Math.abs(pos - cardPos) === 2) score += 10;
  }

  return score;
}

interface CombinationPlan {
  combos: { cards: GameCard[]; type: 'tierce' | 'carre' }[];
  canOpen: boolean;
}

function findBestCombinations(hand: GameCard[], state: GameState): CombinationPlan {
  if(state.config.aiDifficulty==='hard'){
    const plan=findHardPlan(hand,state);
    if(plan)return plan;
  }
  const nonJokers = getNonJokerCards(hand);
  const jokers = hand.filter(c => c.isJoker);
  const combos: { cards: GameCard[]; type: 'tierce' | 'carre' }[] = [];
  const usedCardIds = new Set<string>();

  // Find carres/brelans first
  const byRank = new Map<Rank, Card[]>();
  for (const c of nonJokers) {
    const existing = byRank.get(c.rank) || [];
    existing.push(c);
    byRank.set(c.rank, existing);
  }

  for (const [rank, cards] of byRank) {
    // Only unique suits
    const uniqueSuits = new Map<Suit, Card>();
    for (const c of cards) {
      if (!uniqueSuits.has(c.suit) && !usedCardIds.has(c.id)) {
        uniqueSuits.set(c.suit, c);
      }
    }
    
    const uniqueCards = Array.from(uniqueSuits.values());
    if (uniqueCards.length >= 3) {
      const comboCards = uniqueCards.slice(0, 4);
      combos.push({ cards: comboCards, type: 'carre' });
      comboCards.forEach(c => usedCardIds.add(c.id));
    }
  }

  // Find tierces
  const bySuit = new Map<Suit, Card[]>();
  for (const c of nonJokers) {
    if (usedCardIds.has(c.id)) continue;
    const existing = bySuit.get(c.suit) || [];
    existing.push(c);
    bySuit.set(c.suit, existing);
  }

  for (const [suit, cards] of bySuit) {
    const sorted = [...cards].sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
    
    // Find consecutive sequences
    let sequence: Card[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prevPos = RANK_ORDER[sorted[i - 1].rank];
      const currPos = RANK_ORDER[sorted[i].rank];
      
      if (currPos === prevPos + 1) {
        sequence.push(sorted[i]);
      } else {
        if (sequence.length >= 3) {
          const comboCards = sequence.slice(0, 5);
          combos.push({ cards: comboCards, type: 'tierce' });
          comboCards.forEach(c => usedCardIds.add(c.id));
        }
        sequence = [sorted[i]];
      }
    }
    
    if (sequence.length >= 3) {
      const comboCards = sequence.slice(0, 5);
      combos.push({ cards: comboCards, type: 'tierce' });
      comboCards.forEach(c => usedCardIds.add(c.id));
    }

    // Try Ace-high sequences (Q-K-A)
    const aceCards = cards.filter(c => c.rank === 'A' && !usedCardIds.has(c.id));
    const kCards = cards.filter(c => c.rank === 'K' && !usedCardIds.has(c.id));
    const qCards = cards.filter(c => c.rank === 'Q' && !usedCardIds.has(c.id));
    
    if (aceCards.length > 0 && kCards.length > 0 && qCards.length > 0) {
      const comboCards = [qCards[0], kCards[0], aceCards[0]];
      combos.push({ cards: comboCards, type: 'tierce' });
      comboCards.forEach(c => usedCardIds.add(c.id));
    }
  }

  // Try adding jokers to near-complete combinations
  let jokerIdx = 0;
  if (jokers.length > 0) {
    // Find pairs that could become brelans with a joker
    for (const [rank, cards] of byRank) {
      if (jokerIdx >= jokers.length) break;
      const unusedCards = cards.filter(c => !usedCardIds.has(c.id));
      const uniqueSuits = new Map<Suit, Card>();
      for (const c of unusedCards) {
        if (!uniqueSuits.has(c.suit)) uniqueSuits.set(c.suit, c);
      }
      const unique = Array.from(uniqueSuits.values());
      if (unique.length === 2) {
        combos.push({ cards: [...unique, jokers[jokerIdx]], type: 'carre' });
        unique.forEach(c => usedCardIds.add(c.id));
        jokerIdx++;
      }
    }

    // Test all natural-card pairs against the same validator used by the engine.
    // This includes A-K-Joker, where the Joker represents Q in Q-K-A.
    for (const [, cards] of bySuit) {
      if (jokerIdx >= jokers.length) break;
      const unused = cards.filter(c => !usedCardIds.has(c.id));
      let selectedPair: Card[] | null = null;
      for (let i = 0; i < unused.length && !selectedPair; i++) {
        for (let j = i + 1; j < unused.length; j++) {
          const candidate = [unused[i], unused[j], jokers[jokerIdx]];
          if (detectCombinationType(candidate) === 'tierce') {
            selectedPair = [unused[i], unused[j]];
            break;
          }
        }
      }
      if (selectedPair && jokerIdx < jokers.length) {
        combos.push({ cards: [...selectedPair, jokers[jokerIdx]], type: 'tierce' });
        selectedPair.forEach(card => usedCardIds.add(card.id));
        jokerIdx++;
      }
      if (jokerIdx >= jokers.length) break;
    }
  }

  // Build the exact combination objects and use the engine's first-pose
  // validator for threshold, Joker/Vierge and mandatory-tierce decisions.
  const engineCombinations: Combination[] = combos.map((combo, index) => {
    const result: Combination = {
      id: `ai-plan-${index}`,
      type: combo.type,
      cards: combo.cards,
      ownerId: state.players[state.currentPlayerIndex].id,
    };
    const representation = determineJokerRepresentation(result);
    if (representation) result.jokerRepresents = representation;
    return result;
  });
  const remainingHand = hand.filter(card => !usedCardIds.has(card.id));
  const openingValidation = validateOpening(
    state,
    state.players[state.currentPlayerIndex].id,
    engineCombinations,
    remainingHand,
  );

  return { combos, canOpen: openingValidation.valid };
}

function planPlay(state: GameState, player: Player): AIDecision[] {
  const decisions: AIDecision[] = [];
  const actions = getAvailableActions(state);

  // If player is not opened, try to open
  if (player.status === 'not_opened') {
    const plan = findBestCombinations(player.hand, state);
    
    if (plan.canOpen) {
      for (const combo of plan.combos) {
        decisions.push({
          action: 'place',
          cardIds: combo.cards.map(c => c.id),
          combinationType: combo.type,
        });
      }
    }
    return decisions;
  }

  // Player is already opened - try to play cards
  // Try to add cards to existing combinations
  const additions=isTeamMode(state.config)?[...actions.possibleAdditions].sort((a,b)=>{
    const ownTeam=teamOfPlayer(state,player.id);
    const owner=(id:string)=>state.tableCombinations.find(c=>c.id===id)?.ownerId;
    return Number(teamOfPlayer(state,owner(b.combinationId)??'')===ownTeam)-Number(teamOfPlayer(state,owner(a.combinationId)??'')===ownTeam);
  }):actions.possibleAdditions;
  for (const addition of additions) {
    decisions.push({
      action: 'add',
      cardId: addition.cardId,
      combinationId: addition.combinationId,
      jokerExtension: addition.jokerExtension,
    });
  }

  // First use the combinations currently available in hand. Recover at most
  // one Joker at a time; the executor replans its reuse before ending the turn.
  const plan = findBestCombinations(player.hand, state);
  for (const combo of plan.combos) {
    decisions.push({
      action: 'place',
      cardIds: combo.cards.map(c => c.id),
      combinationType: combo.type,
    });
  }
  const recovery = actions.possibleJokerRecoveries[0];
  if (recovery) {
    decisions.push({
      action: 'recover_joker',
      cardId: recovery.replacementCardId,
      cardIds: recovery.replacementCardIds,
      combinationId: recovery.combinationId,
    });
  }

  // A true carré (never a brelan, never a carré holding a Joker) can be sent
  // back into the base by the player responsible for it.
  for (const combinationId of actions.returnableCarreIds) {
    decisions.push({ action: 'return_carre', combinationId });
  }

  return decisions;
}

function chooseDiscard(state: GameState, player: Player): AIDecision {
  const hand = [...player.hand];
  
  if (hand.length === 0) {
    return { action: 'discard', cardId: '', faceDown: true };
  }

  const openingThisTurn=isTeamMode(state.config)&&player.status==='not_opened'&&validateOpening(state,player.id,state.turnState?.temporaryCombinations??[]).valid;
  // Score each card for discard
  let bestDiscard: GameCard = hand[0];
  let bestScore = -Infinity;

  for (const card of hand) {
    let score = 0;

    // Prefer discarding cards that don't help
    if (card.isJoker) {
      // Never discard joker if possible
      score -= 1000;

      // Unless it's the last card (RJ)
      if (hand.length === 1) {
        return { action: 'discard', cardId: card.id, faceDown: false };
      }
    } else {
      const c = card as Card;
      
      // Check if card is playable on table (would be a fault)
      if (player.status === 'opened' || openingThisTurn) {
        if (isDiscardPlayable(state,player.id,card,[...state.tableCombinations,...(state.turnState?.temporaryCombinations??[])])) {
          score -= 500; // Don't discard playable cards
        }
      }
      
      // Prefer discarding high-value cards that are isolated
      const sameRank = hand.filter(h => !h.isJoker && (h as Card).rank === c.rank && h.id !== card.id);
      const sameSuit = hand.filter(h => !h.isJoker && (h as Card).suit === c.suit && h.id !== card.id);
      
      // If card has no pairs/sequences, it's a good discard
      if (sameRank.length === 0) score += 30;
      
      // If card is isolated in suit, discard it
      const nearBySuit = sameSuit.filter(h => {
        const pos1 = RANK_ORDER[(h as Card).rank];
        const pos2 = RANK_ORDER[c.rank];
        return Math.abs(pos1 - pos2) <= 2;
      });
      if (nearBySuit.length === 0) score += 20;

      // Prefer discarding lower value cards to minimize opponent risk
      const value = getCardValue(c, 'high');
      score += (11 - value); // Lower value = better to discard
      
      // Consider risk of giving opponent a chop opportunity
      // High cards are more likely to help opponents
      score -= value * 2;
    }

    if(state.config.aiDifficulty==='hard') score += futurePotential(hand.filter(c=>c.id!==card.id))*3;
    if (score > bestScore) {
      bestScore = score;
      bestDiscard = card;
    }
  }

  const faceDown = !bestDiscard.isJoker || hand.length > 1;
  return {
    action: 'discard',
    cardId: bestDiscard.id,
    faceDown: bestDiscard.isJoker ? false : true,
  };
}

// Guarantees the AI ends its turn: performs a discard that changes the state
// (i.e. actually advances to the next player). Falls back safely so the game
// can never get stuck on an AI turn — including when an attempted opening below
// the SUITE is rejected by the engine.
function aiDiscardAndAdvance(inputState: GameState, meIndex: number): GameState {
  let state = inputState;
  const tryDiscard = (candidate: GameState): GameState | null => {
    const me = candidate.players[meIndex];
    if (me.hand.length === 0) return null;

    const recoveredUnplayed = candidate.turnState?.recoveredJokers.find(jokerId =>
      me.hand.some(card => card.id === jokerId) &&
      !candidate.turnState!.reusedJokers.includes(jokerId) &&
      !candidate.tableCombinations.some(combo =>
        validateCombination(combo).valid && combo.cards.some(card => card.id === jokerId)
      )
    );
    const choice = recoveredUnplayed
      ? { action: 'discard' as const, cardId: recoveredUnplayed, faceDown: false }
      : chooseDiscard(candidate, me);
    const cardId = choice.cardId || me.hand[me.hand.length - 1].id;
    const next = discard(candidate, cardId, choice.faceDown ?? true);
    return next.currentPlayerIndex !== candidate.currentPlayerIndex || next.phase !== 'playing'
      ? next
      : null;
  };

  let result = tryDiscard(state);
  if (result) return result;

  // Roll back a provisional first pose before considering a CHOP undo.
  const rolledBack = takeBackCombinations(state);
  if (rolledBack !== state) {
    state = rolledBack;
    result = tryDiscard(state);
    if (result) return result;
  }

  // A failed mandatory-card/opening plan may still cancel the untouched CHOP.
  // Then draw from the deck and let the normal AI planner retry from a legal state.
  if (state.turnState?.drawSource === 'chop') {
    const afterReject = rejectChop(state);
    if (afterReject !== state) {
      const afterDraw = drawCard(afterReject);
      if (afterDraw.phase !== 'playing' || afterDraw.currentPlayerIndex !== meIndex) return afterDraw;
      if (afterDraw.turnState?.phase === 'playing' && afterDraw.turnState.drawSource === 'deck') {
        return executeAITurn(afterDraw);
      }
      return afterDraw;
    }
  }

  result = tryDiscard(state);
  if (result) return result;

  // The engine is the final authority. Never bypass a rejected rule with a
  // direct state mutation or a forced penalty; a valid normal turn always has
  // at least one card available for this last discard attempt.
  const me = state.players[meIndex];
  if (me.hand.length > 0) {
    const forced = discard(state, me.hand[0].id, !me.hand[0].isJoker);
    if (forced.currentPlayerIndex !== state.currentPlayerIndex || forced.phase !== 'playing') return forced;
  }
  return state;
}

export function executeAITurn(state: GameState): GameState {
  if (!state.turnState) return state;
  let currentState = state;
  const meIndex = currentState.currentPlayerIndex;

  // ── Phase 1: draw or chop ──
  if (currentState.turnState?.phase === 'must_draw') {
    const me = currentState.players[meIndex];
    const wantsChop = shouldChop(currentState, me);
    currentState = wantsChop ? chopCard(currentState) : drawCard(currentState);

    // If drawing/chopping didn't move us into the playing phase (e.g. null round
    // after reshuffle, or the round ended), stop here — the state already moved on.
    if (currentState.phase !== 'playing') return currentState;
    if (currentState.currentPlayerIndex !== meIndex) return currentState;
    if (currentState.turnState?.phase !== 'playing') {
      // Could not draw for some reason: force-advance via a safe discard.
      return aiDiscardAndAdvance(currentState, meIndex);
    }
  }

  // ── Phase 2: place / add / recover (always keep ≥1 card for the discard) ──
  const playDecisions = planPlay(currentState, currentState.players[meIndex]);
  const mandatoryChopCardId = currentState.turnState?.mandatoryChopCardId;
  const decisionUsesMandatoryCard = (decision: AIDecision) => Boolean(mandatoryChopCardId && (
    (decision.action === 'place' && decision.cardIds?.includes(mandatoryChopCardId)) ||
    ((decision.action === 'add' || decision.action === 'recover_joker') && decision.cardId === mandatoryChopCardId)
  ));
  const planUsesMandatoryCard = mandatoryChopCardId && playDecisions.some(decisionUsesMandatoryCard);
  if (mandatoryChopCardId && !planUsesMandatoryCard) {
    // Do not make unrelated table mutations and then discover at discard time
    // that the mandatory CHOP card was not used. Cancel first, then draw normally.
    const afterReject = rejectChop(currentState);
    if (afterReject !== currentState) {
      const afterDraw = drawCard(afterReject);
      if (afterDraw.phase !== 'playing' || afterDraw.currentPlayerIndex !== meIndex) return afterDraw;
      return afterDraw.turnState?.phase === 'playing' ? executeAITurn(afterDraw) : afterDraw;
    }
  }

  const orderedPlayDecisions = mandatoryChopCardId
    ? [...playDecisions].sort((a, b) => Number(decisionUsesMandatoryCard(b)) - Number(decisionUsesMandatoryCard(a)))
    : playDecisions;
  for (const pd of orderedPlayDecisions) {
    const handLen = currentState.players[meIndex].hand.length;
    switch (pd.action) {
      case 'place':
        // Placing must leave at least one card to discard.
        if (pd.cardIds && pd.combinationType && handLen - pd.cardIds.length >= 1) {
          currentState = placeCombination(currentState, pd.cardIds, pd.combinationType);
        }
        break;
      case 'add':
        if (pd.cardId && pd.combinationId && handLen - 1 >= 1) {
          currentState = addToCombination(currentState, pd.cardId, pd.combinationId, pd.jokerExtension);
        }
        break;
      case 'recover_joker':
        if (pd.cardId && pd.combinationId) {
          currentState = recoverJoker(currentState, pd.combinationId, pd.cardIds ?? pd.cardId);
        }
        break;
      case 'return_carre':
        if (pd.combinationId) {
          currentState = returnCarreToBase(currentState, pd.combinationId);
        }
        break;
    }

    if (mandatoryChopCardId && decisionUsesMandatoryCard(pd)) {
      const mandatoryUsed = hasPlayedMandatoryChopCard(currentState);
      if (!mandatoryUsed) {
        const afterReject = rejectChop(currentState);
        if (afterReject === currentState) return currentState;
        const afterDraw = drawCard(afterReject);
        if (afterDraw.phase !== 'playing' || afterDraw.currentPlayerIndex !== meIndex) return afterDraw;
        return afterDraw.turnState?.phase === 'playing' ? executeAITurn(afterDraw) : afterDraw;
      }
    }
  }

  // Recovering a Joker changes the hand after the original plan was made. Re-run
  // the shared candidate/engine validation once so the recovered card can be
  // added to a table combo or reused in a new combination this same turn.
  const meAfterPlay = currentState.players[meIndex];
  const pendingRecoveredJoker = currentState.turnState?.recoveredJokers.find(jokerId =>
    meAfterPlay.hand.some(card => card.id === jokerId) &&
    !currentState.turnState!.reusedJokers.includes(jokerId)
  );
  if (pendingRecoveredJoker) {
    const possibleAddition = getAvailableActions(currentState).possibleAdditions.find(
      addition => addition.cardId === pendingRecoveredJoker
    );
    if (possibleAddition) {
      currentState = addToCombination(currentState, possibleAddition.cardId, possibleAddition.combinationId, possibleAddition.jokerExtension);
    } else {
      const refreshedPlan = findBestCombinations(meAfterPlay.hand, currentState);
      const reuseCombo = refreshedPlan.combos.find(combo =>
        combo.cards.some(card => card.id === pendingRecoveredJoker) &&
        meAfterPlay.hand.length - combo.cards.length >= 1
      );
      if (reuseCombo) {
        currentState = placeCombination(
          currentState,
          reuseCombo.cards.map(card => card.id),
          reuseCombo.type
        );
      }
    }
  }

  // ── Phase 3: guaranteed discard that advances the turn ──
  return aiDiscardAndAdvance(currentState, meIndex);
}
