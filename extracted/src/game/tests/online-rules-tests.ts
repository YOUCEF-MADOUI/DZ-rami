import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { POST, GET } from "../../app/api/multiplayer/route";
import { DEFAULT_CONFIG } from "../core/types";
const folder = mkdtempSync(join(tmpdir(), "dz-online-rules-"));
process.env.MULTIPLAYER_STORE_PATH = join(folder, "state.json");
delete process.env.MULTIPLAYER_PUBLIC_ORIGIN;
const HOST = "game.example";
const url = `https://${HOST}/api/multiplayer`;
const post = (
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  POST(
    new NextRequest(url, {
      method: "POST",
      headers: {
        host: HOST,
        origin: `https://${HOST}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
const get = (headers: Record<string, string> = {}) =>
  GET(new NextRequest(url, { headers: { host: HOST, ...headers } }));
const json = async (r: Response) => (await r.json()) as Record<string, never>;
const tokenOf = async () => {
  const created = await post({ command: "session", tokenTransport: true });
  return (await json(created)).token as unknown as string;
};
type RoomView = {
  room: {
    id: string;
    name: string;
    config: Record<string, unknown>;
    viewerId: string;
    capacity: number;
    count: number;
  };
};
const roomOf = async (token: string) =>
  (
    (await json(await post({ command: "heartbeat", sessionToken: token })))
      .snapshot as unknown as RoomView
  ).room;
const createTable = (
  token: string,
  tableName: string,
  config: Record<string, unknown> = {},
) =>
  post({
    command: "create",
    requestId: `c-${tableName}`,
    sessionToken: token,
    name: "Hôte",
    tableName,
    private: false,
    config,
  });
let passed = 0;
const test = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  passed += 1;
  console.log(`✅ ${name}`);
};
async function main() {
  await test("default rules are stored as-is when the client sends none", async () => {
    const token = await tokenOf();
    await createTable(token, "Règles par défaut", {
      variant: "classic",
      playerCount: 3,
    });
    const config = (await roomOf(token)).config;
    assert.equal(config.playerCount, 3);
    for (const key of [
      "chopObligatoire",
      "tierceObligatoire",
      "rsScorePerCard",
      "maxCycles",
    ] as const)
      assert.deepEqual(config[key], DEFAULT_CONFIG[key], key);
    // targetScore defaults to 0 ("no limit") in the UI and on the wire.
    assert.equal(config.targetScore, DEFAULT_CONFIG.targetScore ?? 0);
  });
  await test("custom rules reach the server unchanged and survive a reload", async () => {
    const token = await tokenOf();
    const custom = {
      variant: "classic",
      playerCount: 2,
      chopObligatoire: true,
      malusChopOuverture: 75,
      malusChopJoueurOuvertActif: false,
      malusChopJoueurOuvert: 30,
      chopSeulementOuverture: true,
      chopCarteObligatoireAJouer: true,
      tierceObligatoire: true,
      carreResponsable: "detenteur",
      faultePenalty: 120,
      faulteJokerPenalty: 240,
      playableDiscardPenalty: 130,
      carreNotRecoveredPenalty: 90,
      rsScorePerCard: 15,
      rjScorePerCard: 25,
      rsNonOpenedPenalty: 150,
      rjNonOpenedPenalty: 250,
      maxCycles: 5,
      targetScore: 1500,
    };
    await createTable(token, "Règles personnalisées", custom);
    // A later reload reads the stored room, never the general settings.
    const afterReload = (await roomOf(token)).config;
    for (const [key, value] of Object.entries(custom))
      assert.deepEqual(afterReload[key], value, key);
  });
  await test("each table keeps its own independent rule set", async () => {
    const first = await tokenOf();
    await createTable(first, "Indépendante A", {
      ...DEFAULT_CONFIG,
      playerCount: 2,
      tierceObligatoire: true,
      rsScorePerCard: 20,
    });
    const second = await tokenOf();
    const created = await post({
      command: "create",
      requestId: "c-B",
      sessionToken: second,
      name: "Hôte B",
      tableName: "Indépendante B",
      private: false,
      config: {
        ...DEFAULT_CONFIG,
        playerCount: 5,
        tierceObligatoire: false,
        rsScorePerCard: 5,
        chopObligatoire: true,
      },
    });
    assert.equal(created.status, 200);
    const a = (await roomOf(first)).config;
    const b = (await roomOf(second)).config;
    assert.equal(a.tierceObligatoire, true);
    assert.equal(a.rsScorePerCard, 20);
    assert.equal(a.chopObligatoire, false);
    assert.equal(b.tierceObligatoire, false);
    assert.equal(b.rsScorePerCard, 5);
    assert.equal(b.chopObligatoire, true);
    assert.equal(a.playerCount, 2);
    assert.equal(b.playerCount, 5);
    // Activity on one table cannot touch the other's rules.
    const current = (
      await json(await post({ command: "heartbeat", sessionToken: second }))
    ).snapshot as unknown as RoomView;
    const revision = (current.room as unknown as { revision: number }).revision;
    assert.equal(
      (
        await post({
          command: "ready",
          requestId: "ready-B",
          sessionToken: second,
          revision,
          ready: true,
        })
      ).status,
      200,
    );
    const aAgain = (await roomOf(first)).config;
    assert.deepEqual(aAgain, a);
    assert.deepEqual((await roomOf(second)).config, b);
  });
  await test("a joiner receives the host rules and cannot change them", async () => {
    const host = await tokenOf();
    await createTable(host, "Règles de l’hôte", {
      ...DEFAULT_CONFIG,
      playerCount: 2,
      tierceObligatoire: true,
      maxCycles: 4,
    });
    const hostRules = (await roomOf(host)).config;
    const guest = await tokenOf();
    // The joiner sends its own rules: they must be ignored entirely.
    const joined = await post(
      {
        command: "join",
        requestId: "j-1",
        sessionToken: guest,
        name: "Invité",
        tableId: "règles de l’hôte",
        config: {
          ...DEFAULT_CONFIG,
          tierceObligatoire: false,
          maxCycles: 1,
          chopObligatoire: true,
        },
      },
      {},
    );
    assert.equal(joined.status, 200);
    const guestView = await roomOf(guest);
    assert.deepEqual(guestView.config, hostRules);
    assert.equal(guestView.config.tierceObligatoire, true);
    assert.equal(guestView.config.maxCycles, 4);
    assert.equal(guestView.config.chopObligatoire, false);
    assert.deepEqual((await roomOf(host)).config, hostRules);
    // There is no command that lets a member edit the rules of a live table.
    const guestRoom = (
      await json(await post({ command: "heartbeat", sessionToken: guest }))
    ).snapshot as unknown as RoomView;
    const attempt = await post(
      {
        command: "config",
        requestId: "j-2",
        sessionToken: guest,
        revision: (guestRoom.room as unknown as { revision: number }).revision,
        config: { ...hostRules, maxCycles: 9 },
      },
      {},
    );
    // Unknown command → the room is untouched, no rule edit is possible.
    assert.equal(attempt.status, 400);
    assert(String((await json(attempt)).error).includes("Commande inconnue"));
    assert.deepEqual((await roomOf(host)).config, hostRules);
  });
  await test("2v2 forces four players and disables CHOP rules even if the client claims otherwise", async () => {
    const token = await tokenOf();
    const crafted = {
      variant: "teams",
      playerCount: 4,
      chopObligatoire: true,
      malusChopOuverture: 200,
      malusChopJoueurOuvertActif: true,
      malusChopJoueurOuvert: 100,
      chopSeulementOuverture: true,
      chopCarteObligatoireAJouer: true,
      tierceObligatoire: true,
      targetScore: 800,
    };
    await createTable(token, "Équipes verrouillées", crafted);
    const config = (await roomOf(token)).config;
    assert.equal(config.variant, "teams");
    assert.equal(config.playerCount, 4);
    assert.equal(config.chopObligatoire, false);
    assert.equal(config.malusChopOuverture, 0);
    assert.equal(config.malusChopJoueurOuvert, 0);
    assert.equal(config.malusChopJoueurOuvertActif, false);
    assert.equal(config.rsScorePerCard, 10);
    assert.equal(config.rjScorePerCard, 20);
    assert.equal(config.rsNonOpenedPenalty, 100);
    assert.equal(config.rjNonOpenedPenalty, 200);
    // Rules the team mode really honours are preserved (a previous request made
    // the two CHOP obligations effective in 2v2).
    assert.equal(config.chopSeulementOuverture, true);
    assert.equal(config.chopCarteObligatoireAJouer, true);
    assert.equal(config.tierceObligatoire, true);
    assert.equal(config.targetScore, 800);
    // The session already owns a table: creating another one is refused before validation.
    const wrongCount = await post({
      command: "create",
      requestId: "teams-3p",
      sessionToken: token,
      name: "Hôte",
      tableName: "Équipes 3 joueurs",
      private: false,
      config: { ...crafted, playerCount: 3 },
    });
    assert.equal(wrongCount.status, 409);
    // A fresh session sending 3 players in teams mode is refused by the server.
    const other = await tokenOf();
    const refused = await post({
      command: "create",
      requestId: "teams-3p-b",
      sessionToken: other,
      name: "Hôte",
      tableName: "Équipes 3 joueurs B",
      private: false,
      config: { ...crafted, playerCount: 3 },
    });
    assert.equal(refused.status, 400);
    assert(String((await json(refused)).error).includes("quatre joueurs"));
  });
  await test("out-of-range and mistyped rules are refused with an explicit reason", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ maxCycles: 0 }, "maxCycles"],
      [{ maxCycles: 11 }, "maxCycles"],
      [{ maxCycles: 2.5 }, "maxCycles"],
      [{ rsScorePerCard: 500 }, "rsScorePerCard"],
      [{ rsScorePerCard: 1 }, "rsScorePerCard"],
      [{ faultePenalty: 9999 }, "faultePenalty"],
      [{ playableDiscardPenalty: -10 }, "playableDiscardPenalty"],
      [{ targetScore: 5000 }, "targetScore"],
      [{ chopObligatoire: "yes" }, "chopObligatoire"],
      [{ tierceObligatoire: 1 }, "tierceObligatoire"],
      [{ carreResponsable: "autre" }, "carré"],
      [{ aiDifficulty: "insane" }, "robots"],
      [{ playerCount: 7 }, "joueurs"],
      [{ variant: "casino" }, "Mode inconnu"],
    ];
    let index = 0;
    for (const [patch, expected] of cases) {
      const token = await tokenOf();
      const response = await post({
        command: "create",
        requestId: `bad-${(index += 1)}`,
        sessionToken: token,
        name: "Hôte",
        tableName: `Refus ${index}`,
        private: false,
        config: { ...DEFAULT_CONFIG, ...patch },
      });
      assert.equal(response.status, 400, `${expected} should be refused`);
      const body = await json(response);
      assert(
        String(body.error).toLowerCase().includes(expected.toLowerCase()),
        `${expected} → ${body.error}`,
      );
      const room = (
        await json(await post({ command: "heartbeat", sessionToken: token }))
      ).snapshot as unknown as { room: unknown };
      assert.equal(
        room.room,
        null,
        "no table may be created on a refused request",
      );
    }
  });
  await test("private tables still need their password and never expose its hash", async () => {
    const host = await tokenOf();
    await post({
      command: "create",
      requestId: "priv-1",
      sessionToken: host,
      name: "Hôte",
      tableName: "Règles privées",
      private: true,
      password: "secret-rules-1",
      config: { ...DEFAULT_CONFIG, playerCount: 2, tierceObligatoire: true },
    });
    const guest = await tokenOf();
    const wrong = await post(
      {
        command: "join",
        requestId: "priv-2",
        sessionToken: guest,
        name: "Invité",
        tableId: "règles privées",
        password: "mauvais-mot-de-passe",
      },
      {},
    );
    assert.equal(wrong.status, 403);
    const right = await post(
      {
        command: "join",
        requestId: "priv-3",
        sessionToken: guest,
        name: "Invité",
        tableId: "règles privées",
        password: "secret-rules-1",
      },
      {},
    );
    assert.equal(right.status, 200);
    const view = await roomOf(guest);
    assert.equal(view.config.tierceObligatoire, true);
    assert.equal(JSON.stringify(view).includes("secret-rules-1"), false);
    assert.equal(JSON.stringify(view).includes("passwordHash"), false);
  });
  await test("a never-started table with nobody connected disappears from the list", async () => {
    const ghost = await tokenOf();
    await createTable(ghost, "Table fantôme", {
      ...DEFAULT_CONFIG,
      playerCount: 2,
    });
    const watcher = await tokenOf();
    const listedBefore = (
      (await json(await post({ command: "heartbeat", sessionToken: watcher })))
        .snapshot as unknown as {
        tables: { name: string }[];
      }
    ).tables;
    assert(
      listedBefore.some((t) => t.name === "Table fantôme"),
      "a table with an active creator is listed",
    );
    // The creator's tab is closed: no heartbeat for longer than the grace period.
    const future = Date.now() + 300000;
    const originalNow = Date.now;
    Date.now = () => future;
    try {
      const after = (
        (
          await json(
            await post({ command: "heartbeat", sessionToken: watcher }),
          )
        ).snapshot as unknown as {
          tables: { name: string }[];
        }
      ).tables;
      assert.equal(
        after.some((t) => t.name === "Table fantôme"),
        false,
        "ghost table must be gone",
      );
      // The abandoned room is really deleted, not merely hidden.
      const ghostView = (
        (await json(await post({ command: "heartbeat", sessionToken: ghost })))
          .snapshot as unknown as {
          room: unknown;
        }
      ).room;
      assert.equal(ghostView, null);
    } finally {
      Date.now = originalNow;
    }
  });
  await test("the host can delete a waiting table for everyone", async () => {
    const host = await tokenOf();
    await createTable(host, "À supprimer", {
      ...DEFAULT_CONFIG,
      playerCount: 2,
    });
    const guest = await tokenOf();
    await post(
      {
        command: "join",
        requestId: "j-close",
        sessionToken: guest,
        name: "Invité",
        tableId: "À supprimer",
      },
      {},
    );
    // A guest cannot delete the table.
    assert.equal(
      (
        await post({
          command: "close",
          requestId: "c-guest",
          sessionToken: guest,
        })
      ).status,
      403,
    );
    assert.equal((await roomOf(host)).name, "À supprimer");
    // The host can, and both seats are freed.
    assert.equal(
      (
        await post({
          command: "close",
          requestId: "c-host",
          sessionToken: host,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        (await json(await post({ command: "heartbeat", sessionToken: host })))
          .snapshot as unknown as { room: unknown }
      ).room,
      null,
    );
    assert.equal(
      (
        (await json(await post({ command: "heartbeat", sessionToken: guest })))
          .snapshot as unknown as { room: unknown }
      ).room,
      null,
      "the guest is released too",
    );
    // The freed session can create a new table right away.
    assert.equal(
      (await createTable(host, "Nouvelle après suppression")).status,
      200,
    );
  });
  await test("distinct refusal codes let the client react precisely", async () => {
    const host = await tokenOf();
    await createTable(host, "Codes", { ...DEFAULT_CONFIG, playerCount: 2 });
    const revision = (
      (await json(await post({ command: "heartbeat", sessionToken: host })))
        .snapshot as unknown as {
        room: { revision: number };
      }
    ).room.revision;
    const stale = await post({
      command: "ready",
      requestId: "s-1",
      sessionToken: host,
      revision: revision + 5,
      ready: true,
    });
    assert.equal(stale.status, 409);
    assert.equal((await json(stale)).code, "stale_revision");
    const seated = await post(
      {
        command: "join",
        requestId: "s-2",
        sessionToken: host,
        name: "Hôte",
        tableId: "Codes",
      },
      {},
    );
    assert.equal(seated.status, 409);
    assert.equal((await json(seated)).code, "already_seated");
    const started = await tokenOf();
    await post(
      {
        command: "create",
        requestId: "s-3",
        sessionToken: started,
        name: "Hôte",
        tableName: "Démarrée",
        private: false,
        config: { ...DEFAULT_CONFIG, playerCount: 2 },
      },
      {},
    );
    const second = await tokenOf();
    await post(
      {
        command: "join",
        requestId: "s-4",
        sessionToken: second,
        name: "Invité",
        tableId: "Démarrée",
      },
      {},
    );
    const startedRevision = async (token: string) =>
      (
        (await json(await post({ command: "heartbeat", sessionToken: token })))
          .snapshot as unknown as { room: { revision: number } }
      ).room.revision;
    await post(
      {
        command: "ready",
        requestId: "s-5",
        sessionToken: started,
        revision: await startedRevision(started),
        ready: true,
      },
      {},
    );
    await post(
      {
        command: "ready",
        requestId: "s-6",
        sessionToken: second,
        revision: await startedRevision(second),
        ready: true,
      },
      {},
    );
    await post(
      {
        command: "start",
        requestId: "s-7",
        sessionToken: started,
        revision: await startedRevision(started),
      },
      {},
    );
    assert.equal(
      (
        await post({
          command: "close",
          requestId: "s-8",
          sessionToken: started,
        })
      ).status,
      409,
    );
  });
  console.log(`Online table rules: ${passed} tests passed`);
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => rmSync(folder, { recursive: true, force: true }));
