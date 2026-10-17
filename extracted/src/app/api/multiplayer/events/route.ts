import { NextRequest } from "next/server";
import { onlineService } from "@/game/online/server";
import { errorResponse, tokenFrom } from "@/game/online/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  try {
    const token = tokenFrom(request),
      service = onlineService();
    service.touch(token);
    const release = service.stream(token);
    let timer: ReturnType<typeof setInterval> | undefined;
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let stopped = false;
        let previous = "";
        cleanup = () => {
          if (stopped) return;
          stopped = true;
          release();
          clearInterval(timer);
          request.signal.removeEventListener("abort", cleanup);
          try {
            controller.close();
          } catch {}
        };
        const send = () => {
          if (stopped) return;
          try {
            const body = JSON.stringify(service.snapshot(token));
            controller.enqueue(
              encoder.encode(
                body !== previous ? `data: ${body}\n\n` : ": heartbeat\n\n",
              ),
            );
            previous = body;
          } catch {
            cleanup();
          }
        };
        request.signal.addEventListener("abort", cleanup, { once: true });
        send();
        timer = setInterval(send, 1000);
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
