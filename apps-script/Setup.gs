/**
 * One-time (but idempotent) creation of the system's tabs inside the existing
 * spreadsheet. Existing tabs are never touched; everything we own is prefixed
 * with an underscore so a human scanning the tab bar can tell at a glance what
 * belongs to the system and what is the gabbai's own material.
 *
 * Run setup() from the editor, or via the admin API once it exists. Running it
 * twice is safe: tabs that exist are left alone, missing config keys are
 * appended, existing values are preserved.
 */

var SEAT_HEADERS = [
  'seatNo', 'tableId', 'side', 'facingArk', 'pairSeatNo', 'zone',
  'status', 'holderName', 'holderPhone', 'holderEmail',
  'claimedAt', 'paid', 'requestId', 'gabbaiNote',
];

var CHAZAKA_HEADERS = [
  'memberId', 'name', 'phone', 'sourceRaw', 'matchMethod', 'matchScore',
  'matchStatus', 'approvedAt', 'waived',
];

var MEMBER_HEADERS = [
  'memberId', 'fullName', 'fatherName', 'familyName', 'phone', 'email',
  'keyTight', 'keyLoose', 'rawRow',
];

var LOG_HEADERS = [
  'timestamp', 'action', 'seatNos', 'name', 'phone', 'round', 'result', 'detail', 'ip',
];

var LAYOUT_HEADERS = [
  'kind', 'id', 'row', 'col', 'rowSpan', 'colSpan',
  'seatsPerSide', 'arkSide', 'zone', 'label', 'numberFrom',
];

function setup() {
  var ss = ss_();

  var seats = ensureTab_(ss, TAB.SEATS, SEAT_HEADERS);
  var chazaka = ensureTab_(ss, TAB.CHAZAKA, CHAZAKA_HEADERS);
  var members = ensureTab_(ss, TAB.MEMBERS, MEMBER_HEADERS);
  ensureTab_(ss, TAB.LOG, LOG_HEADERS);
  ensureTab_(ss, TAB.LAYOUT, LAYOUT_HEADERS);
  ensureTab_(ss, TAB.LAYOUT_COMPILED, null);
  ensureConfigTab_(ss);

  // Phone columns must be plain text. Sheets otherwise stores 0501234567 as the
  // number 501234567; the leading zero is gone, runtime lookups miss, and Round
  // A silently rejects real members — the worst kind of failure, invisible
  // until an angry phone call.
  forcePlainText_(seats, SEAT_HEADERS, ['holderPhone']);
  forcePlainText_(chazaka, CHAZAKA_HEADERS, ['phone']);
  forcePlainText_(members, MEMBER_HEADERS, ['phone']);

  logAction_('SETUP', '', '', '', '', 'ok', 'tabs ensured', '');
  return 'setup complete';
}

function ensureTab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  if (headers && String(sh.getRange(1, 1).getValue()) !== headers[0]) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Appends any missing config keys with their defaults. Never overwrites a value
 * the gabbai already changed — re-running setup after tuning prices must not
 * quietly reset them.
 */
function ensureConfigTab_(ss) {
  var sh = ss.getSheetByName(TAB.CONFIG);
  if (!sh) {
    sh = ss.insertSheet(TAB.CONFIG);
    sh.getRange(1, 1, 1, 3)
      .setValues([['key', 'value', 'הערה']])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  var notes = {
    MODE: 'OPEN=פתוח, READONLY=הקפאה, CLOSED=סגור',
    PHASE: 'A=סבב חזקה, B=סבב פתוח',
    PRICE_FIRST_SEAT: 'מחיר המקום הראשון בש"ח',
    PRICE_EXTRA_SEAT: 'תוספת לכל מקום נוסף',
    MAX_SEATS_PER_PHONE: 'תקרת מקומות לטלפון אחד',
    BURST_PER_PHONE: 'הגבלת קצב: בקשות לדקה לטלפון',
    BURST_GLOBAL: 'הגבלת קצב: בקשות לדקה סה"כ',
    PENDING_TTL_MIN: 'דקות עד שמקום "ממתין" משתחרר',
    GABBAI_PHONE: 'לקישור וואטסאפ, בפורמט 9725XXXXXXXX',
    ROUND_A_OPENS: '',
    ROUND_A_DEADLINE: '',
    ROUND_B_OPENS: '',
  };

  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var k = String(r[0] || '').trim();
      if (k) existing[k] = true;
    });
  }

  var toAppend = [];
  Object.keys(CONFIG_DEFAULTS).forEach(function (k) {
    if (!existing[k]) toAppend.push([k, CONFIG_DEFAULTS[k], notes[k] || '']);
  });
  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, 3).setValues(toAppend);
  }
}

function forcePlainText_(sh, headers, columnNames) {
  columnNames.forEach(function (name) {
    var idx = headers.indexOf(name);
    if (idx === -1) return;
    sh.getRange(1, idx + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
}

/** Append-only audit log. Failures are logged too — they are the interesting part. */
function logAction_(action, seatNos, name, phone, round, result, detail, ip) {
  try {
    sheet_(TAB.LOG).appendRow([
      new Date(), action, String(seatNos), name, phone, round, result,
      String(detail || '').slice(0, 500), ip || '',
    ]);
  } catch (e) {
    // A logging failure must never break the operation being logged.
  }
}
