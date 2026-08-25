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
      default:
        return json_({ ok: false, code: 'UNKNOWN_ACTION', action: body.action });
    }
  } catch (err) {
    return json_({ ok: false, code: 'SERVER_ERROR', message: String(err) });
  }
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
