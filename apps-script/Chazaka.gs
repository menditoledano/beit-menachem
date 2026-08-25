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
 * Old-hall geometry, for translating a תשפ"ו seat NUMBER into a physical
 * POSITION. Seat numbers are meaningless across the move — the hall grew from
 * 5 table-pairs to 7 — but a position (pair-from-ark, block, row, side) maps
 * one-to-one onto the new layout, because the seed preserved the block
 * structure and kept the bimah at its old third-pair-from-ark slot.
 *
 * Old numbering, per the תשפ"ו map: pairs counted from the ark, each column
 * numbered top-block (6), middle-block (4), bottom-block (6) sequentially;
 * ark-side column of a pair first, then the far column. The bimah pair has no
 * middle block; the last pair exists only in the bottom block.
 */
var OLD_PAIRS = [
  { first: 1, blocks: [6, 4, 6] },   // pair 0, nearest the ark: seats 1-32
  { first: 33, blocks: [6, 4, 6] },  // pair 1: 33-64
  { first: 65, blocks: [6, 0, 6] },  // pair 2 (bimah): 65-88
  { first: 89, blocks: [6, 4, 6] },  // pair 3: 89-120
  { first: 121, blocks: [0, 0, 6] }, // pair 4, entrance side: 121-132
];
var NEW_PAIRS_TOTAL = 7;

/** Old seat number -> {pairFromArk, block, rowInBlock, arkSideCol} or null. */
function oldSeatPosition_(n) {
  for (var p = 0; p < OLD_PAIRS.length; p++) {
    var colSize = OLD_PAIRS[p].blocks[0] + OLD_PAIRS[p].blocks[1] + OLD_PAIRS[p].blocks[2];
    var pairSize = colSize * 2;
    var offset = n - OLD_PAIRS[p].first;
    if (offset < 0 || offset >= pairSize) continue;
    var arkSideCol = offset < colSize;               // ark-side column numbered first
    var inCol = offset % colSize;
    for (var b = 0; b < 3; b++) {
      if (inCol < OLD_PAIRS[p].blocks[b]) {
        return { pairFromArk: p, block: b, rowInBlock: inCol, arkSideCol: arkSideCol };
      }
      inCol -= OLD_PAIRS[p].blocks[b];
    }
  }
  return null;
}

/**
 * Seeds last year's holders onto the new map as reserved seats, preserving
 * each holder's PHYSICAL position — same pair-from-ark, same block, same row,
 * same side of the table — not the old seat number, which no longer means
 * anything. Only APPROVED chazaka rows with a phone produce reservations.
 */
function seedChazakaSeats(body) {
  var tabName = String((body && body.tab) || OLD_MAP_TAB);
  var src = ss_().getSheetByName(tabName);
  if (!src) throw new Error('לא נמצא טאב "' + tabName + '"');

  // name-key -> {name, phone} from approved chazaka rows
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

  // old seat number -> holder display name
  var oldSeatHolder = {};
  src.getDataRange().getValues().forEach(function (r) {
    var no = Number(r[0]);
    var nm = String(r[1] || '').trim();
    if (no >= 1 && no <= 300 && nm && isNaN(Number(nm))) oldSeatHolder[no] = nm;
  });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('BUSY');
  try {
    var sh = sheet_(TAB.SEATS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) throw new Error('אין מקומות — פרסם פריסה קודם');
    var rows = sh.getRange(2, 1, lastRow - 1, SEAT_WIDTH).getValues();

    // Index the NEW seats by physical position. tableId encodes pair and
    // block ('t-p{p}-b{b}'); within a table+side, seat numbers ascend with
    // the row, so sorting them recovers rowInBlock without storing geometry.
    var byPosition = {}; // 'pairFromArk|block|row|side' -> row index in sheet
    var tableSeats = {}; // tableId+side -> [{seatNo, idx}]
    rows.forEach(function (r, i) {
      var key = String(r[COLS.TABLE_ID - 1]) + '|' + String(r[COLS.SIDE - 1]);
      (tableSeats[key] = tableSeats[key] || []).push({
        seatNo: Number(r[COLS.SEAT_NO - 1]), idx: i,
      });
    });
    Object.keys(tableSeats).forEach(function (key) {
      var parts = key.split('|');
      var m = /^t-p(\d+)-b(\d+)$/.exec(parts[0]);
      if (!m) return;
      var pairFromArk = NEW_PAIRS_TOTAL - 1 - Number(m[1]);
      var block = Number(m[2]);
      // Side 'a' is the ark-facing (ark-side) column, matching the old
      // pair's first-numbered column.
      var side = parts[1] === 'a';
      tableSeats[key].sort(function (x, y) { return x.seatNo - y.seatNo; });
      tableSeats[key].forEach(function (s, rowInBlock) {
        byPosition[pairFromArk + '|' + block + '|' + rowInBlock + '|' + (side ? 'ark' : 'far')] = s.idx;
      });
    });

    var reserved = 0, skippedNoPhone = 0, skippedTaken = 0, unmappable = [];
    Object.keys(oldSeatHolder).forEach(function (noStr) {
      var no = Number(noStr);
      var holderName = oldSeatHolder[no];
      var pos = oldSeatPosition_(no);
      if (!pos) { unmappable.push(no); return; }
      var idx = byPosition[
        pos.pairFromArk + '|' + pos.block + '|' + pos.rowInBlock + '|' +
        (pos.arkSideCol ? 'ark' : 'far')
      ];
      if (idx === undefined) { unmappable.push(no); return; }
      if (rows[idx][COLS.STATUS - 1] !== STATUS.FREE) { skippedTaken++; return; }
      var match = byKey[keyTight_(holderName)];
      if (!match) { skippedNoPhone++; return; }
      sh.getRange(idx + 2, COLS.STATUS).setValue(STATUS.RESERVED);
      sh.getRange(idx + 2, COLS.CHAZAKA_NAME, 1, 2).setValues([[match.name, match.phone]]);
      reserved++;
    });

    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('seatmap');
    var summary = 'reserved=' + reserved +
      ' unapprovedHolder=' + skippedNoPhone + ' alreadyTaken=' + skippedTaken +
      (unmappable.length ? ' unmappable=' + unmappable.join('/') : '');
    logAction_('SEED_CHAZAKA', '', '', '', '', 'ok', summary, '');
    return summary;
  } finally {
    lock.releaseLock();
  }
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
