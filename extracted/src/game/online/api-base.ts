/**
 * Where the multiplayer server lives.
 *
 * The web app is served by the same Next.js instance as `/api/multiplayer`, so
 * the base is empty by default and every URL stays relative. The Android build
 * (Capacitor) has no server: it points at a hosted HTTPS server through
 * `NEXT_PUBLIC_API_BASE`, inlined at build time.
 *
 * Only the online mode is affected. Solo, 2-versus-2 and local pass-and-play
 * never touch the network.
 */
export function apiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE ?? "";
  return raw.trim().replace(/\/+$/, "");
}

/** Absolute or relative URL of an API endpoint. */
export function apiUrl(path = "/api/multiplayer"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase()}${normalized}`;
}

/**
 * True when the app runs in an embedded shell (Capacitor) that must talk to a
 * remote server. Cross-origin requests then need CORS on the server side and
 * the session token transport (cookies are cross-site and often refused).
 */
export function isRemoteApi(): boolean {
  return apiBase().length > 0;
}
