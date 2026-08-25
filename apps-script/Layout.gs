/**
 * Layout persistence and publishing.
 *
 * The editor saves the raw layout (tables + elements) into _Layout. Publishing
 * compiles it into per-seat rows in _Seats and a rendering JSON in
 * _LayoutCompiled. The compiled JSON lives in a CELL, not Script Properties —
 * a property value caps at 9KB and the layout is bigger.
 */

/** Overwrites _Layout with the editor's current state. */
function saveLayout(payload) {
  var layout = payload.layout;
  if (!layout || !layout.tables) throw new Error('פריסה ריקה');

  var sh = sheet_(TAB.LAYOUT);
  var rows = [];

  layout.tables.forEach(function (t) {
    rows.push(['table', t.id, t.row, t.col, '', '', t.seatsPerSide, t.orientation, t.zone, '', '']);
  });
  layout.elements.forEach(function (e) {
    rows.push(['element', e.id, e.row, e.col, e.rowSpan, e.colSpan, '', '', '', e.label, '']);
  });
  rows.push(['meta', 'grid', layout.rows, layout.cols, '', '', '', '', '',
    JSON.stringify(layout.numberingOrder), '']);

  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, LAYOUT_HEADERS.length).clearContent();
  sh.getRange(2, 1, rows.length, LAYOUT_HEADERS.length).setValues(rows);

  logAction_('SAVE_LAYOUT', '', '', '', '', 'ok',
    'tables=' + layout.tables.length + ' elements=' + layout.elements.length, '');
  return 'saved tables=' + layout.tables.length;
}

/** Reads _Layout back into the editor's shape, or null when nothing was saved yet. */
function loadLayout() {
  var sh = sheet_(TAB.LAYOUT);
  var last = sh.getLastRow();
  if (last < 2) return null;

  var data = sh.getRange(2, 1, last - 1, LAYOUT_HEADERS.length).getValues();
  var layout = { rows: 0, cols: 0, tables: [], elements: [], numberingOrder: [] };

  data.forEach(function (r) {
    var kind = r[0];
    if (kind === 'table') {
      layout.tables.push({
        kind: 'table', id: r[1], row: Number(r[2]), col: Number(r[3]),
        seatsPerSide: Number(r[6]), orientation: String(r[7] || 'v'),
        zone: String(r[8] || ''),
      });
    } else if (kind === 'element') {
      layout.elements.push({
        kind: 'element', id: r[1], row: Number(r[2]), col: Number(r[3]),
        rowSpan: Number(r[4]) || 1, colSpan: Number(r[5]) || 1,
        label: String(r[9] || ''),
      });
    } else if (kind === 'meta' && r[1] === 'grid') {
      layout.rows = Number(r[2]);
      layout.cols = Number(r[3]);
      try { layout.numberingOrder = JSON.parse(String(r[9] || '[]')); } catch (e) {}
    }
  });

  return layout;
}

/**
 * Compiles the saved layout into _Seats rows and the rendering JSON.
 *
 * `seats` is the numbered-seat list produced by the SAME TypeScript code the
 * editor runs (lib/layout.ts numberSeats). It is computed client-side and sent
 * here rather than reimplemented in Apps Script — one numbering algorithm, one
 * place, nothing to drift. This function validates invariants rather than
 * trusting the caller.
 */
function publishLayout(payload) {
  var layout = payload.layout;
  var seats = payload.seats;
  var compiled = payload.compiled;
  if (!layout || !seats || !seats.length || !compiled) throw new Error('חסר מידע לפרסום');

  // Refuse to republish once anyone holds a seat: renumbering under a live
  // sale would detach every claim from its chair.
  var seatSh = sheet_(TAB.SEATS);
  var lastRow = seatSh.getLastRow();
  if (lastRow > 1) {
    var statuses = seatSh.getRange(2, 7, lastRow - 1, 1).getValues();
    for (var i = 0; i < statuses.length; i++) {
      if (statuses[i][0] === STATUS.TAKEN || statuses[i][0] === STATUS.PENDING) {
        throw new Error('יש מקומות תפוסים — אי אפשר לפרסם פריסה חדשה. שחרר קודם או פתח שנה חדשה.');
      }
    }
  }

  // Invariant checks. These are cheap; a bad publish is not.
  var seen = {};
  seats.forEach(function (s) {
    if (seen[s.seatNo]) throw new Error('מספר מקום כפול: ' + s.seatNo);
    seen[s.seatNo] = true;
  });
  for (var n = 1; n <= seats.length; n++) {
    if (!seen[n]) throw new Error('חסר מקום מספר ' + n + ' ברצף');
  }
  seats.forEach(function (s) {
    if (s.facingArk) {
      var pair = seats.filter(function (x) { return x.seatNo === s.pairSeatNo; })[0];
      if (!pair || pair.pairSeatNo !== s.seatNo) {
        throw new Error('מקום ' + s.seatNo + ' פונה לארון בלי בן זוג תקין');
      }
    }
  });

  saveLayout({ layout: layout });

  var rows = seats.map(function (s) {
    return [
      s.seatNo, s.tableId, s.side, s.facingArk, s.pairSeatNo, s.zone,
      STATUS.FREE, '', '', '', '', false, '', '',
      '', '', // chazakaName, chazakaPhone — filled by seedChazakaSeats
    ];
  });
  if (lastRow > 1) seatSh.getRange(2, 1, lastRow - 1, SEAT_HEADERS.length).clearContent();
  seatSh.getRange(2, 1, rows.length, SEAT_HEADERS.length).setValues(rows);

  var version = Utilities.getUuid().slice(0, 8);
  var compiledOut = JSON.stringify({
    version: version,
    rows: compiled.rows, cols: compiled.cols,
    tracks: compiled.tracks, cells: compiled.cells,
  });
  var compiledSh = sheet_(TAB.LAYOUT_COMPILED);
  compiledSh.getRange(1, 1).setValue(compiledOut);

  CacheService.getScriptCache().remove('layout');
  CacheService.getScriptCache().remove('seatmap');

  logAction_('PUBLISH_LAYOUT', '', '', '', '', 'ok',
    'seats=' + seats.length + ' version=' + version, '');
  return { seats: seats.length, version: version };
}

/** Rendering JSON for the public map, cached because it never changes mid-sale. */
function getCompiledLayout() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('layout');
  if (hit) return hit;
  var raw = String(sheet_(TAB.LAYOUT_COMPILED).getRange(1, 1).getValue() || '');
  if (raw) cache.put('layout', raw, 3600);
  return raw;
}
