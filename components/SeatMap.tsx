"use client";

/**
 * The public hall map. CSS Grid of real <button>s at natural tap size with
 * native horizontal scrolling — no SVG, no pinch-zoom library.
 *
 * RTL: the grid runs right-to-left, so column 1 is the rightmost cell and the
 * ark (high column indices) renders on the LEFT — matching the physical hall.
 * Never do arithmetic on scrollLeft here; engines disagree on its sign in RTL.
 * scrollIntoView sidesteps that entire class of bug.
 */

import { useMemo } from "react";
import type { CompiledLayout, SeatMapPayload } from "@/lib/domain";

export interface SeatSelection {
  seatNo: number;
  pairSeatNo: number | null;
  facing: "ark" | "away";
}

export function SeatMap({
  layout,
  map,
  selected,
  onToggleSeat,
}: {
  layout: CompiledLayout;
  map: SeatMapPayload | null;
  selected: number[];
  onToggleSeat: (sel: SeatSelection) => void;
}) {
  const tracks = useMemo(
    () => layout.tracks.map((w) => `${w}px`).join(" "),
    [layout.tracks],
  );

  return (
    <div
      className="overflow-auto rounded-lg border bg-white p-2"
      style={{ overscrollBehavior: "contain" }}
    >
      <div
        className="grid w-max gap-1"
        style={{
          gridTemplateColumns: tracks,
          gridAutoRows: "44px",
        }}
      >
        {layout.cells.map((cell) => {
          if (cell.kind === "element") {
            return (
              <div
                key={`e-${cell.row}-${cell.col}`}
                className="flex items-center justify-center rounded bg-ark px-1 text-center text-[11px] font-bold text-white"
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
          const free = code === "0";

          const cls = isSelected
            ? "bg-seat-mine ring-2 ring-black"
            : code === "0"
              ? "bg-seat-free"
              : code === "2"
                ? "bg-seat-pending"
                : code === "3"
                  ? "bg-seat-blocked"
                  : "bg-seat-taken";

          return (
            <button
              key={cell.seatNo}
              disabled={!free && !isSelected}
              onClick={() =>
                onToggleSeat({
                  seatNo: cell.seatNo,
                  pairSeatNo: cell.pairSeatNo,
                  facing: cell.facing,
                })
              }
              className={`tnum flex flex-col items-center justify-center rounded text-white transition-transform active:scale-95 disabled:cursor-not-allowed ${cls}`}
              style={{ gridRow: cell.row, gridColumn: cell.col, touchAction: "manipulation" }}
              aria-label={
                free
                  ? `מקום ${cell.seatNo} פנוי`
                  : `מקום ${cell.seatNo} — ${holder ?? "תפוס"}`
              }
            >
              <span className="text-[12px] font-bold leading-none">{cell.seatNo}</span>
              {holder && (
                <span className="max-w-[42px] truncate text-[8px] leading-tight">{holder}</span>
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
