/**
 * Hebrew name and Israeli phone normalisation.
 *
 * These functions exist because the member roster was typed by 253 different
 * people over two years: "מנחם מענדל" next to "מנחם מענדל טולדנו" next to
 * "דוד בן משה ז'ילבר". Matching runs offline against these keys; at runtime
 * the only comparison ever made is an exact normalised phone.
 *
 * Character classes are built from \u escape strings rather than literal
 * characters. Several of the targets (bidi marks) are invisible, and a regex
 * containing invisible characters does not survive copy-paste or editor
 * round-trips. The escaped form is greppable and cannot be silently mangled.
 */

var RE_NIQQUD = new RegExp('[\\u0591-\\u05C7]', 'g');
var RE_BIDI_NBSP = new RegExp('[\\u200E\\u200F\\u202A-\\u202E\\u00A0]', 'g');
var RE_GERESH = new RegExp("[\\u05F3\\u2018\\u2019\\u02BC'`\\u00B4]", 'g');
var RE_GERSHAYIM = new RegExp('[\\u05F4\\u201C\\u201D\\u02BA"]', 'g');
var RE_NON_HEBREW = new RegExp('[^\\u05D0-\\u05EA0-9A-Za-z ]+', 'g');

/** Honorifics and kinship words that carry no identity signal. Post-normalised forms. */
var HE_STOPWORDS = {
  'בן': 1, 'בר': 1, 'הרב': 1, 'ר': 1, 'הכהן': 1, 'הלוי': 1,
  'זל': 1, 'עה': 1, 'שליטא': 1, 'נרו': 1, 'היד': 1,
};

var HE_FINALS = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' };

/**
 * Base cleanup. The geresh rule is load-bearing: ז'ילבר must become זילבר —
 * one token. Replacing the geresh with a space would split the surname in two
 * and no later stage could reassemble it. Deleting also collapses ז״ל to זל and
 * שליט״א to שליטא, which is the form the stopword list expects.
 */
function normHe_(s) {
  return String(s == null ? '' : s)
    .replace(RE_NIQQUD, '')
    .replace(RE_BIDI_NBSP, ' ')
    .replace(RE_GERESH, '')
    .replace(RE_GERSHAYIM, '')
    .replace(RE_NON_HEBREW, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function foldFinals_(s) {
  return s.replace(/[םןץףך]/g, function (c) { return HE_FINALS[c]; });
}

/** Conservative key: safe for blocking and near-exact comparison. */
function keyTight_(s) {
  return foldFinals_(normHe_(s))
    .split(' ')
    .filter(function (w) { return w && !HE_STOPWORDS[w]; })
    .join(' ');
}

/**
 * Aggressive key: collapses ktiv male/haser and ה/א endings so that
 * טולדנו matches טולדאנו. Loose keys collide by design — they nominate
 * candidates for human review and must never auto-accept a match on their own.
 */
function keyLoose_(s) {
  return keyTight_(s)
    .split(' ')
    .map(function (w) {
      var out = w
        .replace(/[הא]+$/, '')
        .replace(/(?!^)[ויאה]/g, '');
      return out || w;
    })
    .join(' ');
}

/**
 * Israeli phone → canonical 10-digit local form, or '' when unusable.
 *
 * Accepts a number because Sheets returns 0501234567 as the number 501234567
 * when a cell was never text-formatted. Returns '' rather than a guess: a
 * wrong-but-plausible phone silently locks a real member out of Round A.
 */
function normPhone_(v) {
  var d = (typeof v === 'number' ? String(Math.round(v)) : String(v || ''))
    .replace(/\D/g, '');
  if (d.indexOf('00972') === 0) d = '0' + d.slice(5);
  else if (d.indexOf('972') === 0) d = '0' + d.slice(3);
  if (d.length === 9 && d.charAt(0) !== '0') d = '0' + d;
  return (d.length === 10 && d.charAt(0) === '0') ? d : '';
}
