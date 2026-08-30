/**
 * Time-driven maintenance. installTriggers() is idempotent — run it once from
 * the editor or via the admin API.
 */

function installTriggers() {
  // The hourly sweep is retired: sync runs on form submit, when there is
  // actually something new. Remove any leftover hourly trigger.
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'hourlyMemberSync') ScriptApp.deleteTrigger(tr);
  });
  var existing = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction();
  });
  if (existing.indexOf('expirePendingSeats') === -1) {
    ScriptApp.newTrigger('expirePendingSeats').timeBased().everyMinutes(10).create();
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
 *
 * Candidates come from BOTH approved _Chazaka rows and the member roster,
 * each indexed under several spellings of the same identity: the tight key,
 * a space-free key (so "בן דור" meets surname "בנדור" and stopwords like
 * "בר" survive as real surnames), and the bare surname / last word. A key
 * that maps to more than one distinct phone attaches nothing — ambiguity
 * stays human.
 */
function attachReservationPhones() {
  var compact = function (s) {
    return foldFinals_(normHe_(String(s || ''))).replace(/ /g, '');
  };
  // key -> {} of distinct phones seen under that key
  var index = {};
  var put = function (key, phone) {
    if (!key || key.length < 2 || !phone) return;
    (index[key] = index[key] || {})[phone] = true;
  };

  var chz = sheet_(TAB.CHAZAKA);
  if (chz.getLastRow() > 1) {
    chz.getRange(2, 1, chz.getLastRow() - 1, CHAZAKA_HEADERS.length).getValues()
      .forEach(function (r) {
        var phone = normPhone_(r[2]);
        var approved = String(r[7] || '') !== '';
        if (!phone || !approved) return;
        var raw = String(r[3]);
        put(keyTight_(raw), phone);
        put(compact(raw), phone);
        var words = normHe_(raw).split(' ').filter(String);
        if (words.length > 1) put(compact(words[words.length - 1]), phone);
      });
  }
  var mem = ss_().getSheetByName(TAB.MEMBERS);
  if (mem && mem.getLastRow() > 1) {
    mem.getRange(2, 1, mem.getLastRow() - 1, MEMBER_HEADERS.length).getValues()
      .forEach(function (m) {
        var phone = normPhone_(m[4]);
        if (!phone) return;
        var given = String(m[1] || ''), family = String(m[3] || '');
        put(keyTight_(given + ' ' + family), phone);
        put(compact(given + family), phone);
        put(compact(family), phone);
      });
  }
  var pick = function (key) {
    var set = index[key];
    if (!set) return '';
    var phones = Object.keys(set);
    return phones.length === 1 ? phones[0] : '';
  };

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
    var phone = pick(keyTight_(nm)) || pick(compact(nm)) ||
      (merge ? pick(merge.phoneKey) : '');
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
 * The member-sync chain: pull fresh form submissions and connect them.
 * Deliberately NON-destructive — no rematching pass (that would wipe manual
 * fills), only roster refresh, resolution of still-open rows, and in-place
 * attachment. Runs on form submit.
 */
function memberSync_() {
  try { importMembers(); } catch (e) { logAction_('MEMBER_SYNC', '', '', '', '', 'fail', 'import: ' + e, ''); }
  try { resolveChazakaV2(); } catch (e) { logAction_('MEMBER_SYNC', '', '', '', '', 'fail', 'resolve: ' + e, ''); }
  try { attachReservationPhones(); } catch (e) { logAction_('MEMBER_SYNC', '', '', '', '', 'fail', 'attach: ' + e, ''); }
}


/** Immediate connection on form submit; same non-destructive chain. */
function onMemberFormSubmit() {
  memberSync_();
}
