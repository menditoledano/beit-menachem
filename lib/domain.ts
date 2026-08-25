/**
 * The wire protocol between the browser, the Next.js proxy and Apps Script.
 *
 * Geometry and state are deliberately separate resources. The layout is fixed
 * for the whole sale and is cached hard; the seat map changes constantly and is
 * polled. Bundling them would mean re-sending the entire hall every few seconds
 * to every watcher, which is exactly the traffic pattern that blows through the
 * Apps Script execution quota.
 */

export type SeatStatus = "פנוי" | "תפוס" | "ממתין" | "חסום";

export const SEAT_STATUS: Record<
  "FREE" | "TAKEN" | "PENDING" | "BLOCKED",
  SeatStatus
> = {
  FREE: "פנוי",
  TAKEN: "תפוס",
  PENDING: "ממתין",
  BLOCKED: "חסום",
};

/** Compact per-seat status codes used in the polled map payload. */
export const STATUS_CODE: Record<SeatStatus, string> = {
  פנוי: "0",
  תפוס: "1",
  ממתין: "2",
  חסום: "3",
};

export type Phase = "A" | "B";
export type SaleMode = "OPEN" | "READONLY" | "CLOSED";

/** Which way a seat faces. The pairing rule is expressed entirely in these two. */
export type Facing = "ark" | "away";

export interface HallElement {
  kind: "element";
  /** ארון קודש, בימת ספר תורה, כניסה, כיור, ספריה … */
  text: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

export interface SeatCell {
  kind: "seat";
  seatNo: number;
  tableId: string;
  /** Which side of the table this seat sits on. */
  side: "a" | "b";
  facing: Facing;
  /** The seat directly across the table. Always defined for a facing="ark" seat. */
  pairSeatNo: number | null;
  zone: string;
  row: number;
  col: number;
}

export type LayoutCell = SeatCell | HallElement;

export interface CompiledLayout {
  /** Changes on every publish; the client caches geometry keyed by this. */
  version: string;
  rows: number;
  cols: number;
  /** Per-column widths in px, so a narrow aisle in the editor stays narrow here. */
  tracks: number[];
  cells: LayoutCell[];
}

export interface SeatMapPayload {
  layoutVersion: string;
  phase: Phase;
  mode: SaleMode;
  /** seatNo -> status code, as a compact object rather than a full seat list. */
  status: Record<string, string>;
  /** seatNo -> public display name. Phone and email are never sent here. */
  holders: Record<string, string>;
  serverTime: string;
}

export type LookupResult =
  | { kind: "CHAZAKA"; memberId: string; name: string }
  | { kind: "MEMBER_NO_CHAZAKA"; memberId: string; name: string }
  /** One phone shared by several member rows — families do this constantly. */
  | { kind: "MULTI"; candidates: Array<{ memberId: string; name: string }> }
  | { kind: "UNKNOWN" };

export interface ClaimRequest {
  action: "claim";
  /** Stable across retries of the same user intent; the idempotency key. */
  requestId: string;
  /** One seat, or a facing pair submitted together. */
  seatNos: number[];
  name: string;
  phone: string;
  email?: string;
}

export type ClaimFailureCode =
  | "BAD_SEAT"
  | "BAD_PHONE"
  | "BAD_INPUT"
  | "TAKEN"
  | "BUSY"
  | "CAP_REACHED"
  | "PAIR_REQUIRED"
  | "ROUND_A_NO_CHAZAKA"
  | "ROUND_A_NOT_YOURS"
  | "TOO_FAST"
  | "SALE_CLOSED"
  | "SERVER_ERROR"
  | "UPSTREAM"
  | "TIMEOUT"
  | "FORBIDDEN";

export type ClaimResponse =
  | { ok: true; seatNos: number[]; totalPrice: number; phase: Phase }
  | {
      ok: false;
      code: ClaimFailureCode;
      /** Present on BUSY and TOO_FAST. */
      retryAfterMs?: number;
      /** Present on TAKEN. */
      holder?: string;
      /** Present on PAIR_REQUIRED. */
      pairSeatNo?: number;
      /** Present on CAP_REACHED. */
      cap?: number;
      held?: number;
    };

/**
 * 150 for the first seat, +50 for each additional. Capped at three seats, so
 * the only totals a member ever sees are 150, 200 and 250.
 */
export function totalPrice(
  seatCount: number,
  firstSeatPrice = 150,
  extraSeatPrice = 50,
): number {
  if (seatCount <= 0) return 0;
  return firstSeatPrice + extraSeatPrice * (seatCount - 1);
}

/**
 * Israeli phone normalisation, mirroring normPhone_ in Apps Script.
 *
 * Returns "" for anything unusable rather than a best guess — a silently
 * mangled phone number means a real member is refused in Round A with no
 * explanation, which is far worse than an explicit rejection at the keyboard.
 */
export function normalizePhone(input: unknown): string {
  let digits =
    typeof input === "number"
      ? String(Math.round(input))
      : String(input ?? "").replace(/\D/g, "");
  digits = digits.replace(/\D/g, "");

  if (digits.startsWith("00972")) digits = "0" + digits.slice(5);
  else if (digits.startsWith("972")) digits = "0" + digits.slice(3);
  // A leading zero eaten by a spreadsheet, or simply never typed.
  if (digits.length === 9 && digits[0] !== "0") digits = "0" + digits;

  return digits.length === 10 && digits.startsWith("0") ? digits : "";
}
