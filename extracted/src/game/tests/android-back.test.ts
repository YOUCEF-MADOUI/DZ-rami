// Android back button: pure routing decision + a no-op on the web.
import { afterEach, describe, expect, it } from 'vitest';
import { backTarget, installAndroidBackButton } from '@/game/native/android-back';

const globalWithCapacitor = globalThis as { Capacitor?: unknown };

afterEach(() => {
  delete globalWithCapacitor.Capacitor;
});

describe('android back button', () => {
  it('returns to the menu from any screen and leaves the app from home', () => {
    expect(backTarget('home')).toBeNull();
    for (const screen of ['settings', 'game', 'scores', 'online', 'local'] as const)
      expect(backTarget(screen)).toBe('home');
  });

  it('is a no-op in a plain browser (no Capacitor runtime)', () => {
    let called = 0;
    const unsubscribe = installAndroidBackButton(() => {
      called++;
      return true;
    });
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(called).toBe(0);
  });

  it('registers the native listener and calls exitApp only from home', async () => {
    const listeners: (() => void)[] = [];
    let exits = 0;
    let removed = 0;
    globalWithCapacitor.Capacitor = {
      Plugins: {
        App: {
          addListener: (_event: string, callback: () => void) => {
            listeners.push(callback);
            return Promise.resolve({ remove: () => { removed++; } });
          },
          exitApp: () => { exits++; },
        },
      },
    };

    let handled = true;
    const unsubscribe = installAndroidBackButton(() => handled);
    await Promise.resolve();
    expect(listeners).toHaveLength(1);

    listeners[0]();
    expect(exits).toBe(0);

    handled = false; // home screen: the app may close
    listeners[0]();
    expect(exits).toBe(1);

    unsubscribe();
    await Promise.resolve();
    expect(removed).toBe(1);
  });

  it('survives a shell whose listener cannot be removed', async () => {
    globalWithCapacitor.Capacitor = { Plugins: { App: { addListener: () => undefined } } };
    const unsubscribe = installAndroidBackButton(() => true);
    await Promise.resolve();
    expect(() => unsubscribe()).not.toThrow();
  });
});
