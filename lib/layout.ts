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
/**
 * The hall, transcribed from the architect's tent plan (12x24m, ark at the
 * TOP): six men's table-strips in three groups per row (right 7 / center 4 /
 * left 7 seats per side), the bimah in a wide aisle between strips 4 and 5,
 * a mechitza, and two women's strips behind it. All entrances, the sink and
 * the sidurim shelf sit on the RIGHT wall, libraries flank the ark.
 *
 * Grid: RTL, column 1 = right wall (entrances). Ark row at top. A table is
 * orientation "h": upper seat row faces the ark, lower faces away.
 */
const SIDE_SEATS = 6;
const CENTER_SEATS = 4;
const MEN_STRIPS = 6;
const WOMEN_STRIPS = 2;

interface GroupSpec { key: "r" | "c" | "l"; startCol: number; seats: number }
const GROUPS: GroupSpec[] = [
  { key: "r", startCol: 2, seats: SIDE_SEATS },                    // right group
  { key: "c", startCol: 2 + SIDE_SEATS + 1, seats: CENTER_SEATS }, // center
  { key: "l", startCol: 2 + SIDE_SEATS + 1 + CENTER_SEATS + 1, seats: SIDE_SEATS }, // left
];
const GRID_COLS = GROUPS[2].startCol + SIDE_SEATS; // left group's far edge

/** Grid row of a strip's UPPER seat row. Strips are 2 rows + 1 aisle row. */
function stripRow(i: number): number {
  const base = 4; // rows 1-3: libraries/ark block
  if (i <= 4) return base + (i - 1) * 3;
  // wide bimah aisle (2 extra rows) between strips 4 and 5
  if (i <= MEN_STRIPS) return base + (i - 1) * 3 + 2;
  // mechitza row after the men's strips
  return base + (i - 1) * 3 + 2 + 2;
}

export function seedFromOldHall(): HallLayout {
  const tables: TableSpec[] = [];
  const numberingOrder: string[] = [];

  for (let i = 1; i <= MEN_STRIPS; i++) {
    for (const g of GROUPS) {
      const id = `t-m${i}-${g.key}`;
      // Strip 5's right table is shorter: the hand-washing station and the
      // coffee corner sit beside the men's entrance there.
      const seats = i === 5 && g.key === "r" ? 4 : g.seats;
      tables.push({
        kind: "table", id, row: stripRow(i), col: g.startCol,
        orientation: "h", seatsPerSide: seats, zone: "גברים",
      });
      numberingOrder.push(id);
    }
  }

  // The women's strips are shorter than the men's: the plan's stated total
  // is 250, and with the men's section faithful to the table dimensions
  // (216), the women's section holds 34 — the back strip clipped further by
  // the women's-entrance corner.
  const WOMEN_GROUPS: Array<Array<{ key: "r" | "c" | "l"; seats: number }>> = [
    [{ key: "r", seats: 6 }, { key: "c", seats: 4 }, { key: "l", seats: 6 }],
    // The back strip loses a chair to the women's-entrance corner (right).
    [{ key: "r", seats: 5 }, { key: "c", seats: 4 }, { key: "l", seats: 6 }],
  ];
  WOMEN_GROUPS.forEach((groups, wi) => {
    for (const g of groups) {
      const base = GROUPS.find((x) => x.key === g.key)!;
      const id = `t-w${wi + 1}-${g.key}`;
      tables.push({
        kind: "table", id, row: stripRow(MEN_STRIPS + wi + 1), col: base.startCol,
        orientation: "h", seatsPerSide: g.seats, zone: "נשים",
      });
      numberingOrder.push(id);
    }
  });

  const gridRows = stripRow(MEN_STRIPS + WOMEN_STRIPS) + 3;
  const arkW = 4;
  const arkCol = Math.floor((GRID_COLS - arkW) / 2) + 1;

  const elements: ElementSpec[] = [
    { kind: "element", id: "ark", label: "ארון קודש", row: 1, col: arkCol, rowSpan: 2, colSpan: arkW },
    { kind: "element", id: "lib-r", label: "ספריה", row: 1, col: 2, rowSpan: 1, colSpan: 5 },
    { kind: "element", id: "lib-l", label: "ספריה", row: 1, col: GRID_COLS - 4, rowSpan: 1, colSpan: 5 },
    {
      kind: "element", id: "bimah", label: "בימת ספר תורה",
      row: stripRow(4) + 2, col: GROUPS[1].startCol, rowSpan: 2, colSpan: CENTER_SEATS,
    },
    { kind: "element", id: "mechitza", label: "מחיצה — עזרת נשים", row: stripRow(6) + 2, col: 2, rowSpan: 1, colSpan: GRID_COLS - 1 },
    { kind: "element", id: "entrance-m", label: "כניסת גברים", row: stripRow(4) + 2, col: 1, rowSpan: 2, colSpan: 1 },
    { kind: "element", id: "sink", label: "כיור", row: stripRow(5), col: 1, rowSpan: 2, colSpan: 1 },
    { kind: "element", id: "entrance-w", label: "כניסת נשים", row: stripRow(8), col: 1, rowSpan: 2, colSpan: 1 },
  ];

  return { rows: gridRows, cols: GRID_COLS, tables, elements, numberingOrder };
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
