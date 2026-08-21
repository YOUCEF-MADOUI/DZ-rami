'use client';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { GameConfig, GameCard, Card, Combination, RANK_ORDER } from '@/game/core/types';
import { useGame } from '@/game/hooks/useGame';
import { detectCombinationType, canAddToCombination, determineTierceSequence } from '@/game/core/validation';
import { detectHandGroups, findGroupForCard, moveBlock } from '@/game/core/hand-groups';
import { REPORTABLE_FAULTS } from '@/game/core/engine';
import CardView from './CardView';
import ScoreBoard from './ScoreBoard';
import PlayerHand, { SortMode } from './PlayerHand';
interface Props { config: GameConfig; playerNames: string[]; onBack: () => void; }
const SUIT_ORDER: Record<string, number> = { spades: 0, hearts: 1, diamonds: 2, clubs: 3 };
function sortCards(cards: GameCard[], mode: SortMode): GameCard[] {
  const s = [...cards];
  if (mode === 'suit') s.sort((a, b) => {
    if (a.isJoker !== b.isJoker) return a.isJoker ? 1 : -1; if (a.isJoker) return 0;
    const ca = a as Card, cb = b as Card;
    const sd = SUIT_ORDER[ca.suit] - SUIT_ORDER[cb.suit];
    return sd !== 0 ? sd : RANK_ORDER[ca.rank] - RANK_ORDER[cb.rank];
  });
  else if (mode === 'rank') s.sort((a, b) => {
    if (a.isJoker && !b.isJoker) return -1; if (!a.isJoker && b.isJoker) return 1; if (a.isJoker) return 0;
    const ca = a as Card, cb = b as Card;
    const ra = ca.rank === 'A' ? 14 : RANK_ORDER[ca.rank], rb = cb.rank === 'A' ? 14 : RANK_ORDER[cb.rank];
    const rd = rb - ra; return rd !== 0 ? rd : SUIT_ORDER[ca.suit] - SUIT_ORDER[cb.suit];
  });
  return s;
}
function applyManualOrder(cards: GameCard[], order: string[]): GameCard[] {
  if (!order.length) return cards;
  const m = new Map(cards.map(c => [c.id, c]));
  const o = order.map(id => m.get(id)).filter((c): c is GameCard => !!c);
  const s = new Set(order); cards.forEach(c => { if (!s.has(c.id)) o.push(c); });
  return o;
}
function sortComboCards(combo: Combination): GameCard[] {
  if (combo.type === 'tierce') {
    const seq = determineTierceSequence(combo);
    if (seq) {
      const sorted = [...seq].sort((a, b) => b.position - a.position);
      return sorted.map(s => s.isJoker ? combo.cards.find(c => c.isJoker)! : s.card!);
    }
  }
  return combo.cards;
}

export default function GameScreen({ config, playerNames, onBack }: Props) {
  const { gameState, selectedCards, availableActions, actions } = useGame();
  const [showScores, setShowScores] = useState(false);
  const [message, setMessage] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('suit');
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [discardHover, setDiscardHover] = useState(false);
  const [comboHover, setComboHover] = useState<string | null>(null);
  const [comboHoverValid, setComboHoverValid] = useState(false);
  const [showDiscardPile, setShowDiscardPile] = useState(false);
  // Fault reporting: which AI player id is being accused (null = closed menu).
  const [faultTargetId, setFaultTargetId] = useState<string | null>(null);
  // User-defined LOCKED SETS: each is a list of card ids the player froze together
  // from a selection. A locked set moves/selects as one block; its cards (incl. a
  // joker) can't be pulled individually until the set is unlocked.
  const [lockedSets, setLockedSets] = useState<string[][]>([]);
  const dragCardRef = useRef<string | null>(null);
  useEffect(() => { actions.startGame(config, playerNames); }, []); // eslint-disable-line
  useEffect(() => {
    if (!gameState) return;
    if (gameState.phase === 'round_end') {
      const r = gameState.roundResults[gameState.roundResults.length - 1];
      if (r) setMessage(r.endType === 'null_round' ? 'Manche nulle' : `${gameState.players.find(p => p.id === r.winnerId)?.name} — ${r.endType} !`);
    }
  }, [gameState?.phase]); // eslint-disable-line
  useEffect(() => { if (message) { const t = setTimeout(() => setMessage(''), 5000); return () => clearTimeout(t); } }, [message]);
  const humanCards = gameState?.players[0]?.hand ?? [];
  // Drop cards from locked sets once they leave the hand; remove sets < 2 cards.
  useEffect(() => {
    const ids = new Set(humanCards.map(c => c.id));
    setLockedSets(prev => {
      const cleaned = prev.map(s => s.filter(id => ids.has(id))).filter(s => s.length >= 2);
      return cleaned.length === prev.length && cleaned.every((s, i) => s.length === prev[i].length) ? prev : cleaned;
    });
  }, [humanCards]);
  const orderedHand = useMemo(
    () => sortMode === 'manual' ? applyManualOrder(humanCards, manualOrder) : sortCards(humanCards, sortMode),
    [humanCards, sortMode, manualOrder]
  );
  // ── AUTO-DETECT GROUPS among adjacent cards ──
  const handGroups = useMemo(() => detectHandGroups(orderedHand), [orderedHand]);
  // Find the locked set (if any) that contains a given card id.
  const lockedSetForCard = useCallback((cardId: string): string[] | null =>
    lockedSets.find(s => s.includes(cardId)) ?? null, [lockedSets]);
  // Lock a list of cards together as a new set (shared by both flows).
  const lockCards = useCallback((ids: string[]) => {
    if (ids.length < 2) { setMessage('Sélectionnez au moins 2 cartes à verrouiller'); return; }
    setLockedSets(prev => {
      const cleaned = prev
        .map(s => s.filter(id => !ids.includes(id)))
        .filter(s => s.length >= 2);
      return [...cleaned, [...ids]];
    });
    actions.clearSelection();
    setMessage('🔒 Cartes verrouillées ensemble');
  }, [actions]);
  // Flow A — lock exactly the cards currently selected (one-by-one selection).
  const lockSelection = useCallback(() => lockCards(selectedCards), [lockCards, selectedCards]);
  // Flow B — lock a whole detected combo via its chevron.
  const lockGroup = useCallback((cardIds: string[]) => lockCards(cardIds), [lockCards]);
  // Unlock (remove) the set that contains this card.
  const unlockSet = useCallback((cardId: string) => {
    setLockedSets(prev => prev.filter(s => !s.includes(cardId)));
    actions.clearSelection();
  }, [actions]);
  const handleSortChange = useCallback((m: SortMode) => { setSortMode(m); setManualOrder([]); }, []);
  // ── Reorder: move a whole block (group or single card) ──
  const handleReorder = useCallback((blockIds: string[], toIndex: number) => {
    const ids = orderedHand.map(c => c.id);
    setManualOrder(moveBlock(ids, blockIds, toIndex));
    setSortMode('manual');
  }, [orderedHand]);
  // ── Select a whole group ──
  const handleSelectGroup = useCallback((cardIds: string[]) => {
    const allSelected = cardIds.every(id => selectedCards.includes(id));
    if (allSelected) {
      cardIds.forEach(id => actions.deselectCard(id));
    } else {
      // Clear then select the group
      actions.clearSelection();
      setTimeout(() => cardIds.forEach(id => actions.selectCard(id)), 0);
    }
  }, [selectedCards, actions]);
  const onCardDragStart = useCallback((cid: string) => { dragCardRef.current = cid; }, []);
  const onCardDragEnd = useCallback(() => { dragCardRef.current = null; setDiscardHover(false); setComboHover(null); }, []);
  const onTableDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); if (dragCardRef.current) setDiscardHover(true); }, []);
  const onTableDragLeave = useCallback(() => setDiscardHover(false), []);
  const onTableDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDiscardHover(false);
    const cid = dragCardRef.current; if (!cid) return;
    const c = humanCards.find(x => x.id === cid); if (!c) return;
    // Only discard single cards, not groups
    const g = findGroupForCard(handGroups, cid);
    if (g) { setMessage('Utilisez "Poser" pour une combinaison'); return; }
    actions.discardCard(cid, !c.isJoker);
  }, [humanCards, actions, handGroups]);
  const onComboDragOver = useCallback((e: React.DragEvent, combo: Combination) => {
    e.preventDefault(); e.stopPropagation();
    const cid = dragCardRef.current; if (!cid) return;
    const card = humanCards.find(c => c.id === cid);
    setComboHover(combo.id); setComboHoverValid(card ? canAddToCombination(combo, card) : false);
  }, [humanCards]);
  const onComboDragLeave = useCallback((e: React.DragEvent) => { e.stopPropagation(); setComboHover(null); }, []);
  const onComboDrop = useCallback((e: React.DragEvent, comboId: string) => {
    e.preventDefault(); e.stopPropagation(); setComboHover(null);
    const cid = dragCardRef.current; if (!cid) return;
    actions.addToCombo(cid, comboId);
  }, [actions]);
  if (!gameState) return <div className="h-full flex items-center justify-center bg-slate-900"><span className="text-amber-400 text-xl">Chargement...</span></div>;
  if (showScores) return <ScoreBoard gameState={gameState} onBack={() => setShowScores(false)} />;
  const cp = gameState.players[gameState.currentPlayerIndex];
  const hp = gameState.players[0];
  const isMyTurn = cp.id === hp.id;
  const phase = gameState.turnState?.phase || 'waiting';
  const canAct = isMyTurn && phase === 'playing';
  const hasDrawnCard = gameState.turnState?.drawnCard;
  const chopMustOpen = config.chopSeulementOuverture && gameState.turnState?.drawSource === 'chop' && hp.status !== 'opened';
  const selCards = selectedCards.map(id => hp.hand.find(c => c.id === id)).filter(Boolean) as GameCard[];
  const detectedType = selCards.length >= 3 ? detectCombinationType(selCards) : null;
  const handleAutoPlace = () => { if (!detectedType) { setMessage('Combinaison invalide'); return; } actions.place(selectedCards, detectedType); };
  const handleDiscard = () => {
    if (selectedCards.length !== 1) return;
    const c = hp.hand.find(x => x.id === selectedCards[0]); if (!c) return;
    actions.discardCard(selectedCards[0], !c.isJoker);
  };
  const visibleDiscard = gameState.discardPile.slice(-14);
  const renderCombo = (combo: Combination, interactive: boolean) => {
    const isHov = comboHover === combo.id;
    const border = isHov ? (comboHoverValid ? 'border-green-400 shadow-green-400/30 scale-[1.03]' : 'border-red-400 shadow-red-400/20') : 'border-white/10';
    return (
      <div key={combo.id}
        className={`inline-flex gap-0.5 p-1 rounded-lg border-2 bg-black/20 transition-all ${border} ${isHov ? 'shadow-lg' : ''}`}
        onDragOver={interactive ? (e) => onComboDragOver(e, combo) : undefined}
        onDragLeave={interactive ? onComboDragLeave : undefined}
        onDrop={interactive ? (e) => onComboDrop(e, combo.id) : undefined}>
        {sortComboCards(combo).map(c => <CardView key={c.id} card={c} small />)}
      </div>
    );
  };
  // AI players (everyone except the human at index 0), spread EVENLY across the
  // top edge with equal horizontal spacing so panels never overlap.
  const aiPlayers = gameState.players.slice(1);
  const renderAIPlayer = (aiPos: number, count: number) => {
    const foundIdx = aiPos + 1; // player index (skip the human)
    const p = gameState.players[foundIdx];
    const combos = gameState.tableCombinations.filter(c => c.ownerId === p.id);
    const isCur = foundIdx === gameState.currentPlayerIndex;
    const isDlr = foundIdx === gameState.firstPlayerIndex;
    // Evenly space the N panels: centers at (i+1)/(N+1) of the width.
    const leftPct = ((aiPos + 1) / (count + 1)) * 100;
    const widthCap = count >= 4 ? 'max-w-[19%]' : count === 3 ? 'max-w-[26%]' : 'max-w-[34%]';
    return (
      <div key={p.id}
        className={`absolute flex flex-col items-center gap-1 z-10 ${widthCap}`}
        style={{ top: 4, left: `${leftPct}%`, transform: 'translateX(-50%)' }}>
        <button
          onClick={() => canAct && setFaultTargetId(p.id)}
          title={canAct ? 'Cliquez pour signaler une faute' : undefined}
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 whitespace-nowrap transition-transform ${canAct ? 'hover:scale-105 cursor-pointer ring-1 ring-white/10' : 'cursor-default'} ${
          isCur ? 'bg-amber-500 text-white card-pulse' : p.status === 'opened' ? 'bg-green-900/60 text-green-400 border border-green-700' : 'bg-slate-800/80 text-slate-400'}`}>
          {isDlr && '🎴'} 🤖 {p.name} ({p.hand.length}) {p.status === 'opened' && '✓'} {canAct && <span className="text-red-300">⚠️</span>}
        </button>
        {combos.length > 0 && <div className="flex flex-wrap gap-1 justify-center">{combos.map(c => renderCombo(c, canAct))}</div>}
      </div>
    );
  };
  const humanCombos = gameState.tableCombinations.filter(c => c.ownerId === hp.id);
  return (
    <div className="h-full flex flex-col bg-slate-900 relative">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/90 border-b border-slate-700 z-20">
        <button onClick={onBack} className="text-amber-400 text-sm font-bold">← Menu</button>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-400">SUITE: <span className="text-amber-400 font-bold">{gameState.suite}</span></span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">R{gameState.roundNumber} · Pioche: <span className="text-amber-400 font-bold">{gameState.deck.length}</span></span>
        </div>
        <button onClick={() => setShowScores(true)} className="text-amber-400 text-sm font-bold">📊</button>
      </div>
      <div className="flex-1 relative overflow-hidden"
        onDragOver={canAct ? onTableDragOver : undefined}
        onDragLeave={canAct ? onTableDragLeave : undefined}
        onDrop={canAct ? onTableDrop : undefined}>
        <div className={`absolute inset-3 rounded-2xl border-4 transition-all ${discardHover ? 'border-amber-400 shadow-lg shadow-amber-400/20' : 'border-amber-900/50'}`}
          style={{ background: 'radial-gradient(ellipse at center, #2d7a45 0%, #1a5c2e 60%, #14472a 100%)', boxShadow: 'inset 0 0 50px rgba(0,0,0,0.4)' }}>
          {discardHover && <div className="absolute inset-0 flex items-center justify-center text-amber-400/30 text-lg font-bold pointer-events-none">Défausser ici</div>}
        </div>
        {message && <div className="absolute top-8 left-1/2 -translate-x-1/2 z-30 bg-slate-900/90 text-amber-400 px-4 py-2 rounded-lg text-sm font-bold fade-in cursor-pointer" onClick={() => setMessage('')}>{message}</div>}
        {aiPlayers.map((_, i) => renderAIPlayer(i, aiPlayers.length))}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-5 z-10">
          <div className="text-center">
            <CardView card={{ id: 'deck', isJoker: false, rank: 'A', suit: 'spades', pack: 1 }} faceDown
              onClick={isMyTurn && phase === 'must_draw' ? actions.draw : undefined} />
            <div className="text-[9px] text-white/40 mt-0.5">{gameState.deck.length}</div>
          </div>
          <div className="relative" style={{ width: 260, height: 200 }}>
            {/* The messy fanned discard heap */}
            <div className="absolute inset-0 cursor-pointer" onClick={() => setShowDiscardPile(true)}>
              {visibleDiscard.length === 0 && (
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-xl border-2 border-dashed border-white/15 px-6 py-8">
                  <span className="text-white/20 text-xs">Défausse</span>
                </div>
              )}
              {visibleDiscard.map((card, i) => {
                const isLast = i === visibleDiscard.length - 1;
                // Stable per-card hash: a discarded card KEEPS its spot forever,
                // it never moves when another player discards a new card.
                let seed = 0;
                for (let k = 0; k < card.id.length; k++) seed = (seed * 31 + card.id.charCodeAt(k)) >>> 0;
                const rot = isLast ? 0 : ((seed % 60) - 30);
                const ox = isLast ? 108 : 30 + (seed % 150);
                const oy = isLast ? 64 : 20 + ((seed * 3) % 110);
                return (
                  <div key={card.id}
                    className={`absolute transition-all ${isLast ? 'drop-shadow-lg' : ''}`}
                    style={{ left: ox, top: oy, transform: `rotate(${rot}deg) ${isLast ? 'scale(1.2)' : ''}`, zIndex: isLast ? 50 : i }}>
                    <CardView card={card} small highlight={isLast} onClick={isLast && isMyTurn && phase === 'must_draw' && availableActions?.canChop ? actions.chop : undefined} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {humanCombos.length > 0 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-wrap gap-1.5 justify-center z-10">
            {humanCombos.map(c => renderCombo(c, canAct))}
          </div>
        )}
      </div>
      {showDiscardPile && (
        <div className="absolute inset-0 bg-black/70 z-40 flex items-center justify-center p-4" onClick={() => setShowDiscardPile(false)}>
          <div className="bg-slate-800 rounded-2xl p-4 max-w-md w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3"><h3 className="text-amber-400 font-bold">Défausse ({gameState.discardPile.length})</h3><button onClick={() => setShowDiscardPile(false)} className="text-slate-400 font-bold text-lg">✕</button></div>
            <div className="flex flex-wrap gap-1.5">{gameState.discardPile.map(c => <CardView key={c.id} card={c} small />)}</div>
            {!gameState.discardPile.length && <p className="text-slate-500 text-center py-4">Vide</p>}
          </div>
        </div>
      )}
      {faultTargetId && (() => {
        const target = gameState.players.find(p => p.id === faultTargetId);
        return (
          <div className="absolute inset-0 bg-black/70 z-40 flex items-center justify-center p-4" onClick={() => setFaultTargetId(null)}>
            <div className="bg-slate-800 rounded-2xl p-4 max-w-sm w-full" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-1">
                <h3 className="text-red-400 font-bold">⚠️ Signaler une faute</h3>
                <button onClick={() => setFaultTargetId(null)} className="text-slate-400 font-bold text-lg">✕</button>
              </div>
              <p className="text-slate-300 text-sm mb-3">Contre <span className="font-bold text-amber-400">{target?.name}</span>. Si la faute est avérée, il écope de la pénalité et la manche se termine. Sinon, c'est vous qui êtes pénalisé.</p>
              <div className="space-y-2">
                {REPORTABLE_FAULTS.map(f => (
                  <button
                    key={f.type}
                    onClick={() => {
                      const res = actions.reportFaultAgainst(faultTargetId, f.type);
                      setFaultTargetId(null);
                      setMessage(res.message);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition-colors">
                    {f.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setFaultTargetId(null)} className="btn-secondary w-full mt-3 py-2">Annuler</button>
            </div>
          </div>
        );
      })()}
      {gameState.phase === 'round_end' && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-30 p-4">
          <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-sm space-y-3 fade-in overflow-y-auto max-h-[90vh]">
            <h2 className="text-xl font-bold text-amber-400 text-center">{gameState.roundResults[gameState.roundResults.length - 1]?.endType === 'null_round' ? '🔄 Manche Nulle' : '🏆 Fin de Manche'}</h2>
            {gameState.roundResults.length > 0 && (() => {
              const lr = gameState.roundResults[gameState.roundResults.length - 1]; const w = gameState.players.find(p => p.id === lr.winnerId);
              return (<>
                {w && <p className="text-center text-green-400 font-bold">{w.name} — {lr.endType}</p>}
                <div className="space-y-2">{gameState.players.map(p => {
                  const isW = p.id === lr.winnerId; const pf = lr.faults.filter(f => f.playerId === p.id);
                  const base = isW ? 0 : p.status === 'not_opened' ? (lr.endType === 'RJ' ? 200 : 100) : p.hand.length * (lr.endType === 'RJ' ? 20 : 10);
                  return (<div key={p.id} className="bg-slate-900/60 rounded-lg p-2">
                    <div className="flex justify-between text-sm font-bold"><span className={isW ? 'text-green-400' : 'text-slate-200'}>{p.name}</span><span className={isW ? 'text-green-400' : 'text-red-400'}>{isW ? lr.endType : `+${lr.scores[p.id]||0}`}</span></div>
                    {!isW && <div className="text-[10px] text-slate-400 mt-1 space-y-0.5">
                      {p.status === 'not_opened' ? <div>Non ouvert → +{lr.endType === 'RJ' ? 200 : 100}</div> : <div>{p.hand.length} carte{p.hand.length !== 1 ? 's' : ''} × {lr.endType === 'RJ' ? 20 : 10} = +{base}</div>}
                      {pf.map((f, i) => <div key={i} className="text-red-400">+{f.penalty} ({f.description})</div>)}
                    </div>}
                  </div>);
                })}</div>
                <div className="border-t border-slate-600 pt-2"><p className="text-xs text-slate-400 text-center font-bold mb-1">Classement</p>{[...gameState.players].sort((a, b) => a.score - b.score).map((p, i) => <div key={p.id} className="flex justify-between text-sm"><span className="text-slate-300">{i+1}. {p.name}</span><span className="text-amber-400 font-bold">{p.score}</span></div>)}</div>
              </>);
            })()}
            <div className="flex gap-3"><button onClick={actions.newRound} className="btn-primary flex-1 py-2.5">Manche Suivante</button><button onClick={onBack} className="btn-secondary flex-1 py-2.5">Quitter</button></div>
          </div>
        </div>
      )}
      {gameState.phase === 'playing' && (
        <div className="bg-slate-800 border-t-2 border-amber-900/40">
          {!isMyTurn && <div className="text-center py-1 bg-slate-900/50 border-b border-slate-700/50"><span className="text-amber-400 font-bold text-sm card-pulse">🤖 {cp.name} joue...</span></div>}
          {isMyTurn && (
            <div className="flex gap-1.5 p-1.5 overflow-x-auto border-b border-slate-700/50 items-center">
              {phase === 'must_draw' && (<>
                <button onClick={actions.draw} className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0">📥 Piocher</button>
                {availableActions?.canChop && <button onClick={actions.chop} className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 bg-gradient-to-r from-purple-600 to-purple-800">✋ CHOP</button>}
              </>)}
              {phase === 'playing' && (<>
                {chopMustOpen && (
                  <>
                    <span className="text-amber-400 text-[11px] self-center whitespace-nowrap font-bold">✋ CHOP : vous devez ouvrir ou annuler</span>
                    <button onClick={actions.cancelChop} className="btn-secondary text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0">↩️ Annuler CHOP</button>
                  </>
                )}
                {hasDrawnCard && selectedCards.length === 1 && <button onClick={() => actions.discardCard(selectedCards[0])} className="btn-danger text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0">🗑️ Jeter</button>}
                {detectedType && <button onClick={handleAutoPlace} className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0">🃏 Poser {detectedType === 'tierce' ? 'Tierce' : selCards.length === 4 ? 'Carré' : 'Brelan'}</button>}
                {hp.status !== 'opened' && humanCombos.length > 0 && <button onClick={actions.takeBack} className="btn-secondary text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0">↩️ Reprendre</button>}
                {selCards.length >= 3 && !detectedType && <span className="text-red-400 text-[10px] self-center">Invalide</span>}
                <button onClick={handleDiscard} disabled={selectedCards.length !== 1} className="btn-danger text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-40">🗑️ Défausser</button>
                {selectedCards.length === 1 && hp.hand.find(c => c.id === selectedCards[0])?.isJoker && <button onClick={() => actions.discardCard(selectedCards[0], false)} className="btn-danger text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 bg-gradient-to-r from-purple-600 to-purple-800">🃏 RJ</button>}
                {selectedCards.length >= 2 && <button onClick={lockSelection} className="text-xs px-3 py-1.5 whitespace-nowrap flex-shrink-0 rounded-lg font-bold bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-900">🔒 Verrouiller la sélection ({selectedCards.length})</button>}
                {selectedCards.length > 0 && <button onClick={actions.clearSelection} className="btn-secondary text-xs px-2 py-1.5 flex-shrink-0">✕</button>}
              </>)}
            </div>
          )}
          <PlayerHand
            cards={orderedHand}
            selectedCards={isMyTurn ? selectedCards : []}
            groups={handGroups}
            lockedSetForCard={lockedSetForCard}
            onUnlockSet={isMyTurn ? unlockSet : () => {}}
            onLockGroup={isMyTurn ? lockGroup : () => {}}
            onSelectCard={isMyTurn ? actions.selectCard : () => {}}
            onSelectGroup={isMyTurn ? handleSelectGroup : () => {}}
            disabled={!isMyTurn || phase === 'must_draw'}
            sortMode={sortMode} onSortChange={handleSortChange} onReorder={handleReorder}
            onCardDragStart={canAct ? onCardDragStart : undefined}
            onCardDragEnd={canAct ? onCardDragEnd : undefined} />
          <div className="flex items-center justify-between px-3 py-0.5 bg-slate-900/50 text-[10px] text-slate-400">
            <span>{hp.name} · {hp.hand.length} cartes</span>
            <span>{hp.status === 'opened' ? '✅ Ouvert' : '⏳ Non ouvert'}</span>
            <span>Score: {hp.score}</span>
          </div>
        </div>
      )}
    </div>
  );
}
