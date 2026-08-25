import { gasPost, UpstreamError } from "@/lib/gas";
import type { SeatMapPayload } from "@/lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The quota shield. Apps Script allows 30 simultaneous executions for the
 * whole account, and every anonymous request runs as the owner — so this route
 * makes sure Apps Script never sees read traffic proportional to the crowd.
 *
 * Two layers: a short in-instance TTL cache with single-flight (concurrent
 * requests share one upstream fetch), and CDN s-maxage doing the same across
 * instances. Result: one upstream read every few seconds, whether 10 people
 * are watching or 500.
 */
let inflight: Promise<SeatMapPayload> | null = null;
let cached: { at: number; data: SeatMapPayload } | null = null;
const TTL_MS = 4_000;

async function getMap(): Promise<SeatMapPayload> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  if (inflight) return inflight;
  inflight = gasPost<{ ok: boolean; map: SeatMapPayload }>("seatmap")
    .then((res) => {
      if (!res.ok) throw new UpstreamError("UPSTREAM", "seatmap not ok");
      cached = { at: Date.now(), data: res.map };
      return res.map;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function GET() {
  try {
    return Response.json(await getMap(), {
      headers: { "Cache-Control": "public, s-maxage=3, stale-while-revalidate=30" },
    });
  } catch {
    // Serve stale rather than a 500 — a map a few seconds old is still a map.
    if (cached) return Response.json({ ...cached.data, stale: true });
    return Response.json({ ok: false, code: "UPSTREAM" }, { status: 503 });
  }
}
