import { NextRequest, NextResponse } from "next/server";
import { onlineService, OnlineError } from "@/game/online/server";
import {
  COOKIE,
  errorResponse,
  requireOrigin,
  tokenFrom,
  optionalToken,
  sessionCookieOptions,
} from "@/game/online/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    requireOrigin(request);
    // Limit streamed bodies too; Content-Length is not trusted.
    const reader = request.body?.getReader();
    let body = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 16384) {
          await reader.cancel();
          throw new OnlineError("Requête trop volumineuse.", 413);
        }
        body += decoder.decode(value, { stream: true });
      }
    body += decoder.decode();
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(body);
    } catch {
      throw new OnlineError("JSON invalide.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new OnlineError("Requête invalide.");
    const service = onlineService();
    if (input.command === "session") {
      // Reuse any valid session presented by cookie, header or body token, so a
      // reconnection keeps the same seat instead of creating a second session.
      const identity =
        typeof input.playerIdentity === "string" ? input.playerIdentity : undefined;
      const session = service.session(optionalToken(request, input), identity);
      service.touch(session.token);
      const payload: { snapshot: ReturnType<typeof service.snapshot>; message: string; token?: string } = {
        snapshot: service.snapshot(session.token),
        message: "",
      };
      // Issue the identical opaque token in the body only when the client
      // explicitly asks for token transport (browsers that refuse the cookie).
      if (input.tokenTransport === true) payload.token = session.token;
      const response = NextResponse.json(payload, {
        headers: { "Cache-Control": "no-store" },
      });
      response.cookies.set(
        COOKIE,
        session.token,
        sessionCookieOptions(request),
      );
      return response;
    }
    if (input.command === "heartbeat") {
      const token = tokenFrom(request, input);
      service.rate(`heartbeat:${token}`, 60);
      service.touch(token);
      return NextResponse.json(
        { snapshot: service.snapshot(token) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    /**
     * Real-time channel that needs no cookie and no custom header: the session
     * token travels in the body, exactly like every other command. The request is
     * held until the room changes (or up to ~2.5 s), which gives sub-second
     * updates through any proxy that forwards POST bodies.
     */
    if (input.command === "watch") {
      const token = tokenFrom(request, input);
      service.rate(`watch:${token}`, 120);
      const since = typeof input.since === "number" ? input.since : -1;
      const deadline = Date.now() + 2500;
      let snapshot = service.snapshot(token);
      while (snapshot.serial <= since && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 200));
        snapshot = service.snapshot(token);
      }
      return NextResponse.json(
        { snapshot, message: "" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(service.command(tokenFrom(request, input), input), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      { snapshot: onlineService().snapshot(tokenFrom(request)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
