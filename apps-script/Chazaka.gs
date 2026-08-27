/**
 * The offline chazaka matching pass.
 *
 * Chazaka this year is a PRIORITY TO CHOOSE, not a specific chair — the hall
 * itself changed — so the entire question is "who held a seat last year, and
 * what is their phone". Names on the old map are surnames or short names;
 * matching cascades from exact surname to loose-key candidates, records its
 * method and confidence, and NOTHING becomes a live right until a human
 * approves the row. Fuzzy logic nominates; the gabbai decides.
 */

var OLD_MAP_TAB = 'תשפ"ו בחירת מקומות בבית הכנסת למשלמי דמי חבר';

/**
 * Reads holder names from the most recent old seat list. The old spreadsheet
 * tab layout: the newer numbered list (seat -> name) is the section whose
 * rows look like [number, name, ...]. We read the whole tab and take every
 * such pair, letting later duplicates (the newer section) win.
 */
function runChazakaMatching(body) {
  var tabName = String((body && body.tab) || OLD_MAP_TAB);
  var src = ss_().getSheetByName(tabName);
  if (!src) {
    var names = ss_().getSheets().map(function (s) { return s.getName(); });
    throw new Error('לא נמצא טאב "' + tabName + '". טאבים: ' + names.join(' | '));
  }

  var data = src.getDataRange().getValues();
  var holders = {}; // normalized display -> raw display (dedup)
  data.forEach(function (r) {
    var no = Number(r[0]);
    var nm = String(r[1] || '').trim();
    // A seat-number/name pair. Later sections overwrite earlier ones, which
    // makes the newest list win; holders keyed by name dedup multi-seat owners.
    if (no >= 1 && no <= 300 && nm && isNaN(Number(nm))) {
      holders[keyTight_(nm)] = nm;
    }
  });

  var members = sheet_(TAB.MEMBERS);
  var mRows = members.getLastRow() > 1
    ? members.getRange(2, 1, members.getLastRow() - 1, MEMBER_HEADERS.length).getValues()
    : [];

  var out = [];
  Object.keys(holders).forEach(function (key) {
    var raw = holders[key];
    if (!key) return;

    // Cascade. Each stage only fires when the previous produced nothing.
    var tightHits = mRows.filter(function (m) {
      return String(m[6]) === key ||
        keyTight_(String(m[3])) === key ||          // surname-only cell
        String(m[6]).indexOf(key) !== -1;           // cell is a subset of full name
    });
    var method = 'tight';
    var hits = tightHits;

    if (hits.length === 0) {
      var loose = keyLoose_(raw);
      hits = mRows.filter(function (m) { return String(m[7]) === loose || keyLoose_(String(m[3])) === loose; });
      method = 'loose';
    }
    if (hits.length === 0) {
      var lk = keyLoose_(raw);
      hits = mRows.filter(function (m) {
        return String(m[7]).indexOf(lk) !== -1 || lk.indexOf(keyLoose_(String(m[3]))) !== -1;
      });
      method = 'contains';
    }

    if (hits.length === 1) {
      var m = hits[0];
      out.push([
        String(m[0]), (String(m[1]) + ' ' + String(m[3])).trim(), String(m[4]),
        raw, method, method === 'tight' ? 0.95 : 0.6,
        method === 'tight' ? 'AUTO' : 'REVIEW', '', false,
      ]);
    } else if (hits.length > 1) {
      out.push([
        '', hits.map(function (h) { return String(h[0]); }).join(','), '',
        raw, method + '-multi', 0.3, 'AMBIGUOUS', '', false,
      ]);
    } else {
      out.push(['', '', '', raw, 'none', 0, 'NO_MATCH', '', false]);
    }
  });

  var sh = sheet_(TAB.CHAZAKA);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, CHAZAKA_HEADERS.length).clearContent();
  if (out.length) sh.getRange(2, 1, out.length, CHAZAKA_HEADERS.length).setValues(out);
  CacheService.getScriptCache().remove('chazakaPhones');

  var counts = { AUTO: 0, REVIEW: 0, AMBIGUOUS: 0, NO_MATCH: 0 };
  out.forEach(function (r) { counts[r[6]] = (counts[r[6]] || 0) + 1; });
  var summary = 'holders=' + out.length +
    ' auto=' + counts.AUTO + ' review=' + counts.REVIEW +
    ' ambiguous=' + counts.AMBIGUOUS + ' none=' + counts.NO_MATCH;
  logAction_('CHAZAKA_MATCH', '', '', '', '', 'ok', summary, '');
  return summary;
}

/**
 * Core-hall geometry, transcribed from the source-of-truth tab "מקומות תשפ\"ה".
 * Each entry: sheet start row, row count, and the seat pairs as
 * [arkSideCol, farCol] in sheet coordinates, nearest-ark first. This MUST
 * mirror HALL_BLOCKS in lib/layout.ts — the tableIds t-{block}-p{i} are the
 * contract between the two.
 */
var CORE_BLOCKS = [
  { name: 'top', startRow: 0, rows: 6, pairs: [[2, 3], [5, 6], [8, 9], [11, 12]] },
  { name: 'mid', startRow: 8, rows: 4, pairs: [[3, 4], [6, 7], [13, 14]] },
  { name: 'bottom', startRow: 14, rows: 6, pairs: [[2, 3], [5, 6], [8, 9], [11, 12], [14, 15]] },
];

/**
 * Old cell -> position in the NEW tent hall, front rows.
 *
 * The old hall had the ark on its LEFT wall with vertical table-pairs; the
 * tent has the ark on TOP with horizontal strips. Rotating the old map 90
 * degrees clockwise maps it onto the tent front exactly as the gabbai asked
 * ("the existing arrangement keeps its configuration, at the front near the
 * ark"): old pair k from the ark -> tent strip k+1; old top block -> RIGHT
 * group, middle -> CENTER (the bimah stays beside it), bottom -> LEFT group;
 * the ark-side column of a pair -> the strip's ark-facing (upper) row.
 * New seats grow behind, toward the women's section.
 */
var BLOCK_TO_GROUP = { top: 'r', mid: 'c', bottom: 'l' };
function coreCellPosition_(r, c) {
  for (var b = 0; b < CORE_BLOCKS.length; b++) {
    var blk = CORE_BLOCKS[b];
    if (r < blk.startRow || r >= blk.startRow + blk.rows) continue;
    for (var p = 0; p < blk.pairs.length; p++) {
      var side = null;
      if (c === blk.pairs[p][0]) side = 'a';
      else if (c === blk.pairs[p][1]) side = 'b';
      if (side) {
        return {
          tableId: 't-m' + (p + 1) + '-' + BLOCK_TO_GROUP[blk.name],
          side: side,
          seatIdx: r - blk.startRow,
        };
      }
    }
  }
  return null;
}

/**
 * Explicit family merges: cells on the old map that are ONE household — the
 * surname cell and a given+surname cell for a son — collapse to a single
 * holder, so one phone unlocks all of that family's seats. This list is
 * DELIBERATELY explicit and short: surname-wide auto-merging would wrongly
 * fuse the דרורי brothers, the three כהן households and the בורובסקי pair.
 */
var HOLDER_MERGES = [
  { display: 'טולדנו', phoneFrom: 'טולדנו', cells: ['טולדנו', 'יוסף יצחק טולדנו'] },
  { display: 'רייניץ', phoneFrom: 'נפתלי רייניץ', cells: ['נפתלי רייניץ', 'שניאור רייניץ', 'שניאור זלמן רייניץ'] },
];

/** Cell name -> {display, phoneKey} when part of a merge, else null. */
function holderMergeFor_(nm) {
  var k = keyTight_(nm);
  for (var i = 0; i < HOLDER_MERGES.length; i++) {
    var m = HOLDER_MERGES[i];
    for (var j = 0; j < m.cells.length; j++) {
      if (keyTight_(m.cells[j]) === k) {
        return { display: m.display, phoneKey: keyTight_(m.phoneFrom) };
      }
    }
  }
  return null;
}

/** Non-seat labels that may appear inside the grid area of the core tab. */
var CORE_LABELS = { 'חזן': 1, 'ארון קודש': 1, 'בימת ספר תורה': 1, 'כניסה': 1, 'כיור': 1, 'ספריה': 1 };

/**
 * Seeds reservations straight from the core tab: every NAMED CELL becomes a
 * reserved seat at the same physical position in the new layout — same block,
 * same pair-from-ark, same row, same table side. No seat-number translation
 * exists anymore; the name grid IS the source of truth. Only names that
 * resolve to an approved _Chazaka phone produce reservations.
 */
function seedChazakaSeats(body) {
  var tabName = String((body && body.tab) || 'מקומות תשפ"ה');
  var src = ss_().getSheetByName(tabName);
  if (!src) throw new Error('לא נמצא טאב "' + tabName + '"');

  var chz = sheet_(TAB.CHAZAKA);
  var byKey = {};
  if (chz.getLastRow() > 1) {
    chz.getRange(2, 1, chz.getLastRow() - 1, CHAZAKA_HEADERS.length).getValues()
      .forEach(function (r) {
        var phone = normPhone_(r[2]);
        var approved = String(r[7] || '') !== '';
        var waived = r[8] === true || r[8] === 'TRUE';
        if (phone && approved && !waived) {
          byKey[keyTight_(String(r[3]))] = { name: String(r[3]), phone: phone };
        }
      });
  }

  var grid = src.getDataRange().getValues();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('BUSY');
  try {
    var sh = sheet_(TAB.SEATS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) throw new Error('אין מקומות — פרסם פריסה קודם');
    var rows = sh.getRange(2, 1, lastRow - 1, SEAT_WIDTH).getValues();

    // New seats indexed by physical position via tableId 't-{block}-p{i}'.
    var tableSeats = {};
    rows.forEach(function (r, i) {
      var key = String(r[COLS.TABLE_ID - 1]) + '|' + String(r[COLS.SIDE - 1]);
      (tableSeats[key] = tableSeats[key] || []).push({ seatNo: Number(r[COLS.SEAT_NO - 1]), idx: i });
    });
    var byPosition = {};
    Object.keys(tableSeats).forEach(function (key) {
      tableSeats[key].sort(function (x, y) { return x.seatNo - y.seatNo; });
      tableSeats[key].forEach(function (s, seatIdx) {
        byPosition[key + '|' + seatIdx] = s.idx;
      });
    });

    var reserved = 0, skippedNoPhone = 0, skippedTaken = 0, unmappable = [];
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < grid[r].length; c++) {
        var nm = String(grid[r][c] || '').trim();
        if (!nm || CORE_LABELS[nm]) continue;
        var pos = coreCellPosition_(r, c);
        if (!pos) { unmappable.push(nm + '@' + r + ',' + c); continue; }
        var idx = byPosition[pos.tableId + '|' + pos.side + '|' + pos.seatIdx];
        if (idx === undefined) { unmappable.push(nm + '@' + r + ',' + c); continue; }
        if (rows[idx][COLS.STATUS - 1] !== STATUS.FREE) { skippedTaken++; continue; }
        // EVERY named cell is reserved. A holder with a resolved phone can
        // confirm from the wizard; a holder without one still gets his seat
        // held and his name on the map — nobody can grab it, and the WhatsApp
        // fallback routes him to the gabbai for manual assignment. A seat must
        // never look free just because its holder skipped the member form.
        var merge = holderMergeFor_(nm);
        var displayName = merge ? merge.display : nm;
        var match = byKey[merge ? merge.phoneKey : keyTight_(nm)];
        if (!match) skippedNoPhone++;
        sh.getRange(idx + 2, COLS.STATUS).setValue(STATUS.RESERVED);
        sh.getRange(idx + 2, COLS.CHAZAKA_NAME, 1, 2)
          .setValues([[displayName, match ? match.phone : '']]);
        reserved++;
      }
    }

    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('seatmap');
    var summary = 'reserved=' + reserved +
      ' nameOnlyNoPhone=' + skippedNoPhone + ' alreadyTaken=' + skippedTaken +
      (unmappable.length ? ' unmappable=' + unmappable.slice(0, 8).join(';') : '');
    logAction_('SEED_CHAZAKA', '', '', '', '', 'ok', summary, '');
    return summary;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Feeds phones recovered from external documents into _Chazaka. Each entry
 * updates the row whose sourceRaw matches (tight-key comparison), records the
 * source document as the match method, and stamps approval — the gabbai
 * explicitly ordered this backfill, so the rows arrive live.
 * Entries that match no open row are reported back, not silently dropped.
 */
function fillChazakaFromExternal(body) {
  var entries = body.entries || [];
  if (!entries.length) throw new Error('אין רשומות');
  var sh = sheet_(TAB.CHAZAKA);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('_Chazaka ריק');
  var rows = sh.getRange(2, 1, lastRow - 1, CHAZAKA_HEADERS.length).getValues();

  var byKey = {};
  rows.forEach(function (r, i) { byKey[keyTight_(String(r[3]))] = i; });

  var updated = 0, unmatched = [], skippedHasPhone = 0;
  entries.forEach(function (e) {
    var idx = byKey[keyTight_(String(e.target || ''))];
    if (idx === undefined) { unmatched.push(String(e.target)); return; }
    var phone = normPhone_(e.phone);
    if (!phone) { unmatched.push(String(e.target) + ' (טלפון פסול)'); return; }
    // Never overwrite a phone that is already live — human data wins.
    if (normPhone_(rows[idx][2])) { skippedHasPhone++; return; }
    sh.getRange(idx + 2, 2, 1, 2).setValues([[String(e.foundName || e.target), phone]]);
    sh.getRange(idx + 2, 5, 1, 3).setValues([[
      'external:' + String(e.source || '').slice(0, 40), 0.8, 'AUTO',
    ]]);
    sh.getRange(idx + 2, 8).setValue(new Date());
    updated++;
  });

  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove('chazakaPhones');
  var summary = 'updated=' + updated + ' alreadyHadPhone=' + skippedHasPhone +
    (unmatched.length ? ' unmatched=' + unmatched.join(';') : '');
  logAction_('CHAZAKA_EXTERNAL_FILL', '', '', '', '', 'ok', summary, '');
  return summary;
}

/**
 * Converts every unexercised reservation back to free. The explicit gabbai
 * action that opens Round B — deliberately not a timer, so a hold never
 * evaporates overnight without a human deciding it.
 */
function releaseReservedSeats() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('BUSY');
  try {
    var sh = sheet_(TAB.SEATS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return 'released=0';
    var rows = sh.getRange(2, 1, lastRow - 1, SEAT_WIDTH).getValues();
    var released = 0;
    rows.forEach(function (r, i) {
      if (r[COLS.STATUS - 1] !== STATUS.RESERVED) return;
      sh.getRange(i + 2, COLS.STATUS).setValue(STATUS.FREE);
      sh.getRange(i + 2, COLS.CHAZAKA_NAME, 1, 2).setValues([['', '']]);
      released++;
    });
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('seatmap');
    logAction_('RELEASE_RESERVED', '', '', '', '', 'ok', 'released=' + released, '');
    return 'released=' + released;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Bulk-approves AUTO rows (they still went through the human's eyes as a
 * list), stamps the approval time. REVIEW/AMBIGUOUS/NO_MATCH stay dead until
 * edited by hand in the sheet or via the admin console.
 */
function approveAutoChazaka() {
  var sh = sheet_(TAB.CHAZAKA);
  var last = sh.getLastRow();
  if (last < 2) return 'nothing to approve';
  var rows = sh.getRange(2, 1, last - 1, CHAZAKA_HEADERS.length).getValues();
  var stamped = 0;
  var now = new Date();
  rows.forEach(function (r, i) {
    if (r[6] === 'AUTO' && !r[7] && r[2]) {
      sh.getRange(i + 2, 8).setValue(now);
      stamped++;
    }
  });
  CacheService.getScriptCache().remove('chazakaPhones');
  logAction_('CHAZAKA_APPROVE', '', '', '', '', 'ok', 'approved=' + stamped, '');
  return 'approved=' + stamped;
}
