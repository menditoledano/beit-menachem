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
 * Seeds last year's holders onto the new map as reserved seats.
 *
 * The new layout was scaled from the old hall, so old seat numbers land in
 * roughly the same physical spot. Each old holder's seat numbers are marked
 * שמור with the holder's name and phone (from the approved _Chazaka rows) —
 * the wizard then shows each member their own seat, held for them until the
 * Round A deadline. Only APPROVED rows with a phone produce reservations.
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

    var reserved = 0, skippedNoPhone = 0, skippedTaken = 0;
    rows.forEach(function (r, i) {
      var no = Number(r[COLS.SEAT_NO - 1]);
      var holderName = oldSeatHolder[no];
      if (!holderName) return;
      if (r[COLS.STATUS - 1] !== STATUS.FREE) { skippedTaken++; return; }
      var match = byKey[keyTight_(holderName)];
      if (!match) { skippedNoPhone++; return; }
      sh.getRange(i + 2, COLS.STATUS).setValue(STATUS.RESERVED);
      sh.getRange(i + 2, COLS.CHAZAKA_NAME, 1, 2).setValues([[match.name, match.phone]]);
      reserved++;
    });

    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('seatmap');
    var summary = 'reserved=' + reserved +
      ' unapprovedHolder=' + skippedNoPhone + ' alreadyTaken=' + skippedTaken;
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
