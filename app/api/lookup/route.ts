import { gasPost, UpstreamError } from "@/lib/gas";
import { allow, checkOrigin, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Phone → membership status for the Round A entry screen.
 *
 * This endpoint is a phone-number oracle: feed it a phone, learn a name. The
 * cap of 10 distinct lookups per IP per hour is what stops someone from
 * walking the congregation's phone book — a legitimate family needs two or
 * three.
 */
const seenPhones = new Map<string, Set<string>>();
// The distinct-phone window resets hourly: on sale night the whole community
// shares the synagogue's NAT IP, so a lifetime cap would lock everyone out.
let seenPhonesResetAt = Date.now();

export async function POST(req: Request) {
  if (!checkOrigin(req)) {
    return Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  const ip = clientIp(req);
  if (!allow(`lookup:${ip}`, 20, 60_000)) {
    return Response.json({ kind: "UNKNOWN", throttled: true }, { status: 429 });
  }

  try {
    const body = await req.json();
    const phone = String(body.phone ?? "");

    if (Date.now() - seenPhonesResetAt > 60 * 60 * 1000) {
      seenPhones.clear();
      seenPhonesResetAt = Date.now();
    }
    const set = seenPhones.get(ip) ?? new Set<string>();
    set.add(phone);
    seenPhones.set(ip, set);
    if (set.size > 60) {
      // Past the distinct-phone cap this IP only ever learns "unknown".
      return Response.json({ ok: true, result: { kind: "UNKNOWN" } });
    }

    const result = await gasPost("lookup", { phone });
    return Response.json(result);
  } catch (err) {
    const code = err instanceof UpstreamError ? err.code : "UPSTREAM";
    return Response.json({ ok: false, code }, { status: 502 });
  }
}
