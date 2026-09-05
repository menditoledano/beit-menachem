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

  var cfg = null;
  // Every rejection is written to _Log — sale-night complaints get diagnosed
  // from the sheet, not reconstructed from memory.
  var rej = function (code, extra) {
    logAction_('REJECT', seatNos.join(','), name, phone,
      String((cfg && cfg.PHASE) || ''), code, extra ? JSON.stringify(extra) : '', ip);
    return fail_(cache, reqId, code, extra);
  };

  try {
    var again = cache.get('req:' + reqId);
    if (again) return JSON.parse(again);

    cfg = getConfig_();
    if (cfg.MODE !== 'OPEN') return rej('SALE_CLOSED');

    // Burst throttle. Read-modify-write on CacheService is only atomic because
    // we hold the lock. It is a throttle, never a cap — cache entries evict.
    if (!bump_(cache, 'ph:' + phone, Number(cfg.BURST_PER_PHONE || 3), 60)) {
      return rej('TOO_FAST', { retryAfterMs: 30000 });
    }
    if (!bump_(cache, 'global', Number(cfg.BURST_GLOBAL || 40), 60)) {
      return rej('BUSY', { retryAfterMs: 5000 });
    }

    var sh = sheet_(TAB.SEATS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return rej('SALE_CLOSED');
    // One read of the whole tab (~200 rows) gives the re-read AND the cap
    // recount AND the pairing lookups. Never count the cap from cache.
    var rows = sh.getRange(2, 1, lastRow - 1, SEAT_WIDTH).getValues();
    var bySeat = {};
    rows.forEach(function (r, i) { bySeat[Number(r[COLS.SEAT_NO - 1])] = { row: r, idx: i }; });

    // A hold belongs to this caller either by the phone on the reservation,
    // or — when the seed left it name-only — by the name _Chazaka matched to
    // this phone offline. Both paths are phone-authenticated; typed input
    // never grants a hold.
    var myNameKeys = chazakaNameKeysForPhone_(phone);
    var holdIsMine = function (row) {
      if (row[COLS.STATUS - 1] !== STATUS.RESERVED) return false;
      var hp = normPhone_(row[COLS.CHAZAKA_PHONE - 1]);
      if (hp) return hp === phone;
      return myNameKeys[keyTight_(String(row[COLS.CHAZAKA_NAME - 1] || ''))] === true;
    };

    for (var i = 0; i < seatNos.length; i++) {
      var entry = bySeat[seatNos[i]];
      if (!entry) return rej('BAD_SEAT');
      var st = entry.row[COLS.STATUS - 1];
      // A reserved seat is claimable, but only by its own holder — anyone
      // else sees it as taken until the hold lapses.
      if (st === STATUS.RESERVED) {
        if (!holdIsMine(entry.row)) {
          return rej('RESERVED_FOR_OTHER', {
            seatNo: seatNos[i],
            holder: String(entry.row[COLS.CHAZAKA_NAME - 1] || ''),
          });
        }
      } else if (st !== STATUS.FREE) {
        return rej('TAKEN', {
          seatNo: seatNos[i],
          holder: String(entry.row[COLS.NAME - 1] || '').split(' ')[0],
        });
      }
    }

    // Section first: one claim stays inside one section, and both the cap
    // and the price ladder are PER SECTION — a family buying in the women's
    // section must not exhaust the father's men's-section allowance.
    var section = String(bySeat[seatNos[0]].row[COLS.ZONE - 1]);
    for (var sIdx = 1; sIdx < seatNos.length; sIdx++) {
      if (String(bySeat[seatNos[sIdx]].row[COLS.ZONE - 1]) !== section) {
        return rej('MIXED_SECTION');
      }
    }
    // Durable cap, recounted from the sheet inside the lock.
    var held = rows.filter(function (r) {
      return normPhone_(r[COLS.PHONE - 1]) === phone &&
        r[COLS.STATUS - 1] !== STATUS.FREE &&
        String(r[COLS.ZONE - 1]) === section;
    }).length;
    var cap = Number(cfg.MAX_SEATS_PER_PHONE || 3);
    if (held + seatNos.length > cap) {
      return rej('CAP_REACHED', { cap: cap, held: held });
    }

    // Purchase shape. The rule, as the gabbai stated it: the second seat MUST
    // be the one across the table from the first; a third must sit adjacent
    // to that pair. This is what prevents a family buying a whole row of
    // ark-facing seats with nobody opposite.
    //
    // Exemption: a selection consisting entirely of this caller's own holds
    // is a historic position being confirmed — last year's arrangement
    // predates the rule and is honored as-is.
    var reservedForMe = holdIsMine;
    var allMine = seatNos.every(function (n) { return reservedForMe(bySeat[n].row); });

    if (!allMine) {
      var shapeErr = shapeError_(seatNos, bySeat, reservedForMe);
      if (shapeErr) return rej(shapeErr.code, shapeErr.extra);
    }

    // Anyone may buy a FREE seat in any round — chazaka priority is enforced
    // by the RESERVED holds themselves, seat by seat, so a phase-wide gate
    // adds no protection and locked out first-time members on sale night.
    // An unknown phone parks as PENDING — visible as reserved, expires by
    // trigger — so a typo'd phone cannot permanently grab seats, while a real
    // member whose number is missing from the roster still gets served.
    var isMember = isMemberPhone_(phone);
    var newStatus = (isMember || isChazakaPhone_(phone)) ? STATUS.TAKEN : STATUS.PENDING;

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
      if (!holdIsMine(r)) return;
      if (seatNos.indexOf(Number(r[COLS.SEAT_NO - 1])) !== -1) return;
      // Consumption is PER SECTION: buying women's-section chairs must not
      // evaporate the men's-section hold that is still awaiting confirmation.
      if (String(r[COLS.ZONE - 1]) !== section) return;
      sh.getRange(i + 2, COLS.STATUS).setValue(STATUS.FREE);
      sh.getRange(i + 2, COLS.CHAZAKA_NAME, 1, 2).setValues([['', '']]);
      releasedHolds.push(Number(r[COLS.SEAT_NO - 1]));
    });
    if (releasedHolds.length) {
      logAction_('CHAZAKA_MOVED', releasedHolds.join(','), name, phone, cfg.PHASE,
        'ok', 'released after claiming ' + seatNos.join(','), ip);
    }

    // `held` above is the pre-claim count in this section — exactly what
    // the per-section price ladder needs.
    var heldInSection = held;
    var total = totalPriceFor_(heldInSection + seatNos.length, cfg, section) -
      totalPriceFor_(heldInSection, cfg, section);
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

/**
 * Purchase shape, as the gabbai stated it: the second seat MUST be the one
 * across the table from the first; a third must sit adjacent to that pair,
 * on the ark-facing side. This is what prevents a family buying a whole row
 * of ark-facing seats with nobody opposite.
 *
 * A single seat is always valid, either side of the table — the rule
 * constrains only MULTI-seat holdings. Returns null when valid, otherwise
 * {code, extra}. One rule, one place: claim() and move() both call it.
 */
function shapeError_(seatNos, bySeat, isMine) {
  if (seatNos.length < 2) return null;
  // 2-3 seats: exactly one across-pair, plus (optionally) one adjacent.
  var pairFound = null;
  for (var a = 0; a < seatNos.length && !pairFound; a++) {
    var pn = Number(bySeat[seatNos[a]].row[COLS.PAIR - 1]);
    if (seatNos.indexOf(pn) !== -1) pairFound = [seatNos[a], pn];
  }
  if (!pairFound) {
    return { code: 'SHAPE_PAIR_FIRST', extra: {
      seatNo: seatNos[0], pairSeatNo: Number(bySeat[seatNos[0]].row[COLS.PAIR - 1]),
    } };
  }
  var extras = seatNos.filter(function (n) {
    return n !== pairFound[0] && n !== pairFound[1];
  });
  // A third seat must sit on the ARK-FACING side, adjacent to the pair's
  // facing member. Growth is facing-first by design: a back-row seat must
  // never be sold without its opposite, so the extra chair opens a new pair
  // from the facing side — its opposite stays available for the next buyer.
  var isFacing = function (r) { return r[COLS.FACING - 1] === true || r[COLS.FACING - 1] === 'TRUE'; };
  var facingOfPair = pairFound.filter(function (pnum) { return isFacing(bySeat[pnum].row); })[0];
  var adjacentOk = facingOfPair !== undefined && extras.every(function (n) {
    var er = bySeat[n].row;
    var pr = bySeat[facingOfPair].row;
    return isFacing(er) &&
      String(er[COLS.TABLE_ID - 1]) === String(pr[COLS.TABLE_ID - 1]) &&
      Math.abs(n - facingOfPair) === 1;
  });
  if (adjacentOk) return null;
  // Offer the valid neighbours so the client can guide, not scold.
  var suggestions = [];
  if (facingOfPair !== undefined) {
    [facingOfPair - 1, facingOfPair + 1].forEach(function (n) {
      var e2 = bySeat[n];
      if (e2 && (e2.row[COLS.STATUS - 1] === STATUS.FREE || isMine(e2.row)) &&
          String(e2.row[COLS.TABLE_ID - 1]) ===
          String(bySeat[facingOfPair].row[COLS.TABLE_ID - 1]) &&
          isFacing(e2.row)) {
        suggestions.push(n);
      }
    });
  }
  return { code: 'SHAPE_ADJACENT', extra: {
    pair: pairFound, seatNo: extras[0], suggestions: suggestions,
  } };
}

/**
 * A buyer swaps one of their own seats for a FREE one. The only self-service
 * change to a taken seat: a bare release stays gabbai-only, so the worst a
 * guessed phone can do is shuffle someone within the same section — and the
 * owner hears about it by email, exactly like a claim.
 *
 * Same section only (the price ladder and the cap are per section, so the
 * amount owed does not change), paid flag rides along, and the resulting
 * holding must still satisfy the purchase shape.
 */
function move(body) {
  var cache = CacheService.getScriptCache();
  var phone = normPhone_(body.phone);
  var from = Number(body.fromSeatNo);
  var to = Number(body.toSeatNo);
  var reqId = String(body.requestId || '').slice(0, 80);
  var ip = String(body.ip || '');

  if (!(from >= 1) || !(to >= 1) || from === to) return { ok: false, code: 'BAD_SEAT' };
  if (!phone) return { ok: false, code: 'BAD_PHONE' };
  if (!reqId) return { ok: false, code: 'BAD_INPUT' };

  var hit = cache.get('req:' + reqId);
  if (hit) return JSON.parse(hit);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) {
    return { ok: false, code: 'BUSY', retryAfterMs: 700 + Math.floor(Math.random() * 900) };
  }

  var cfg = null;
  var rej = function (code, extra) {
    logAction_('REJECT', from + '>' + to, '', phone,
      String((cfg && cfg.PHASE) || ''), code, extra ? JSON.stringify(extra) : '', ip);
    return fail_(cache, reqId, code, extra);
  };

  try {
    var again = cache.get('req:' + reqId);
    if (again) return JSON.parse(again);

    cfg = getConfig_();
    if (cfg.MODE !== 'OPEN') return rej('SALE_CLOSED');
    if (!bump_(cache, 'ph:' + phone, Number(cfg.BURST_PER_PHONE || 3), 60)) {
      return rej('TOO_FAST', { retryAfterMs: 30000 });
    }

    var sh = sheet_(TAB.SEATS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return rej('SALE_CLOSED');
    var rows = sh.getRange(2, 1, lastRow - 1, SEAT_WIDTH).getValues();
    var bySeat = {};
    rows.forEach(function (r, i) { bySeat[Number(r[COLS.SEAT_NO - 1])] = { row: r, idx: i }; });

    var src = bySeat[from];
    var dst = bySeat[to];
    if (!src || !dst) return rej('BAD_SEAT');

    var srcStatus = src.row[COLS.STATUS - 1];
    if ((srcStatus !== STATUS.TAKEN && srcStatus !== STATUS.PENDING) ||
        normPhone_(src.row[COLS.PHONE - 1]) !== phone) {
      return rej('NOT_YOURS', { seatNo: from });
    }
    // FREE only — a hold, even the caller's own, goes through claim().
    if (dst.row[COLS.STATUS - 1] !== STATUS.FREE) {
      return rej('TAKEN', {
        seatNo: to, holder: String(dst.row[COLS.NAME - 1] || '').split(' ')[0],
      });
    }
    var section = String(src.row[COLS.ZONE - 1]);
    if (String(dst.row[COLS.ZONE - 1]) !== section) return rej('MIXED_SECTION');

    // The holding after the swap must still be a legal shape — unless it
    // never was one: a chazaka position confirmed as-is, or a gabbai
    // assignment, predates the rule and may be rearranged freely.
    var others = rows.filter(function (r) {
      return normPhone_(r[COLS.PHONE - 1]) === phone &&
        r[COLS.STATUS - 1] !== STATUS.FREE &&
        String(r[COLS.ZONE - 1]) === section &&
        Number(r[COLS.SEAT_NO - 1]) !== from;
    }).map(function (r) { return Number(r[COLS.SEAT_NO - 1]); });
    var never = function () { return false; };
    var wasLegal = shapeError_(others.concat([from]), bySeat, never) === null;
    var after = others.concat([to]);
    if (wasLegal) {
      var shapeErr = shapeError_(after, bySeat, never);
      if (shapeErr) return rej(shapeErr.code, shapeErr.extra);
    }

    var name = String(src.row[COLS.NAME - 1] || '');
    var email = String(src.row[COLS.EMAIL - 1] || '');
    var paid = src.row[COLS.PAID - 1] === true || src.row[COLS.PAID - 1] === 'TRUE';
    sh.getRange(dst.idx + 2, COLS.STATUS, 1, 8).setValues([[
      srcStatus, name, phone, email, new Date(), paid, reqId,
      String(src.row[COLS.NOTE - 1] || ''),
    ]]);
    sh.getRange(src.idx + 2, COLS.STATUS, 1, 8)
      .setValues([[STATUS.FREE, '', '', '', '', false, '', '']]);
    // The vacated chair carries no stale chazaka claim — the hold, if there
    // was one, was consumed when it was bought.
    sh.getRange(src.idx + 2, COLS.CHAZAKA_NAME, 1, 2).setValues([['', '']]);

    logAction_('MOVE', from + '>' + to, name, phone, cfg.PHASE, 'ok',
      paid ? 'paid' : '', ip);
    SpreadsheetApp.flush();

    var res = { ok: true, fromSeatNo: from, toSeatNo: to, paid: paid, seats: after.sort(function (a, b) { return a - b; }) };
    cache.put('req:' + reqId, JSON.stringify(res), 900);
    cache.remove('seatmap');

    try { sendMoveEmail_(name, phone, email, from, to, isMemberPhone_(phone)); } catch (e) {
      logAction_('EMAIL', from + '>' + to, name, phone, cfg.PHASE, 'fail', String(e), '');
    }
    return res;
  } catch (err) {
    logAction_('MOVE', from + '>' + to, '', phone, '', 'error', String(err), ip);
    return { ok: false, code: 'SERVER_ERROR' };
  } finally {
    lock.releaseLock();
  }
}

/** Same impersonation alarm as the claim mail: the address on file, not the typed one. */
function sendMoveEmail_(name, phone, typedEmail, from, to, isMember) {
  var target = onFileEmail_(phone, isMember) || typedEmail;
  if (!target) return;
  MailApp.sendEmail({
    to: target,
    subject: 'החלפת מקום — בית מנחם גני איילון',
    htmlBody:
      '<div dir="rtl">שלום ' + name + ',<br><br>' +
      'המקום שלך הוחלף: ממקום <b>' + from + '</b> למקום <b>' + to + '</b>.<br>' +
      'המקום הקודם שוחרר. התשלום, אם בוצע, עבר למקום החדש.<br>' +
      '<br>אם לא אתה ביצעת את ההחלפה — השב למייל זה או פנה לגבאי מיד.<br><br>' +
      'בית הכנסת חב"ד "בית מנחם", גני איילון</div>',
  });
}

function onFileEmail_(phone, isMember) {
  if (!isMember) return '';
  var sh = sheet_(TAB.MEMBERS);
  if (sh.getLastRow() < 2) return '';
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, MEMBER_HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (normPhone_(rows[i][4]) === phone && rows[i][5]) return String(rows[i][5]);
  }
  return '';
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

/**
 * The name identity a phone carries: tight keys of every approved _Chazaka
 * row bearing this phone, expanded through HOLDER_MERGES. This is what lets a
 * phone-verified holder act on holds the seed left name-only — same person,
 * matched offline, before the phone ever reached the seat row.
 */
function chazakaNameKeysForPhone_(phone) {
  var keys = {};
  var sh = ss_().getSheetByName(TAB.CHAZAKA);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, CHAZAKA_HEADERS.length).getValues()
      .forEach(function (r) {
        var approved = String(r[7] || '') !== '';
        var waived = r[8] === true || r[8] === 'TRUE';
        if (!approved || waived || normPhone_(r[2]) !== phone) return;
        var raw = String(r[3]);
        keys[keyTight_(raw)] = true;
        var merge = holderMergeFor_(raw);
        if (merge) keys[keyTight_(merge.display)] = true;
      });
  }
  return keys;
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
  var to = onFileEmail_(phone, isMember) || typedEmail;
  if (!to) return;

  var cfgMail = getConfig_();
  var payUrl = String(cfgMail.PAYMENT_URL || '');
  var gabbaiPhone = String(cfgMail.GABBAI_PHONE || '');
  var waUrl = gabbaiPhone
    ? 'https://wa.me/' + gabbaiPhone + '?text=' + encodeURIComponent(
        'שלום, כאן ' + name + '. שילמתי על מקום/ות ' + seatNos.join(', ') +
        ' בסך ' + total + ' ש"ח — מצרף אסמכתא / הוראת קבע.')
    : '';
  MailApp.sendEmail({
    to: to,
    subject: 'אישור בחירת מקום — בית מנחם גני איילון',
    htmlBody:
      '<div dir="rtl">שלום ' + name + ',<br><br>' +
      'נרשמה על שמך בחירת מקום/ות: <b>' + seatNos.join(', ') + '</b><br>' +
      'סכום לתשלום: <b>' + total + ' ש"ח</b><br>' +
      (payUrl ? '<a href="' + payUrl + '">לתשלום מאובטח לחץ כאן</a><br>' : '') +
      '<br><b>חשוב:</b> לאחר התשלום יש לשלוח לגבאי בוואטסאפ אסמכתא על התשלום ' +
      'או צילום הוראת הקבע — ללא אסמכתא המקום יתפנה.<br>' +
      (waUrl ? '<a href="' + waUrl + '">לשליחת האסמכתא בוואטסאפ לחץ כאן</a><br>' : '') +
      '<br>אם לא אתה ביצעת את הבחירה — השב למייל זה או פנה לגבאי מיד.<br><br>' +
      'בית הכנסת חב"ד "בית מנחם", גני איילון</div>',
  });
}
