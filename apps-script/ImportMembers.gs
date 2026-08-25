/**
 * Imports the member roster ("פרטי מתפלל" form responses) into _Members with
 * normalised keys. Re-running replaces the whole tab — the roster's source of
 * truth stays the original form sheet, and this copy is a derived index.
 */

var MEMBERS_SOURCE_ID = '1DRXfPDZnjYFwo70JqecgapjJPCLel0F8DA-RqbtwgnA';

/**
 * Source columns, by position in the form response sheet:
 * 0 timestamp | 1 email | 2 full name (aliyah name) | 3 father's name |
 * 4 family name | 5 birthday | 6 phone | 7.. wife/children/yahrzeit fields
 */
function importMembers() {
  // The source spreadsheet holds several tabs (member details, dues status,
  // children's birthdays). The form-responses tab is addressed by its name so
  // a reordering of tabs can never silently swap the data source.
  var src = SpreadsheetApp.openById(MEMBERS_SOURCE_ID).getSheetByName('פרטי מתפלל');
  if (!src) throw new Error('לא נמצא טאב "פרטי מתפלל" בגיליון המקור');

  var last = src.getLastRow();
  if (last < 2) throw new Error('גיליון המקור ריק');

  var rows = src.getRange(2, 1, last - 1, 7).getValues();
  var out = [];
  var skipped = 0;

  rows.forEach(function (r, i) {
    var email = String(r[1] || '').trim();
    var fullName = String(r[2] || '').trim();
    var fatherName = String(r[3] || '').trim();
    var familyName = String(r[4] || '').trim();
    var phone = normPhone_(r[6]);

    // A row with neither a name nor a phone cannot ever be matched to anyone.
    if (!fullName && !familyName && !phone) { skipped++; return; }

    var display = (fullName + ' ' + familyName).trim();
    out.push([
      'm' + String(i + 2),          // memberId = source row anchor, stable across imports
      fullName,
      fatherName,
      familyName,
      phone,                        // '' when the source value was unusable
      email,
      keyTight_(display),
      keyLoose_(display),
      i + 2,                        // rawRow — jump back to the source for context
    ]);
  });

  var sh = sheet_(TAB.MEMBERS);
  var lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, MEMBER_HEADERS.length).clearContent();
  sh.getRange(2, 1, out.length, MEMBER_HEADERS.length).setValues(out);

  var missingPhones = out.filter(function (r) { return !r[4]; }).length;
  var summary = 'imported=' + out.length + ' skipped=' + skipped +
    ' missingPhone=' + missingPhones;
  logAction_('IMPORT_MEMBERS', '', '', '', '', 'ok', summary, '');
  return summary;
}
