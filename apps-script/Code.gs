/**
 * HTTP entry points.
 *
 * Two constraints shape everything here:
 *
 * 1. Apps Script cannot read request headers. There is no Authorization, no
 *    User-Agent and no client IP. The shared secret therefore travels in the
 *    POST body, and anything IP-based lives in the Next.js proxy instead.
 *
 * 2. There is no doOptions entry point, so a CORS preflight can never succeed.
 *    The proxy calls this server-to-server, which sidesteps CORS entirely; the
 *    text/plain content type on POST is what keeps the request "simple".
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'ping';
  try {
    switch (action) {
      case 'ping':
        return json_({ ok: true, action: 'ping', now: new Date().toISOString() });
      case 'bootstrap':
        return bootstrap_();
      default:
        return json_({ ok: false, code: 'UNKNOWN_ACTION', action: action });
    }
  } catch (err) {
    return json_({ ok: false, code: 'SERVER_ERROR', message: String(err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, code: 'BAD_JSON' });
  }

  if (!checkSecret_(body.secret)) {
    return json_({ ok: false, code: 'FORBIDDEN' });
  }

  try {
    switch (body.action) {
      case 'ping':
        return json_({ ok: true, action: 'ping', now: new Date().toISOString() });
      case 'importMembers':
        return json_({ ok: true, result: importMembers() });
      case 'saveLayout':
        return json_({ ok: true, result: saveLayout(body) });
      case 'loadLayout':
        return json_({ ok: true, layout: loadLayout() });
      case 'publishLayout':
        return json_({ ok: true, result: publishLayout(body) });
      case 'getLayout':
        return json_({ ok: true, compiled: JSON.parse(getCompiledLayout() || 'null') });
      case 'seatmap':
        return json_({ ok: true, map: seatmap() });
      case 'lookup':
        return json_({ ok: true, result: lookup(body) });
      case 'claim':
        return json_(claim(body));
      case 'installTriggers':
        return json_({ ok: true, result: installTriggers() });
      case 'setConfig':
        return json_({ ok: true, result: setConfigValue_(body.key, body.value) });
      case 'gabbai':
        return json_(gabbaiAction(body));
      case 'runChazakaMatching':
        return json_({ ok: true, result: runChazakaMatching(body) });
      case 'approveAutoChazaka':
        return json_({ ok: true, result: approveAutoChazaka() });
      case 'debugSourceTabs':
        return json_({
          ok: true,
          tabs: SpreadsheetApp.openById(MEMBERS_SOURCE_ID).getSheets().map(function (sh) {
            return {
              name: sh.getName(),
              rows: sh.getLastRow(),
              cols: sh.getLastColumn(),
              firstHeader: String(sh.getRange(1, 1).getValue()).slice(0, 40),
            };
          }),
        });
      default:
        return json_({ ok: false, code: 'UNKNOWN_ACTION', action: body.action });
    }
  } catch (err) {
    return json_({ ok: false, code: 'SERVER_ERROR', message: String(err) });
  }
}

/**
 * One-time initialisation: generates the shared secret server-side, stores it,
 * creates the tabs, and returns the secret in the response body exactly once.
 *
 * Generating on the server keeps the secret out of query strings (which land in
 * Google's execution logs) and out of chat transcripts. After the first call
 * this endpoint permanently refuses, so the /exec URL alone grants nothing.
 */
function bootstrap_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SHARED_SECRET')) {
    return json_({ ok: false, code: 'ALREADY_BOOTSTRAPPED' });
  }
  var secret = Utilities.getUuid() + '-' + Utilities.getUuid();
  props.setProperty('SHARED_SECRET', secret);
  var result = setup();
  return json_({ ok: true, setup: result, secret: secret });
}

/**
 * The secret lives in Script Properties rather than in this file so it can be
 * rotated instantly if the /exec URL ever leaks — no redeploy, and therefore no
 * risk of the URL changing mid-sale.
 */
function checkSecret_(candidate) {
  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!expected) return false;
  return String(candidate || '') === expected;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
