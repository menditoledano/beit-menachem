import { gasPost, requireAdmin, UpstreamError } from "@/lib/gas";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Actions the admin console may relay to Apps Script, and nothing else. */
const ALLOWED = new Set([
  "gabbai",
  "setConfig",
  "seatmap",
  "seatDetails",
  "recentLog",
  "runChazakaMatching",
  "approveAutoChazaka",
  "seedChazakaSeats",
  "syncChazaka",
  "refreshReservations",
  "releaseReservedSeats",
  "resolveChazakaV2",
  "clearRegistrations",
  "runExpiryNow",
  "importMembers",
  "installTriggers",
  "setup",
]);

export async function POST(req: Request) {
  if (!requireAdmin(req)) {
    return Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const action = String(body.action ?? "");
    if (!ALLOWED.has(action)) {
      return Response.json({ ok: false, code: "UNKNOWN_ACTION" }, { status: 400 });
    }
    const { action: _drop, ...rest } = body;
    return Response.json(await gasPost(action, rest));
  } catch (err) {
    const code = err instanceof UpstreamError ? err.code : "UPSTREAM";
    return Response.json({ ok: false, code }, { status: 502 });
  }
}
