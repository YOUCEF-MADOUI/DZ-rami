'use client';
import { useRef, useCallback, useState } from 'react';
import { GameCard } from '@/game/core/types';
import { DetectedGroup, findGroupForIndex, GROUP_COLORS } from '@/game/core/hand-groups';
import CardView from './CardView';
export type SortMode = 'manual' | 'suit' | 'rank';
interface Props {
  cards: GameCard[];
  selectedCards: string[];
  groups: DetectedGroup[];
  lockedSetForCard?: (cardId: string) => string[] | null;  // user-locked set a card belongs to
  onUnlockSet?: (cardId: string) => void;                   // unlock the set containing this card
  onLockGroup?: (cardIds: string[]) => void;                // lock a detected combo via its chevron
  onSelectCard: (cardId: string) => void;
  onSelectGroup: (cardIds: string[]) => void;
  disabled?: boolean;                    // blocks game actions, NOT drag
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  onReorder: (blockIds: string[], toIndex: number) => void;
  onCardDragStart?: (cardId: string) => void;
  onCardDragEnd?: () => void;
}
const CARD_W = 64;
const GAP = 6;
export default function PlayerHand({
  cards, selectedCards, groups, lockedSetForCard, onUnlockSet, onLockGroup, onSelectCard, onSelectGroup, disabled,
  sortMode, onSortChange, onReorder, onCardDragStart, onCardDragEnd,
}: Props) {
  // Locked set (user-frozen) a card belongs to, if any.
  const lockedSet = useCallback((cardId: string): string[] | null =>
    lockedSetForCard ? lockedSetForCard(cardId) : null, [lockedSetForCard]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragBlock, setDragBlock] = useState<string[] | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const isInternalRef = useRef(false);
  // ── Resolve what block a card belongs to ──
  // A card inside a user-locked set moves with the whole set; otherwise it's free.
  const blockForIndex = useCallback((index: number): string[] => {
    const id = cards[index]?.id;
    if (!id) return [];
    const set = lockedSet(id);
    return set ? set : [id];
  }, [cards, lockedSet]);
  // ── Click: select the whole locked set if the card is locked, else single card ──
  const handleClick = useCallback((index: number) => {
    if (disabled) return;
    const id = cards[index]?.id;
    const set = lockedSet(id);
    if (set) { onSelectGroup(set); return; }
    onSelectCard(id);
  }, [disabled, cards, onSelectCard, onSelectGroup, lockedSet]);
  // ── Drag start ──
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    const block = blockForIndex(index);
    setDragBlock(block);
    isInternalRef.current = false;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', block[0] ?? '');
    // Notify parent which card is being dragged (for drop targets outside the hand)
    onCardDragStart?.(block.length === 1 ? block[0] : block[0]);
  }, [blockForIndex, onCardDragStart]);
  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    isInternalRef.current = true;
    setOverIdx(index);
  }, []);
  const handleDragEnd = useCallback(() => {
    if (isInternalRef.current && dragBlock && overIdx !== null) {
      onReorder(dragBlock, overIdx);
    }
    setDragBlock(null);
    setOverIdx(null);
    isInternalRef.current = false;
    onCardDragEnd?.();
  }, [dragBlock, overIdx, onReorder, onCardDragEnd]);
  // ── Touch ──
  const touchStartRef = useRef<{ block: string[] } | null>(null);
  const handleTouchStart = useCallback((index: number) => {
    const block = blockForIndex(index);
    touchStartRef.current = { block };
    setDragBlock(block);
  }, [blockForIndex]);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || !containerRef.current) return;
    const touch = e.touches[0];
    const items = containerRef.current.querySelectorAll('[data-ci]');
    let target = 0;
    items.forEach(el => {
      const rect = el.getBoundingClientRect();
      const i = parseInt(el.getAttribute('data-ci') || '0');
      if (touch.clientX > rect.left + rect.width / 2) target = i + 1;
    });
    setOverIdx(target);
  }, []);
  const handleTouchEnd = useCallback(() => {
    if (touchStartRef.current && dragBlock && overIdx !== null) {
      onReorder(dragBlock, overIdx);
    }
    touchStartRef.current = null;
    setDragBlock(null);
    setOverIdx(null);
  }, [dragBlock, overIdx, onReorder]);
  const draggingSet = new Set(dragBlock ?? []);
  return (
    <div className="flex flex-col">
      {/* Sort bar */}
      <div className="flex gap-1 px-2 py-1 bg-slate-900/30 border-b border-slate-700/50 items-center overflow-x-auto">
        <span className="text-[10px] text-slate-500 mr-1">TRIER:</span>
        {(['suit', 'rank'] as const).map(m => (
          <button key={m} onClick={() => onSortChange(m)}
            className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${sortMode === m ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
            {m === 'suit' ? '♠♥♦♣ Couleur' : 'A→2 Valeur'}
          </button>
        ))}
        {sortMode === 'manual' && <span className="text-[10px] text-amber-400 ml-1">Manuel</span>}
        {groups.length > 0 && (
          <span className="text-[10px] text-green-400 ml-auto whitespace-nowrap">
            {groups.length} combinaison{groups.length > 1 ? 's' : ''} détectée{groups.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {/* Cards with group bands */}
      <div ref={containerRef}
        className="relative flex px-2 pt-2 pb-7 overflow-x-auto"
        style={{ gap: GAP, minHeight: 134 }}
        onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
        {cards.map((card, index) => {
          // Auto-detected combo (visual hint only, non-interactive).
          const group = findGroupForIndex(groups, index);
          const isFirstOfGroup = group?.startIndex === index;
          const isLastOfGroup = group?.endIndex === index;
          const color = group ? GROUP_COLORS[group.colorIndex] : null;
          // User-locked set membership.
          const set = lockedSet(card.id);
          const prevSet = index > 0 ? lockedSet(cards[index - 1].id) : null;
          const nextSet = index < cards.length - 1 ? lockedSet(cards[index + 1].id) : null;
          const sameSet = (a: string[] | null, b: string[] | null) => !!a && !!b && a === b;
          const isFirstOfSet = !!set && !sameSet(set, prevSet);
          const isLastOfSet = !!set && !sameSet(set, nextSet);
          const isDragging = draggingSet.has(card.id);
          const isOver = overIdx === index && !isDragging;
          return (
            <div key={card.id} data-ci={index} draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              onTouchStart={() => handleTouchStart(index)}
              className={`relative flex-shrink-0 transition-transform duration-100 ${isDragging ? 'scale-90 opacity-50' : ''} ${isOver ? 'translate-x-3' : ''}`}
              style={{
                // Tighten spacing inside a locked set so it reads as one block.
                marginLeft: set && !isFirstOfSet ? -GAP + 1 : 0,
                marginRight: 0,
              }}>
              {/* Auto-detected combo band (guide only) */}
              {group && color && !set && (
                <>
                  <div className="absolute pointer-events-none"
                    style={{
                      left: isFirstOfGroup ? -3 : 0, right: isLastOfGroup ? -3 : 0,
                      bottom: -8, height: 5, background: color.band,
                      borderTopLeftRadius: isFirstOfGroup ? 3 : 0, borderBottomLeftRadius: isFirstOfGroup ? 3 : 0,
                      borderTopRightRadius: isLastOfGroup ? 3 : 0, borderBottomRightRadius: isLastOfGroup ? 3 : 0,
                      zIndex: 0,
                    }} />
                  {isFirstOfGroup && (
                    <div className="absolute pointer-events-none text-[8px] font-black px-1 rounded"
                      style={{ top: -12, left: -2, color: color.band, background: 'rgba(0,0,0,0.6)', zIndex: 3 }}>
                      {group.type === 'tierce' ? 'TIERCE' : group.cardIds.length === 4 ? 'CARRÉ' : 'BRELAN'}
                    </div>
                  )}
                  {/* Lock chevron under the detected combo — locks the WHOLE combo */}
                  {isLastOfGroup && group.cardIds.length >= 2 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onLockGroup?.(group.cardIds); }}
                      onPointerDown={(e) => e.stopPropagation()}
                      draggable={false}
                      title="Verrouiller cette combinaison"
                      className="absolute z-20 flex items-center justify-center rounded-full shadow-md transition-transform active:scale-90 hover:scale-110"
                      style={{ bottom: -22, right: -6, width: 22, height: 22, background: 'rgba(15,23,42,0.9)', border: `2px solid ${color.band}` }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ color: color.band }}>
                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </>
              )}
              {/* User LOCKED SET highlight (amber) */}
              {set && (
                <>
                  <div className="absolute pointer-events-none"
                    style={{
                      left: isFirstOfSet ? -3 : 0, right: isLastOfSet ? -3 : 0,
                      top: -3, bottom: -3, background: 'rgba(245,158,11,0.28)',
                      borderTopLeftRadius: isFirstOfSet ? 10 : 0, borderBottomLeftRadius: isFirstOfSet ? 10 : 0,
                      borderTopRightRadius: isLastOfSet ? 10 : 0, borderBottomRightRadius: isLastOfSet ? 10 : 0,
                      boxShadow: 'inset 0 0 0 2px #f59e0b', zIndex: 0,
                    }} />
                  {isFirstOfSet && (
                    <div className="absolute pointer-events-none text-[8px] font-black px-1 rounded flex items-center gap-0.5"
                      style={{ top: -12, left: -2, color: '#0f172a', background: '#f59e0b', zIndex: 3 }}>
                      🔒 VERROUILLÉ
                    </div>
                  )}
                </>
              )}
              {/* Unlock chevron under the LAST card of a locked set */}
              {set && isLastOfSet && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUnlockSet?.(card.id); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  draggable={false}
                  title="Déverrouiller ces cartes"
                  className="absolute z-20 flex items-center justify-center rounded-full shadow-md transition-transform active:scale-90 hover:scale-110"
                  style={{ bottom: -22, right: -6, width: 22, height: 22, background: '#f59e0b', border: '2px solid #f59e0b' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ color: '#0f172a' }}>
                    <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
              <div style={{ position: 'relative', zIndex: 1 }}>
                <CardView card={card}
                  selected={selectedCards.includes(card.id)}
                  onClick={() => handleClick(index)}
                  disabled={disabled} />
              </div>
            </div>
          );
        })}
        {/* End drop zone */}
        <div data-ci={cards.length}
          onDragOver={(e) => handleDragOver(e, cards.length)}
          className="flex-shrink-0"
          style={{ width: 24 }} />
      </div>
    </div>
  );
}
