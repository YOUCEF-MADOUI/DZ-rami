// Native Android shell helper — no dependency.
//
// Inside Capacitor the native runtime injects `window.Capacitor.Plugins.App`.
// When the app is not embeddes (the normal web build, or the APK built without
// `@capacitor/app`), every function below degrades to a no-op, so the web app is
// strictly unchanged.

/** Minimal shape of the Capacitor `App` plugin we rely on. */
interface CapacitorAppPlugin {
  addListener?: (
    event: "backButton",
    callback: () => void,
  ) => Promise<{ remove?: () => void }> | undefined;
  exitApp?: () => void;
}

interface CapacitorGlobal {
  Plugins?: { App?: CapacitorAppPlugin };
}

function plugin(): CapacitorAppPlugin | null {
  const capacitor = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return capacitor?.Plugins?.App ?? null;
}

/**
 * Where the Android back button leads. `null` means "no in-app destination":
 * on the home screen the system behaviour applies (leave the app).
 */
export function backTarget<T extends string>(screen: T): "home" | null {
  return screen === "home" ? null : "home";
}

/**
 * Registers the hardware/gesture back button.
 *
 * `onBack` returns `true` when the app handled the navigation, `false` when the
 * screen is the home screen and the app should close.
 * Returns an unsubscribe function (no-op on the web).
 */
export function installAndroidBackButton(onBack: () => boolean): () => void {
  const app = plugin();
  if (!app?.addListener) return () => {};
  let remove: (() => void) | undefined;
  let cancelled = false;
  const subscription = app.addListener("backButton", () => {
    if (!onBack()) app.exitApp?.();
  });
  // addListener returns a promise in Capacitor 5+ and a handle in older ports.
  Promise.resolve(subscription)
    .then(handle => {
      if (cancelled) handle?.remove?.();
      else remove = handle?.remove;
    })
    .catch(() => {
      /* the shell is optional: never break the game because of it */
    });
  return () => {
    cancelled = true;
    remove?.();
  };
}
