import { cookies } from "next/headers";
import { cookieName, requireUser, session } from "@/lib/auth";
import { execute, eventRevision } from "@/lib/db";
import { errorResponse, ok } from "@/lib/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Outbox hanya perlu event terbaru. Pangkas sekali per jam agar COUNT(*) tetap ringan;
// penghapusan mengubah revisi sehingga klien cukup refresh satu kali.
const keptEvents = 1000;
const pruneState = globalThis as unknown as { stockEventsPrunedAt?: number };
async function prune(version: number) {
  const now = Date.now();
  if (now - (pruneState.stockEventsPrunedAt ?? 0) < 3600000) return;
  pruneState.stockEventsPrunedAt = now;
  if (version > keptEvents)
    await execute("DELETE FROM stock_events WHERE id<=?", [
      version - keptEvents,
    ]);
}
async function readRevision() {
  const result = await eventRevision();
  await prune(result.version);
  return result;
}
export async function GET(req: Request) {
  try {
    await requireUser();
    // Mode cek berkala (build Vercel): satu jawaban singkat tanpa koneksi terbuka,
    // karena Vercel menghitung kuota selama request berlangsung.
    if (new URL(req.url).searchParams.has("poll"))
      return ok({ revision: (await readRevision()).revision });
    const token = (await cookies()).get(cookieName)!.value;
    let ended = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let last = "";
        let retrying = false;
        let heartbeat = 0;
        const stop = () => {
          if (ended) return;
          ended = true;
          if (timer) clearTimeout(timer);
          try {
            controller.close();
          } catch {}
        };
        req.signal.addEventListener("abort", stop, { once: true });
        const send = (data: string) => {
          if (!ended) controller.enqueue(encoder.encode(data));
        };
        const tick = async () => {
          try {
            if (ended) return;
            // Session diperiksa tiap 10 detik; API tetap menolak session kedaluwarsa seketika.
            if (heartbeat % 10 === 0 && !(await session(token))) {
              send("event: expired\ndata: {}\n\n");
              stop();
              return;
            }
            const { version, count, revision } = await readRevision();
            if (revision !== last || retrying) {
              last = revision;
              retrying = false;
              send(
                `id: ${revision}\nevent: update\ndata: {"version":${version},"count":${count}}\n\n`,
              );
            }
            if (++heartbeat % 15 === 0) send(": heartbeat\n\n");
          } catch {
            retrying = true;
            send("event: retrying\ndata: {}\n\n");
          } finally {
            if (!ended) timer = setTimeout(tick, 1000);
          }
        };
        send("retry: 3000\n\n");
        void tick();
      },
      cancel() {
        ended = true;
        if (timer) clearTimeout(timer);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
