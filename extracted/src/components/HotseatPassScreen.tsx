'use client';
import { SEAT_LABELS, type TablePosition } from '@/game/core/types';

interface Props {
  name: string;
  seat: TablePosition;
  /** Cards waiting behind the screen: shown as anonymous backs only. */
  hiddenCount: number;
  /** A CHOP is possible on this turn: the incoming player decides. */
  chopAvailable?: boolean;
  onReady: () => void;
}

/**
 * "Pass the device" screen for local hot-seat games. It is rendered in place of
 * the hand, so the previous player's cards are not in the DOM at all (and the
 * incoming hand is only shown as backs). No game rule is involved here.
 */
export default function HotseatPassScreen({ name, seat, hiddenCount, chopAvailable, onReady }: Props) {
  return (
    <div
      data-hotseat-gate
      role="dialog"
      aria-modal="true"
      aria-label={`Passe l’appareil à ${name}`}
      className="px-4 py-5 flex flex-col items-center gap-3 bg-slate-900 border-t-2 border-amber-900/40"
    >
      <p className="text-[11px] uppercase tracking-widest text-slate-400">Multijoueur local · à tour de rôle</p>
      <h2 className="text-xl sm:text-2xl font-black text-amber-400 text-center">
        📱 Passe l’appareil à <span data-hotseat-name>{name}</span>
      </h2>
      <p className="text-xs text-slate-400 text-center">
        {SEAT_LABELS[seat]} · La main du joueur précédent est masquée.
        {chopAvailable ? ' Une carte peut être chopée à ce tour.' : ''}
      </p>
      <div className="flex items-end justify-center" data-hotseat-hidden-hand aria-label={`${hiddenCount} cartes face cachée`}>
        {Array.from({ length: Math.min(hiddenCount, 16) }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className="card card-back card-small"
            style={{ marginLeft: index === 0 ? 0 : -18, transform: `rotate(${(index % 3) - 1}deg)` }}
          />
        ))}
      </div>
      <p className="text-[11px] text-slate-500">{hiddenCount} cartes en main — visibles par personne d’autre</p>
      <button type="button" onClick={onReady} className="btn-primary w-full max-w-xs py-3 text-lg">
        ✅ Je suis prêt
      </button>
    </div>
  );
}
