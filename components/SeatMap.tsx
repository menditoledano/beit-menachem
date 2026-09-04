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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  adminMode,
  fitOnMount,
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
  /** Gabbai console: every seat is clickable regardless of status. */
  adminMode?: boolean;
  /** Open showing the WHOLE hall (fit-to-width); zoom in from there. */
  fitOnMount?: boolean;
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

  /* ---------- zoom ----------
   * CSS `zoom` (not transform) so the scroll area resizes with the content —
   * one finger pans natively, two fingers pinch, buttons serve desktop.
   */
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const clampZoom = (z: number) => Math.min(1.4, Math.max(0.24, z));
  const applyZoom = useCallback((z: number) => {
    const c = clampZoom(z);
    zoomRef.current = c;
    setZoom(c);
  }, []);

  // The edge fades only make sense when there is something to scroll to.
  // With the hall fitted to the viewport they would just veil the entrance
  // column on the far right — so they follow the real overflow state.
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    const inner = el?.firstElementChild;
    if (!el || !inner) return;
    const measure = () => setScrollable(el.scrollWidth > el.clientWidth + 2);
    // A CSS `zoom` change resizes the grid a frame later than the state
    // flips, so observe the boxes themselves rather than the state.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(inner);
    measure();
    return () => ro.disconnect();
  }, [layout]);

  const fitToWidth = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const inner = el.firstElementChild as HTMLElement | null;
    if (!inner) return;
    // Natural width = rendered width divided by the current zoom.
    const natural = inner.scrollWidth / zoomRef.current || 1;
    applyZoom((el.clientWidth - 8) / natural);
  }, [applyZoom]);

  // Opening view: the whole hall at once — orientation first, detail on
  // demand. Runs once, synchronously after the grid is laid out — not via
  // requestAnimationFrame, which never fires in a background tab and left
  // the map at 1:1 when opened from a WhatsApp preview.
  const didFitRef = useRef(false);
  useLayoutEffect(() => {
    if (!fitOnMount || didFitRef.current) return;
    didFitRef.current = true;
    fitToWidth();
  }, [fitOnMount, fitToWidth, layout]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const pinch = { dist: 0, zoom: 1 };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch.dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        pinch.zoom = zoomRef.current;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch.dist) return;
      // Two fingers are ours; one finger stays native pan.
      e.preventDefault();
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      applyZoom(pinch.zoom * (d / pinch.dist));
    };
    const onWheel = (e: WheelEvent) => {
      // Trackpad pinch arrives as ctrl+wheel.
      if (!e.ctrlKey) return;
      e.preventDefault();
      applyZoom(zoomRef.current * (e.deltaY < 0 ? 1.08 : 0.92));
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("wheel", onWheel);
    };
  }, [applyZoom]);

  return (
    <div>
      {/* One slim toolbar ABOVE the map — legend and zoom never cover seats. */}
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {((adminMode
            ? [
                ["bg-seat-free", "פנוי"],
                ["bg-seat-reserved", "שמור"],
                ["bg-seat-taken", "תפוס"],
                ["ring-4 ring-brand-maroon bg-white", "נבחר"],
              ]
            : [
                ["bg-seat-free", "פנוי"],
                ["bg-seat-reserved", "שמור"],
                ["bg-seat-taken", "תפוס"],
                ["bg-seat-mine", "שלך"],
              ]) as Array<[string, string]>).map(([cls, label]) => (
            <span key={label} className="flex items-center gap-1 text-[12px] font-semibold">
              <span className={`inline-block h-3.5 w-3.5 rounded-md ${cls}`} />
              {label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => applyZoom(zoom * 1.2)} aria-label="הגדל"
            className="h-10 w-10 rounded-full border border-black/10 bg-white text-xl font-bold shadow-sm">＋</button>
          <button onClick={() => applyZoom(zoom / 1.2)} aria-label="הקטן"
            className="h-10 w-10 rounded-full border border-black/10 bg-white text-xl font-bold shadow-sm">－</button>
          <button onClick={fitToWidth} aria-label="הצג את כל האולם"
            className="h-10 rounded-full border border-black/10 bg-white px-3 text-[13px] font-bold shadow-sm">הכל</button>
        </div>
      </div>
      <div className="relative">
      <div className={scrollable ? "scroll-fade" : undefined}>
      <div
        ref={scrollRef}
        className="max-h-[74vh] overflow-auto rounded-xl"
        style={{ overscrollBehavior: "contain" }}
      >
        <div
          className="grid w-max gap-[3px] p-1"
          style={{ gridTemplateColumns: tracks, gridAutoRows: `${SEAT_PX}px`, zoom }}
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
          const clickable = adminMode || code === "0" || isMyHold || isSelected;

          const statusBg =
            code === "0" ? "bg-seat-free"
            : code === "4" ? "bg-seat-reserved"
            : code === "2" ? "bg-seat-pending"
            : code === "3" ? "bg-seat-blocked"
            : "bg-seat-taken";
          const cls = isSelected
            // The gabbai selects seats to OPERATE on them — the status color
            // must stay visible, so selection is a heavy ring, not gold.
            ? adminMode
              ? `${statusBg} text-white ring-4 ring-brand-maroon shadow-md`
              : "bg-seat-mine text-amber-950 ring-2 ring-amber-600 shadow-md"
            : isMyHold
              ? "bg-seat-mine text-amber-950 ring-2 ring-amber-500 animate-pulse"
              : code === "0"
                ? "bg-seat-free text-white hover:brightness-110"
                : code === "4"
                  ? "bg-seat-reserved text-white"
                  : code === "2"
                    ? "bg-seat-pending text-white"
                    : code === "3"
                      ? "bg-seat-blocked text-white"
                      : "bg-seat-taken text-white";

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
              className={`tnum flex flex-col items-center justify-center gap-0.5 rounded-lg transition-transform active:scale-95 disabled:cursor-not-allowed ${cls}`}
              style={{ gridRow: cell.row, gridColumn: cell.col, touchAction: "manipulation" }}
              /* title = desktop tooltip; the same text is the aria-label for readers */
              title={label}
              aria-label={label}
            >
              <span className="text-[15px] font-bold leading-none">{cell.seatNo}</span>
              {(holder || isMyHold) && (
                <span className="max-w-[54px] truncate px-0.5 text-[11px] leading-tight">
                  {isMyHold ? "שלך ✓" : holder}
                </span>
              )}
            </button>
          );
        })}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}
