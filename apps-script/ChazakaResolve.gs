/**
 * Second-pass chazaka resolution: given-name + family-name matching with a
 * Chabad nickname table. Runs over the rows the first pass left unresolved
 * (REVIEW / AMBIGUOUS / NO_MATCH) and auto-approves only UNIQUE hits — a
 * surname shared by two brothers with no first name on the map stays
 * unresolved, because guessing between them wrongly is worse than a phone
 * call.
 */

/** Common Hebrew/Chabad nicknames → the formal given name as registered. */
var NICKNAMES = {
  'מענדי': 'מנחם מענדל', 'מנדי': 'מנחם מענדל', 'מענדל': 'מנחם מענדל',
  'איציק': 'יצחק', 'יצי': 'יצחק',
  'אלי': 'אליהו', 'שלוימי': 'שלמה', 'שלומי': 'שלמה',
  'יוסי': 'יוסף', 'יוסל': 'יוסף',
  'חזקי': 'יחזקאל', 'צביקה': 'צבי', 'זלמי': 'שניאור זלמן',
  'שוקי': 'יהושע', 'שועי': 'יהושע', 'קובי': 'יעקב',
  'אברמי': 'אברהם', 'אבי': 'אברהם', 'דודי': 'דוד',
  'בערל': 'דוב בער', 'לייבל': 'יהודה לייב',
};

function expandNickname_(token) {
  return NICKNAMES[token] || token;
}

function resolveChazakaV2() {
  var members = sheet_(TAB.MEMBERS);
  var mRows = members.getLastRow() > 1
    ? members.getRange(2, 1, members.getLastRow() - 1, MEMBER_HEADERS.length).getValues()
    : [];

  // Per-member: loose keys of every given-name token and of the family name.
  var index = mRows.map(function (m) {
    var given = keyTight_(String(m[1])).split(' ').filter(String).map(keyLoose_);
    return {
      memberId: String(m[0]),
      display: (String(m[1]) + ' ' + String(m[3])).trim(),
      phone: normPhone_(m[4]),
      givenLoose: given,
      familyLoose: keyLoose_(String(m[3])),
      familyTight: keyTight_(String(m[3])),
    };
  }).filter(function (m) { return m.phone; });

  var sh = sheet_(TAB.CHAZAKA);
  var last = sh.getLastRow();
  if (last < 2) return 'no rows';
  var rows = sh.getRange(2, 1, last - 1, CHAZAKA_HEADERS.length).getValues();

  var resolved = 0, stillOpen = [];
  var now = new Date();

  rows.forEach(function (r, i) {
    var status = String(r[6]);
    var hasPhone = normPhone_(r[2]) !== '';
    if (hasPhone && String(r[7] || '') !== '') return; // already live
    var raw = String(r[3] || '').trim();
    if (!raw) return;

    var tokens = keyTight_(raw).split(' ').filter(String);
    var hits = [];

    if (tokens.length >= 2) {
      // Try every token as the family name; the rest must overlap the
      // member's given names, with nicknames expanded.
      var famTok = tokens[tokens.length - 1];
      var givenToks = tokens.slice(0, -1)
        .map(expandNickname_).join(' ').split(' ').map(keyLoose_);
      hits = index.filter(function (m) {
        var famOk = m.familyLoose === keyLoose_(famTok) ||
          m.familyTight.indexOf(famTok) !== -1 || famTok.indexOf(m.familyTight) !== -1;
        if (!famOk) return false;
        return givenToks.some(function (g) {
          return g && m.givenLoose.indexOf(g) !== -1;
        });
      });
      // Fall back: maybe the FIRST token is the family (e.g. "יוני בים").
      if (hits.length !== 1) {
        var famFirst = tokens[0];
        var givenRest = tokens.slice(1).map(expandNickname_).join(' ').split(' ').map(keyLoose_);
        var alt = index.filter(function (m) {
          if (m.familyLoose !== keyLoose_(famFirst)) return false;
          return givenRest.some(function (g) { return g && m.givenLoose.indexOf(g) !== -1; });
        });
        if (alt.length === 1) hits = alt;
      }
    } else if (tokens.length === 1) {
      // Surname only: resolvable only when exactly ONE member carries it.
      var fam = keyLoose_(tokens[0]);
      hits = index.filter(function (m) { return m.familyLoose === fam; });
    }

    if (hits.length === 1) {
      sh.getRange(i + 2, 1, 1, 8).setValues([[
        hits[0].memberId, hits[0].display, hits[0].phone, raw,
        'v2-given-family', 0.9, 'AUTO', now,
      ]]);
      resolved++;
    } else {
      stillOpen.push(raw + (hits.length ? ' (x' + hits.length + ')' : ' (0)'));
    }
  });

  CacheService.getScriptCache().remove('chazakaPhones');
  logAction_('CHAZAKA_V2', '', '', '', '', 'ok',
    'resolved=' + resolved + ' open=' + stillOpen.length, '');
  return { resolved: resolved, open: stillOpen };
}
