import { NextRequest, NextResponse } from "next/server";
import { OnlineError } from "./errors";
export const COOKIE = "dz-rami-online";
/**
 * CSRF guard.
 *
 * A cross-origin browser request always carries `Origin` (form posts included),
 * so an explicit origin must match the serving host or the configured public
 * origin. Same-origin requests, however, are sent *without* `Origin` by modern
 * browsers — this app's own POST fetches included — so they are recognised by
 * the `Sec-Fetch-Site` metadata, with a same-host `Referer` as the fallback for
 * browsers that do not send it. Anything unverifiable is still refused.
 */
export function requireOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = process.env.MULTIPLAYER_PUBLIC_ORIGIN;
  const hosts = [
    request.headers.get("host"),
    // A preview/reverse proxy may rewrite `Host` but keeps the public one here.
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim(),
  ].filter((host): host is string => !!host);
  if (origin) {
    let valid = false;
    try {
      valid = allowed
        ? origin === new URL(allowed).origin
        : hosts.includes(new URL(origin).host);
    } catch {
      // `Origin: null` (sandboxed document) or a malformed value: refuse.
      valid = false;
    }
    if (!valid) throw new OnlineError("Origine non autorisée.", 403);
    return;
  }
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return;
  const referer = request.headers.get("referer");
  if (!site && referer && hosts.length) {
    try {
      if (hosts.includes(new URL(referer).host)) return;
    } catch {
      // Malformed Referer: fall through to the refusal below.
    }
  }
  throw new OnlineError("Origine non autorisée.", 403);
}
/** Call only after requireOrigin. HTTPS previews need a cross-site, partitioned cookie. */
export function sessionCookieOptions(request: NextRequest) {
  const secure =
    request.nextUrl.protocol === "https:" ||
    process.env.MULTIPLAYER_PUBLIC_ORIGIN?.startsWith("https:") === true ||
    request.headers.get("origin")?.startsWith("https://") === true ||
    // Preview proxies terminate TLS and forward the original scheme.
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ("none" as const) : ("lax" as const),
    ...(secure ? { partitioned: true } : {}),
    path: "/",
    maxAge: 30 * 86400,
  };
}
/**
 * A session token identifies the authenticated session — never a player: player
 * ids, seat numbers and viewer ids sent by a client are always ignored.
 *
 * Four transports are accepted, all carrying the same opaque server-issued token:
 *   1. the HttpOnly cookie (preferred);
 *   2. the Authorization: Bearer header;
 *   3. the X-DZ-Session header (some proxies strip Authorization);
 *   4. the POST body field `sessionToken` (proxies that rewrite headers entirely).
 * The body channel exists because a preview proxy may drop Set-Cookie *and* all
 * custom request headers; the request body is then the only forwarded channel.
 */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,200}$/;
export function optionalToken(
  request: NextRequest,
  body?: Record<string, unknown>,
): string | undefined {
  const cookie = request.cookies.get(COOKIE)?.value;
  if (cookie && TOKEN_PATTERN.test(cookie)) return cookie;
  const bearer = /^Bearer\s+(\S+)$/.exec(
    request.headers.get("authorization")?.trim() ?? "",
  );
  if (bearer && TOKEN_PATTERN.test(bearer[1])) return bearer[1];
  const custom = request.headers.get("x-dz-session");
  if (custom && TOKEN_PATTERN.test(custom)) return custom;
  const bodyToken = body?.sessionToken;
  if (typeof bodyToken === "string" && TOKEN_PATTERN.test(bodyToken))
    return bodyToken;
  return undefined;
}
export function tokenFrom(
  request: NextRequest,
  body?: Record<string, unknown>,
) {
  const token = optionalToken(request, body);
  if (!token)
    throw new OnlineError(
      "Session requise : aucune session multijoueur valide (cookie, en-tête et jeton de corps absents ou refusés). Ouvrez le menu Multijoueur pour en établir une.",
      401,
    );
  return token;
}
export function errorResponse(error: unknown) {
  if (!(error instanceof OnlineError))
    console.error("Multiplayer server error", error);
  return NextResponse.json(
    {
      error:
        error instanceof OnlineError
          ? error.message
          : "Erreur du serveur. La dernière action n’a pas été confirmée.",
      code: error instanceof OnlineError ? error.code : "",
    },
    {
      status: error instanceof OnlineError ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
