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
  codes[STATUS.RESERVED] = '4';

  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, SEAT_WIDTH).getValues().forEach(function (r) {
      var n = Number(r[COLS.SEAT_NO - 1]);
      if (!n) return;
      var st = r[COLS.STATUS - 1];
      status[n] = codes[st] || '0';
      // Public payload: display names only. Phones and emails never leave here.
      if (st === STATUS.TAKEN) holders[n] = String(r[COLS.NAME - 1] || '');
      if (st === STATUS.PENDING) holders[n] = 'משוריין';
      if (st === STATUS.RESERVED) holders[n] = String(r[COLS.CHAZAKA_NAME - 1] || 'שמור');
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
    // Deadline of the reservation hold, verbatim from config, for the countdown.
    reservedUntil: String(cfg.ROUND_A_DEADLINE || ''),
    paymentUrl: String(cfg.PAYMENT_URL || ''),
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

  if (!matches.length) {
    // Not in the member roster — but a reservation can still exist for this
    // phone, backfilled from external documents. The hold itself is the
    // identity; without this branch those holders are locked out of the very
    // seats reserved for them.
    var held = reservedSeatsWithName_(phone);
    if (held.seats.length) {
      return {
        kind: 'CHAZAKA', memberId: '', name: held.name, reservedSeats: held.seats,
      };
    }
    return { kind: 'UNKNOWN' };
  }
  // Families share a number; let the caller ask which household member this is.
  if (matches.length > 1) return { kind: 'MULTI', candidates: matches };

  var hasChazaka = isChazakaPhone_(phone);
  return {
    kind: hasChazaka ? 'CHAZAKA' : 'MEMBER_NO_CHAZAKA',
    memberId: matches[0].memberId,
    name: matches[0].name,
    // The member's own reserved seats, so the wizard can greet them with
    // "המקום שלך שמור" and jump straight there on the map.
    reservedSeats: reservedSeatsFor_(phone),
  };
}

function reservedSeatsFor_(phone) {
  return reservedSeatsWithName_(phone).seats;
}

function reservedSeatsWithName_(phone) {
  var sh = ss_().getSheetByName(TAB.SEATS);
  if (!sh || sh.getLastRow() < 2) return { seats: [], name: '' };
  var out = [];
  var name = '';
  sh.getRange(2, 1, sh.getLastRow() - 1, SEAT_WIDTH).getValues().forEach(function (r) {
    if (r[COLS.STATUS - 1] === STATUS.RESERVED &&
        normPhone_(r[COLS.CHAZAKA_PHONE - 1]) === phone) {
      out.push(Number(r[COLS.SEAT_NO - 1]));
      if (!name) name = String(r[COLS.CHAZAKA_NAME - 1] || '');
    }
  });
  return { seats: out, name: name };
}
