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
  if (existing.indexOf('hourlyMemberSync') === -1) {
    ScriptApp.newTrigger('hourlyMemberSync').timeBased().everyHours(1).create();
  }
  // Fires the moment a member-form submission lands in the source
  // spreadsheet — the person sees their seat connected right away, without
  // waiting for the hourly sweep (which stays as the safety net).
  if (existing.indexOf('onMemberFormSubmit') === -1) {
    ScriptApp.newTrigger('onMemberFormSubmit')
      .forSpreadsheet(MEMBERS_SOURCE_ID)
      .onFormSubmit()
      .create();
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
    // NOT `|| 10`: zero is a legitimate TTL (expire immediately) and must not
    // silently fall back to the default.
    var ttlMin = Number(cfg.PENDING_TTL_MIN);
    if (isNaN(ttlMin)) ttlMin = 10;
    var ttlMs = ttlMin * 60 * 1000;
    var sh = sheet_(TAB.SEATS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return;

    var rows = sh.getRange(2, 1, lastRow - 1, SEAT_WIDTH).getValues();
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


/**
 * Attaches phones to name-only reservations, in place. A holder who has
 * since filled the member form gets connected without releasing anything —
 * the map, purchased seats and existing holds are untouched.
 */
function attachReservationPhones() {
  var chz = sheet_(TAB.CHAZAKA);
  var byKey = {};
  if (chz.getLastRow() > 1) {
    chz.getRange(2, 1, chz.getLastRow() - 1, CHAZAKA_HEADERS.length).getValues()
      .forEach(function (r) {
        var phone = normPhone_(r[2]);
        var approved = String(r[7] || '') !== '';
        if (phone && approved) byKey[keyTight_(String(r[3]))] = phone;
      });
  }
  var sh = sheet_(TAB.SEATS);
  if (sh.getLastRow() < 2) return 'attached=0';
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, SEAT_WIDTH).getValues();
  var attached = 0;
  rows.forEach(function (r, i) {
    if (r[COLS.STATUS - 1] !== STATUS.RESERVED) return;
    if (normPhone_(r[COLS.CHAZAKA_PHONE - 1])) return;
    var nm = String(r[COLS.CHAZAKA_NAME - 1] || '');
    if (!nm) return;
    var merge = holderMergeFor_(nm);
    var phone = byKey[keyTight_(nm)] || (merge ? byKey[merge.phoneKey] : '');
    if (!phone) return;
    sh.getRange(i + 2, COLS.CHAZAKA_PHONE).setValue(phone);
    attached++;
  });
  if (attached) {
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('seatmap');
    logAction_('ATTACH_PHONES', '', '', '', '', 'ok', 'attached=' + attached, '');
  }
  return 'attached=' + attached;
}

/**
 * Hourly: pull fresh member-form submissions and connect them. Deliberately
 * NON-destructive — no rematching pass (that would wipe manual fills), only
 * roster refresh, resolution of still-open rows, and in-place attachment.
 */
function hourlyMemberSync() {
  try { importMembers(); } catch (e) { logAction_('HOURLY_SYNC', '', '', '', '', 'fail', 'import: ' + e, ''); }
  try { resolveChazakaV2(); } catch (e) { logAction_('HOURLY_SYNC', '', '', '', '', 'fail', 'resolve: ' + e, ''); }
  try { attachReservationPhones(); } catch (e) { logAction_('HOURLY_SYNC', '', '', '', '', 'fail', 'attach: ' + e, ''); }
}


/** Immediate connection on form submit; same non-destructive chain. */
function onMemberFormSubmit() {
  hourlyMemberSync();
}
