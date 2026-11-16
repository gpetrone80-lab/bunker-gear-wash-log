(function () {
  'use strict';

  var CFG = window.BGW_CONFIG || {};
  var URL_ = (CFG.APPS_SCRIPT_URL || '').trim();
  var QUEUE_KEY = 'bgw_queue_v1';
  var RECENT_KEY = 'bgw_recent_v1';
  var PW_KEY = 'bgw_entry_pw';
  var XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var XLSX_SRI = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';

  var NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ '.\-]{0,39}$/;
  var EMP_RE = /^[A-Za-z0-9][A-Za-z0-9\-]{0,14}$/;

  var $ = function (id) { return document.getElementById(id); };
  var records = [];
  var adminPin = '';
  var flushing = false;

  // ---------- storage helpers (never throw) ----------
  function sGet(store, k) { try { return store.getItem(k); } catch (e) { return null; } }
  function sSet(store, k, v) { try { store.setItem(k, v); } catch (e) { /* ignore */ } }
  function sDel(store, k) { try { store.removeItem(k); } catch (e) { /* ignore */ } }
  function loadJSON(store, k, fallback) {
    try { var v = JSON.parse(sGet(store, k)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function getQueue() { return loadJSON(window.localStorage, QUEUE_KEY, []); }
  function setQueue(q) { sSet(window.localStorage, QUEUE_KEY, JSON.stringify(q)); updateStatus(); }

  // ---------- utils ----------
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function show(el, on) { el.hidden = !on; }
  function setErr(id, msg) {
    var el = $(id);
    el.textContent = msg || '';
    show(el, !!msg);
    var input = el.previousElementSibling;
    if (input && input.tagName === 'INPUT') input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  // ---------- network ----------
  function api(action, payload) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 25000);
    var body = JSON.stringify(Object.assign({ action: action }, payload));
    return fetch(URL_, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script does not answer
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
      redirect: 'follow',
      signal: ctrl.signal
    }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).catch(function (e) {
      clearTimeout(t);
      var err = new Error('network');
      err.network = true;
      throw err;
    });
  }

  function updateStatus() {
    var q = getQueue().length;
    var online = navigator.onLine;
    $('statusDot').className = 'dot ' + (online ? 'on' : 'off');
    var txt = online ? 'Online' : 'Offline';
    if (q) txt += ' · ' + q + ' waiting to sync';
    $('statusText').textContent = txt;
  }

  // ---------- views ----------
  function showLogin() {
    show($('loginView'), true);
    show($('appView'), false);
    setTimeout(function () { $('entryPassword').focus(); }, 0);
  }
  function showApp() {
    show($('loginView'), false);
    show($('appView'), true);
    $('washDate').max = todayISO();
    if (!$('washDate').value) $('washDate').value = todayISO();
    renderRecent();
    flushQueue();
  }
  function selectTab(name) {
    var log = name === 'log';
    $('tabLog').setAttribute('aria-selected', String(log));
    $('tabRecords').setAttribute('aria-selected', String(!log));
    show($('logPanel'), log);
    show($('recordsPanel'), !log);
  }

  // ---------- login ----------
  $('loginForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var pw = $('entryPassword').value;
    if (!pw) { showLoginError('Enter the password.'); return; }
    var btn = $('loginBtn');
    btn.disabled = true; btn.textContent = 'Checking…';
    api('login', { password: pw }).then(function (res) {
      if (res.ok) {
        sSet(window.sessionStorage, PW_KEY, pw);
        $('entryPassword').value = '';
        showLoginError('');
        showApp();
      } else {
        showLoginError(res.message || 'Incorrect password.');
      }
    }).catch(function () {
      showLoginError('Cannot reach the server. Check your connection and try again.');
    }).then(function () {
      btn.disabled = false; btn.textContent = 'Unlock';
    });
  });
  function showLoginError(m) { var e = $('loginError'); e.textContent = m; show(e, !!m); }

  $('signOutBtn').addEventListener('click', lockDevice);
  function lockDevice() {
    sDel(window.sessionStorage, PW_KEY);
    adminPin = ''; records = [];
    closeRecords();
    selectTab('log');
    showLogin();
  }

  // ---------- log a wash ----------
  function validate(v) {
    var ok = true;
    setErr('lastNameError', ''); setErr('empNoError', ''); setErr('washDateError', '');
    if (!NAME_RE.test(v.lastName)) {
      setErr('lastNameError', 'Use letters only (spaces, hyphen, apostrophe allowed), up to 40 characters.'); ok = false;
    }
    if (!EMP_RE.test(v.employeeNumber)) {
      setErr('empNoError', 'Use letters, numbers and hyphens only, up to 15 characters.'); ok = false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) {
      setErr('washDateError', 'Pick the date the gear was washed.'); ok = false;
    } else if (v.date > todayISO()) {
      setErr('washDateError', 'The date cannot be in the future.'); ok = false;
    } else if (v.date < '2000-01-01') {
      setErr('washDateError', 'That date looks wrong.'); ok = false;
    }
    return ok;
  }

  $('washForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    setErr('formError', '');
    var entry = {
      id: uid(),
      lastName: clean($('lastName').value),
      employeeNumber: clean($('empNo').value).toUpperCase(),
      date: $('washDate').value
    };
    if (!validate(entry)) return;
    if (!URL_) { setErr('formError', 'The shared record is not connected yet (see SETUP.md).'); return; }

    var q = getQueue(); q.push(entry); setQueue(q);
    addRecent(entry, true);
    $('lastName').value = ''; $('empNo').value = '';
    $('lastName').focus();
    show($('savedBanner'), false);
    var btn = $('submitBtn'); btn.disabled = true; btn.textContent = 'Saving…';
    flushQueue().then(function (stillQueued) {
      btn.disabled = false; btn.textContent = 'Log wash';
      var b = $('savedBanner');
      b.textContent = stillQueued
        ? 'Saved on this device. It will upload automatically when you are back online.'
        : 'Saved to the shared record: ' + entry.lastName + ' (#' + entry.employeeNumber + '), ' + entry.date + '.';
      b.className = 'banner ' + (stillQueued ? 'warn' : 'ok');
      show(b, true);
    });
  });

  function flushQueue() {
    if (flushing) return Promise.resolve(getQueue().length > 0);
    var pw = sGet(window.sessionStorage, PW_KEY);
    if (!pw || !URL_) return Promise.resolve(getQueue().length > 0);
    flushing = true;
    function next() {
      var q = getQueue();
      if (!q.length) return Promise.resolve();
      var entry = q[0];
      return api('add', { password: pw, entry: entry }).then(function (res) {
        if (res.ok || res.error === 'invalid') {
          // saved (or duplicate), or permanently rejected: remove from queue either way
          if (!res.ok) setErr('formError', 'An entry was rejected by the server: ' + (res.message || 'invalid data'));
          markSynced(entry.id);
          setQueue(getQueue().filter(function (e) { return e.id !== entry.id; }));
          return next();
        }
        if (res.error === 'auth' || res.error === 'locked') {
          lockDevice();
          showLoginError(res.message || 'Please enter the password again. Your entries are kept on this device.');
          return;
        }
        // other server error: keep in queue, stop for now
      });
    }
    return next().catch(function () { /* offline: leave queue */ }).then(function () {
      flushing = false;
      updateStatus();
      renderRecent();
      return getQueue().length > 0;
    });
  }

  // recent list (this device, today) so the user sees confirmation
  function addRecent(entry, pending) {
    var r = loadJSON(window.sessionStorage, RECENT_KEY, []);
    r.unshift({ id: entry.id, lastName: entry.lastName, employeeNumber: entry.employeeNumber, date: entry.date, pending: !!pending });
    sSet(window.sessionStorage, RECENT_KEY, JSON.stringify(r.slice(0, 10)));
    renderRecent();
  }
  function markSynced(id) {
    var r = loadJSON(window.sessionStorage, RECENT_KEY, []);
    r.forEach(function (x) { if (x.id === id) x.pending = false; });
    sSet(window.sessionStorage, RECENT_KEY, JSON.stringify(r));
  }
  function renderRecent() {
    var r = loadJSON(window.sessionStorage, RECENT_KEY, []);
    var ul = $('recentList');
    ul.textContent = '';
    r.forEach(function (x) {
      var li = document.createElement('li');
      var a = document.createElement('span');
      a.textContent = x.lastName + ' · #' + x.employeeNumber + ' · ' + x.date;
      li.appendChild(a);
      if (x.pending) {
        var p = document.createElement('span');
        p.className = 'pending'; p.textContent = 'waiting to sync';
        li.appendChild(p);
      }
      ul.appendChild(li);
    });
    show($('recentWrap'), r.length > 0);
  }

  // ---------- records (admin) ----------
  $('tabLog').addEventListener('click', function () { selectTab('log'); });
  $('tabRecords').addEventListener('click', function () { selectTab('records'); });

  $('pinForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var pin = $('adminPin').value;
    if (!pin) { setPinError('Enter the admin PIN.'); return; }
    var btn = $('pinBtn'); btn.disabled = true; btn.textContent = 'Checking…';
    loadRecords(pin).then(function (ok) {
      if (ok) { adminPin = pin; $('adminPin').value = ''; setPinError(''); show($('pinGate'), false); show($('recordsView'), true); }
    }).then(function () { btn.disabled = false; btn.textContent = 'Open records'; });
  });
  function setPinError(m) { var e = $('pinError'); e.textContent = m; show(e, !!m); }

  function loadRecords(pin) {
    setErr('recordsError', '');
    return api('list', { pin: pin }).then(function (res) {
      if (!res.ok) { setPinError(res.message || 'Incorrect PIN.'); setErr('recordsError', res.message || ''); return false; }
      records = res.rows || [];
      renderRecords();
      return true;
    }).catch(function () {
      setPinError('Cannot reach the server. Check your connection.');
      return false;
    });
  }
  $('refreshBtn').addEventListener('click', function () { if (adminPin) loadRecords(adminPin); });

  function closeRecords() {
    adminPin = ''; records = [];
    $('recordsBody').textContent = '';
    show($('recordsView'), false);
    show($('pinGate'), true);
  }
  $('lockBtn').addEventListener('click', closeRecords);
  $('search').addEventListener('input', renderRecords);

  function filtered() {
    var q = clean($('search').value).toLowerCase();
    if (!q) return records;
    return records.filter(function (r) {
      return (r.lastName + ' ' + r.employeeNumber + ' ' + r.date).toLowerCase().indexOf(q) !== -1;
    });
  }
  function renderRecords() {
    var rows = filtered();
    var tb = $('recordsBody');
    tb.textContent = '';
    rows.slice(0, 500).forEach(function (r) {
      var tr = document.createElement('tr');
      [r.date, r.lastName, r.employeeNumber, r.submittedAt].forEach(function (v) {
        var td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    var more = rows.length > 500 ? ' (showing newest 500; downloads include all)' : '';
    $('countText').textContent = rows.length + ' of ' + records.length + ' records' + more;
  }

  // ---------- downloads ----------
  var HEAD = ['Date Washed', 'Last Name', 'Employee Number', 'Logged At'];
  function tableRows(rows) {
    return rows.map(function (r) { return [r.date, r.lastName, r.employeeNumber, r.submittedAt]; });
  }
  function csvCell(v) {
    v = String(v == null ? '' : v);
    // neutralise spreadsheet formulas, then quote
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function save(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function stamp() { return 'bunker-gear-wash-log-' + todayISO(); }

  $('csvBtn').addEventListener('click', function () {
    var lines = [HEAD].concat(tableRows(filtered())).map(function (r) { return r.map(csvCell).join(','); });
    save(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), stamp() + '.csv');
  });

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = XLSX_SRC; s.integrity = XLSX_SRI; s.crossOrigin = 'anonymous';
      s.onload = resolve; s.onerror = function () { reject(new Error('xlsx')); };
      document.head.appendChild(s);
    });
  }
  $('xlsxBtn').addEventListener('click', function () {
    var btn = $('xlsxBtn'); btn.disabled = true; btn.textContent = 'Preparing…';
    loadXlsx().then(function () {
      var ws = XLSX.utils.aoa_to_sheet([HEAD].concat(tableRows(filtered())), { cellDates: false });
      ws['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 18 }, { wch: 20 }];
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Wash Log');
      XLSX.writeFile(wb, stamp() + '.xlsx');
    }).catch(function () {
      setErr('recordsError', 'Could not load the Excel library. Use Download CSV instead (opens in Excel).');
    }).then(function () { btn.disabled = false; btn.textContent = 'Download Excel'; });
  });

  // ---------- boot ----------
  window.addEventListener('online', function () { updateStatus(); flushQueue(); });
  window.addEventListener('offline', updateStatus);
  updateStatus();

  if (!URL_) show($('setupBanner'), true);
  if (sGet(window.sessionStorage, PW_KEY)) showApp(); else showLogin();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* optional */ });
  }
})();
