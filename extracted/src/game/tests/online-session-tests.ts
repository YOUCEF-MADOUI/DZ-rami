import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { POST, GET } from "../../app/api/multiplayer/route";
import { optionalToken, tokenFrom, COOKIE } from "../online/http";
import { OnlineError } from "../online/errors";
import { DEFAULT_CONFIG } from "../core/types";
// The room service reads this lazily on its first use, so setting it here is enough.
const folder = mkdtempSync(join(tmpdir(), "dz-online-session-"));
process.env.MULTIPLAYER_STORE_PATH = join(folder, "state.json");
delete process.env.MULTIPLAYER_PUBLIC_ORIGIN;
const HOST = "game.example";
let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  passed += 1;
  console.log(`✅ ${name}`);
};
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
const cookieHeader = (response: Response) =>
  (response.headers.get("set-cookie") ?? "").split(";")[0];
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const json = async (response: Response) =>
  (await response.json()) as Record<string, never>;
async function main() {
  // 1. Missing credentials: the exact 401 the user saw, with an explicit reason.
  await test("GET without cookie or bearer is refused with an explicit 401", async () => {
    const response = await get();
    assert.equal(response.status, 401);
    const body = await json(response);
    assert(String(body.error).includes("Session requise"), String(body.error));
    assert(String(body.error).includes("cookie, en-tête et jeton de corps"));
  });
  // 2. Session creation sets the HttpOnly cookie and reveals no token unless asked.
  await test("session creates the cookie without exposing a token by default", async () => {
    const response = await post({ command: "session" });
    assert.equal(response.status, 200);
    const body = await json(response);
    assert.equal(body.token, undefined);
    const cookie = cookieHeader(response);
    assert(cookie.startsWith(`${COOKIE}=`));
    assert((response.headers.get("set-cookie") ?? "").includes("HttpOnly"));
    assert.equal((await get({ cookie })).status, 200);
  });
  // 3. Same session over the Authorization header: this is what a cookie-less
  //    preview needs, and it is the very same opaque server-issued token.
  await test("the identical token works as a bearer credential", async () => {
    const created = await post({ command: "session" });
    const token = cookieHeader(created).split("=")[1];
    assert.equal(
      optionalToken(new NextRequest(url, { headers: bearer(token) })),
      token,
    );
    assert.equal((await get(bearer(token))).status, 200);
    assert.equal(
      (await post({ command: "heartbeat" }, bearer(token))).status,
      200,
    );
  });
  // 4. Token transport must reuse the session, never create a second seat.
  await test("tokenTransport reuses the bearer session instead of creating a new one", async () => {
    const created = await post({ command: "session" });
    const token = cookieHeader(created).split("=")[1];
    await post(
      {
        command: "create",
        requestId: "r-1",
        name: "Alice",
        tableName: "Bearer table",
        private: false,
        config: { ...DEFAULT_CONFIG, playerCount: 2 },
      },
      bearer(token),
    );
    const issued = await post(
      { command: "session", tokenTransport: true },
      bearer(token),
    );
    const body = await json(issued);
    assert.equal(body.token, token);
    const room = (body.snapshot as { room: { id: string; name: string } }).room;
    assert.equal(room.name, "Bearer table");
    const plain = await json(await post({ command: "session" }));
    assert.equal(plain.token, undefined);
  });
  // 5. A forged or expired bearer is refused, never silently upgraded.
  await test("unknown, malformed and absent tokens are all rejected", async () => {
    assert.equal((await get(bearer("a".repeat(64)))).status, 401);
    assert.equal((await get({ authorization: "Bearer short" })).status, 401);
    assert.equal(
      (await get({ authorization: "Basic YWxpY2U6c2VjcmV0" })).status,
      401,
    );
    assert.throws(
      () => tokenFrom(new NextRequest(url)),
      (error: unknown) => error instanceof OnlineError && error.status === 401,
    );
  });
  // 6. Identity always comes from the authenticated session, never from the body.
  await test("client-supplied player ids are ignored by the server", async () => {
    const host = await post({ command: "session" });
    const hostToken = cookieHeader(host).split("=")[1];
    await post(
      {
        command: "create",
        requestId: "r-2",
        name: "Host",
        tableName: "Identity table",
        private: false,
        config: { ...DEFAULT_CONFIG, playerCount: 2 },
      },
      bearer(hostToken),
    );
    const guest = await post({ command: "session" });
    const guestToken = cookieHeader(guest).split("=")[1];
    await post(
      {
        command: "join",
        requestId: "r-3",
        name: "Guest",
        tableId: "identity table",
      },
      bearer(guestToken),
    );
    // Send the *correct* revision so the refusal is about identity, not staleness.
    const current = await json(await get(bearer(guestToken)));
    const revision = (current.snapshot as { room: { revision: number } }).room
      .revision;
    // Claims to be the host (player-0) and asks to start: identity comes from the session.
    const forged = await post(
      {
        command: "start",
        requestId: "r-4",
        revision,
        playerId: "player-0",
        viewerId: "player-0",
        memberSlot: 0,
      },
      bearer(guestToken),
    );
    assert.equal(forged.status, 403);
    // Nothing changed: no game started, the host is still the authenticated creator.
    const after = await json(await get(bearer(guestToken)));
    const room = (
      after.snapshot as {
        room: {
          game: unknown;
          viewerId: string;
          hostPlayerId: string;
          count: number;
        };
      }
    ).room;
    assert.equal(room.game, null);
    assert.equal(room.viewerId, "player-1");
    assert.equal(room.hostPlayerId, "player-0");
    assert.equal(room.count, 2);
  });
  // 7. A forged identity in the body cannot act out of turn once a game runs.
  await test("an out-of-turn action claiming another player id is refused", async () => {
    const host = await post({ command: "session" });
    const hostToken = cookieHeader(host).split("=")[1];
    await post(
      {
        command: "create",
        requestId: "r-6",
        name: "Host",
        tableName: "Turn table",
        private: false,
        config: { ...DEFAULT_CONFIG, playerCount: 2 },
      },
      bearer(hostToken),
    );
    const guest = await post({ command: "session" });
    const guestToken = cookieHeader(guest).split("=")[1];
    await post(
      {
        command: "join",
        requestId: "r-7",
        name: "Guest",
        tableId: "turn table",
      },
      bearer(guestToken),
    );
    const revision = async (token: string) =>
      (
        (await json(await get(bearer(token)))).snapshot as {
          room: { revision: number };
        }
      ).room.revision;
    let readyIndex = 0;
    for (const token of [hostToken, guestToken])
      assert.equal(
        (
          await post(
            {
              command: "ready",
              requestId: `r-ready-${(readyIndex += 1)}`,
              revision: await revision(token),
              ready: true,
            },
            bearer(token),
          )
        ).status,
        200,
      );
    assert.equal(
      (
        await post(
          {
            command: "start",
            requestId: "r-8",
            revision: await revision(hostToken),
          },
          bearer(hostToken),
        )
      ).status,
      200,
    );
    const hostView = (await json(await get(bearer(hostToken)))).snapshot as {
      room: {
        revision: number;
        game: { currentPlayerId: string; localHand: { id: string }[] };
      };
    };
    const current = hostView.room.game.currentPlayerId;
    const attackerToken = current === "player-0" ? guestToken : hostToken;
    const attackerCard = (
      (await json(await get(bearer(attackerToken)))).snapshot as {
        room: { game: { localHand: { id: string }[] } };
      }
    ).room.game.localHand[0].id;
    const stolen = await post(
      {
        command: "action",
        requestId: "r-9",
        revision: await revision(hostToken),
        playerId: current,
        viewerId: current,
        action: { type: "discard", cardId: attackerCard },
      },
      bearer(attackerToken),
    );
    assert.equal(stolen.status, 403);
    assert(String((await json(stolen)).error).includes("tour"));
    const unchanged = (
      (await json(await get(bearer(hostToken)))).snapshot as {
        room: { revision: number };
      }
    ).room.revision;
    assert.equal(unchanged, hostView.room.revision);
  });
  // 8. Authorization is unchanged by the transport used.
  await test("origin checks and rate limits still apply with body-token transport", async () => {
    const created = await post({ command: "session", tokenTransport: true });
    const token = (await json(created)).token as unknown as string;
    const foreign = await POST(
      new NextRequest(url, {
        method: "POST",
        headers: {
          host: HOST,
          origin: "https://attacker.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ command: "heartbeat", sessionToken: token }),
      }),
    );
    assert.equal(foreign.status, 403);
    let limited = 0;
    for (let i = 0; i < 65; i += 1) {
      const attempt = await post({ command: "heartbeat", sessionToken: token });
      if (attempt.status === 429) {
        limited += 1;
        break;
      }
      assert.equal(attempt.status, 200);
    }
    assert.equal(limited, 1, "the per-session rate limit still applies");
  });
  // 9. The body token is a first-class credential (preview proxies drop headers).
  await test("the session token in the POST body authenticates on its own", async () => {
    const created = await post({ command: "session", tokenTransport: true });
    const token = (await json(created)).token as unknown as string;
    assert.equal(token.length >= 32, true);
    // No cookie, no Authorization, no X-DZ-Session: body only.
    const heartbeat = await post({ command: "heartbeat", sessionToken: token });
    assert.equal(heartbeat.status, 200);
    await post(
      {
        command: "create",
        requestId: "body-1",
        sessionToken: token,
        name: "Body",
        tableName: "Table jeton corps",
        private: false,
        config: { ...DEFAULT_CONFIG, playerCount: 2 },
      },
      {},
    );
    const view = await json(
      await post({ command: "heartbeat", sessionToken: token }),
    );
    const room = (view.snapshot as { room: { name: string } }).room;
    assert.equal(room.name, "Table jeton corps");
    // A forged body token is refused exactly like a forged cookie.
    assert.equal(
      (await post({ command: "heartbeat", sessionToken: "f".repeat(64) }))
        .status,
      401,
    );
    assert.equal(
      (await post({ command: "heartbeat", sessionToken: "player-0" })).status,
      401,
    );
  });
  // 10. The watch command is the real-time channel and it changes on demand.
  await test("watch returns a newer serial only after a real change", async () => {
    const created = await post({ command: "session", tokenTransport: true });
    const token = (await json(created)).token as unknown as string;
    await post(
      {
        command: "create",
        requestId: "watch-1",
        sessionToken: token,
        name: "Watch",
        tableName: "Table watch",
        private: false,
        config: { ...DEFAULT_CONFIG, playerCount: 2 },
      },
      {},
    );
    const first = await json(
      await post({ command: "watch", sessionToken: token, since: -1 }),
    );
    const serial = (first.snapshot as { serial: number }).serial;
    // No change: the server holds the request, then answers with the same serial.
    const started = Date.now();
    const idle = await json(
      await post({ command: "watch", sessionToken: token, since: serial }),
    );
    assert.equal((idle.snapshot as { serial: number }).serial, serial);
    assert.equal(
      Date.now() - started >= 1500,
      true,
      "the request was genuinely held open",
    );
    // A real change (ready toggle) is delivered before the hold expires.
    const view = await json(
      await post({ command: "heartbeat", sessionToken: token }),
    );
    const revision = (view.snapshot as { room: { revision: number } }).room
      .revision;
    const change = post({
      command: "ready",
      requestId: "watch-2",
      sessionToken: token,
      revision,
      ready: true,
    });
    const watchStarted = Date.now();
    const changed = await json(
      await post({ command: "watch", sessionToken: token, since: serial }),
    );
    const changeResult = await change;
    assert.equal(changeResult.status, 200);
    assert.equal(
      Date.now() - watchStarted < 2000,
      true,
      "a real change wakes the watch before the hold expires",
    );
    assert.equal((await post({ command: "watch", since: serial })).status, 401);
  });
  console.log(`Online session transport: ${passed} tests passed`);
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => rmSync(folder, { recursive: true, force: true }));
