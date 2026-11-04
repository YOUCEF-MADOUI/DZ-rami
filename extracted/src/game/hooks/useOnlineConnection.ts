"use client";
import { useCallback, useEffect, useState } from "react";
import type { OnlineSnapshot } from "../online/protocol";
import {
  bootstrapSession,
  connectionFailure,
  onlineRequest,
  watchLoop,
  OnlineRequestError,
  type OnlineTransport,
} from "../online/client";
interface ConnectionState {
  connected: boolean;
  detail: string;
  error: string;
  transport: OnlineTransport | null;
  /** Exact failing request, for the on-screen diagnostic. */
  lastFailure: string;
}
const INITIAL: ConnectionState = {
  connected: false,
  detail: "Vérification de la session…",
  error: "",
  transport: null,
  lastFailure: "",
};
function describe(error: unknown): string {
  if (error instanceof OnlineRequestError)
    return `${error.method} ${error.path} → HTTP ${error.status || "réseau"} · ${error.message}`;
  return error instanceof Error ? error.message : "Erreur inconnue.";
}
/**
 * A session counts as usable only after an authenticated round-trip proves the
 * credential reached the server. Failures are reported with the exact request,
 * HTTP status and transport, so a broken preview cannot be blamed on guesswork.
 */
export function useOnlineConnection(
  accept: (snapshot: OnlineSnapshot) => void,
  profile: (name: string) => void,
) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ConnectionState>(INITIAL);
  const reconnect = useCallback(() => {
    setState({ ...INITIAL, detail: "Nouvelle tentative de connexion…" });
    setAttempt((n) => n + 1);
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const publish = (patch: Partial<ConnectionState>) => {
      if (active) setState((current) => ({ ...current, ...patch }));
    };
    const run = async () => {
      try {
        const { reply, transport } = await bootstrapSession(controller.signal);
        if (!active) return;
        accept(reply.snapshot);
        profile(reply.snapshot.name);
        publish({
          connected: true,
          error: "",
          transport,
          lastFailure: "",
          detail:
            transport === "token"
              ? "Session vérifiée par jeton aléatoire dans le corps des requêtes (cookie refusé par l’environnement)."
              : "Session vérifiée par cookie sécurisé.",
        });
        heartbeat = setInterval(() => {
          onlineRequest({ command: "heartbeat" }, { signal: controller.signal })
            .then((result) => {
              if (active) {
                accept(result.snapshot);
                publish({ connected: true, error: "" });
              }
            })
            .catch((error) => {
              if (active)
                publish({
                  connected: false,
                  detail: "Les actions sont suspendues.",
                  error: connectionFailure(error),
                  lastFailure: describe(error),
                });
            });
        }, 5000);
        await watchLoop({
          signal: controller.signal,
          initialSerial: reply.snapshot.serial,
          onSnapshot: (snapshot) => {
            if (!active) return;
            accept(snapshot);
            publish({ connected: true, error: "" });
          },
          onStatus: (mode) =>
            publish({
              detail:
                mode === "long-poll"
                  ? "Synchronisation en temps réel active (long-poll POST authentifié)."
                  : "Synchronisation en attente : actualisation HTTP authentifiée.",
            }),
          onUnavailable: (error) =>
            publish({
              connected: false,
              detail: "Les actions sont suspendues.",
              error: connectionFailure(error),
              lastFailure: describe(error),
            }),
        });
      } catch (error) {
        publish({
          connected: false,
          detail: "Les actions sont suspendues.",
          error: connectionFailure(error),
          lastFailure: describe(error),
        });
      } finally {
        clearInterval(heartbeat);
      }
    };
    queueMicrotask(() => {
      if (active) void run();
    });
    return () => {
      active = false;
      controller.abort();
      clearInterval(heartbeat);
    };
  }, [accept, profile, attempt]);
  return { ...state, reconnect };
}
