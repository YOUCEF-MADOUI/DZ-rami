"use client";
import type { GameCard } from "@/game/core/types";
import CardView from "./CardView";

/**
 * Public "base" pile: the carrés players returned to the base.
 *
 * These cards were on the table before being returned, so every card identity
 * is already public. Showing them immediately (no animation, no delay) keeps the
 * discard area consistent: the four cards never simply vanish.
 */
export default function BasePile({
  cards,
  onInspect,
}: {
  cards: readonly GameCard[];
  onInspect?: () => void;
}) {
  if (!cards.length) return null;
  // A returned carré is always four cards: group them so each carré stays readable.
  const squares: GameCard[][] = [];
  for (let index = 0; index < cards.length; index += 4)
    squares.push(cards.slice(index, index + 4));
  return (
    <div
      data-base-pile
      data-base-count={cards.length}
      className="base-pile"
      aria-label={`Base : ${cards.length} cartes de carrés rentrés`}
    >
      <button
        type="button"
        className="base-pile-cards"
        onClick={onInspect}
        title="Base — carrés rentrés"
        aria-label={`Voir la base, ${cards.length} cartes`}
      >
        {squares.map((square, squareIndex) => (
          <span key={square[0]?.id ?? squareIndex} className="base-square" data-base-square>
            {square.map((card) => (
              <CardView key={card.id} card={card} tiny />
            ))}
          </span>
        ))}
      </button>
      <span className="base-pile-label">Base · {cards.length}</span>
    </div>
  );
}
