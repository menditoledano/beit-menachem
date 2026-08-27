/**
 * Shared constants and Config-tab access.
 *
 * Everything the gabbai may need to change mid-sale lives in the _Config tab,
 * not here — a value in this file requires a redeploy, and a redeploy done the
 * wrong way changes the /exec URL and takes the site down.
 */

var SPREADSHEET_ID = '19LCKmYIPU-QqUNPgAi_Vons3UK15tRst3slwj4S9oJI';

var TAB = {
  LAYOUT: '_Layout',
  LAYOUT_COMPILED: '_LayoutCompiled',
  SEATS: '_Seats',
  CHAZAKA: '_Chazaka',
  MEMBERS: '_Members',
  LOG: '_Log',
  CONFIG: '_Config',
  REGISTRATIONS: '_Registrations',
};

/** Seat status values. Stored in Hebrew so the sheet reads correctly to a human. */
var STATUS = {
  FREE: 'פנוי',
  TAKEN: 'תפוס',
  PENDING: 'ממתין',
  BLOCKED: 'חסום',
  // Reserved for last year's holder until the Round A deadline. Claimable
  // only by the phone recorded on the reservation.
  RESERVED: 'שמור',
};

/** Sale mode. READONLY is the one-cell emergency brake. */
var MODE = { OPEN: 'OPEN', READONLY: 'READONLY', CLOSED: 'CLOSED' };

/** Round A is chazaka-holders only; round B is open to everyone. */
var PHASE = { A: 'A', B: 'B' };

var CONFIG_DEFAULTS = {
  MODE: MODE.CLOSED,
  PHASE: PHASE.A,
  PRICE_FIRST_SEAT: 150,
  PRICE_EXTRA_SEAT: 50,
  PRICE_WOMEN_FIRST_SEAT: 150,
  PRICE_WOMEN_EXTRA_SEAT: 50,
  MAX_SEATS_PER_PHONE: 3,
  BURST_PER_PHONE: 3,
  BURST_GLOBAL: 40,
  PENDING_TTL_MIN: 10,
  GABBAI_PHONE: '',
  PAYMENT_URL: 'https://mygabay.com/truma/1734/lnysy',
  ROUND_A_OPENS: '',
  ROUND_A_DEADLINE: '',
  ROUND_B_OPENS: '',
};

var CONFIG_CACHE_SECONDS = 30;

function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('חסר טאב: ' + name);
  return sh;
}

/**
 * Reads _Config as a plain object, cached briefly. The cache is why MODE can be
 * flipped by editing one cell and take effect within half a minute without a
 * deploy — and why a config read costs nothing during a rush.
 */
function getConfig_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('config');
  if (hit) return JSON.parse(hit);

  var cfg = {};
  Object.keys(CONFIG_DEFAULTS).forEach(function (k) {
    cfg[k] = CONFIG_DEFAULTS[k];
  });

  var sh = ss_().getSheetByName(TAB.CONFIG);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (row) {
      var key = String(row[0] || '').trim();
      if (key) cfg[key] = row[1];
    });
  }

  cache.put('config', JSON.stringify(cfg), CONFIG_CACHE_SECONDS);
  return cfg;
}

/**
 * Price for the Nth seat a person is buying, 1-based.
 * 150 for the first, +50 for each additional: 150 / 200 / 250 cumulative.
 */
function priceForNthSeat_(n, cfg) {
  return n <= 1
    ? Number(cfg.PRICE_FIRST_SEAT)
    : Number(cfg.PRICE_EXTRA_SEAT);
}

function totalPriceFor_(count, cfg, section) {
  if (count <= 0) return 0;
  var women = section === 'נשים';
  var first = Number(women ? cfg.PRICE_WOMEN_FIRST_SEAT : cfg.PRICE_FIRST_SEAT) || 150;
  var extra = Number(women ? cfg.PRICE_WOMEN_EXTRA_SEAT : cfg.PRICE_EXTRA_SEAT) || 50;
  return first + (count - 1) * extra;
}
