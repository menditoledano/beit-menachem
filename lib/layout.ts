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
 * The hall structure, transcribed cell-for-cell from the source-of-truth tab
 * "מקומות תשפ"ה" and extended for the new 20×15m hall.
 *
 * The real hall is asymmetric and that asymmetry is preserved exactly:
 *   top block    (sheet rows 0-5):  4 pairs at sheet cols (2,3)(5,6)(8,9)(11,12)
 *   middle block (sheet rows 8-11): 3 pairs OFFSET one column — (3,4)(6,7)(13,14),
 *                                   with the bimah between at sheet cols 9-10
 *   bottom block (sheet rows 14-19): 5 pairs, the top's four plus (14,15)
 * = 132 core seats. The growth adds two entrance-side pairs per block
 * (marked isNew) for 196 seats total.
 *
 * Sheet col 0 is the ark wall; sheet col 17 was the entrance wall and moves
 * outward to make room. In OUR grid (RTL, column 1 = rightmost = entrance,
 * high columns = ark) a sheet column c lands at grid col SHEET_COLS - c.
 */
const SHEET_COLS = 25; // ark wall 0 … entrance wall 24, after the extension
const toGrid = (sheetCol: number) => SHEET_COLS - sheetCol;
/** Sheet row r (0-based) → grid row (1-based, one row of margin on top). */
const rowGrid = (sheetRow: number) => sheetRow + 2;

interface BlockSpec {
  name: "top" | "mid" | "bottom";
  sheetStartRow: number;
  rows: number;
  /** [arkSideCol, farCol] in sheet coordinates, ordered nearest-ark first. */
  corePairs: Array<[number, number]>;
  newPairs: Array<[number, number]>;
}

export const HALL_BLOCKS: BlockSpec[] = [
  {
    name: "top", sheetStartRow: 0, rows: 6,
    corePairs: [[2, 3], [5, 6], [8, 9], [11, 12]],
    newPairs: [[14, 15], [17, 18]],
  },
  {
    name: "mid", sheetStartRow: 8, rows: 4,
    corePairs: [[3, 4], [6, 7], [13, 14]],
    newPairs: [[16, 17], [19, 20]],
  },
  {
    name: "bottom", sheetStartRow: 14, rows: 6,
    corePairs: [[2, 3], [5, 6], [8, 9], [11, 12], [14, 15]],
    newPairs: [[17, 18], [20, 21]],
  },
];

export function seedFromOldHall(): HallLayout {
  const tables: TableSpec[] = [];
  const numberingOrder: string[] = [];

  // Numbering: ark-nearest pair first within each block, blocks top→bottom
  // per pair index — mirroring how the old map read.
  for (const block of HALL_BLOCKS) {
    const pairs = [...block.corePairs, ...block.newPairs];
    pairs.forEach(([arkCol], pairIdx) => {
      const id = `t-${block.name}-p${pairIdx}`;
      tables.push({
        kind: "table",
        id,
        row: rowGrid(block.sheetStartRow),
        // Anchor at the pair's lower grid col; side "a" resolves to the
        // higher grid col — which is toGrid(arkCol), the ark-side seat.
        col: toGrid(arkCol) - 1,
        orientation: "v",
        seatsPerSide: block.rows,
        zone: pairIdx <= 1 ? "מזרח" : pairIdx <= 3 ? "מרכז" : "כניסה",
      });
    });
  }
  // Walk numbering ark-outward across blocks: pair 0 of every block first.
  const maxPairs = Math.max(...HALL_BLOCKS.map((b) => b.corePairs.length + b.newPairs.length));
  for (let p = 0; p < maxPairs; p++) {
    for (const block of HALL_BLOCKS) {
      const id = `t-${block.name}-p${p}`;
      if (tables.some((t) => t.id === id)) numberingOrder.push(id);
    }
  }

  const gridCols = SHEET_COLS + 1; // + ark margin column
  const gridRows = rowGrid(19) + 1;

  const elements: ElementSpec[] = [
    // Sheet: ark at col 0 rows 8-11, chazan row 7; both on the ark wall.
    { kind: "element", id: "ark", label: "ארון קודש", row: rowGrid(8), col: toGrid(0), rowSpan: 4, colSpan: 1 },
    { kind: "element", id: "chazan", label: "חזן", row: rowGrid(7), col: toGrid(0), rowSpan: 1, colSpan: 1 },
    // Bimah between the middle pairs, sheet cols 9-10 (colSpan spans both).
    { kind: "element", id: "bimah", label: "בימת ספר תורה", row: rowGrid(8), col: toGrid(10), rowSpan: 4, colSpan: 2 },
    // Entrance wall fixtures move outward with the hall: sheet col 24.
    { kind: "element", id: "entrance", label: "כניסה", row: rowGrid(0), col: toGrid(24), rowSpan: 2, colSpan: 1 },
    { kind: "element", id: "sink", label: "כיור", row: rowGrid(2), col: toGrid(24), rowSpan: 2, colSpan: 1 },
    { kind: "element", id: "library", label: "ספריה", row: rowGrid(14), col: toGrid(24), rowSpan: 6, colSpan: 1 },
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
