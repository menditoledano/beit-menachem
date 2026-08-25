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

import { useEffect, useMemo, useRef } from "react";
import type { CompiledLayout, SeatMapPayload } from "@/lib/domain";

export interface SeatSelection {
  seatNo: number;
  pairSeatNo: number | null;
  facing: "ark" | "away";
}

/** Seat cells grow to this size so a surname fits; aisles stay narrow. */
const SEAT_PX = 52;
const AISLE_PX = 14;

export function SeatMap({
  layout,
  map,
  selected,
  myPhone,
  myReservedSeats,
  focusSeat,
  onToggleSeat,
}: {
  layout: CompiledLayout;
  map: SeatMapPayload | null;
  selected: number[];
  /** Normalised phone of the identified user, for highlighting their hold. */
  myPhone?: string;
  myReservedSeats?: number[];
  /** Seat to bring into view on first render — the user's own hold, usually. */
  focusSeat?: number;
  onToggleSeat: (sel: SeatSelection) => void;
}) {
  // Column widths are computed PER COLUMN from actual seat occupancy, not
  // from the compiled tracks: with the middle block offset by one column,
  // trusting the compiled track makes every offset column full-width even in
  // rows where it is empty, opening canyon-wide gaps between the top-block
  // pairs. A column is seat-width only if a seat actually lives in it.
  const tracks = useMemo(() => {
    const seatCols = new Set<number>();
    const elementCols = new Set<number>();
    for (const cell of layout.cells) {
      if (cell.kind === "seat") seatCols.add(cell.col);
      else for (let c = 0; c < cell.colSpan; c++) elementCols.add(cell.col + c);
    }
    const widths: string[] = [];
    for (let c = 1; c <= layout.cols; c++) {
      widths.push(
        seatCols.has(c) ? `${SEAT_PX}px`
        : elementCols.has(c) ? `${Math.round(SEAT_PX * 0.8)}px`
        : `${AISLE_PX}px`,
      );
    }
    return widths.join(" ");
  }, [layout]);

  const mine = useMemo(() => new Set(myReservedSeats ?? []), [myReservedSeats]);

  // Open the map centred on what matters to THIS user: their held seat, or
  // the ark end where the map begins. RTL scroll offsets are treacherous —
  // scrollIntoView is the only portable way to do this.
  const scrollRef = useRef<HTMLDivElement>(null);
  const didFocusRef = useRef(false);
  useEffect(() => {
    if (didFocusRef.current || !scrollRef.current) return;
    const target = scrollRef.current.querySelector(
      focusSeat ? `[data-seat="${focusSeat}"]` : '[data-seat="1"]',
    );
    if (target) {
      didFocusRef.current = true;
      target.scrollIntoView({ inline: "center", block: "nearest" });
    }
  }, [focusSeat, layout]);

  return (
    <div className="scroll-fade">
      <div
        ref={scrollRef}
        className="max-h-[68vh] overflow-auto rounded-xl"
        style={{ overscrollBehavior: "contain" }}
      >
        <div
          className="grid w-max gap-[3px] p-1"
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
            ? "bg-seat-mine ring-2 ring-black shadow-md"
            : isMyHold
              ? "bg-seat-mine/80 ring-2 ring-seat-mine animate-pulse"
              : code === "0"
                ? "bg-seat-free hover:brightness-110"
                : code === "4"
                  ? "bg-seat-reserved"
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
              data-seat={cell.seatNo}
              className={`tnum flex flex-col items-center justify-center gap-0.5 rounded-lg text-white transition-transform active:scale-95 disabled:cursor-not-allowed ${cls}`}
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
    </div>
  );
}

export function Legend() {
  const items: Array<[string, string]> = [
    ["bg-seat-free", "פנוי"],
    ["bg-seat-taken", "תפוס"],
    ["bg-seat-reserved", "שמור לבעל חזקה"],
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
