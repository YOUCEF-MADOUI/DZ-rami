import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  creationIssues,
  connectionFailure,
  OnlineRequestError,
} from "../online/client";
import {
  requireOrigin,
  sessionCookieOptions,
  errorResponse,
} from "../online/http";
import { OnlineError } from "../online/errors";
let count = 0;
const test = (name: string, fn: () => void) => {
  fn();
  count++;
  console.log(`✅ ${name}`);
};
const valid = {
  name: "Alice",
  tableName: "Table",
  privateTable: false,
  password: "",
  connected: true,
  busy: false,
};
test("Valid authenticated public creation is enabled", () =>
  assert.deepEqual(creationIssues(valid), []));
test("Missing/whitespace name and table name have specific reasons", () => {
  const issues = creationIssues({ ...valid, name: "  ", tableName: "  " });
  assert.equal(issues.length, 2);
  assert(issues.some((i) => i.includes("nom de joueur")));
  assert(issues.some((i) => i.includes("nom de la table")));
});
test("Name alone cannot enable creation; length limits match server", () => {
  assert.equal(creationIssues({ ...valid, tableName: "" }).length, 1);
  assert.equal(
    creationIssues({
      ...valid,
      name: "x".repeat(31),
      tableName: "x".repeat(61),
    }).length,
    2,
  );
});
test("Private table password validates independently", () => {
  for (const password of ["", "short", "x".repeat(129)])
    assert.equal(
      creationIssues({ ...valid, privateTable: true, password }).length,
      1,
    );
  assert.deepEqual(
    creationIssues({ ...valid, privateTable: true, password: "password8" }),
    [],
  );
});
test("Complete form still blocks disconnected/pending server", () => {
  assert(
    creationIssues({ ...valid, connected: false })[0].includes("authentifiée"),
  );
  assert(
    creationIssues({ ...valid, busy: true })[0].includes(
      "requête est en cours",
    ),
  );
});
test("401 names both credentials and offers an explicit recovery", () => {
  const message = connectionFailure(
    new OnlineRequestError("Session requise. (HTTP 401)", 401),
  );
  assert(message.includes("cookie"));
  assert(message.includes("jeton"));
  assert(message.includes("Reconnecter"));
  assert(message.includes("401"));
  assert.equal(
    connectionFailure(
      new OnlineRequestError("Serveur indisponible (HTTP 503)", 503),
    ),
    "Serveur indisponible (HTTP 503)",
  );
});
test("Expected authentication errors keep their HTTP status and explicit reason", () => {
  const result = errorResponse(new OnlineError("Session requise.", 401));
  assert.equal(result.status, 401);
  assert.equal(
    errorResponse(new OnlineError("Mot de passe incorrect.", 403)).status,
    403,
  );
});
const old = process.env.MULTIPLAYER_PUBLIC_ORIGIN;
delete process.env.MULTIPLAYER_PUBLIC_ORIGIN;
try {
  test("HTTPS iframe cookie is HttpOnly, Secure, SameSite=None and partitioned", () => {
    const request = new NextRequest("https://localhost:3443/api/multiplayer", {
      headers: { host: "localhost:3443", origin: "https://localhost:3443" },
    });
    requireOrigin(request);
    const cookie = sessionCookieOptions(request);
    assert(cookie.httpOnly);
    assert(cookie.secure);
    assert(cookie.partitioned);
    assert.equal(cookie.sameSite, "none");
  });
  test("HTTPS origin behind an HTTP proxy still produces a Secure partitioned cookie", () => {
    const request = new NextRequest("http://localhost:3000/api/multiplayer", {
      headers: { host: "preview.e2b.app", origin: "https://preview.e2b.app" },
    });
    requireOrigin(request);
    assert(sessionCookieOptions(request).secure);
    assert(sessionCookieOptions(request).partitioned);
  });
  test("Plain HTTP development keeps SameSite=Lax, not insecure SameSite=None", () => {
    const request = new NextRequest("http://localhost:3000/api/multiplayer", {
      headers: { host: "localhost:3000", origin: "http://localhost:3000" },
    });
    requireOrigin(request);
    const c = sessionCookieOptions(request);
    assert.equal(c.sameSite, "lax");
    assert.equal(c.secure, false);
    assert(!c.partitioned);
    assert(c.httpOnly);
  });
  test("CSRF origin checks are preserved, including configured production origin", () => {
    assert.throws(() =>
      requireOrigin(
        new NextRequest("https://game.example/api", {
          headers: { host: "game.example", origin: "https://attacker.example" },
        }),
      ),
    );
    assert.throws(() =>
      requireOrigin(
        new NextRequest("https://game.example/api", {
          headers: { host: "game.example" },
        }),
      ),
    );
    process.env.MULTIPLAYER_PUBLIC_ORIGIN = "https://game.example";
    requireOrigin(
      new NextRequest("http://internal/api", {
        headers: { origin: "https://game.example" },
      }),
    );
    assert.throws(() =>
      requireOrigin(
        new NextRequest("http://internal/api", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
    );
  });
} finally {
  if (old === undefined) delete process.env.MULTIPLAYER_PUBLIC_ORIGIN;
  else process.env.MULTIPLAYER_PUBLIC_ORIGIN = old;
}
console.log(`Online form/auth: ${count} tests passed`);
