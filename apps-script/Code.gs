/**
 * Bunker Gear Wash Log - shared record backend (Google Apps Script)
 *
 * Paste this whole file into Extensions > Apps Script of a Google Sheet, then follow SETUP.md.
 * The entry password and admin PIN live in Script Properties (Project Settings), never in the
 * website code, and are checked here on the server for every request.
 */

var SHEET_NAME = 'Wash Log';
var HEADERS = ['Submitted At', 'Last Name', 'Employee Number', 'Date Washed', 'Entry ID'];
var MAX_FAILS = 10;      // wrong guesses allowed per role...
var LOCK_SECONDS = 600;  // ...within this window, then that role is locked for the rest of it
var NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ '.\-]{0,39}$/;
var EMP_RE = /^[A-Za-z0-9][A-Za-z0-9\-]{0,14}$/;
var ID_RE = /^[A-Za-z0-9\-]{8,64}$/;

/** Run once from the editor (Run > setup) to create the sheet and placeholder secrets. */
function setup() {
  var sh = getSheet_();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ENTRY_PASSWORD')) props.setProperty('ENTRY_PASSWORD', 'CHANGE-ME');
  if (!props.getProperty('ADMIN_PIN')) props.setProperty('ADMIN_PIN', 'CHANGE-ME');
  Logger.log('Sheet ready: ' + sh.getParent().getUrl());
  Logger.log('Now open Project Settings > Script Properties and set ENTRY_PASSWORD and ADMIN_PIN.');
}

function doGet() {
  return json_({ ok: true, service: 'bunker-gear-wash-log' });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (req.action) {
      case 'login': return json_(login_(req));
      case 'add':   return json_(add_(req));
      case 'list':  return json_(list_(req));
      default:      return json_(fail_('invalid', 'Unknown request.'));
    }
  } catch (err) {
    return json_(fail_('server', 'Server error. Please try again.'));
  }
}

// ---------- actions ----------
function login_(req) {
  var a = auth_('entry', req.password);
  return a.ok ? { ok: true } : a;
}

function add_(req) {
  var a = auth_('entry', req.password);
  if (!a.ok) return a;

  var en = req.entry || {};
  var lastName = clean_(en.lastName);
  var emp = clean_(en.employeeNumber).toUpperCase();
  var date = String(en.date || '');
  var id = String(en.id || '');
  if (!NAME_RE.test(lastName)) return fail_('invalid', 'Last name has invalid characters or is too long.');
  if (!EMP_RE.test(emp)) return fail_('invalid', 'Employee number has invalid characters or is too long.');
  if (!ID_RE.test(id)) return fail_('invalid', 'Bad entry id.');
  if (!validDate_(date)) return fail_('invalid', 'Date is not valid.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = getSheet_();
    var last = sh.getLastRow();
    if (last > 1) {
      var found = sh.getRange(2, 5, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
      if (found) return { ok: true, duplicate: true }; // retry of an entry we already stored
    }
    var tz = Session.getScriptTimeZone();
    var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
    sh.appendRow([stamp, lastName, emp, date, id]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function list_(req) {
  var a = auth_('admin', req.pin);
  if (!a.ok) return a;
  var sh = getSheet_();
  var last = sh.getLastRow();
  var rows = [];
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, 5).getValues();
    for (var i = vals.length - 1; i >= 0; i--) { // newest first
      rows.push({
        submittedAt: String(vals[i][0]),
        lastName: String(vals[i][1]),
        employeeNumber: String(vals[i][2]),
        date: dateText_(vals[i][3]),
        id: String(vals[i][4])
      });
    }
  }
  return { ok: true, rows: rows };
}

// ---------- helpers ----------
function auth_(role, supplied) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty(role === 'admin' ? 'ADMIN_PIN' : 'ENTRY_PASSWORD');
  if (!secret || secret === 'CHANGE-ME') {
    return fail_('not_configured', 'The administrator has not set the ' + (role === 'admin' ? 'admin PIN' : 'entry password') + ' yet.');
  }
  var cache = CacheService.getScriptCache();
  var key = 'fails_' + role;
  var fails = Number(cache.get(key) || 0);
  if (fails >= MAX_FAILS) {
    return fail_('locked', 'Too many wrong attempts. Wait 10 minutes and try again.');
  }
  if (safeEqual_(String(supplied || ''), secret)) {
    cache.remove(key);
    return { ok: true };
  }
  cache.put(key, String(fails + 1), LOCK_SECONDS);
  return fail_('auth', 'Incorrect ' + (role === 'admin' ? 'PIN' : 'password') + '.');
}

function safeEqual_(a, b) {
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function validDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if (d.getUTCFullYear() !== p[0] || d.getUTCMonth() !== p[1] - 1 || d.getUTCDate() !== p[2]) return false;
  var tomorrow = Date.now() + 36 * 3600 * 1000; // slack for time zones
  return d.getTime() >= Date.UTC(2000, 0, 1) && d.getTime() <= tomorrow;
}

function dateText_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v);
}

function clean_(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:E').setNumberFormat('@'); // keep everything as text (leading zeros, no date shifting)
  }
  return sh;
}

function fail_(code, message) { return { ok: false, error: code, message: message }; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
