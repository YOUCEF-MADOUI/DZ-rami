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
  cards, selectedCards, groups, onSelectCard, onSelectGroup, disabled,
  sortMode, onSortChange, onReorder, onCardDragStart, onCardDragEnd,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragBlock, setDragBlock] = useState<string[] | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const isInternalRef = useRef(false);
  // ── Resolve what block a card belongs to (group or itself) ──
  const blockForIndex = useCallback((index: number): string[] => {
    const g = findGroupForIndex(groups, index);
    return g ? g.cardIds : [cards[index]?.id].filter(Boolean) as string[];
  }, [groups, cards]);
  // ── Click: select whole group if card is in a group ──
  const handleClick = useCallback((index: number) => {
    if (disabled) return;
    const g = findGroupForIndex(groups, index);
    if (g) onSelectGroup(g.cardIds);
    else onSelectCard(cards[index].id);
  }, [disabled, groups, cards, onSelectCard, onSelectGroup]);
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
        className="relative flex px-2 pt-2 pb-4 overflow-x-auto"
        style={{ gap: GAP, minHeight: 122 }}
        onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
        {cards.map((card, index) => {
          const group = findGroupForIndex(groups, index);
          const isFirstOfGroup = group?.startIndex === index;
          const isLastOfGroup = group?.endIndex === index;
          const color = group ? GROUP_COLORS[group.colorIndex] : null;
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
                // Tighten spacing inside a group so it reads as one block
                marginLeft: group && !isFirstOfGroup ? -GAP + 1 : 0,
                marginRight: group && !isLastOfGroup ? 0 : 0,
              }}>
              {/* Group band (behind + under the cards) */}
              {group && color && (
                <>
                  {/* Top glow border */}
                  <div className="absolute pointer-events-none"
                    style={{
                      left: isFirstOfGroup ? -3 : 0,
                      right: isLastOfGroup ? -3 : 0,
                      top: -3, bottom: -3,
                      background: color.glow,
                      borderTopLeftRadius: isFirstOfGroup ? 10 : 0,
                      borderBottomLeftRadius: isFirstOfGroup ? 10 : 0,
                      borderTopRightRadius: isLastOfGroup ? 10 : 0,
                      borderBottomRightRadius: isLastOfGroup ? 10 : 0,
                      zIndex: 0,
                    }} />
                  {/* Solid bottom band */}
                  <div className="absolute pointer-events-none"
                    style={{
                      left: isFirstOfGroup ? -3 : 0,
                      right: isLastOfGroup ? -3 : 0,
                      bottom: -8, height: 5,
                      background: color.band,
                      borderTopLeftRadius: isFirstOfGroup ? 3 : 0,
                      borderBottomLeftRadius: isFirstOfGroup ? 3 : 0,
                      borderTopRightRadius: isLastOfGroup ? 3 : 0,
                      borderBottomRightRadius: isLastOfGroup ? 3 : 0,
                      zIndex: 0,
                    }} />
                  {/* Type label on the first card */}
                  {isFirstOfGroup && (
                    <div className="absolute pointer-events-none text-[8px] font-black px-1 rounded"
                      style={{ top: -12, left: -2, color: color.band, background: 'rgba(0,0,0,0.6)', zIndex: 3 }}>
                      {group.type === 'tierce' ? 'TIERCE' : group.cardIds.length === 4 ? 'CARRÉ' : 'BRELAN'}
                    </div>
                  )}
                </>
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
