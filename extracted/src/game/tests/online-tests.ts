import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { OnlineService, OnlineError } from "../online/server";
import {
  DEFAULT_CONFIG,
  type GameState,
  type GameCard,
  type Combination,
} from "../core/types";
import { createDeck, withDeckRandom, shuffleDeck } from "../core/deck";
import { assertDeckIntegrity } from "../core/deck-integrity";
let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`✅ ${name}`);
};
let time = 1700000000000;
const folder = mkdtempSync(join(tmpdir(), "dz-online-")),
  file = join(folder, "state.json");
let service = new OnlineService(file, () => time);
const tokens = Array.from({ length: 6 }, () => service.session().token);
const snap = (i: number) => service.snapshot(tokens[i]);
const cmd = (i: number, command: string, extra: Record<string, unknown> = {}) =>
  service.command(tokens[i], {
    command,
    requestId: randomUUID(),
    revision: snap(i).room?.revision,
    ...extra,
  });
const rejects = (fn: () => unknown, status?: number) =>
  assert.throws(
    fn,
    (e: unknown) =>
      e instanceof OnlineError && (!status || e.status === status),
  );
const action = (i: number, a: Record<string, unknown>) =>
  cmd(i, "action", { action: a });
function fixture(update: (state: GameState) => GameState) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const roomId = snap(0).room!.id;
  data.rooms[roomId].state = update(data.rooms[roomId].state);
  assertDeckIntegrity(data.rooms[roomId].state);
  writeFileSync(file, JSON.stringify(data));
  service = new OnlineService(file, () => time);
  tokens.forEach((t) => service.touch(t));
}
const deck = createDeck();
const card = (id: string) => deck.find((c) => c.id === id)!;
function rig(
  state: GameState,
  hands: GameCard[][],
  combos: Combination[] = [],
): GameState {
  const used = new Set(
    [...hands.flat(), ...combos.flatMap((c) => c.cards)].map((c) => c.id),
  );
  return {
    ...state,
    phase: "playing",
    currentPlayerIndex: 0,
    players: state.players.map((p, i) => ({
      ...p,
      status: "opened",
      hand: hands[i] ?? [],
    })),
    deck: deck.filter((c) => !used.has(c.id)),
    discardPile: [],
    basePile: [],
    tableCombinations: combos,
    actionHistory: [],
    lastCompletedTurnAction: null,
    lastCompletedTurnActionsByPlayer: {},
    lastDiscardFaceDown: false,
    turnState: {
      ...state.turnState!,
      playerId: "player-0",
      phase: "playing",
      hasDrawn: true,
      drawSource: undefined,
      mandatoryChopCardId: undefined,
      temporaryCombinations: [],
      actionsThisTurn: [],
      recoveredJokers: [],
      reusedJokers: [],
    },
  };
}
try {
  test("Opaque sessions authenticate; no client supplied player identity", () => {
    assert.equal(tokens[0].length, 64);
    assert.equal(service.session(tokens[0]).token, tokens[0]);
    rejects(() => service.snapshot("forged"), 401);
  });
  test("Private table requires a password; private tables/hashes never listed", () => {
    rejects(() =>
      cmd(0, "create", {
        name: "Alice",
        tableName: "Private",
        private: true,
        password: "short",
        config: DEFAULT_CONFIG,
      }),
    );
    const room = cmd(0, "create", {
      name: "Alice",
      tableName: "Private",
      private: true,
      password: "correct-password",
      config: { ...DEFAULT_CONFIG, playerCount: 2 },
    }).snapshot.room!;
    assert(room.private);
    assert.equal(snap(1).tables.length, 0);
    assert(!JSON.stringify(snap(0)).includes("password"));
    const stored = readFileSync(file, "utf8");
    assert(!stored.includes("correct-password"));
    assert(!stored.includes(tokens[0]));
    rejects(
      () =>
        cmd(1, "join", {
          name: "Bob",
          tableId: room.id,
          password: "wrong-password",
        }),
      403,
    );
    rejects(
      () =>
        cmd(1, "join", {
          name: "Bob",
          tableId: "missing",
          password: "correct-password",
        }),
      404,
    );
    cmd(1, "join", {
      name: "Bob",
      tableId: "Private",
      password: "correct-password",
    });
    assert.equal(snap(0).room!.count, 2);
    rejects(
      () =>
        cmd(2, "join", {
          name: "Cara",
          tableId: room.id,
          password: "correct-password",
        }),
      409,
    );
    rejects(
      () =>
        cmd(0, "create", {
          name: "Alice",
          tableName: "Duplicate",
          private: false,
          config: DEFAULT_CONFIG,
        }),
      409,
    );
  });
  test("Ready state, host authorization and complete attendance are enforced", () => {
    rejects(() => cmd(0, "start"));
    rejects(() => cmd(1, "start"), 403);
    cmd(0, "ready", { ready: true });
    cmd(1, "ready", { ready: true });
    cmd(0, "start");
    assert(snap(0).room!.game);
    assert(snap(1).room!.game!.players.every((p) => !p.isAI));
    rejects(
      () =>
        cmd(2, "join", {
          name: "Cara",
          tableId: "Private",
          password: "correct-password",
        }),
      409,
    );
  });
  test("Each wire DTO contains only its own hand, not stock/opponents/snapshots", () => {
    for (let i = 0; i < 2; i++) {
      const dto = snap(i).room!.game!,
        other = snap(1 - i).room!.game!;
      const wire = JSON.stringify(dto);
      for (const c of other.localHand) assert(!wire.includes(`"${c.id}"`));
      for (const field of [
        "deck",
        "basePile",
        "actionHistory",
        "lastCompletedTurnAction",
        "actionsThisTurn",
      ])
        assert(!(field in dto));
      assert(!("hand" in dto.players[1]));
      if (dto.currentPlayerId !== dto.viewerId) assert.equal(dto.actions, null);
    }
  });
  test("Out-of-turn, stolen-card, stale and duplicate actions do not mutate the game", () => {
    const current = Number(snap(0).room!.game!.currentPlayerId.split("-")[1]),
      other = 1 - current;
    rejects(
      () => action(other, { type: "draw", playerId: `player-${current}` }),
      403,
    );
    const before = snap(current).room!;
    const stolen = snap(other).room!.game!.localHand[0].id;
    rejects(() => action(current, { type: "discard", cardId: stolen }), 422);
    assert.equal(snap(current).room!.revision, before.revision);
    const request = {
      command: "action",
      requestId: randomUUID(),
      revision: before.revision,
      action: { type: "discard", cardId: before.game!.localHand[0].id },
    };
    service.command(tokens[current], request);
    const after = snap(current);
    service.command(tokens[current], request);
    assert.deepEqual(snap(current), after);
    rejects(
      () =>
        service.command(tokens[current], {
          ...request,
          requestId: randomUUID(),
        }),
      409,
    );
    action(other, { type: "draw" });
    assert.equal(snap(other).room!.game!.localHand.length, 15);
    assert.equal(snap(current).room!.game!.draw?.targetCardId, undefined);
  });
  test("JSON persistence/reconnection restores the same seat, cards and active turn", () => {
    const before = snap(0).room!;
    service = new OnlineService(file, () => time);
    tokens.forEach((t) => service.touch(t));
    const after = snap(0).room!;
    assert.deepEqual(after, before);
    assert.equal(service.session(tokens[0]).token, tokens[0]);
  });
  test("A leaving player keeps his seat and reclaims it through his browser identity", () => {
    // Each browser carries a stable identity: it is what lets a player come back.
    const identityOne = randomBytes(32).toString("hex"),
      identityTwo = randomBytes(32).toString("hex");
    service.session(tokens[0], identityOne);
    service.session(tokens[1], identityTwo);
    time += 31000;
    service.touch(tokens[1]);
    assert.equal(
      snap(1).room!.members.find((m) => m.playerId === "player-0")!.connected,
      false,
    );
    cmd(1, "claimHost");
    assert.equal(snap(1).room!.hostPlayerId, "player-1");
    const hand = snap(1).room!.game!.localHand;
    const tableId = snap(1).room!.id;
    cmd(1, "leave");
    service.touch(tokens[1]);
    // The session is released: the seat belongs to the browser identity now.
    assert.equal(snap(1).room, null, "the leaving session is no longer attached to the table");
    // The seat itself is kept for its owner, with the same hand (never re-dealt).
    const keeper = snap(0).room!;
    assert.equal(keeper.members.length, 2, "no seat was lost");
    assert.equal(keeper.leftSeats.length, 1);
    assert.equal(
      keeper.leftSeats[0].name,
      keeper.members.find((m) => m.playerId === "player-1")!.name,
    );
    // The same browser identity finds the seat again, with the same hand.
    const back = service.command(tokens[1], {
      command: "join",
      requestId: randomUUID(),
      playerIdentity: identityTwo,
      name: "Invité",
      tableId,
      password: "correct-password",
    });
    assert(back.message.includes("retrouvé"));
    const reclaimed = snap(1).room!;
    assert.equal(reclaimed.viewerId, "player-1");
    assert.deepEqual(reclaimed.game!.localHand, hand);
    assert.equal(reclaimed.leftSeats.length, 0, "the seat no longer waits for a replacement");
    // A stranger cannot take that seat: without the identity he is refused, and as
    // a spectator he only receives public information.
    const stranger = service.session().token;
    const strangerIdentity = randomBytes(32).toString("hex");
    service.session(stranger, strangerIdentity);
    let refused = false;
    try {
      service.command(stranger, {
        command: "join",
        requestId: randomUUID(),
        playerIdentity: strangerIdentity,
        name: "Intrus",
        tableId,
        password: "correct-password",
      });
    } catch (error) {
      refused = (error as { code?: string }).code === "table_started";
    }
    assert.equal(refused, true, "a started table accepts no new player");
    const asWatcher = service.command(stranger, {
      command: "join",
      requestId: randomUUID(),
      playerIdentity: strangerIdentity,
      name: "Intrus",
      tableId,
      password: "correct-password",
      asSpectator: true,
    });
    const watcherRoom = asWatcher.snapshot.room;
    assert.equal(watcherRoom?.viewerRole, "spectator");
    assert.equal(watcherRoom?.viewerId, "");
    assert.equal(watcherRoom?.game?.localHand.length, 0, "a spectator never gets a hand");
    assert.equal(watcherRoom?.game?.actions, null);
  });
  test("Public tables list capacity/status; lobby departure frees seat and transfers host", () => {
    cmd(2, "create", {
      name: "Cara",
      tableName: "Public",
      private: false,
      config: { ...DEFAULT_CONFIG, playerCount: 2 },
    });
    const id = snap(2).room!.id;
    assert(snap(3).tables.some((r) => r.id === id && r.status === "waiting"));
    cmd(3, "join", { name: "David", tableId: id });
    assert.equal(snap(2).tables.find((r) => r.id === id)?.status, "full");
    cmd(2, "leave");
    assert.equal(snap(3).room!.hostPlayerId, "player-1");
    assert.equal(snap(2).room, null);
    cmd(4, "join", { name: "Eve", tableId: id });
    assert.equal(snap(4).room!.viewerId, "player-0");
  });
  test("Actual CHOP, public addition, carré return and discard run through server engine", () => {
    fixture((state) => {
      const combo: Combination = {
        id: "brelan",
        ownerId: "player-1",
        type: "carre",
        cards: ["h-8-1", "c-8-1", "s-8-1"].map(card),
      };
      const r = rig(
        state,
        [["c-2-1", "c-3-1"].map(card), ["h-2-1", "h-3-1"].map(card)],
        [combo],
      );
      r.config.chopCarteObligatoireAJouer = true;
      r.deck = r.deck.filter((c) => c.id !== "d-8-1");
      r.discardPile = [card("d-8-1")];
      r.turnState!.phase = "must_draw";
      r.turnState!.hasDrawn = false;
      return r;
    });
    action(0, { type: "chop" });
    rejects(() => action(0, { type: "discard", cardId: "c-2-1" }), 422);
    action(0, { type: "add", cardId: "d-8-1", comboId: "brelan" });
    action(0, { type: "returnCarre", comboId: "brelan" });
    assert.equal(snap(0).room!.game!.chopPending, false);
    action(0, { type: "discard", cardId: "c-2-1" });
    assert.equal(snap(0).room!.game!.currentPlayerId, "player-1");
  });
  test("Opening drafts remain private, undo after restart, then commit atomically", () => {
    const combos: Combination[] = (["K", "Q", "J"] as const).map((rank) => ({
      id: `set-${rank}`,
      ownerId: "player-0",
      type: "carre",
      cards: ["h", "d", "c", "s"].map((s) => card(`${s}-${rank}-1`)),
    }));
    fixture((state) => {
      const r = rig(state, [
        [...combos.flatMap((c) => c.cards), card("h-2-2")],
        [card("d-2-2"), card("d-3-2")],
      ]);
      r.players[0].status = "not_opened";
      r.suite = 111;
      return r;
    });
    for (const combo of combos)
      action(0, {
        type: "place",
        kind: "carre",
        cardIds: combo.cards.map((c) => c.id),
      });
    assert.equal(snap(0).room!.game!.myDraft.length, 3);
    assert.equal(snap(1).room!.game!.myDraft.length, 0);
    assert.equal(snap(1).room!.game!.tableCombinations.length, 0);
    for (const c of combos.flatMap((c) => c.cards))
      assert(!JSON.stringify(snap(1)).includes(`"${c.id}"`));
    service = new OnlineService(file, () => time);
    tokens.forEach((t) => service.touch(t));
    action(0, { type: "takeBack" });
    assert.equal(snap(0).room!.game!.localHand.length, 13);
    for (const combo of combos)
      action(0, {
        type: "place",
        kind: "carre",
        cardIds: combo.cards.map((c) => c.id),
      });
    action(0, { type: "confirmOpening" });
    assert.equal(snap(1).room!.game!.tableCombinations.length, 3);
    assert.equal(snap(1).room!.game!.suite, 121);
  });
  test("A confirmed report ends the round and synchronizes scores", () => {
    const combo: Combination = {
      id: "run",
      ownerId: "player-0",
      type: "tierce",
      cards: ["s-J-1", "s-Q-1", "s-K-1"].map(card),
    };
    fixture((state) =>
      rig(
        state,
        [["s-A-1", "h-2-1"].map(card), ["d-2-1", "d-3-1"].map(card)],
        [combo],
      ),
    );
    action(0, { type: "discard", cardId: "s-A-1" });
    action(1, {
      type: "report",
      accusedId: "player-0",
      fault: "playable_discard",
    });
    assert.equal(snap(0).room!.game!.phase, "round_end");
    assert.deepEqual(
      snap(0).room!.game!.roundResults,
      snap(1).room!.game!.roundResults,
    );
  });
  test("RS ends/scores a round without exposing face-down identity to opponent", () => {
    fixture((state) =>
      rig(state, [[card("h-5-2")], [card("c-2-2"), card("c-3-2")]]),
    );
    action(0, { type: "discard", cardId: "h-5-2", faceDown: true });
    const mine = snap(0).room!.game!,
      other = snap(1).room!.game!;
    assert.equal(mine.phase, "round_end");
    assert.equal(mine.roundResults.at(-1)?.endType, "RS");
    assert.equal(other.lastDiscard?.card, null);
    assert(!JSON.stringify(other).includes("h-5-2"));
    assert.deepEqual(mine.roundResults, other.roundResults);
    const host = Number(snap(0).room!.hostPlayerId.split("-")[1]);
    action(host, { type: "nextRound" });
    assert.equal(snap(0).room!.game!.roundNumber, mine.roundNumber + 1);
  });
  test("RJ and report requests are engine-authoritative and shared", () => {
    fixture((state) =>
      rig(state, [[card("joker-1")], [card("c-2-2"), card("c-3-2")]]),
    );
    const report = action(1, {
      type: "report",
      accusedId: "player-0",
      fault: "playable_discard",
    });
    assert(report.message.includes("rien à signaler"));
    action(0, { type: "discard", cardId: "joker-1" });
    assert.equal(snap(1).room!.game!.roundResults.at(-1)?.endType, "RJ");
    assert.equal(snap(0).room!.game!.phase, "round_end");
  });
  test("2v2 enforces four seats and keeps opposite partners, never AI", () => {
    cmd(3, "leave");
    cmd(4, "leave");
    cmd(2, "create", {
      name: "Team A",
      tableName: "Teams",
      private: false,
      config: { ...DEFAULT_CONFIG, variant: "teams", playerCount: 4 },
    });
    for (const i of [3, 4, 5])
      cmd(i, "join", { name: `Team ${i}`, tableId: snap(2).room!.id });
    for (const i of [2, 3, 4, 5]) {
      service.touch(tokens[i]);
      cmd(i, "ready", { ready: true });
    }
    cmd(2, "start");
    assert.deepEqual(
      snap(2).room!.game!.players.map((p) => p.seat),
      ["south", "east", "north", "west"],
    );
  });
  test("Expired tables are not revived by heartbeat; expired sessions are rejected", () => {
    time += service.retentionMinutes * 60000 + 1;
    service = new OnlineService(file, () => time);
    service.touch(tokens[0]);
    assert.equal(snap(0).room, null);
    time += 31 * 86400000;
    rejects(() => snap(0), 401);
  });
  test("Scoped server randomness cannot alter solo RNG after completion or throw", () => {
    const original = shuffleDeck(deck, () => 0);
    assert.deepEqual(
      withDeckRandom(
        () => 0,
        () => shuffleDeck(deck),
      ),
      original,
    );
    assert.throws(() =>
      withDeckRandom(
        () => 0,
        () => {
          throw new Error("test");
        },
      ),
    );
    assert.deepEqual(
      shuffleDeck(deck, () => 0),
      original,
    );
  });
  test("Stored credential keys are digests, not bearer session tokens", () => {
    const data = JSON.parse(readFileSync(file, "utf8"));
    assert(data.sessions[createHash("sha256").update(tokens[0]).digest("hex")]);
  });
  console.log(`Online server: ${passed} tests passed`);
} finally {
  rmSync(folder, { recursive: true, force: true });
}
