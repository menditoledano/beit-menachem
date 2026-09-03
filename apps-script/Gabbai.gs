/**
 * Gabbai operations. Every mutation takes the same script lock as claim() and
 * flushes before releasing — the lock protects rows only against other script
 * executions, so the admin UI must go through here rather than letting a human
 * type into _Seats mid-rush.
 */

/**
 * Full per-seat detail for the admin panel — the one read that may include
 * phone, email and paid state. Never routed to the public API.
 */
function seatDetails(body) {
  var wanted = (body.seatNos || []).map(Number);
  if (!wanted.length) return { seats: [] };
  var sh = sheet_(TAB.SEATS);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { seats: [] };
  var rows = sh.getRange(2, 1, lastRow - 1, SEAT_WIDTH).getValues();
  var out = [];
  rows.forEach(function (r) {
    var n = Number(r[COLS.SEAT_NO - 1]);
    if (wanted.indexOf(n) === -1) return;
    out.push({
      seatNo: n,
      status: String(r[COLS.STATUS - 1]),
      holderName: String(r[COLS.NAME - 1] || ''),
      holderPhone: String(r[COLS.PHONE - 1] || ''),
      holderEmail: String(r[COLS.EMAIL - 1] || ''),
      paid: r[COLS.PAID - 1] === true || r[COLS.PAID - 1] === 'TRUE',
      chazakaName: String(r[COLS.CHAZAKA_NAME - 1] || ''),
      chazakaPhone: String(r[COLS.CHAZAKA_PHONE - 1] || ''),
      note: String(r[COLS.NOTE - 1] || ''),
    });
  });
  return { seats: out };
}

/** Last audit-log rows, newest first, for the console's activity feed. */
function recentLog(body) {
  var limit = Math.min(30, Number((body && body.limit) || 15));
  var sh = sheet_(TAB.LOG);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { rows: [] };
  var count = Math.min(limit, lastRow - 1);
  var vals = sh.getRange(lastRow - count + 1, 1, count, LOG_HEADERS.length).getValues();
  return {
    rows: vals.reverse().map(function (r) {
      return {
        time: r[0] instanceof Date
          ? Utilities.formatDate(r[0], 'Asia/Jerusalem', 'dd/MM HH:mm')
          : String(r[0]),
        action: String(r[1]),
        seats: String(r[2]),
        name: String(r[3]),
        result: String(r[6]),
        detail: String(r[7] || '').slice(0, 80),
      };
    }),
  };
}

function setConfigValue_(key, value) {
  var allowed = Object.keys(CONFIG_DEFAULTS);
  if (allowed.indexOf(String(key)) === -1) throw new Error('מפתח לא מוכר: ' + key);
  var sh = sheet_(TAB.CONFIG);
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(key)) {
      sh.getRange(i + 2, 2).setValue(value);
      SpreadsheetApp.flush();
      CacheService.getScriptCache().remove('config');
      CacheService.getScriptCache().remove('seatmap');
      logAction_('SET_CONFIG', '', '', '', '', 'ok', key + '=' + value, '');
      return key + '=' + value;
    }
  }
  throw new Error('מפתח לא נמצא בטאב: ' + key);
}

/**
 * op ∈ release | markPaid | assign | block | unblock
 * Seat mutations only a gabbai may perform. Self-release does not exist as a
 * public action by design — nobody can evict anybody.
 */
function gabbaiAction(body) {
  var op = String(body.op || '');
  var seatNos = (body.seatNos || []).map(Number);
  if (!seatNos.length) return { ok: false, code: 'BAD_SEAT' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { ok: false, code: 'BUSY' };

  try {
    var sh = sheet_(TAB.SEATS);
    var lastRow = sh.getLastRow();
    var rows = sh.getRange(2, 1, lastRow - 1, SEAT_WIDTH).getValues();
    var byNo = {};
    rows.forEach(function (r, i) { byNo[Number(r[COLS.SEAT_NO - 1])] = i; });

    var touched = [];
    seatNos.forEach(function (n) {
      var i = byNo[n];
      if (i === undefined) return;
      var rowIdx = i + 2;
      switch (op) {
        case 'release':
          sh.getRange(rowIdx, COLS.STATUS, 1, 7)
            .setValues([[STATUS.FREE, '', '', '', '', false, '']]);
          // A released reservation must not leave a stale chazaka claim on
          // the row — the next seeding run re-creates real ones.
          sh.getRange(rowIdx, COLS.CHAZAKA_NAME, 1, 2).setValues([['', '']]);
          touched.push(n);
          break;
        case 'markPaid':
          sh.getRange(rowIdx, COLS.PAID).setValue(true);
          // A pending seat that pays becomes a real claim.
          if (rows[i][COLS.STATUS - 1] === STATUS.PENDING) {
            sh.getRange(rowIdx, COLS.STATUS).setValue(STATUS.TAKEN);
          }
          touched.push(n);
          break;
        case 'assign':
          sh.getRange(rowIdx, COLS.STATUS, 1, 7).setValues([[
            STATUS.TAKEN,
            // An unparseable phone stays EMPTY — falling back to the raw text
            // used to plant names in the phone column, breaking lookup and
            // per-phone pricing for that holder.
            String(body.name || ''), normPhone_(body.phone),
            String(body.email || ''), new Date(), false, 'gabbai-assign',
          ]]);
          touched.push(n);
          break;
        case 'block':
          sh.getRange(rowIdx, COLS.STATUS).setValue(STATUS.BLOCKED);
          touched.push(n);
          break;
        case 'unblock':
          sh.getRange(rowIdx, COLS.STATUS).setValue(STATUS.FREE);
          touched.push(n);
          break;
        default:
          throw new Error('פעולה לא מוכרת: ' + op);
      }
    });

    logAction_('GABBAI_' + op.toUpperCase(), touched.join(','), String(body.name || ''),
      '', '', 'ok', '', '');
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('seatmap');
    return { ok: true, op: op, seatNos: touched };
  } catch (err) {
    return { ok: false, code: 'SERVER_ERROR', message: String(err) };
  } finally {
    lock.releaseLock();
  }
}
