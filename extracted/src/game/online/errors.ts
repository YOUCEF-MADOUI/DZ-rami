/** Stable identity across Next dev hot reloads, just like the cached room service. */
class MultiplayerError extends Error {
  constructor(
    message: string,
    public status = 400,
    /** Machine-readable reason so the client can react without parsing text. */
    public code = "",
  ) {
    super(message);
    this.name = "OnlineError";
  }
}
const runtime = globalThis as typeof globalThis & {
  dzOnlineError?: typeof MultiplayerError;
};
export const OnlineError = (runtime.dzOnlineError ??= MultiplayerError);
