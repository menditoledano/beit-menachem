/**
 * Layout model shared by the editor, the compiler and the public map.
 *
 * The unit of editing is a TABLE, not a seat. A table is two facing rows of
 * seats; which of them faces the ark is a property of the table. Seat pairing
 * (the "one facing the ark requires the one across" rule) falls out of this
 * structure for free — seat i on side A pairs with seat i on side B — so there
 * is no pairing table to maintain and nothing to drift out of sync.
 */

export interface TableSpec {
  kind: "table";
  id: string;
  /** Top-right grid anchor (RTL: column 1 is the rightmost). */
  row: number;
  col: number;
  /**
   * "v": the two seat columns run vertically, side A is the column nearer the
   * ark. "h": two seat rows run horizontally.
   */
  orientation: "v" | "h";
  seatsPerSide: number;
  /** Which side faces the ark: side "a" is by convention the ark-facing one. */
  zone: string;
}

export interface ElementSpec {
  kind: "element";
  id: string;
  /** ארון קודש, בימת ספר תורה, כניסה, כיור, ספריה, עמוד … */
  label: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

export interface HallLayout {
  rows: number;
  cols: number;
  tables: TableSpec[];
  elements: ElementSpec[];
  /** Table ids in numbering order; seat numbers are assigned by walking this. */
  numberingOrder: string[];
}

/**
 * The old hall (12×15m, 132 seats) as the proportional seed for the new one
 * (20×15m). The width axis is unchanged; the length axis grows by 20/12, which
 * at the structural level means the five table-column-pairs become seven while
 * the three bench blocks (6/4/6 rows) stay as they were. Seven pairs yield
 * ~186 seats — inside the 180–200 target.
 *
 * Grid convention: RTL. Column 1 is the physical RIGHT edge of the hall
 * (entrance side); high columns are the physical LEFT (ark side). A table pair
 * occupies two adjacent columns; aisles are the single columns between pairs.
 */
export function seedFromOldHall(): HallLayout {
  const BLOCKS = [
    { startRow: 2, rows: 6 }, // top bench block
    { startRow: 10, rows: 4 }, // middle block (bimah sits beside it)
    { startRow: 16, rows: 6 }, // bottom bench block
  ];
  const PAIRS = 7;
  // Rightmost pair starts at col 2; each pair is 2 cols + 1 aisle col.
  const pairCol = (i: number) => 2 + i * 3;

  const tables: TableSpec[] = [];
  const numberingOrder: string[] = [];

  // Numbering walks ark-side first (the old map numbered 1-32 nearest the
  // ark), so iterate pairs from the LEFT (high pair index) toward the right.
  for (let p = PAIRS - 1; p >= 0; p--) {
    for (let b = 0; b < BLOCKS.length; b++) {
      // The bimah replaces the middle block of the centre pair, as in the old hall.
      const isBimahSlot = b === 1 && p === Math.floor(PAIRS / 2);
      if (isBimahSlot) continue;
      const id = `t-p${p}-b${b}`;
      tables.push({
        kind: "table",
        id,
        row: BLOCKS[b].startRow,
        col: pairCol(p),
        orientation: "v",
        seatsPerSide: BLOCKS[b].rows,
        zone: p >= PAIRS - 2 ? "מזרח" : p >= 2 ? "מרכז" : "כניסה",
      });
      numberingOrder.push(id);
    }
  }

  const gridCols = pairCol(PAIRS - 1) + 2 + 2; // last pair + its width + ark margin
  const gridRows = 23;

  const elements: ElementSpec[] = [
    { kind: "element", id: "ark", label: "ארון קודש", row: 10, col: gridCols - 1, rowSpan: 4, colSpan: 2 },
    { kind: "element", id: "chazan", label: "חזן", row: 8, col: gridCols - 1, rowSpan: 1, colSpan: 1 },
    {
      kind: "element", id: "bimah", label: "בימת ספר תורה",
      row: 10, col: pairCol(Math.floor(PAIRS / 2)), rowSpan: 4, colSpan: 2,
    },
    { kind: "element", id: "entrance", label: "כניסה", row: 2, col: 1, rowSpan: 2, colSpan: 1 },
    { kind: "element", id: "sink", label: "כיור", row: 6, col: 1, rowSpan: 3, colSpan: 1 },
    { kind: "element", id: "library", label: "ספריה", row: 14, col: 1, rowSpan: 8, colSpan: 1 },
  ];

  return { rows: gridRows, cols: gridCols, tables, elements, numberingOrder };
}

export function countSeats(layout: HallLayout): number {
  return layout.tables.reduce((sum, t) => sum + t.seatsPerSide * 2, 0);
}

export interface LayoutProblem {
  severity: "error" | "warn";
  message: string;
}

/** Publish-time gate. A broken layout must fail loudly here, not on the live map. */
export function validateLayout(layout: HallLayout): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  const occupied = new Map<string, string>();

  const claim = (r: number, c: number, owner: string) => {
    if (r < 1 || r > layout.rows || c < 1 || c > layout.cols) {
      problems.push({ severity: "error", message: `${owner} חורג מגבולות הרשת (${r},${c})` });
      return;
    }
    const key = `${r},${c}`;
    const existing = occupied.get(key);
    if (existing && existing !== owner) {
      problems.push({ severity: "error", message: `חפיפה בין ${existing} ל-${owner} בתא (${r},${c})` });
    }
    occupied.set(key, owner);
  };

  for (const t of layout.tables) {
    if (t.seatsPerSide < 1) {
      problems.push({ severity: "error", message: `שולחן ${t.id} בלי מקומות` });
    }
    for (let i = 0; i < t.seatsPerSide; i++) {
      if (t.orientation === "v") {
        claim(t.row + i, t.col, t.id);
        claim(t.row + i, t.col + 1, t.id);
      } else {
        claim(t.row, t.col + i, t.id);
        claim(t.row + 1, t.col + i, t.id);
      }
    }
  }

  for (const e of layout.elements) {
    for (let r = 0; r < e.rowSpan; r++) {
      for (let c = 0; c < e.colSpan; c++) {
        claim(e.row + r, e.col + c, e.label);
      }
    }
  }

  const inOrder = new Set(layout.numberingOrder);
  for (const t of layout.tables) {
    if (!inOrder.has(t.id)) {
      problems.push({ severity: "error", message: `שולחן ${t.id} חסר בסדר המספור` });
    }
  }
  for (const id of layout.numberingOrder) {
    if (!layout.tables.some((t) => t.id === id)) {
      problems.push({ severity: "error", message: `סדר המספור מפנה לשולחן שנמחק: ${id}` });
    }
  }

  if (!layout.elements.some((e) => e.label === "ארון קודש")) {
    problems.push({ severity: "warn", message: "אין ארון קודש בפריסה" });
  }

  return problems;
}

export interface NumberedSeat {
  seatNo: number;
  tableId: string;
  side: "a" | "b";
  facingArk: boolean;
  pairSeatNo: number;
  zone: string;
  row: number;
  col: number;
}

/**
 * Deterministic numbering: walk tables in numberingOrder; within a table,
 * ark-facing side first, top to bottom, then the far side. Pairing is
 * positional — the i-th seat of each side.
 */
export function numberSeats(layout: HallLayout): NumberedSeat[] {
  const seats: NumberedSeat[] = [];
  let n = 1;
  for (const id of layout.numberingOrder) {
    const t = layout.tables.find((x) => x.id === id);
    if (!t) continue;
    const per = t.seatsPerSide;
    for (let i = 0; i < per; i++) {
      const base = {
        tableId: t.id,
        zone: t.zone,
      };
      // Side A (ark-facing) is the higher-numbered column in RTL (nearer the ark).
      const aCell = t.orientation === "v"
        ? { row: t.row + i, col: t.col + 1 }
        : { row: t.row, col: t.col + i };
      const bCell = t.orientation === "v"
        ? { row: t.row + i, col: t.col }
        : { row: t.row + 1, col: t.col + i };
      seats.push({
        ...base, seatNo: n + i, side: "a", facingArk: true,
        pairSeatNo: n + per + i, ...aCell,
      });
      seats.push({
        ...base, seatNo: n + per + i, side: "b", facingArk: false,
        pairSeatNo: n + i, ...bCell,
      });
    }
    n += per * 2;
  }
  return seats.sort((x, y) => x.seatNo - y.seatNo);
}
