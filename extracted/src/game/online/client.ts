import type { OnlineSnapshot } from "./protocol";
export class OnlineRequestError extends Error {
  constructor(
    message: string,
    public status = 0,
    /** Exact request that failed — shown in the on-screen diagnostic. */
    public method = "POST",
    public path = "/api/multiplayer",
    /** Server-provided reason code (e.g. stale_revision, table_full). */
    public code = "",
  ) {
    super(message);
  }
}
export interface OnlineReply {
  snapshot: OnlineSnapshot;
  message?: string;
  /** Returned only when the client explicitly requested token transport. */
  token?: string;
}
export type OnlineTransport = "cookie" | "token";
const TOKEN_KEY = "dz-rami:online-token:v1";
/** Stable identity of this browser: lets the same player find their seat again. */
const IDENTITY_KEY = "dz-rami:player-identity:v1";
let cachedIdentity: string | null = null;
/**
 * The token is the same opaque server-issued secret as the cookie, never a
 * player id. It is only kept because some browsers/proxies refuse Set-Cookie on
 * cross-site preview iframes; the cookie stays the preferred transport.
 */
let cachedToken: string | null | undefined;
function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
export function sessionToken(): string | undefined {
  if (cachedToken === undefined) {
    try {
      cachedToken = store()?.getItem(TOKEN_KEY) ?? null;
    } catch {
      cachedToken = null;
    }
  }
  return cachedToken ?? undefined;
}
function randomIdentity(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
/**
 * Persistent identity of this browser, created once. It is an opaque bearer
 * credential, never a player id: the server binds a seat to it and ignores any
 * playerId a client could send.
 */
export function playerIdentity(): string {
  try {
    const existing = window.localStorage.getItem(IDENTITY_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,200}$/.test(existing)) return existing;
    const created = randomIdentity();
    window.localStorage.setItem(IDENTITY_KEY, created);
    return created;
  } catch {
    // Storage can be unavailable; a per-tab identity still works.
    cachedIdentity ??= randomIdentity();
    return cachedIdentity;
  }
}
export function rememberSessionToken(token: string | null): void {
  cachedToken = token;
  try {
    if (token) store()?.setItem(TOKEN_KEY, token);
    else store()?.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable; the in-memory token still works this tab.
  }
}
export interface RequestOptions {
  signal?: AbortSignal;
  /** "cookie" verifies the HttpOnly cookie alone; "auto" also sends the token. */
  auth?: "auto" | "cookie";
}
function authHeaders(
  auth: "auto" | "cookie",
  token: string | undefined,
): Record<string, string> {
  if (auth === "cookie" || !token) return {};
  // Two header spellings: some proxies strip Authorization specifically.
  return { Authorization: `Bearer ${token}`, "X-DZ-Session": token };
}
/** The body field is accepted by the server exactly like the cookie. */
function withBodyToken(
  body: Record<string, unknown> | undefined,
  auth: "auto" | "cookie",
): Record<string, unknown> | undefined {
  const token = auth === "cookie" ? undefined : sessionToken();
  if (!body) return body;
  return {
    ...body,
    ...(token ? { sessionToken: token } : {}),
    playerIdentity: playerIdentity(),
  };
}
function checkSnapshot(data: unknown): OnlineReply {
  const payload = data as OnlineReply | null;
  if (
    !payload?.snapshot ||
    typeof payload.snapshot.serial !== "number" ||
    !Array.isArray(payload.snapshot.tables)
  )
    throw new OnlineRequestError(
      "Réponse du serveur invalide : la session n’a pas pu être vérifiée.",
    );
  return payload;
}
/** Real authenticated HTTP only; a timeout never proves an action was not committed. */
export async function onlineRequest(
  body?: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<OnlineReply> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const auth = options.auth ?? "auto";
  const timer = setTimeout(abort, 12000);
  try {
    const token = sessionToken();
    const payload = withBodyToken(body, auth);
    const response = await fetch("/api/multiplayer", {
      method: payload ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...authHeaders(auth, token),
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const reason =
        typeof (data as { error?: unknown })?.error === "string"
          ? (data as { error: string }).error
          : "Serveur indisponible.";
      const code =
        typeof (data as { code?: unknown })?.code === "string"
          ? (data as { code: string }).code
          : "";
      throw new OnlineRequestError(
        `${reason} (HTTP ${response.status})`,
        response.status,
        payload ? "POST" : "GET",
        "/api/multiplayer",
        code,
      );
    }
    return checkSnapshot(data);
  } catch (error) {
    if (error instanceof OnlineRequestError) throw error;
    throw new OnlineRequestError(
      controller.signal.aborted
        ? "Le serveur ne répond pas dans le délai de 10 secondes. Réessayez la connexion."
        : "Impossible de joindre le serveur multijoueur. Vérifiez votre connexion puis réessayez.",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
export interface BootstrapResult {
  reply: OnlineReply;
  transport: OnlineTransport;
}
/**
 * Establish and *verify* a session. Creating a session is worthless if the
 * browser then drops the credential, so the cookie is confirmed with an
 * authenticated round-trip before anything else happens.
 */
export async function bootstrapSession(
  signal?: AbortSignal,
): Promise<BootstrapResult> {
  await onlineRequest({ command: "session" }, { signal });
  try {
    // The cookie is proven by the server echoing the authenticated snapshot.
    const verified = await onlineRequest(
      { command: "heartbeat" },
      { signal, auth: "cookie" },
    );
    return { reply: verified, transport: "cookie" };
  } catch (error) {
    if (!(error instanceof OnlineRequestError) || error.status !== 401)
      throw error;
  }
  // The cookie was refused: ask for the same opaque token explicitly, then prove
  // it through the body channel (immune to header rewriting by a proxy).
  const issued = await onlineRequest(
    { command: "session", tokenTransport: true },
    { signal, auth: "cookie" },
  );
  if (!issued.token)
    throw new OnlineRequestError(
      "Le serveur n’a pas pu établir de session sécurisée par jeton.",
    );
  rememberSessionToken(issued.token);
  const verified = await onlineRequest(
    { command: "heartbeat" },
    { signal, auth: "auto" },
  );
  return { reply: verified, transport: "token" };
}
/**
 * Real-time channel that survives any proxy: session token in the body, response
 * held by the server until the room changes. Same guarantee as SSE for this game
 * (sub-second propagation), with no cookie and no custom header involved.
 */
export async function watchLoop(options: {
  signal: AbortSignal;
  initialSerial: number;
  onSnapshot: (snapshot: OnlineSnapshot) => void;
  onStatus?: (mode: "long-poll" | "polling-5s") => void;
  onUnavailable: (error: unknown) => void;
}): Promise<void> {
  let serial = options.initialSerial;
  let failures = 0;
  while (!options.signal.aborted) {
    try {
      const reply = await onlineRequest(
        { command: "watch", since: serial },
        { signal: options.signal },
      );
      serial = reply.snapshot.serial;
      failures = 0;
      options.onStatus?.("long-poll");
      options.onSnapshot(reply.snapshot);
    } catch (error) {
      if (options.signal.aborted) return;
      failures += 1;
      if (
        error instanceof OnlineRequestError &&
        (error.status === 401 || error.status === 403)
      ) {
        if (failures >= 2) {
          options.onUnavailable(error);
          return;
        }
      } else {
        options.onStatus?.("polling-5s");
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(5000, 500 * failures)),
      );
    }
  }
}
export function connectionFailure(error: unknown): string {
  if (error instanceof OnlineRequestError && error.status === 401) {
    return `${error.message} Ni le cookie, ni l’en-tête, ni le jeton du corps de requête ne sont reconnus : la session a peut-être expiré. Cliquez sur Reconnecter ; une nouvelle session sûre sera créée.`;
  }
  return error instanceof Error
    ? error.message
    : "Connexion multijoueur interrompue.";
}
export function creationIssues(input: {
  name: string;
  tableName: string;
  privateTable: boolean;
  password: string;
  connected: boolean;
  busy: boolean;
}): string[] {
  const issues: string[] = [];
  if (!input.connected)
    issues.push(
      "Une connexion authentifiée au serveur est nécessaire. Consultez le statut de connexion ci-dessus.",
    );
  if (input.busy)
    issues.push("Une requête est en cours. Attendez sa confirmation.");
  if (!input.name.trim()) issues.push("Renseignez votre nom de joueur.");
  else if (input.name.length > 30)
    issues.push("Votre nom de joueur ne doit pas dépasser 30 caractères.");
  if (!input.tableName.trim()) issues.push("Renseignez le nom de la table.");
  else if (input.tableName.length > 60)
    issues.push("Le nom de la table ne doit pas dépasser 60 caractères.");
  if (
    input.privateTable &&
    (input.password.length < 8 || input.password.length > 128)
  )
    issues.push(
      "Une table privée exige un mot de passe de 8 à 128 caractères.",
    );
  return issues;
}
