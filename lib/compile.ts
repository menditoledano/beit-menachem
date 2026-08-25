import type { HallLayout } from "./layout";
import { numberSeats } from "./layout";
import type { CompiledLayout, LayoutCell } from "./domain";

/**
 * Turns the editable layout into the rendering JSON the public map consumes.
 * Aisle columns — columns no table or element touches — get a narrow track, so
 * the visual rhythm of the hall survives without the gabbai configuring
 * anything.
 */
export function compileLayout(layout: HallLayout): Omit<CompiledLayout, "version"> {
  const seats = numberSeats(layout);
  const usedCols = new Set<number>();
  for (const s of seats) usedCols.add(s.col);
  for (const e of layout.elements) {
    for (let c = 0; c < e.colSpan; c++) usedCols.add(e.col + c);
  }

  const SEAT_TRACK = 44; // minimum comfortable tap target
  const AISLE_TRACK = 14;
  const tracks: number[] = [];
  for (let c = 1; c <= layout.cols; c++) {
    tracks.push(usedCols.has(c) ? SEAT_TRACK : AISLE_TRACK);
  }

  const cells: LayoutCell[] = [
    ...seats.map((s) => ({
      kind: "seat" as const,
      seatNo: s.seatNo,
      tableId: s.tableId,
      side: s.side,
      facing: s.facingArk ? ("ark" as const) : ("away" as const),
      pairSeatNo: s.pairSeatNo,
      zone: s.zone,
      row: s.row,
      col: s.col,
    })),
    ...layout.elements.map((e) => ({
      kind: "element" as const,
      text: e.label,
      row: e.row,
      col: e.col,
      rowSpan: e.rowSpan,
      colSpan: e.colSpan,
    })),
  ];

  return { rows: layout.rows, cols: layout.cols, tracks, cells };
}
