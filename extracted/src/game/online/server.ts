import { OnlineError } from "./errors";
export { OnlineError } from "./errors";
// Node-only authoritative room service. Never import this module from a client component.
import {
  randomBytes,
  randomInt,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_CONFIG,
  INITIAL_THRESHOLDS,
  getSeatOrder,
  RANKS,
  SUITS,
  type GameConfig,
  type GameState,
  type JokerPlacement,
} from "../core/types";
import { withDeckRandom } from "../core/deck";
import { TOKEN_PATTERN } from "./http";
import * as engine from "../core/engine";
import { normalizeVariantConfig } from "../core/team-rules";
import { projectPlayerView, projectSpectatorView } from "../core/public-view";
import { drawVisualEvent } from "../../components/presentation/table-motion";
import { assertDeckIntegrity } from "../core/deck-integrity";
import type { OnlineSnapshot, RoomSummary, RoomView } from "./protocol";
interface Session {
  name: string;
  expires: number;
  roomId?: string;
  requests: string[];
  /** Stable bearer identity of the browser/device, independent of the session. */
  identity?: string;
}
interface Member {
  session: string;
  slot: number;
  name: string;
  ready: boolean;
  /** Identity that owns this seat, so the same player can always come back. */
  identity?: string;
  /** True after an explicit leave during a started game (seat can be replaced). */
  left?: boolean;
  leftAt?: number;
}
interface Spectator {
  session: string;
  name: string;
  identity?: string;
}
interface Room {
  id: string;
  name: string;
  private: boolean;
  passwordHash?: string;
  config: GameConfig;
  host: string;
  members: Member[];
  /** Watchers: they receive public information only, never a hand. */
  spectators: Spectator[];
  /** Table option: a spectator may take the seat of a player who left. */
  allowReplacement: boolean;
  state: GameState | null;
  revision: number;
  updated: number;
}
/** A member counts as present if the server saw it this recently. */
const PRESENCE_MS = 15000;
/** A never-started table with nobody connected is abandoned after this delay. */
const ABANDONED_LOBBY_MS = 90000;
interface Store {
  sequence?: number;
  version: 1;
  sessions: Record<string, Session>;
  rooms: Record<string, Room>;
}
const fail = (message: string, status = 400, code = ""): never => {
  throw new OnlineError(message, status, code);
};
/** Identity of the browser: same opaque format as a session token. */
function identityFrom(value: unknown): string | undefined {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) return undefined;
  return value;
}
export function text(value: unknown, label: string, max = 80): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(`${label} invalide.`);
  return (value as string).trim();
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Requête invalide.");
  return value as Record<string, unknown>;
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 108)
    fail("Cartes invalides.");
  const list = (value as unknown[]).map((v) => text(v, "Carte", 80));
  if (new Set(list).size !== list.length) fail("Cartes dupliquées.");
  return list;
}
function password(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128)
    fail("Le mot de passe doit contenir 8 à 128 caractères.");
  return value as string;
}
function hashPassword(value: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 32).toString("hex")}`;
}
function verifyPassword(value: string, hash: string): boolean {
  const [salt, key] = hash.split(":");
  return timingSafeEqual(Buffer.from(key, "hex"), scryptSync(value, salt, 32));
}
const sessionKey = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
/**
 * Server-side rule validation. The browser form is never trusted: every numeric
 * rule has an explicit range and every enum an explicit allowed set, so a crafted
 * request cannot create a table with impossible rules or a mode/config mismatch.
 */
const RULE_RANGES: [keyof GameConfig, number, number][] = [
  ["malusChopOuverture", 0, 200],
  ["malusChopJoueurOuvert", 0, 100],
  ["carreNotRecoveredPenalty", 0, 300],
  ["faultePenalty", 0, 500],
  ["faulteJokerPenalty", 0, 500],
  ["playableDiscardPenalty", 0, 300],
  ["rsScorePerCard", 5, 50],
  ["rjScorePerCard", 10, 100],
  ["rsNonOpenedPenalty", 50, 500],
  ["rjNonOpenedPenalty", 100, 500],
  ["maxCycles", 1, 10],
  ["targetScore", 0, 3000],
];
const RULE_TOGGLES: (keyof GameConfig)[] = [
  "chopObligatoire",
  "malusChopJoueurOuvertActif",
  "chopSeulementOuverture",
  "chopCarteObligatoireAJouer",
  "tierceObligatoire",
];
function configFrom(value: unknown): GameConfig {
  const input = record(value);
  const out = { ...DEFAULT_CONFIG } as GameConfig;
  for (const key of RULE_TOGGLES) {
    const raw = input[key] ?? DEFAULT_CONFIG[key];
    if (typeof raw !== "boolean")
      fail(`Paramètre invalide : ${String(key)} doit être vrai ou faux.`);
    Object.assign(out, { [key]: raw });
  }
  for (const [key, min, max] of RULE_RANGES) {
    const raw = input[key] ?? DEFAULT_CONFIG[key] ?? 0;
    if (
      typeof raw !== "number" ||
      !Number.isInteger(raw) ||
      raw < min ||
      raw > max
    )
      fail(
        `Paramètre invalide : ${String(key)} doit être un entier entre ${min} et ${max}.`,
      );
    Object.assign(out, { [key]: raw });
  }
  const carre = input.carreResponsable ?? DEFAULT_CONFIG.carreResponsable;
  if (carre !== "detenteur" && carre !== "completeur")
    fail("Responsable du carré invalide : choisissez détenteur ou compléteur.");
  out.carreResponsable = carre as GameConfig["carreResponsable"];
  const difficulty = input.aiDifficulty ?? DEFAULT_CONFIG.aiDifficulty;
  if (difficulty !== "easy" && difficulty !== "normal" && difficulty !== "hard")
    fail("Difficulté des robots invalide.");
  out.aiDifficulty = difficulty as GameConfig["aiDifficulty"];
  const count = input.playerCount ?? DEFAULT_CONFIG.playerCount;
  if (![2, 3, 4, 5].includes(count as number))
    fail("Nombre de joueurs invalide (2 à 5).");
  out.playerCount = count as GameConfig["playerCount"];
  if (
    input.variant !== undefined &&
    input.variant !== "classic" &&
    input.variant !== "teams"
  )
    fail("Mode inconnu : choisissez Rami classique ou 2 contre 2.");
  out.variant = input.variant === "teams" ? "teams" : "classic";
  if (out.variant === "teams" && out.playerCount !== 4)
    fail("Le mode 2 contre 2 exige quatre joueurs.");
  // Teams normalisation stays authoritative: a crafted request cannot enable CHOP
  // obligations or malus in 2v2, whatever the browser sent.
  return normalizeVariantConfig(out);
}
function restoreReferences(state: GameState) {
  if (state.turnState) {
    const actions = new Map(
      state.actionHistory.map((a) => [JSON.stringify(a), a]),
    );
    state.turnState.actionsThisTurn = state.turnState.actionsThisTurn.map(
      (a) => actions.get(JSON.stringify(a)) ?? a,
    );
  }
  assertDeckIntegrity(state);
}
export class OnlineService {
  private data: Store = { version: 1, sessions: {}, rooms: {} };
  private seen = new Map<string, number>();
  private streams = new Map<string, number>();
  private limits = new Map<string, { at: number; count: number }>();
  readonly retentionMinutes: number;
  constructor(
    private file: string | null = resolve(
      process.env.MULTIPLAYER_STORE_PATH ?? ".multiplayer/state.json",
    ),
    private now = () => Date.now(),
  ) {
    this.retentionMinutes = Math.max(
      5,
      Math.min(
        10080,
        Number(process.env.MULTIPLAYER_RETENTION_MINUTES) || 1440,
      ),
    );
    if (file && existsSync(file)) {
      const loaded = JSON.parse(readFileSync(file, "utf8")) as Store;
      if (loaded.version !== 1)
        throw new Error("Unsupported multiplayer store");
      for (const room of Object.values(loaded.rooms)) {
        if (room.state) restoreReferences(room.state);
        // Older stores predate spectators and the replacement option.
        room.spectators ??= [];
        room.allowReplacement ??= false;
      }
      this.data = loaded;
    }
  }
  private save(next: Store) {
    next.sequence = (this.data.sequence ?? 0) + 1;
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = `${this.file}.tmp`;
      writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
      renameSync(temp, this.file);
    }
    this.data = next;
  }
  private seenAt(session: string) {
    return this.seen.get(session) ?? 0;
  }
  /** At least one member was active within the presence window. */
  private present(room: Room) {
    return room.members.some(
      (m) => this.now() - this.seenAt(m.session) < PRESENCE_MS,
    );
  }
  /**
   * A table only exists while it is useful:
   *  - empty tables are removed immediately (nobody left to play with);
   *  - a never-started table with nobody connected is a ghost from an abandoned
   *    tab or a test run: removed after a short grace period instead of lingering
   *    for the whole retention window;
   *  - a started game keeps its seats until the retention window expires.
   */
  private prune(next: Store) {
    for (const room of Object.values(next.rooms)) {
      const last = Math.max(
        room.updated,
        ...room.members.map((m) => this.seenAt(m.session)),
      );
      const empty = room.members.length === 0;
      const abandoned =
        !room.state &&
        !this.present(room) &&
        this.now() - last > ABANDONED_LOBBY_MS;
      const expired = this.now() - last > this.retentionMinutes * 60000;
      if (empty || abandoned || expired) {
        delete next.rooms[room.id];
        for (const member of room.members)
          if (next.sessions[member.session])
            delete next.sessions[member.session].roomId;
        for (const sp of room.spectators ?? [])
          if (next.sessions[sp.session]) delete next.sessions[sp.session].roomId;
      }
    }
    for (const [key, s] of Object.entries(next.sessions))
      if (s.expires < this.now() && !s.roomId) delete next.sessions[key];
  }
  rate(key: string, max = 100) {
    const old = this.limits.get(key);
    if (!old || this.now() - old.at > 60000) {
      this.limits.set(key, { at: this.now(), count: 1 });
    } else if (++old.count > max)
      fail("Trop de requêtes. Réessayez dans une minute.", 429);
    if (this.limits.size > 10000)
      for (const [k, v] of this.limits)
        if (this.now() - v.at > 60000) this.limits.delete(k);
  }
  session(
    token?: string,
    identity?: string,
  ): { token: string; created: boolean } {
    const known = token ? sessionKey(token) : undefined;
    if (known && this.data.sessions[known]?.expires > this.now()) {
      // A reconnect may teach an older session its identity.
      if (identity && this.data.sessions[known].identity !== identity) {
        const next = clone(this.data);
        next.sessions[known].identity = identity;
        next.sessions[known].expires = this.now() + 30 * 86400000;
        this.save(next);
      }
      return { token: token!, created: false };
    }
    this.rate("new-sessions", 120);
    const next = clone(this.data);
    this.prune(next);
    if (Object.keys(next.sessions).length >= 5000) fail("Serveur occupé.", 503);
    token = randomBytes(32).toString("hex");
    next.sessions[sessionKey(token)] = {
      name: "",
      expires: this.now() + 30 * 86400000,
      requests: [],
      ...(identity ? { identity } : {}),
    };
    this.save(next);
    return { token, created: true };
  }
  private identity(key: string) {
    return this.data.sessions[key].identity;
  }
  private auth(token: string) {
    const key = sessionKey(token),
      session = this.data.sessions[key];
    if (!session || session.expires < this.now())
      fail("Session expirée. Rechargez le menu.", 401);
    return { key, session };
  }
  stream(token: string) {
    const { key } = this.auth(token);
    const count = this.streams.get(key) ?? 0;
    if (
      count >= 4 ||
      [...this.streams.values()].reduce((a, b) => a + b, 0) >= 500
    )
      fail("Trop de connexions simultanées.", 429);
    this.streams.set(key, count + 1);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      const n = (this.streams.get(key) ?? 1) - 1;
      if (n) this.streams.set(key, n);
      else this.streams.delete(key);
    };
  }
  touch(token: string) {
    const { key, session } = this.auth(token);
    const room = session.roomId ? this.data.rooms[session.roomId] : undefined;
    if (
      room &&
      this.now() -
        Math.max(
          room.updated,
          ...room.members.map((m) => this.seen.get(m.session) ?? 0),
        ) >
        this.retentionMinutes * 60000
    ) {
      const next = clone(this.data);
      this.prune(next);
      this.save(next);
      return;
    }
    this.seen.set(key, this.now());
    // Checkpoint active rooms so a process restart preserves the retention window.
    if (room && this.now() - room.updated > 60000) {
      const next = clone(this.data);
      next.rooms[room.id].updated = this.now();
      next.sessions[key].expires = this.now() + 30 * 86400000;
      this.save(next);
    }
  }
  private summary(room: Room): RoomSummary {
    return {
      id: room.id,
      name: room.name,
      variant: room.config.variant ?? "classic",
      capacity: room.config.playerCount,
      count: room.members.length,
      status: room.state
        ? room.state.phase === "game_end"
          ? "finished"
          : "playing"
        : room.members.length === room.config.playerCount
          ? "full"
          : "waiting",
      spectatorCount: (room.spectators ?? []).length,
    };
  }
  snapshot(token: string): OnlineSnapshot {
    const { key, session } = this.auth(token);
    // Opportunistic sweep: expired/ghost tables never reach the lobby list.
    {
      const next = clone(this.data);
      this.prune(next);
      if (
        Object.keys(next.rooms).length !== Object.keys(this.data.rooms).length
      )
        this.save(next);
    }
    const room = session.roomId ? this.data.rooms[session.roomId] : undefined;
    const active = (r: Room) =>
      this.now() -
        Math.max(
          r.updated,
          ...r.members.map((m) => this.seen.get(m.session) ?? 0),
        ) <=
      this.retentionMinutes * 60000;
    let view: RoomView | null = null;
    if (room && active(room)) {
      const member = room.members.find((m) => m.session === key);
      const watcher = room.spectators?.find((sp) => sp.session === key);
      const state = room.state;
      const viewerId = member ? `player-${member.slot}` : "";
      const leftSeats = room.members
        .filter((m) => m.left)
        .map((m) => ({ slot: m.slot, name: m.name }));
      const canReplace = Boolean(
        !member && watcher && room.allowReplacement && leftSeats.length > 0,
      );
      view = {
        ...this.summary(room),
        viewerRole: member ? "player" : "spectator",
        allowReplacement: room.allowReplacement,
        spectators: (room.spectators ?? []).map((sp) => ({
          name: sp.name,
          connected: this.now() - (this.seen.get(sp.session) ?? 0) < PRESENCE_MS,
        })),
        leftSeats,
        canReplace,
        ...(canReplace ? { canReplaceSlot: leftSeats[0].slot } : {}),
        private: room.private,
        revision: room.revision,
        hostPlayerId: room.members.length
          ? `player-${room.members.find((m) => m.session === room.host)?.slot ?? 0}`
          : "",
        viewerId,
        config: clone(room.config),
        members: room.members.map((m) => ({
          playerId: `player-${m.slot}`,
          name: m.name,
          ready: m.ready,
          connected: this.now() - (this.seen.get(m.session) ?? 0) < 15000,
          seat: getSeatOrder(room.config.playerCount)[m.slot],
        })),
        game: state
          ? {
              ...(member
                ? projectPlayerView(state, viewerId)
                : projectSpectatorView(state)),
              viewerId,
              draw: drawVisualEvent(state, viewerId),
              pristine: state.actionHistory.length === 0,
              roundNumber: state.roundNumber,
              suite: state.suite,
              lastOpeningTotal: state.lastOpeningTotal ?? 0,
              vierge: INITIAL_THRESHOLDS[state.config.playerCount],
              turnPhase: state.turnState?.phase ?? null,
              myDraft:
                member && state.turnState?.playerId === viewerId
                  ? clone(state.turnState.temporaryCombinations)
                  : [],
              // getAvailableActions examines the active hand: NEVER call/send it for a non-active viewer.
              actions:
                member && state.players[state.currentPlayerIndex].id === viewerId
                  ? engine.getAvailableActions(state, viewerId)
                  : null,
              chopMustOpen:
                state.turnState?.playerId === viewerId &&
                state.config.chopSeulementOuverture &&
                state.turnState.drawSource === "chop" &&
                state.players[state.currentPlayerIndex].status !== "opened",
              chopPending:
                state.turnState?.playerId === viewerId &&
                !!state.turnState.mandatoryChopCardId &&
                !engine.hasPlayedMandatoryChopCard(state),
            }
          : null,
      };
    }
    return {
      serial: this.data.sequence ?? 0,
      name: session.name,
      room: view,
      tables: Object.values(this.data.rooms)
        .filter((r) => !r.private && active(r) && this.present(r))
        .map((r) => this.summary(r)),
      retentionMinutes: this.retentionMinutes,
    };
  }
  command(
    token: string,
    raw: unknown,
  ): { snapshot: OnlineSnapshot; message: string } {
    return withDeckRandom(
      () => randomInt(0x100000000) / 0x100000000,
      () => this.applyCommand(token, raw),
    );
  }
  private applyCommand(
    token: string,
    raw: unknown,
  ): { snapshot: OnlineSnapshot; message: string } {
    const { key } = this.auth(token);
    this.rate(key);
    const input = record(raw),
      requestId = text(input.requestId, "Identifiant de requête", 100);
    if (this.data.sessions[key].requests.includes(requestId))
      return { snapshot: this.snapshot(token), message: "Action déjà reçue." };
    const next = clone(this.data);
    this.prune(next);
    const session = next.sessions[key];
    let room = session.roomId ? next.rooms[session.roomId] : undefined;
    let message = "";
    let leaving = false;
    const cmd = text(input.command, "Commande", 30);
    const myIdentity =
      identityFrom(input.playerIdentity) ??
      this.identity(key) ??
      session.identity;
    if (myIdentity) {
      session.identity = myIdentity;
      // A seated player teaches the server which browser identity owns the seat, so
      // the seat can always be reclaimed later (even after a full session loss).
      const own = room?.members.find((m) => m.session === key);
      if (own && !own.identity) own.identity = myIdentity;
    }
    if (cmd === "create" || cmd === "join" || cmd === "watch") {
      if (room) {
        // Already seated (possibly as a spectator): keep the seat, never duplicate it.
        if (cmd === "watch")
          return { snapshot: this.snapshot(token), message: "" };
        fail(
          "Vous avez déjà une place à cette table. Quittez-la avant de continuer.",
          409,
          "already_seated",
        );
      }
      session.name = text(input.name, "Votre nom", 30);
      if (cmd === "create") {
        if (Object.keys(next.rooms).length >= 250)
          fail("Nombre maximal de tables atteint.", 503);
        const name = text(input.tableName, "Nom de table", 60),
          config = configFrom(input.config);
        if (
          Object.values(next.rooms).some(
            (r) => r.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          )
        )
          fail("Ce nom de table est déjà utilisé.", 409);
        if (typeof input.private !== "boolean") fail("Visibilité invalide.");
        const replacement =
          input.allowReplacement === undefined
            ? false
            : input.allowReplacement === true;
        const id = randomBytes(6).toString("hex");
        room = {
          id,
          name,
          private: input.private as boolean,
          ...(input.private
            ? { passwordHash: hashPassword(password(input.password)) }
            : {}),
          config,
          host: key,
          members: [],
          spectators: [],
          allowReplacement: replacement as boolean,
          state: null,
          revision: 0,
          updated: this.now(),
        };
        next.rooms[id] = room;
      } else {
        this.rate(`join:${key}`, 12);
        this.rate("password-attempts", 120);
        const query = text(
          input.tableId,
          "Identifiant ou nom de table",
          80,
        ).toLocaleLowerCase();
        room = Object.values(next.rooms).find(
          (r) => r.id === query || r.name.toLocaleLowerCase() === query,
        );
        if (!room) fail("Table inexistante ou expirée.", 404);
        if (
          room!.private &&
          !verifyPassword(password(input.password), room!.passwordHash!)
        )
          fail("Mot de passe incorrect.", 403);
        // Same player coming back: reclaim the seat that belongs to this identity,
        // even if the table is full or the game already started.
        const mine = myIdentity
          ? room!.members.find((m) => m.identity && m.identity === myIdentity)
          : undefined;
        if (mine) {
          const previous = mine.session;
          mine.session = key;
          mine.left = false;
          mine.leftAt = undefined;
          if (next.sessions[previous]) delete next.sessions[previous].roomId;
          session.roomId = room!.id;
          message = "Vous avez retrouvé votre place à cette table.";
          if (room!.spectators.some((sp) => sp.session === key))
            room!.spectators = room!.spectators.filter(
              (sp) => sp.session !== key,
            );
          if (room) {
            room.revision += 1;
            room.updated = this.now();
          }
          session.requests.push(requestId);
          session.requests = session.requests.slice(-128);
          session.expires = this.now() + 30 * 86400000;
          this.save(next);
          this.seen.set(key, this.now());
          return { snapshot: this.snapshot(token), message };
        }
        const wantsSpectator = input.asSpectator === true;
        if (wantsSpectator) {
          if (room!.spectators.length >= 20)
            fail("Trop de spectateurs pour cette table.", 409);
          if (
            room!.spectators.some(
              (sp) => sp.identity && sp.identity === myIdentity,
            )
          )
            fail("Vous suivez déjà cette table.", 409);
          room!.spectators.push({
            session: key,
            name: session.name,
            ...(myIdentity ? { identity: myIdentity } : {}),
          });
          session.roomId = room!.id;
          message = "Vous suivez la table en spectateur.";
          room!.revision += 1;
          room!.updated = this.now();
          session.requests.push(requestId);
          session.requests = session.requests.slice(-128);
          session.expires = this.now() + 30 * 86400000;
          this.save(next);
          this.seen.set(key, this.now());
          return { snapshot: this.snapshot(token), message };
        }
        if (room!.state)
          fail(
            "La partie a déjà commencé : entrez en spectateur ou attendez la fin de la manche.",
            409,
            "table_started",
          );
        if (room!.members.length >= room!.config.playerCount)
          fail("Table complète.", 409, "table_full");
      }
      const joined = room!;
      let slot = 0;
      while (joined.members.some((m) => m.slot === slot)) slot++;
      joined.members.push({
        session: key,
        slot,
        name: session.name,
        ready: false,
        ...(myIdentity ? { identity: myIdentity } : {}),
      });
      session.roomId = joined.id;
      room = joined;
    } else if (cmd === "setOptions") {
      if (!room) fail("Vous ne faites partie d’aucune table.", 404);
      const r = room!;
      if (r.host !== key)
        fail("Seul l’hôte peut modifier les options de la table.", 403);
      if (r.state)
        fail(
          "Les options ne se modifient plus après le démarrage.",
          409,
          "table_started",
        );
      if (typeof input.allowReplacement !== "boolean")
        fail("Option de remplacement invalide.");
      r.allowReplacement = input.allowReplacement as boolean;
      message = r.allowReplacement
        ? "Remplacement des joueurs ayant quitté la partie : activé."
        : "Remplacement des joueurs ayant quitté la partie : désactivé.";
    } else if (cmd === "replace") {
      if (!room) fail("Vous ne faites partie d’aucune table.", 404);
      const r = room!;
      const watcher = r.spectators.find((sp) => sp.session === key);
      if (!watcher) fail("Seul un spectateur peut remplacer un joueur.", 403);
      const me = watcher!;
      if (!r.allowReplacement)
        fail(
          "Le remplacement des joueurs ayant quitté la partie est désactivé pour cette table.",
          409,
          "replacement_disabled",
        );
      const target =
        input.slot === undefined
          ? r.members.find((m) => m.left)
          : r.members.find((m) => m.slot === input.slot);
      if (!target || !target.left)
        fail(
          "Aucun siège libéré à reprendre pour le moment.",
          409,
          "no_free_seat",
        );
      const seat = target!;
      // Release the session of the player who left: it no longer holds that seat.
      if (next.sessions[seat.session]) delete next.sessions[seat.session].roomId;
      seat.session = key;
      seat.name = me.name;
      seat.left = false;
      seat.leftAt = undefined;
      if (myIdentity) seat.identity = myIdentity;
      r.spectators = r.spectators.filter((sp) => sp.session !== key);
      session.roomId = r.id;
      // The hand is inherited as-is: no card is ever redistributed.
      message = "Vous avez repris ce siège.";
    } else {
      if (!room) fail("Vous ne faites partie d’aucune table.", 404);
      const r = room!;
      const member = r.members.find((m) => m.session === key);
      const watcher = r.spectators.find((sp) => sp.session === key);
      if (!member && !watcher)
        fail("Vous ne faites partie d’aucune table.", 404);
      // Optimistic revision only guards commands that mutate shared state. Leaving
      // or deleting one's own table must answer on authorisation, not staleness.
      if (
        ["ready", "start", "action", "claimHost"].includes(cmd) &&
        input.revision !== r.revision
      )
        fail(
          "La table a changé. Actualisez puis réessayez.",
          409,
          "stale_revision",
        );
      if (cmd === "close") {
        if (r.host !== key) fail("Seul l’hôte peut supprimer la table.", 403);
        if (r.state && r.state.phase !== "game_end")
          fail(
            "Une partie commencée ne peut pas être supprimée.",
            409,
            "table_started",
          );
        for (const m of r.members)
          if (next.sessions[m.session]) delete next.sessions[m.session].roomId;
        for (const sp of r.spectators)
          if (next.sessions[sp.session])
            delete next.sessions[sp.session].roomId;
        delete next.rooms[r.id];
        room = undefined;
        message = "Table supprimée.";
      } else if (cmd === "stopWatching") {
        if (!watcher) fail("Vous n’êtes pas spectateur de cette table.", 404);
        r.spectators = r.spectators.filter((sp) => sp.session !== key);
        delete session.roomId;
        message = "Vous ne suivez plus cette table.";
      } else if (!member) {
        fail(
          "Vous êtes spectateur : cette action est réservée aux joueurs.",
          403,
        );
      } else if (cmd === "leave") {
        if (r.state && r.state.phase !== "game_end") {
          // Keep the seat and the hand for the owner, mark it replaceable, and
          // release this session: the same browser comes back through its
          // identity (which reclaims the seat as long as nobody took it).
          member.left = true;
          member.leftAt = this.now();
          leaving = true;
          delete session.roomId;
          message = r.allowReplacement
            ? "Vous avez quitté la partie. Votre siège peut être repris par un spectateur."
            : "Vous avez quitté la partie. Votre siège reste réservé.";
          if (r.host === key)
            r.host = r.members.find((m) => m.session !== key)?.session ?? key;
        } else {
          r.members = r.members.filter((m) => m.session !== key);
          delete session.roomId;
          if (!r.members.length) {
            delete next.rooms[r.id];
            room = undefined;
          } else if (r.host === key) r.host = r.members[0].session;
        }
      } else if (cmd === "ready") {
        if (r.state) fail("La partie a déjà commencé.");
        if (typeof input.ready !== "boolean") fail("Statut invalide.");
        member.ready = input.ready as boolean;
      } else if (cmd === "claimHost") {
        if (this.now() - (this.seen.get(r.host) ?? 0) < 30000)
          fail("L’hôte est encore connecté.");
        r.host = key;
        message = "Vous êtes maintenant l’hôte.";
      } else if (cmd === "start") {
        if (r.host !== key) fail("Seul l’hôte peut démarrer.", 403);
        if (
          r.state ||
          r.members.length !== r.config.playerCount ||
          r.members.some(
            (m) =>
              m.left ||
              !m.ready ||
              this.now() - (this.seen.get(m.session) ?? 0) >= PRESENCE_MS,
          )
        )
          fail(
            "Toutes les places doivent être occupées par des joueurs connectés et prêts.",
          );
        let state = engine.createInitialGameState(
          r.config,
          [...r.members].sort((a, b) => a.slot - b.slot).map((m) => m.name),
        );
        state = {
          ...state,
          players: state.players.map((p) => ({ ...p, isAI: false })),
        };
        state = engine.performDrawing(state);
        state = engine.startNewRound(state);
        assertDeckIntegrity(state);
        r.state = state;
        r.config = state.config;
      } else if (cmd === "action") {
        const state = r.state;
        if (!state) fail("La partie n’a pas commencé.");
        const action = record(input.action),
          type = text(action.type, "Action", 40),
          viewerId = `player-${member.slot}`;
        if (
          type !== "report" &&
          type !== "nextRound" &&
          state!.players[state!.currentPlayerIndex].id !== viewerId
        )
          fail("Ce n’est pas votre tour.", 403);
        let updated = state!;
        switch (type) {
          case "draw":
            updated = engine.drawCard(state!);
            break;
          case "chop":
            updated = engine.chopCard(state!);
            break;
          case "cancelChop":
            updated = engine.rejectChop(state!);
            break;
          case "takeBack":
            updated = engine.takeBackCombinations(state!);
            break;
          case "confirmOpening":
            updated = engine.confirmOpening(state!);
            break;
          case "discard":
            if (
              action.faceDown !== undefined &&
              typeof action.faceDown !== "boolean"
            )
              fail("Défausse invalide.");
            updated = engine.discard(
              state!,
              text(action.cardId, "Carte"),
              action.faceDown === true,
            );
            break;
          case "place": {
            if (action.kind !== "tierce" && action.kind !== "carre")
              fail("Combinaison invalide.");
            let placement: JokerPlacement | undefined;
            if (action.jokerPlacement) {
              const p = record(action.jokerPlacement),
                rep = record(p.represents);
              if (
                !Number.isInteger(p.position) ||
                Number(p.position) < 0 ||
                Number(p.position) > 107 ||
                !RANKS.includes(rep.rank as never) ||
                !SUITS.includes(rep.suit as never)
              )
                fail("Position du Joker invalide.");
              placement = {
                jokerId: text(p.jokerId, "Joker"),
                position: Number(p.position),
                represents: {
                  rank: rep.rank as JokerPlacement["represents"]["rank"],
                  suit: rep.suit as JokerPlacement["represents"]["suit"],
                },
              };
            }
            updated = engine.placeCombination(
              state!,
              ids(action.cardIds),
              action.kind as "tierce" | "carre",
              placement,
            );
            break;
          }
          case "add":
            if (
              action.side !== undefined &&
              action.side !== "higher" &&
              action.side !== "lower"
            )
              fail("Côté du Joker invalide.");
            updated = engine.addToCombination(
              state!,
              text(action.cardId, "Carte"),
              text(action.comboId, "Combinaison"),
              action.side as "higher" | "lower" | undefined,
            );
            break;
          case "recover":
            updated = engine.recoverJoker(
              state!,
              text(action.comboId, "Combinaison"),
              ids(action.cardIds),
            );
            break;
          case "returnCarre":
            updated = engine.returnCarreToBase(
              state!,
              text(action.comboId, "Combinaison"),
            );
            break;
          case "report": {
            const fault = engine.REPORTABLE_FAULTS.find(
              (f) => f.type === action.fault,
            );
            if (!fault) fail("Faute inconnue.");
            const result = engine.reportFault(
              state!,
              viewerId,
              text(action.accusedId, "Joueur"),
              fault!.type,
            );
            updated = result.state;
            message = result.message;
            break;
          }
          case "nextRound":
            if (r.host !== key)
              fail("Seul l’hôte peut lancer la manche suivante.", 403);
            if (state!.phase !== "round_end")
              fail("La manche n’est pas terminée.");
            updated = engine.startNewRound(state!);
            break;
          default:
            fail("Action inconnue.");
        }
        if (updated === state && type !== "report")
          fail(
            "Action refusée par les règles du jeu. Vérifiez l’ouverture, la carte CHOP et la sélection.",
            422,
          );
        assertDeckIntegrity(updated);
        r.state = updated;
      } else fail("Commande inconnue.");
    }
    if (room) {
      room.revision++;
      room.updated = this.now();
    }
    session.requests.push(requestId);
    session.requests = session.requests.slice(-128);
    session.expires = this.now() + 30 * 86400000;
    this.save(next);
    if (leaving) this.seen.delete(key);
    else this.seen.set(key, this.now());
    return { snapshot: this.snapshot(token), message };
  }
}
const globals = globalThis as typeof globalThis & { dzOnline?: OnlineService };
export function onlineService() {
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.MULTIPLAYER_PUBLIC_ORIGIN?.startsWith("https://") ||
      !process.env.MULTIPLAYER_STORE_PATH?.startsWith("/"))
  )
    throw new OnlineError(
      "Multijoueur non configuré : origine HTTPS et stockage persistant requis sur le serveur.",
      503,
    );
  return (globals.dzOnline ??= new OnlineService());
}
