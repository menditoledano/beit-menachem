/**
 * Gabbai operations. Every mutation takes the same script lock as claim() and
 * flushes before releasing — the lock protects rows only against other script
 * executions, so the admin UI must go through here rather than letting a human
 * type into _Seats mid-rush.
 */

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
            String(body.name || ''), normPhone_(body.phone) || String(body.phone || ''),
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
