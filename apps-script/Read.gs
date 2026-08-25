/**
 * Read endpoints. No locks anywhere on this path — reads must stay cheap and
 * lock-free, because they are the traffic that scales with the crowd.
 */

/**
 * Compact seat-state payload, cached briefly. Geometry is NOT here — the
 * client fetches the layout once per version and polls only this.
 */
function seatmap() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('seatmap');
  if (hit) return JSON.parse(hit);

  var cfg = getConfig_();
  var sh = sheet_(TAB.SEATS);
  var lastRow = sh.getLastRow();
  var status = {};
  var holders = {};

  var codes = {};
  codes[STATUS.FREE] = '0'; codes[STATUS.TAKEN] = '1';
  codes[STATUS.PENDING] = '2'; codes[STATUS.BLOCKED] = '3';

  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, COLS.NOTE).getValues().forEach(function (r) {
      var n = Number(r[COLS.SEAT_NO - 1]);
      if (!n) return;
      status[n] = codes[r[COLS.STATUS - 1]] || '0';
      // Public payload: display name only. Phone and email never leave here.
      if (r[COLS.STATUS - 1] === STATUS.TAKEN) holders[n] = String(r[COLS.NAME - 1] || '');
      if (r[COLS.STATUS - 1] === STATUS.PENDING) holders[n] = 'משוריין';
    });
  }

  var compiled = getCompiledLayout();
  var version = '';
  if (compiled) {
    try { version = JSON.parse(compiled).version || ''; } catch (e) {}
  }

  var payload = {
    layoutVersion: version,
    phase: String(cfg.PHASE),
    mode: String(cfg.MODE),
    status: status,
    holders: holders,
    // The shul's public contact number for the Round A fallback link.
    gabbaiPhone: String(cfg.GABBAI_PHONE || ''),
    serverTime: new Date().toISOString(),
  };
  cache.put('seatmap', JSON.stringify(payload), 4);
  return payload;
}

/**
 * Phone lookup for the Round A entry screen. Exact phone match only.
 *
 * This is a phone-number oracle by construction (enter a phone, learn a name),
 * which is why the proxy rate-limits it hard per IP. Here it stays cheap.
 */
function lookup(body) {
  var phone = normPhone_(body.phone);
  if (!phone) return { kind: 'UNKNOWN' };

  var sh = sheet_(TAB.MEMBERS);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { kind: 'UNKNOWN' };

  var rows = sh.getRange(2, 1, lastRow - 1, MEMBER_HEADERS.length).getValues();
  var matches = rows.filter(function (r) { return normPhone_(r[4]) === phone; })
    .map(function (r) {
      return { memberId: String(r[0]), name: (String(r[1]) + ' ' + String(r[3])).trim() };
    });

  if (!matches.length) return { kind: 'UNKNOWN' };
  // Families share a number; let the caller ask which household member this is.
  if (matches.length > 1) return { kind: 'MULTI', candidates: matches };

  var hasChazaka = isChazakaPhone_(phone);
  return {
    kind: hasChazaka ? 'CHAZAKA' : 'MEMBER_NO_CHAZAKA',
    memberId: matches[0].memberId,
    name: matches[0].name,
  };
}
