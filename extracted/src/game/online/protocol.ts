import type { DrawVisualEvent } from "../../components/presentation/table-motion";
import type {
  GameConfig,
  Combination,
  JokerPlacement,
  FaultType,
} from "../core/types";
import type { projectPlayerView } from "../core/public-view";
import type { AvailableActions } from "../core/engine";
export type OnlineAction =
  | {
      type:
        | "draw"
        | "chop"
        | "cancelChop"
        | "confirmOpening"
        | "takeBack"
        | "nextRound";
    }
  | { type: "discard"; cardId: string; faceDown?: boolean }
  | {
      type: "place";
      cardIds: string[];
      kind: "tierce" | "carre";
      jokerPlacement?: JokerPlacement;
    }
  | { type: "add"; cardId: string; comboId: string; side?: "higher" | "lower" }
  | { type: "recover"; comboId: string; cardIds: string[] }
  | { type: "returnCarre"; comboId: string }
  | { type: "report"; accusedId: string; fault: FaultType }
  | { type: "stopWatching" }
  | { type: "replace"; slot?: number };
export interface RoomSpectator { name: string; connected: boolean }
export interface RoomSummary {
  id: string;
  name: string;
  variant: "classic" | "teams";
  capacity: number;
  count: number;
  status: "waiting" | "full" | "playing" | "finished";
  /** Number of watchers (detail is in RoomView). */
  spectatorCount: number;
}
export interface OnlineGame extends ReturnType<typeof projectPlayerView> {
  draw: DrawVisualEvent | null;
  pristine: boolean;
  viewerId: string;
  roundNumber: number;
  suite: number;
  lastOpeningTotal: number;
  vierge: number;
  turnPhase: string | null;
  myDraft: Combination[];
  actions: AvailableActions | null;
  chopPending: boolean;
  /** Same condition the local screen uses to explain a CHOP that must open. */
  chopMustOpen: boolean;
}
export interface RoomView extends RoomSummary {
  /** "player" when this client holds a seat, "spectator" when it only watches. */
  viewerRole: "player" | "spectator";
  /** Table option: a spectator may take the seat of a player who left. */
  allowReplacement: boolean;
  spectators: RoomSpectator[];
  /** Seats whose owner explicitly left a started game, with their position. */
  leftSeats: { slot: number; name: string }[];
  /** True when this spectator may take a seat right now. */
  canReplace: boolean;
  canReplaceSlot?: number;
  private: boolean;
  revision: number;
  hostPlayerId: string;
  viewerId: string;
  config: GameConfig;
  members: {
    playerId: string;
    name: string;
    ready: boolean;
    connected: boolean;
    seat: string;
  }[];
  game: OnlineGame | null;
}
export interface OnlineSnapshot {
  serial: number;
  name: string;
  room: RoomView | null;
  tables: RoomSummary[];
  retentionMinutes: number;
}
