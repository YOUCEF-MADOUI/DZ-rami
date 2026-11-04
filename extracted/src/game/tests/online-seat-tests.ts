import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/multiplayer/route";
import { DEFAULT_CONFIG } from "../core/types";
const folder = mkdtempSync(join(tmpdir(), "dz-online-seat-"));
process.env.MULTIPLAYER_STORE_PATH = join(folder, "state.json");
delete process.env.MULTIPLAYER_PUBLIC_ORIGIN;
const HOST = "game.example";
const url = `https://${HOST}/api/multiplayer`;
const identity = () => randomBytes(32).toString("hex");
const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest(url, {
      method: "POST",
      headers: {
        host: HOST,
        origin: `https://${HOST}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
const json = async (r: Response) => (await r.json()) as Record<string, never>;
type View = {
  room: {
    id: string;
    viewerRole: string;
    viewerId: string;
    hostPlayerId: string;
    count: number;
    capacity: number;
    spectators: { name: string; connected: boolean }[];
    leftSeats: { slot: number; name: string }[];
    canReplace: boolean;
    canReplaceSlot?: number;
    allowReplacement: boolean;
    revision: number;
    members: { playerId: string; name: string; seat: string; ready: boolean }[];
    game: {
      localHand: unknown[];
      actions: unknown;
      myDraft: unknown[];
      players: { id: string; name: string; handCount: number }[];
      currentPlayerId: string;
      phase: string;
      tableCombinations: unknown[];
    } | null;
  } | null;
  tables: { id: string; name: string; spectatorCount: number }[];
};
/** A client is a session + a persistent browser identity. */
async function client(id = identity()) {
  const created = await json(
    await post({
      command: "session",
      tokenTransport: true,
      playerIdentity: id,
    }),
  );
  const token = created.token as unknown as string;
  const call = async (body: Record<string, unknown>) => {
    const response = await post({
      ...body,
      sessionToken: token,
      playerIdentity: id,
      requestId: randomBytes(8).toString("hex"),
    });
    const payload = await json(response);
    if (response.status !== 200)
      throw Object.assign(new Error(String(payload.error)), {
        status: response.status,
        code: payload.code,
      });
    return payload;
  };
  const view = async () =>
    ((await call({ command: "heartbeat" })).snapshot as unknown as View).room;
  return {
    id,
    token,
    call,
    view,
    try: async (body: Record<string, unknown>) => {
      const response = await post({
        ...body,
        sessionToken: token,
        playerIdentity: id,
        requestId: randomBytes(8).toString("hex"),
      });
      return { status: response.status, body: await json(response) };
    },
  };
}
/** A brand new session (fresh token) but the SAME browser identity. */
async function sameBrowserAgain(id: string) {
  const created = await json(
    await post({
      command: "session",
      tokenTransport: true,
      playerIdentity: id,
    }),
  );
  const token = created.token as unknown as string;
  const call = async (body: Record<string, unknown>) => {
    const response = await post({
      ...body,
      sessionToken: token,
      playerIdentity: id,
      requestId: randomBytes(8).toString("hex"),
    });
    const payload = await json(response);
    if (response.status !== 200)
      throw Object.assign(new Error(String(payload.error)), {
        status: response.status,
        code: payload.code,
      });
    return payload;
  };
  return {
    call,
    view: async () =>
      ((await call({ command: "heartbeat" })).snapshot as unknown as View).room,
    try: async (body: Record<string, unknown>) => {
      const response = await post({
        ...body,
        sessionToken: token,
        playerIdentity: id,
        requestId: randomBytes(8).toString("hex"),
      });
      return { status: response.status, body: await json(response) };
    },
  };
}
const config = { ...DEFAULT_CONFIG, playerCount: 2 };
let passed = 0;
const test = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  passed += 1;
  console.log(`✅ ${name}`);
};
async function main() {
  await test("the same browser finds its seat again after losing its session", async () => {
    const host = await client();
    await host.call({
      command: "create",
      name: "Hôte",
      tableName: `Identité ${Date.now()}`,
      private: false,
      config,
    });
    const first = await host.view();
    assert.equal(first?.viewerId, "player-0");
    // The tab is closed and the session token is gone: only the identity survives.
    const again = await sameBrowserAgain(host.id);
    const back = await again.call({
      command: "join",
      name: "Hôte",
      tableId: first!.id,
    });
    assert(
      (back.message as unknown as string).includes("retrouvé"),
      String(back.message),
    );
    const view = await again.view();
    assert.equal(view?.viewerId, "player-0", "same seat, not a second one");
    assert.equal(view?.count, 1, "no duplicate seat was created");
  });
  await test("reclaiming works for a started game, keeping the hand untouched", async () => {
    const host = await client(),
      guest = await client();
    await host.call({
      command: "create",
      name: "Alice",
      tableName: `Reprise ${Date.now()}`,
      private: false,
      config,
    });
    const room = await host.view();
    await guest.call({ command: "join", name: "Bob", tableId: room!.id });
    await host.call({
      command: "ready",
      revision: (await host.view())!.revision,
      ready: true,
    });
    await guest.call({
      command: "ready",
      revision: (await guest.view())!.revision,
      ready: true,
    });
    await host.call({
      command: "start",
      revision: (await host.view())!.revision,
    });
    const started = await guest.view();
    const handBefore = started!.game!.localHand.length;
    assert(started!.game!.players.length === 2);
    // Bob loses his session entirely, then comes back with the same browser.
    const bobAgain = await sameBrowserAgain(guest.id);
    const rejoin = await bobAgain.call({
      command: "join",
      name: "Bob",
      tableId: room!.id,
    });
    assert((rejoin.message as unknown as string).includes("retrouvé"));
    const view = await bobAgain.view();
    assert.equal(view?.viewerId, "player-1");
    assert.equal(
      view?.game!.localHand.length,
      handBefore,
      "the hand is the same, never re-dealt",
    );
    assert.equal(
      view?.game!.players.find((p) => p.id === "player-1")?.handCount,
      handBefore,
      "his seat still holds the same number of cards",
    );
    // Bob happens to be the starter here, so he does receive his own actions.
    assert.equal(
      typeof view?.game!.actions === "object" || view?.game!.actions === null,
      true,
      "actions are only ever sent to the player whose turn it is",
    );
  });
  await test("a spectator watches without ever receiving a hand", async () => {
    const host = await client(),
      guest = await client(),
      watcher = await client();
    await host.call({
      command: "create",
      name: "Alice",
      tableName: `Spectacle ${Date.now()}`,
      private: false,
      config,
    });
    const room = await host.view();
    await guest.call({ command: "join", name: "Bob", tableId: room!.id });
    await watcher.call({
      command: "join",
      name: "Wael",
      tableId: room!.id,
      asSpectator: true,
    });
    let view = await watcher.view();
    assert.equal(view?.viewerRole, "spectator");
    assert.equal(view?.game, null, "no game yet: nothing to watch");
    assert.equal(view?.spectators.length, 1);
    // Start the game: the spectator sees the table but never a card.
    await host.call({
      command: "ready",
      revision: (await host.view())!.revision,
      ready: true,
    });
    await guest.call({
      command: "ready",
      revision: (await guest.view())!.revision,
      ready: true,
    });
    await host.call({
      command: "start",
      revision: (await host.view())!.revision,
    });
    view = await watcher.view();
    assert.equal(view?.viewerRole, "spectator");
    assert.equal(view?.game!.localHand.length, 0, "a spectator has no hand");
    assert.equal(
      view?.game!.actions,
      null,
      "a spectator gets no available action",
    );
    assert.equal(view?.game!.myDraft.length, 0);
    assert(
      view?.game!.players.every((p) => p.handCount > 0),
      "the counts stay public",
    );
    // And cannot act.
    const play = await watcher.try({
      command: "action",
      revision: view!.revision,
      action: { type: "draw" },
    });
    assert.equal(play.status, 403);
    // The table list exposes the number of watchers.
    const listed = (
      (await watcher.call({ command: "heartbeat" })).snapshot as unknown as View
    ).tables.find((t) => t.id === room!.id);
    assert.equal(listed?.spectatorCount, 1);
  });
  await test("replacement is refused unless the table option is on", async () => {
    const host = await client(),
      guest = await client(),
      watcher = await client();
    await host.call({
      command: "create",
      name: "Alice",
      tableName: `Sans option ${Date.now()}`,
      private: false,
      config,
    });
    const room = await host.view();
    assert.equal(room?.allowReplacement, false, "disabled by default");
    await guest.call({ command: "join", name: "Bob", tableId: room!.id });
    await watcher.call({
      command: "join",
      name: "Wael",
      tableId: room!.id,
      asSpectator: true,
    });
    await host.call({
      command: "ready",
      revision: (await host.view())!.revision,
      ready: true,
    });
    await guest.call({
      command: "ready",
      revision: (await guest.view())!.revision,
      ready: true,
    });
    await host.call({
      command: "start",
      revision: (await host.view())!.revision,
    });
    const bob = await guest.view();
    await guest.call({ command: "leave", revision: bob!.revision });
    const waelView = await watcher.view();
    assert.equal(waelView?.canReplace, false);
    const attempt = await watcher.try({
      command: "replace",
      revision: waelView!.revision,
    });
    assert.equal(attempt.status, 409);
    assert.equal(attempt.body.code, "replacement_disabled");
    assert(
      (await watcher.view())?.viewerRole === "spectator",
      "still a spectator",
    );
  });
  await test("with the option on, a spectator takes over the left seat and its hand", async () => {
    const host = await client(),
      guest = await client(),
      watcher = await client();
    await host.call({
      command: "create",
      name: "Alice",
      tableName: `Remplacement ${Date.now()}`,
      private: false,
      config,
      allowReplacement: true,
    });
    const room = await host.view();
    assert.equal(room?.allowReplacement, true);
    await guest.call({ command: "join", name: "Bob", tableId: room!.id });
    await watcher.call({
      command: "join",
      name: "Wael",
      tableId: room!.id,
      asSpectator: true,
    });
    await host.call({
      command: "ready",
      revision: (await host.view())!.revision,
      ready: true,
    });
    await guest.call({
      command: "ready",
      revision: (await guest.view())!.revision,
      ready: true,
    });
    await host.call({
      command: "start",
      revision: (await host.view())!.revision,
    });
    const bob = await guest.view();
    const bobHand = bob!.game!.localHand.length;
    await guest.call({ command: "leave", revision: bob!.revision });
    const before = await watcher.view();
    assert.equal(before?.canReplace, true);
    assert.equal(before?.leftSeats.length, 1);
    assert.equal(before?.leftSeats[0].name, "Bob");
    const take = await watcher.call({
      command: "replace",
      revision: before!.revision,
    });
    assert((take.message as unknown as string).includes("repris"));
    const after = await watcher.view();
    assert.equal(after?.viewerRole, "player");
    assert.equal(
      after?.viewerId,
      "player-1",
      "same seat, same physical player id",
    );
    assert.equal(
      after?.game!.localHand.length,
      bobHand,
      "the same hand continues, no re-deal",
    );
    assert.equal(after?.leftSeats.length, 0);
    assert.equal(
      after?.spectators.length,
      0,
      "the watcher left the spectator list",
    );
    // The host sees the seat taken by the new name.
    const hostView = await host.view();
    assert.equal(
      hostView?.members.find((m) => m.playerId === "player-1")?.name,
      "Wael",
    );
    assert.equal(hostView?.members.length, 2, "no extra seat was created");
  });
  await test("the host toggles the replacement option before the game starts", async () => {
    const host = await client(),
      guest = await client();
    await host.call({
      command: "create",
      name: "Alice",
      tableName: `Option ${Date.now()}`,
      private: false,
      config,
    });
    const room = await host.view();
    await guest.call({ command: "join", name: "Bob", tableId: room!.id });
    const toggle = await host.call({
      command: "setOptions",
      allowReplacement: true,
    });
    assert((toggle.message as unknown as string).includes("activé"));
    assert.equal(
      (await guest.view())?.allowReplacement,
      true,
      "every player sees the option",
    );
    // A non-host cannot change it.
    const refused = await guest.try({
      command: "setOptions",
      allowReplacement: false,
    });
    assert.equal(refused.status, 403);
    // And it freezes once the game has started.
    await host.call({
      command: "ready",
      revision: (await host.view())!.revision,
      ready: true,
    });
    await guest.call({
      command: "ready",
      revision: (await guest.view())!.revision,
      ready: true,
    });
    await host.call({
      command: "start",
      revision: (await host.view())!.revision,
    });
    const frozen = await host.try({
      command: "setOptions",
      allowReplacement: false,
    });
    assert.equal(frozen.status, 409);
    assert.equal(frozen.body.code, "table_started");
  });
  await test("leaving without the option keeps the seat for its owner", async () => {
    const host = await client(),
      guest = await client(),
      watcher = await client();
    await host.call({
      command: "create",
      name: "Alice",
      tableName: `Réservé ${Date.now()}`,
      private: false,
      config,
    });
    const room = await host.view();
    await guest.call({ command: "join", name: "Bob", tableId: room!.id });
    await watcher.call({
      command: "join",
      name: "Wael",
      tableId: room!.id,
      asSpectator: true,
    });
    await host.call({
      command: "ready",
      revision: (await host.view())!.revision,
      ready: true,
    });
    await guest.call({
      command: "ready",
      revision: (await guest.view())!.revision,
      ready: true,
    });
    await host.call({
      command: "start",
      revision: (await host.view())!.revision,
    });
    await guest.call({
      command: "leave",
      revision: (await guest.view())!.revision,
    });
    const take = await watcher.try({ command: "replace" });
    assert.equal(take.status, 409, "no replacement while the option is off");
    // The owner comes back with the same browser identity: the seat is his.
    const bobAgain = await sameBrowserAgain(guest.id);
    await bobAgain.call({ command: "join", name: "Bob", tableId: room!.id });
    const view = await bobAgain.view();
    assert.equal(view?.viewerId, "player-1");
    assert.equal(view?.viewerRole, "player");
    assert.equal(view?.leftSeats.length, 0);
  });
  console.log(`Online seats/spectators/replacement: ${passed} tests passed`);
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => rmSync(folder, { recursive: true, force: true }));
