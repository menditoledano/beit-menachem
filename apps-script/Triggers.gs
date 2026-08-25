/**
 * Time-driven maintenance. installTriggers() is idempotent — run it once from
 * the editor or via the admin API.
 */

function installTriggers() {
  var existing = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction();
  });
  if (existing.indexOf('expirePendingSeats') === -1) {
    ScriptApp.newTrigger('expirePendingSeats').timeBased().everyMinutes(10).create();
  }
  return 'triggers: ' + ScriptApp.getProjectTriggers().length;
}

/**
 * Reverts seats stuck in PENDING back to FREE after the configured TTL.
 * PENDING exists so an unrecognised phone in Round B reserves rather than
 * takes; this sweep is what stops a typo'd phone from holding seats forever.
 * Takes the same lock as claim() — it mutates the same rows.
 */
function expirePendingSeats() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var cfg = getConfig_();
    var ttlMs = Number(cfg.PENDING_TTL_MIN || 10) * 60 * 1000;
    var sh = sheet_(TAB.SEATS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return;

    var rows = sh.getRange(2, 1, lastRow - 1, COLS.NOTE).getValues();
    var now = Date.now();
    var expired = [];

    rows.forEach(function (r, i) {
      if (r[COLS.STATUS - 1] !== STATUS.PENDING) return;
      var at = r[COLS.CLAIMED_AT - 1];
      if (!(at instanceof Date) || now - at.getTime() < ttlMs) return;
      sh.getRange(i + 2, COLS.STATUS, 1, 7)
        .setValues([[STATUS.FREE, '', '', '', '', false, '']]);
      expired.push(r[COLS.SEAT_NO - 1]);
    });

    if (expired.length) {
      logAction_('EXPIRE_PENDING', expired.join(','), '', '', '', 'ok',
        'ttlMin=' + cfg.PENDING_TTL_MIN, '');
      SpreadsheetApp.flush();
      CacheService.getScriptCache().remove('seatmap');
    }
  } finally {
    lock.releaseLock();
  }
}
