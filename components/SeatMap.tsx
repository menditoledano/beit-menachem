"use client";

/**
 * The public hall map. CSS Grid of real <button>s with native horizontal
 * scrolling — no SVG, no pinch-zoom library.
 *
 * Cells are enlarged beyond the compiled track width so the holder's surname
 * is legible on the seat itself; the full name rides in the title attribute
 * for desktop hover, and on the seat face for everyone else.
 *
 * RTL: the grid runs right-to-left, so column 1 is the rightmost cell and the
 * ark (high column indices) renders on the LEFT — matching the physical hall.
 * Never do arithmetic on scrollLeft here; engines disagree on its sign in RTL.
 */

import { useMemo } from "react";
import type { CompiledLayout, SeatMapPayload } from "@/lib/domain";

export interface SeatSelection {
  seatNo: number;
  pairSeatNo: number | null;
  facing: "ark" | "away";
}

/** Seat cells grow to this size so a surname fits; aisles stay narrow. */
const SEAT_PX = 58;
const AISLE_PX = 16;

export function SeatMap({
  layout,
  map,
  selected,
  myPhone,
  myReservedSeats,
  onToggleSeat,
}: {
  layout: CompiledLayout;
  map: SeatMapPayload | null;
  selected: number[];
  /** Normalised phone of the identified user, for highlighting their hold. */
  myPhone?: string;
  myReservedSeats?: number[];
  onToggleSeat: (sel: SeatSelection) => void;
}) {
  const tracks = useMemo(
    () =>
      layout.tracks
        .map((w) => `${w <= 20 ? AISLE_PX : SEAT_PX}px`)
        .join(" "),
    [layout.tracks],
  );

  const mine = useMemo(() => new Set(myReservedSeats ?? []), [myReservedSeats]);

  return (
    <div
      className="overflow-auto rounded-lg border bg-white p-2"
      style={{ overscrollBehavior: "contain" }}
    >
      <div
        className="grid w-max gap-1"
        style={{ gridTemplateColumns: tracks, gridAutoRows: `${SEAT_PX}px` }}
      >
        {layout.cells.map((cell) => {
          if (cell.kind === "element") {
            return (
              <div
                key={`e-${cell.row}-${cell.col}`}
                className="flex items-center justify-center rounded bg-ark px-1 text-center text-[12px] font-bold text-white"
                style={{
                  gridRow: `${cell.row} / span ${cell.rowSpan}`,
                  gridColumn: `${cell.col} / span ${cell.colSpan}`,
                  writingMode: cell.rowSpan > cell.colSpan * 2 ? "vertical-rl" : undefined,
                }}
              >
                {cell.text}
              </div>
            );
          }

          const code = map?.status[String(cell.seatNo)] ?? "0";
          const holder = map?.holders[String(cell.seatNo)];
          const isSelected = selected.includes(cell.seatNo);
          const isMyHold = mine.has(cell.seatNo);
          const clickable = code === "0" || isMyHold || isSelected;

          const cls = isSelected
            ? "bg-seat-mine ring-2 ring-black"
            : isMyHold
              ? "bg-seat-mine/80 ring-2 ring-seat-mine animate-pulse"
              : code === "0"
                ? "bg-seat-free"
                : code === "4"
                  ? "bg-sky-700"
                  : code === "2"
                    ? "bg-seat-pending"
                    : code === "3"
                      ? "bg-seat-blocked"
                      : "bg-seat-taken";

          const label =
            code === "0"
              ? `מקום ${cell.seatNo} פנוי`
              : isMyHold
                ? `מקום ${cell.seatNo} — שמור לך`
                : code === "4"
                  ? `מקום ${cell.seatNo} — שמור ל${holder ?? ""}`
                  : `מקום ${cell.seatNo} — ${holder ?? "תפוס"}`;

          return (
            <button
              key={cell.seatNo}
              disabled={!clickable}
              onClick={() =>
                onToggleSeat({
                  seatNo: cell.seatNo,
                  pairSeatNo: cell.pairSeatNo,
                  facing: cell.facing,
                })
              }
              className={`tnum flex flex-col items-center justify-center gap-0.5 rounded-md text-white transition-transform active:scale-95 disabled:cursor-not-allowed ${cls}`}
              style={{ gridRow: cell.row, gridColumn: cell.col, touchAction: "manipulation" }}
              /* title = desktop tooltip; the same text is the aria-label for readers */
              title={label}
              aria-label={label}
            >
              <span className="text-[14px] font-bold leading-none">{cell.seatNo}</span>
              {(holder || isMyHold) && (
                <span className="max-w-[54px] truncate px-0.5 text-[10px] leading-tight">
                  {isMyHold ? "שלך ✓" : holder}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Legend() {
  const items: Array<[string, string]> = [
    ["bg-seat-free", "פנוי"],
    ["bg-seat-taken", "תפוס"],
    ["bg-sky-700", "שמור לבעל חזקה"],
    ["bg-seat-pending", "משוריין"],
    ["bg-seat-mine", "הבחירה שלך"],
  ];
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {items.map(([cls, label]) => (
        <span key={label} className="flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded ${cls}`} />
          {label}
        </span>
      ))}
    </div>
  );
}
