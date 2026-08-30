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
    memberFormUrl: String(cfg.MEMBER_FORM_URL || ''),
    prices: {
      menFirst: Number(cfg.PRICE_FIRST_SEAT) || 150,
      menExtra: Number(cfg.PRICE_EXTRA_SEAT) || 50,
      womenFirst: Number(cfg.PRICE_WOMEN_FIRST_SEAT) || 150,
      womenExtra: Number(cfg.PRICE_WOMEN_EXTRA_SEAT) || 50,
    },
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

  var idn = seatIdentityFor_(phone);

  if (!matches.length) {
    // Not in the member roster — but the seats themselves can identify this
    // phone: a hold backfilled from external documents, or a purchase already
    // made (the buyer who returns to add women's-section seats must not hear
    // "המספר לא נמצא" from the system that just sold to them).
    if (idn.reserved.length || idn.taken.length) {
      return {
        kind: 'CHAZAKA', memberId: '', name: idn.name,
        reservedSeats: idn.reserved, takenSeats: idn.taken,
      };
    }
    return { kind: 'UNKNOWN' };
  }
  // Families share a number; let the caller ask which household member this
  // is. The reservation is keyed by PHONE, so the held seats ride along —
  // omitting them here left duplicate-row members blind to their own hold.
  if (matches.length > 1) {
    return {
      kind: 'MULTI', candidates: matches,
      reservedSeats: idn.reserved, takenSeats: idn.taken,
    };
  }

  var hasChazaka = isChazakaPhone_(phone);
  return {
    kind: hasChazaka ? 'CHAZAKA' : 'MEMBER_NO_CHAZAKA',
    memberId: matches[0].memberId,
    name: matches[0].name,
    // The member's own reserved seats, so the wizard can greet them with
    // "המקום שלך שמור" and jump straight there on the map.
    reservedSeats: idn.reserved,
    takenSeats: idn.taken,
  };
}

/**
 * Everything the seat tab knows about a phone: its live holds (by hold phone,
 * or by the name _Chazaka matched to this phone when the hold is name-only)
 * and its purchased seats. The purchase branch is what keeps a buyer
 * recognisable after their hold was consumed.
 */
function seatIdentityFor_(phone) {
  var out = { reserved: [], taken: [], name: '' };
  var sh = ss_().getSheetByName(TAB.SEATS);
  if (!sh || sh.getLastRow() < 2) return out;
  var nameKeys = chazakaNameKeysForPhone_(phone);
  var holdName = '';
  sh.getRange(2, 1, sh.getLastRow() - 1, SEAT_WIDTH).getValues().forEach(function (r) {
    var st = r[COLS.STATUS - 1];
    if (st === STATUS.RESERVED) {
      var hp = normPhone_(r[COLS.CHAZAKA_PHONE - 1]);
      var holderName = String(r[COLS.CHAZAKA_NAME - 1] || '');
      var mine = hp ? hp === phone : nameKeys[keyTight_(holderName)] === true;
      if (mine) {
        out.reserved.push(Number(r[COLS.SEAT_NO - 1]));
        if (!holdName) holdName = holderName;
      }
    } else if (st === STATUS.TAKEN || st === STATUS.PENDING) {
      if (normPhone_(r[COLS.PHONE - 1]) === phone) {
        out.taken.push(Number(r[COLS.SEAT_NO - 1]));
        // The typed full name from the purchase beats the hold's surname.
        if (!out.name) out.name = String(r[COLS.NAME - 1] || '');
      }
    }
  });
  if (!out.name) out.name = holdName;
  return out;
}
