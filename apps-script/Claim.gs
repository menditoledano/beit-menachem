/**
 * The claim path — the only code that turns a free seat into a taken one.
 *
 * Order of operations inside the lock is the whole game:
 *   idempotency fast-path (outside) → tryLock → idempotency re-check →
 *   config gate → single getValues of all seats → status / phase / cap /
 *   pairing checks → write → audit → flush() → cache result → release.
 *
 * flush() before releaseLock() is mandatory. Spreadsheet writes are batched;
 * releasing first lets the next execution acquire the lock, re-read the seat
 * and see it still FREE — the one defect that double-books a chair.
 */

var COLS = {
  SEAT_NO: 1, TABLE_ID: 2, SIDE: 3, FACING: 4, PAIR: 5, ZONE: 6,
  STATUS: 7, NAME: 8, PHONE: 9, EMAIL: 10, CLAIMED_AT: 11, PAID: 12,
  REQUEST_ID: 13, NOTE: 14, CHAZAKA_NAME: 15, CHAZAKA_PHONE: 16,
};
var SEAT_WIDTH = 16; // total columns read/written per seat row

function claim(body) {
  var t0 = Date.now();
  var cache = CacheService.getScriptCache();

  var seatNos = (body.seatNos || []).map(Number).filter(function (n) { return n >= 1; });
  var name = String(body.name || '').replace(new RegExp('[\\u0000-\\u001F\\u007F]', 'g'), '').trim().slice(0, 60);
  var phone = normPhone_(body.phone);
  var email = String(body.email || '').trim().slice(0, 100);
  var reqId = String(body.requestId || '').slice(0, 80);
  var ip = String(body.ip || '');

  if (!seatNos.length || seatNos.length > 3) return { ok: false, code: 'BAD_SEAT' };
  if (!phone) return { ok: false, code: 'BAD_PHONE' };
  if (name.length < 2 || !reqId) return { ok: false, code: 'BAD_INPUT' };

  // Same requestId → same answer, no lock, no queue. Double-taps and network
  // retries during a 3-6s cold start land here.
  var hit = cache.get('req:' + reqId);
  if (hit) return JSON.parse(hit);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) {
    // A thread WAITING on the lock still occupies one of the 30 execution
    // slots, so fail fast with jitter rather than queueing patiently.
    return { ok: false, code: 'BUSY', retryAfterMs: 700 + Math.floor(Math.random() * 900) };
  }

  try {
    var again = cache.get('req:' + reqId);
    if (again) return JSON.parse(again);

    var cfg = getConfig_();
    if (cfg.MODE !== 'OPEN') return fail_(cache, reqId, 'SALE_CLOSED');

    // Burst throttle. Read-modify-write on CacheService is only atomic because
    // we hold the lock. It is a throttle, never a cap — cache entries evict.
    if (!bump_(cache, 'ph:' + phone, Number(cfg.BURST_PER_PHONE || 3), 60)) {
      return fail_(cache, reqId, 'TOO_FAST', { retryAfterMs: 30000 });
    }
    if (!bump_(cache, 'global', Number(cfg.BURST_GLOBAL || 40), 60)) {
      return fail_(cache, reqId, 'BUSY', { retryAfterMs: 5000 });
    }

    var sh = sheet_(TAB.SEATS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return fail_(cache, reqId, 'SALE_CLOSED');
    // One read of the whole tab (~200 rows) gives the re-read AND the cap
    // recount AND the pairing lookups. Never count the cap from cache.
    var rows = sh.getRange(2, 1, lastRow - 1, SEAT_WIDTH).getValues();
    var bySeat = {};
    rows.forEach(function (r, i) { bySeat[Number(r[COLS.SEAT_NO - 1])] = { row: r, idx: i }; });

    for (var i = 0; i < seatNos.length; i++) {
      var entry = bySeat[seatNos[i]];
      if (!entry) return fail_(cache, reqId, 'BAD_SEAT');
      var st = entry.row[COLS.STATUS - 1];
      // A reserved seat is claimable, but only by the phone on the
      // reservation — anyone else sees it as taken until the hold lapses.
      if (st === STATUS.RESERVED) {
        if (normPhone_(entry.row[COLS.CHAZAKA_PHONE - 1]) !== phone) {
          return fail_(cache, reqId, 'RESERVED_FOR_OTHER', {
            seatNo: seatNos[i],
            holder: String(entry.row[COLS.CHAZAKA_NAME - 1] || ''),
          });
        }
      } else if (st !== STATUS.FREE) {
        return fail_(cache, reqId, 'TAKEN', {
          seatNo: seatNos[i],
          holder: String(entry.row[COLS.NAME - 1] || '').split(' ')[0],
        });
      }
    }

    // Round A: chazaka holders only, matched by exact phone. Fuzzy matching
    // never runs here — it ran offline, weeks ago, into _Chazaka.
    if (cfg.PHASE === 'A' && !isChazakaPhone_(phone)) {
      return fail_(cache, reqId, 'ROUND_A_NOT_YOURS');
    }

    // Durable cap, recounted from the sheet inside the lock.
    var held = rows.filter(function (r) {
      return normPhone_(r[COLS.PHONE - 1]) === phone && r[COLS.STATUS - 1] !== STATUS.FREE;
    }).length;
    var cap = Number(cfg.MAX_SEATS_PER_PHONE || 3);
    if (held + seatNos.length > cap) {
      return fail_(cache, reqId, 'CAP_REACHED', { cap: cap, held: held });
    }

    // Purchase shape. The rule, as the gabbai stated it: the second seat MUST
    // be the one across the table from the first; a third must sit adjacent
    // to that pair. This is what prevents a family buying a whole row of
    // ark-facing seats with nobody opposite.
    //
    // Exemption: a selection consisting entirely of seats RESERVED for this
    // phone is a historic position being confirmed — last year's arrangement
    // predates the rule and is honored as-is.
    var reservedForMe = function (row) {
      return row[COLS.STATUS - 1] === STATUS.RESERVED &&
        normPhone_(row[COLS.CHAZAKA_PHONE - 1]) === phone;
    };
    var allMine = seatNos.every(function (n) { return reservedForMe(bySeat[n].row); });

    if (!allMine) {
      if (seatNos.length === 1) {
        // A lone ark-facing seat with a free opposite would start an
        // unpaired facing row — unless it is this member's own hold.
        var s0 = bySeat[seatNos[0]].row;
        var facing0 = s0[COLS.FACING - 1] === true || s0[COLS.FACING - 1] === 'TRUE';
        if (facing0 && !reservedForMe(s0)) {
          var p0 = Number(s0[COLS.PAIR - 1]);
          var p0taken = bySeat[p0] && bySeat[p0].row[COLS.STATUS - 1] !== STATUS.FREE &&
            !reservedForMe(bySeat[p0].row);
          if (!p0taken) {
            return fail_(cache, reqId, 'PAIR_REQUIRED', { seatNo: seatNos[0], pairSeatNo: p0 });
          }
        }
      } else {
        // 2-3 seats: exactly one across-pair, plus (optionally) one adjacent.
        var pairFound = null;
        for (var a = 0; a < seatNos.length && !pairFound; a++) {
          var pn = Number(bySeat[seatNos[a]].row[COLS.PAIR - 1]);
          if (seatNos.indexOf(pn) !== -1) pairFound = [seatNos[a], pn];
        }
        if (!pairFound) {
          var wantPair = Number(bySeat[seatNos[0]].row[COLS.PAIR - 1]);
          return fail_(cache, reqId, 'SHAPE_PAIR_FIRST', {
            seatNo: seatNos[0], pairSeatNo: wantPair,
          });
        }
        var extras = seatNos.filter(function (n) {
          return n !== pairFound[0] && n !== pairFound[1];
        });
        // Numbering ascends along a table side, so adjacency on the same
        // table and side is exactly a seat-number difference of one.
        var adjacentOk = extras.every(function (n) {
          var er = bySeat[n].row;
          return pairFound.some(function (pnum) {
            var pr = bySeat[pnum].row;
            return String(er[COLS.TABLE_ID - 1]) === String(pr[COLS.TABLE_ID - 1]) &&
              String(er[COLS.SIDE - 1]) === String(pr[COLS.SIDE - 1]) &&
              Math.abs(n - pnum) === 1;
          });
        });
        if (!adjacentOk) {
          return fail_(cache, reqId, 'SHAPE_ADJACENT', {
            pair: pairFound, seatNo: extras[0],
          });
        }
      }
    }

    // Unknown phone in Round B parks as PENDING — visible as reserved, expires
    // by trigger — so a typo'd phone cannot permanently grab seats, while a
    // real member whose number is missing from the roster still gets served.
    var isMember = isMemberPhone_(phone);
    var newStatus = (cfg.PHASE === 'B' && !isMember) ? STATUS.PENDING : STATUS.TAKEN;

    var now = new Date();
    seatNos.forEach(function (n) {
      var idx = bySeat[n].idx;
      sh.getRange(idx + 2, COLS.STATUS, 1, 7).setValues([[
        newStatus, name, phone, email, now, false, reqId,
      ]]);
    });

    // Wizard registration data rides along with the claim; stored regardless
    // of which seats were picked so the aliyot list is complete.
    if (body.registration) {
      try {
        sheet_(TAB.REGISTRATIONS).appendRow([
          now, name, phone, email, seatNos.join(','),
          totalPriceFor_(held + seatNos.length, cfg) - totalPriceFor_(held, cfg),
          String(body.registration.aliyah1 || '').slice(0, 100),
          String(body.registration.aliyah2 || '').slice(0, 100),
          body.registration.takanonApproved === true,
          body.registration.duesDeclared === true,
          String(body.registration.notes || '').slice(0, 300),
        ]);
      } catch (e) {
        logAction_('REGISTRATION', seatNos.join(','), name, phone, cfg.PHASE, 'fail', String(e), '');
      }
    }

    // Exercising the chazaka right consumes it: any reservation of this phone
    // NOT claimed right now is released. Choosing a different seat is a move,
    // not an accumulation — the old hold frees up for Round B.
    var releasedHolds = [];
    rows.forEach(function (r, i) {
      if (r[COLS.STATUS - 1] !== STATUS.RESERVED) return;
      if (normPhone_(r[COLS.CHAZAKA_PHONE - 1]) !== phone) return;
      if (seatNos.indexOf(Number(r[COLS.SEAT_NO - 1])) !== -1) return;
      sh.getRange(i + 2, COLS.STATUS).setValue(STATUS.FREE);
      sh.getRange(i + 2, COLS.CHAZAKA_NAME, 1, 2).setValues([['', '']]);
      releasedHolds.push(Number(r[COLS.SEAT_NO - 1]));
    });
    if (releasedHolds.length) {
      logAction_('CHAZAKA_MOVED', releasedHolds.join(','), name, phone, cfg.PHASE,
        'ok', 'released after claiming ' + seatNos.join(','), ip);
    }

    var total = totalPriceFor_(held + seatNos.length, cfg) - totalPriceFor_(held, cfg);
    logAction_('CLAIM', seatNos.join(','), name, phone, cfg.PHASE,
      newStatus === STATUS.PENDING ? 'pending' : 'ok',
      'ms=' + (Date.now() - t0), ip);

    SpreadsheetApp.flush();

    var res = {
      ok: true, seatNos: seatNos, totalPrice: total, phase: cfg.PHASE,
      pending: newStatus === STATUS.PENDING,
    };
    cache.put('req:' + reqId, JSON.stringify(res), 900);
    cache.remove('seatmap');

    // Email after the flush — a mail failure must never unwind a claim.
    try { sendClaimEmail_(name, phone, email, seatNos, total, isMember); } catch (e) {
      logAction_('EMAIL', seatNos.join(','), name, phone, cfg.PHASE, 'fail', String(e), '');
    }
    return res;
  } catch (err) {
    logAction_('CLAIM', seatNos.join(','), name, phone, '', 'error', String(err), ip);
    // Deliberately NOT cached: a transient error must stay retryable.
    return { ok: false, code: 'SERVER_ERROR' };
  } finally {
    lock.releaseLock();
  }
}

/** Deterministic rejections are cached — same requestId, same verdict. */
function fail_(cache, reqId, code, extra) {
  var r = { ok: false, code: code };
  if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
  cache.put('req:' + reqId, JSON.stringify(r), 900);
  return r;
}

function bump_(cache, key, max, windowSec) {
  var k = 'rl:' + key;
  var n = Number(cache.get(k) || 0);
  if (n >= max) return false;
  cache.put(k, String(n + 1), windowSec);
  return true;
}

function isChazakaPhone_(phone) {
  return chazakaPhoneSet_()['p' + phone] === true;
}

function chazakaPhoneSet_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('chazakaPhones');
  if (hit) return JSON.parse(hit);
  var set = {};
  var sh = ss_().getSheetByName(TAB.CHAZAKA);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, CHAZAKA_HEADERS.length).getValues()
      .forEach(function (r) {
        // Only approved, non-waived rows grant Round A access.
        var phone = normPhone_(r[2]);
        var approved = String(r[7] || '') !== '';
        var waived = r[8] === true || r[8] === 'TRUE';
        if (phone && approved && !waived) set['p' + phone] = true;
      });
  }
  cache.put('chazakaPhones', JSON.stringify(set), 300);
  return set;
}

function isMemberPhone_(phone) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('memberPhones');
  var set;
  if (hit) {
    set = JSON.parse(hit);
  } else {
    set = {};
    var sh = ss_().getSheetByName(TAB.MEMBERS);
    if (sh && sh.getLastRow() > 1) {
      sh.getRange(2, 5, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
        var p = normPhone_(r[0]);
        if (p) set['p' + p] = true;
      });
    }
    cache.put('memberPhones', JSON.stringify(set), 300);
  }
  return set['p' + phone] === true;
}

/**
 * Confirmation goes to the address ON FILE for this phone, not the typed one.
 * That asymmetry is the impersonation alarm: claim a seat in someone else's
 * name and the real owner hears about it within seconds.
 */
function sendClaimEmail_(name, phone, typedEmail, seatNos, total, isMember) {
  var to = '';
  if (isMember) {
    var sh = sheet_(TAB.MEMBERS);
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, MEMBER_HEADERS.length).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (normPhone_(rows[i][4]) === phone && rows[i][5]) { to = String(rows[i][5]); break; }
    }
  }
  if (!to) to = typedEmail;
  if (!to) return;

  var payUrl = String(getConfig_().PAYMENT_URL || '');
  MailApp.sendEmail({
    to: to,
    subject: 'אישור בחירת מקום — בית מנחם גני איילון',
    htmlBody:
      '<div dir="rtl">שלום ' + name + ',<br><br>' +
      'נרשמה על שמך בחירת מקום/ות: <b>' + seatNos.join(', ') + '</b><br>' +
      'סכום לתשלום: <b>' + total + ' ש"ח</b><br>' +
      (payUrl ? '<a href="' + payUrl + '">לתשלום מאובטח לחץ כאן</a><br>' : '') +
      '<br>אם לא אתה ביצעת את הבחירה — השב למייל זה או פנה לגבאי מיד.<br><br>' +
      'בית הכנסת חב"ד "בית מנחם", גני איילון</div>',
  });
}
