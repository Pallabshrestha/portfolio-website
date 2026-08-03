/* ============================================================
   Calendar Timesheet — Google Calendar to a printable monthly
   timesheet matching the supplied template.

   Everything runs in the browser. The OAuth token is held in
   memory only; settings live in localStorage.
   ============================================================ */

'use strict';

const SCOPE   = 'https://www.googleapis.com/auth/calendar.readonly';
const API     = 'https://www.googleapis.com/calendar/v3';
const STORE   = 'calendar-timesheet:v1';

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const state = {
  token: null,
  tokenClient: null,
  calendars: [],
  selected: new Set(),
  rows: [],
};

const $  = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/* ---------------------------------------------------------- */
/* settings persistence                                        */
/* ---------------------------------------------------------- */

const FIELDS = [
  'clientId','empName','empPosition','selMonth','selYear',
  'optGrouping','optDateFmt','optTimeFmt','optRound','optBreak','optAllDayHours',
  'optExclude','optInclude','optRowsPerPage',
];
const FLAGS = [
  'optAllDay','optDeclined','optWeekends','optEmptyDays','optDescDetail','optTotal',
];

function saveSettings() {
  const data = { selected: [...state.selected] };
  FIELDS.forEach((k) => { data[k] = $(k).value; });
  FLAGS.forEach((k)  => { data[k] = $(k).checked; });
  try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (_) { /* private mode */ }
}

function loadSettings() {
  let data;
  try { data = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (_) { data = {}; }
  FIELDS.forEach((k) => { if (data[k] !== undefined && data[k] !== '') $(k).value = data[k]; });
  FLAGS.forEach((k)  => { if (data[k] !== undefined) $(k).checked = data[k]; });
  if (Array.isArray(data.selected)) state.selected = new Set(data.selected);
}

/* ---------------------------------------------------------- */
/* small helpers                                               */
/* ---------------------------------------------------------- */

let toastTimer;
function toast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), isError ? 7000 : 3500);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtTime(date, mode) {
  let h = date.getHours();
  const m = pad2(date.getMinutes());
  if (mode === '12') {
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  }
  return `${pad2(h)}:${m}`;
}

function fmtDate(date, mode) {
  const d = date.getDate(), m = date.getMonth(), y = date.getFullYear();
  switch (mode) {
    case 'd':    return String(d);
    case 'dmon': return `${d}-${MON_SHORT[m]}`;
    case 'ymd':  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
    default:     return `${pad2(d)}/${pad2(m + 1)}/${y}`;
  }
}

function roundHours(h, step) {
  if (!step) return Math.round(h * 100) / 100;
  return Math.round(h / step) * step;
}

function hoursText(h) {
  if (h === null || h === undefined) return '';
  const s = (Math.round(h * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
  return s === '' ? '0' : s;
}

/** Parse an all-day 'YYYY-MM-DD' as a *local* midnight, not UTC. */
function parseLocalDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function stripHtml(s) {
  if (!s) return '';
  const tmp = el('div');
  tmp.innerHTML = s;
  return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}

function splitTerms(s) {
  return (s || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

/* ---------------------------------------------------------- */
/* auth                                                        */
/* ---------------------------------------------------------- */

function gisReady() {
  return typeof google !== 'undefined' && google.accounts && google.accounts.oauth2;
}

function setAuthUI(connected) {
  const s = $('authStatus');
  s.textContent = connected ? 'Connected' : 'Not connected';
  s.className = 'status ' + (connected ? 'status-on' : 'status-off');
  $('btnConnect').classList.toggle('hidden', connected);
  $('btnSignOut').classList.toggle('hidden', !connected);
}

function connect() {
  const clientId = $('clientId').value.trim();
  if (!clientId) {
    toast('Paste your Google OAuth Client ID first (step 1).', true);
    $('clientId').focus();
    return;
  }
  if (!gisReady()) {
    toast('Google sign-in library is still loading — try again in a moment.', true);
    return;
  }

  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (resp) => {
      if (resp.error) {
        toast(`Sign-in failed: ${resp.error_description || resp.error}`, true);
        return;
      }
      state.token = resp.access_token;
      setAuthUI(true);
      saveSettings();
      loadCalendars();
    },
    error_callback: (err) => {
      toast(`Sign-in was cancelled or blocked (${err.type || 'unknown'}). ` +
            'Check that this origin is an authorised JavaScript origin.', true);
    },
  });

  state.tokenClient.requestAccessToken({ prompt: state.token ? '' : 'consent' });
}

function signOut() {
  if (state.token && gisReady()) google.accounts.oauth2.revoke(state.token, () => {});
  state.token = null;
  state.calendars = [];
  setAuthUI(false);
  $('calList').innerHTML = '<p class="muted">Connect your account to list calendars.</p>';
  toast('Signed out.');
}

async function api(path, params) {
  if (!state.token) throw new Error('Not connected to Google Calendar.');
  const url = new URL(API + path);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const res = await fetch(url, { headers: { Authorization: `Bearer ${state.token}` } });

  if (res.status === 401) {
    state.token = null;
    setAuthUI(false);
    throw new Error('Your Google session expired. Click "Connect Google Calendar" again.');
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.error && body.error.message) detail = body.error.message;
    } catch (_) { /* keep status text */ }
    throw new Error(detail);
  }
  return res.json();
}

/* ---------------------------------------------------------- */
/* calendars                                                   */
/* ---------------------------------------------------------- */

async function loadCalendars() {
  const box = $('calList');
  box.innerHTML = '<p class="muted">Loading calendars…</p>';
  try {
    const items = [];
    let pageToken;
    do {
      const data = await api('/users/me/calendarList', { maxResults: 250, pageToken });
      items.push(...(data.items || []));
      pageToken = data.nextPageToken;
    } while (pageToken);

    items.sort((a, b) => {
      if (!!a.primary !== !!b.primary) return a.primary ? -1 : 1;
      return (a.summary || '').localeCompare(b.summary || '');
    });

    state.calendars = items;

    // First run: preselect the primary calendar.
    if (state.selected.size === 0) {
      const primary = items.find((c) => c.primary) || items[0];
      if (primary) state.selected.add(primary.id);
    }

    renderCalendars();
    saveSettings();
  } catch (err) {
    box.innerHTML = '';
    box.appendChild(el('p', 'muted', err.message));
    toast(err.message, true);
  }
}

function renderCalendars() {
  const box = $('calList');
  box.innerHTML = '';
  if (!state.calendars.length) {
    box.appendChild(el('p', 'muted', 'No calendars found on this account.'));
    return;
  }
  state.calendars.forEach((c) => {
    const label = el('label', 'check');

    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(c.id);
    cb.addEventListener('change', () => {
      if (cb.checked) state.selected.add(c.id); else state.selected.delete(c.id);
      saveSettings();
    });

    const dot = el('span', 'cal-dot');
    dot.style.background = c.backgroundColor || '#9ca3af';

    const name = el('span', 'cal-name', c.summary + (c.primary ? ' (primary)' : ''));
    name.title = c.summary;

    label.append(cb, dot, name);
    box.appendChild(label);
  });
}

/* ---------------------------------------------------------- */
/* fetching + row building                                     */
/* ---------------------------------------------------------- */

async function fetchEvents(calendarId, timeMin, timeMax) {
  const out = [];
  let pageToken;
  do {
    const data = await api(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
      pageToken,
    });
    out.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

function readOptions() {
  return {
    grouping:  $('optGrouping').value,
    dateFmt:   $('optDateFmt').value,
    timeFmt:   $('optTimeFmt').value,
    round:     parseFloat($('optRound').value) || 0,
    breakMin:  Math.max(0, parseFloat($('optBreak').value) || 0),
    allDayHrs: Math.max(0, parseFloat($('optAllDayHours').value) || 0),
    allDay:    $('optAllDay').checked,
    declined:  $('optDeclined').checked,
    weekends:  $('optWeekends').checked,
    emptyDays: $('optEmptyDays').checked,
    detail:    $('optDescDetail').checked,
    total:     $('optTotal').checked,
    exclude:   splitTerms($('optExclude').value),
    include:   splitTerms($('optInclude').value),
    perPage:   Math.max(5, parseInt($('optRowsPerPage').value, 10) || 21),
  };
}

/** Turn raw Calendar events into normalised entries for the given month. */
function normalise(events, month, year, o) {
  const entries = [];

  events.forEach((e) => {
    if (e.status === 'cancelled') return;

    const isAllDay = !e.start.dateTime;
    if (isAllDay && !o.allDay) return;

    if (!o.declined) {
      const me = (e.attendees || []).find((a) => a.self);
      if (me && me.responseStatus === 'declined') return;
    }

    const title = (e.summary || '(no title)').trim();
    const lower = title.toLowerCase();
    if (o.exclude.length && o.exclude.some((t) => lower.includes(t))) return;
    if (o.include.length && !o.include.some((t) => lower.includes(t))) return;

    let start, end, hours;
    if (isAllDay) {
      start = parseLocalDate(e.start.date);
      end   = parseLocalDate(e.end.date);
      hours = o.allDayHrs;
    } else {
      start = new Date(e.start.dateTime);
      end   = new Date(e.end.dateTime);
      hours = (end - start) / 3600000;
    }

    // Only keep what actually falls inside the requested month.
    if (start.getMonth() !== month || start.getFullYear() !== year) return;
    if (!o.weekends && (start.getDay() === 0 || start.getDay() === 6)) return;

    let desc = title;
    if (o.detail) {
      const extra = [];
      if (e.location) extra.push(e.location.replace(/\s+/g, ' ').trim());
      const notes = stripHtml(e.description);
      if (notes) extra.push(notes.length > 160 ? notes.slice(0, 157) + '…' : notes);
      if (extra.length) desc += ` — ${extra.join(' · ')}`;
    }

    entries.push({ start, end, hours, desc, isAllDay });
  });

  entries.sort((a, b) => a.start - b.start);
  return entries;
}

function applyAdjustments(hours, o) {
  let h = Math.max(0, hours - o.breakMin / 60);
  h = roundHours(h, o.round);
  return Math.max(0, h);
}

function buildRows(entries, month, year, o) {
  const rows = [];

  if (o.grouping === 'day') {
    const byDay = new Map();
    entries.forEach((en) => {
      const k = dayKey(en.start);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(en);
    });

    [...byDay.keys()].sort().forEach((k) => {
      const list  = byDay.get(k);
      const first = list[0].start;
      const last  = list.reduce((a, b) => (b.end > a ? b.end : a), list[0].end);
      const timed = list.filter((en) => !en.isAllDay);

      const raw = list.reduce((sum, en) => sum + en.hours, 0);
      const timing = timed.length
        ? `${fmtTime(first, o.timeFmt)} - ${fmtTime(last, o.timeFmt)}`
        : 'All day';

      rows.push({
        date:   first,
        timing,
        hours:  applyAdjustments(raw, o),
        desc:   list.map((en) => en.desc).join('; '),
      });
    });
  } else {
    entries.forEach((en) => {
      rows.push({
        date:   en.start,
        timing: en.isAllDay ? 'All day'
                            : `${fmtTime(en.start, o.timeFmt)} - ${fmtTime(en.end, o.timeFmt)}`,
        hours:  applyAdjustments(en.hours, o),
        desc:   en.desc,
      });
    });
  }

  if (o.emptyDays) {
    const filled = new Set(rows.map((r) => dayKey(r.date)));
    const last = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const date = new Date(year, month, d);
      if (!o.weekends && (date.getDay() === 0 || date.getDay() === 6)) continue;
      if (filled.has(dayKey(date))) continue;
      rows.push({ date, timing: '', hours: null, desc: '', blank: true });
    }
  }

  rows.sort((a, b) => a.date - b.date);
  return rows;
}

/* ---------------------------------------------------------- */
/* rendering the sheet                                         */
/* ---------------------------------------------------------- */

function buildHead(o, month, year) {
  const thead = el('thead');

  const title = el('tr', 'r-title');
  const tdTitle = el('td');
  tdTitle.colSpan = 6;
  tdTitle.appendChild(el('span', null, 'TIME SHEET'));
  title.appendChild(tdTitle);
  thead.appendChild(title);

  const metaRow = (label, valueCells) => {
    const tr = el('tr', 'r-meta');
    tr.appendChild(el('td', 'lbl', label));
    valueCells.forEach((c) => tr.appendChild(c));
    return tr;
  };

  const cell = (cls, text, span) => {
    const td = el('td', cls, text);
    if (span) td.colSpan = span;
    td.contentEditable = 'true';
    return td;
  };

  thead.appendChild(metaRow('NAME:',     [cell('val', $('empName').value.trim(), 5)]));
  thead.appendChild(metaRow('POSITION:', [cell('val', $('empPosition').value.trim(), 5)]));
  thead.appendChild(metaRow('MONTH:',    [
    cell('val-c', MONTHS[month], 2),
    el('td', 'val-c', 'Year'),
    cell('val-r', String(year), 2),
  ]));

  const head = el('tr', 'r-head');
  ['DATE','DAY','Timing','Hours','DESCRIPTION OF TASK','VERIFIED BY']
    .forEach((h) => head.appendChild(el('th', null, h)));
  thead.appendChild(head);

  return thead;
}

function bodyRow(row, o) {
  const tr = el('tr');
  const add = (cls, text, editable) => {
    const td = el('td', cls, text);
    if (editable) td.contentEditable = 'true';
    tr.appendChild(td);
  };

  if (!row) {                       // padding row, keeps the grid full
    ['t-date','t-day','t-timing','t-hours','t-desc','t-verif']
      .forEach((c) => add(c, '', true));
    return tr;
  }

  if (row.total) {
    tr.className = 'r-total';
    add('t-date', '');
    add('t-day', '');
    add('t-timing', '');
    add('t-hours', hoursText(row.hours));
    add('t-desc', 'TOTAL');
    add('t-verif', '');
    return tr;
  }

  add('t-date',   fmtDate(row.date, o.dateFmt), true);
  add('t-day',    DAYS[row.date.getDay()], true);
  add('t-timing', row.timing, true);
  add('t-hours',  hoursText(row.hours), true);
  add('t-desc',   row.desc, true);
  add('t-verif',  '', true);
  return tr;
}

function render(rows, month, year, o) {
  const host = $('sheets');
  host.innerHTML = '';

  const printable = rows.slice();
  if (o.total) {
    const sum = rows.reduce((s, r) => s + (r.hours || 0), 0);
    printable.push({ total: true, hours: roundHours(sum, 0) });
  }

  const pages = Math.max(1, Math.ceil(printable.length / o.perPage));

  for (let p = 0; p < pages; p++) {
    const slice = printable.slice(p * o.perPage, (p + 1) * o.perPage);

    const sheet = el('div', 'sheet');
    const table = el('table', 'ts');

    const cg = el('colgroup');
    ['c-date','c-day','c-timing','c-hours','c-desc','c-verif']
      .forEach((c) => cg.appendChild(el('col', c)));
    table.appendChild(cg);

    table.appendChild(buildHead(o, month, year));

    const tbody = el('tbody');
    slice.forEach((r) => tbody.appendChild(bodyRow(r, o)));
    for (let i = slice.length; i < o.perPage; i++) tbody.appendChild(bodyRow(null, o));
    table.appendChild(tbody);

    sheet.appendChild(table);
    host.appendChild(sheet);
  }

  const worked = rows.filter((r) => !r.blank).length;
  const total  = rows.reduce((s, r) => s + (r.hours || 0), 0);
  $('summaryLine').textContent =
    `${MONTHS[month]} ${year} — ${worked} entr${worked === 1 ? 'y' : 'ies'}, ` +
    `${hoursText(roundHours(total, 0))} h, ${pages} page${pages === 1 ? '' : 's'}.`;

  $('btnPrint').disabled = false;
  $('btnCsv').disabled = false;
}

/* ---------------------------------------------------------- */
/* generate                                                    */
/* ---------------------------------------------------------- */

async function generate() {
  if (!state.token) { toast('Connect your Google account first.', true); return; }
  if (!state.selected.size) { toast('Select at least one calendar.', true); return; }

  const o = readOptions();
  const month = parseInt($('selMonth').value, 10);
  const year  = parseInt($('selYear').value, 10);
  if (!Number.isInteger(year) || year < 1970) { toast('Enter a valid year.', true); return; }

  const btn = $('btnGenerate');
  btn.disabled = true;
  btn.textContent = 'Fetching events…';
  saveSettings();

  try {
    const timeMin = new Date(year, month, 1, 0, 0, 0);
    const timeMax = new Date(year, month + 1, 1, 0, 0, 0);

    const ids = state.calendars.filter((c) => state.selected.has(c.id)).map((c) => c.id);
    const batches = await Promise.all(ids.map((id) => fetchEvents(id, timeMin, timeMax)));
    const events = batches.flat();

    const entries = normalise(events, month, year, o);
    state.rows = buildRows(entries, month, year, o);

    render(state.rows, month, year, o);

    if (!state.rows.length) {
      toast('No matching events in that month — the blank template is ready to fill in.');
    } else {
      toast(`Generated ${state.rows.length} row${state.rows.length === 1 ? '' : 's'}.`);
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate timesheet';
  }
}

/* ---------------------------------------------------------- */
/* CSV                                                         */
/* ---------------------------------------------------------- */

function exportCsv() {
  // Read straight off the rendered sheet so manual edits are included.
  const rows = [['DATE','DAY','Timing','Hours','DESCRIPTION OF TASK','VERIFIED BY']];
  document.querySelectorAll('.sheet tbody tr').forEach((tr) => {
    const cells = [...tr.children].map((td) => td.textContent.trim());
    if (cells.some((c) => c !== '')) rows.push(cells);
  });

  const esc = (v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');

  const month = parseInt($('selMonth').value, 10);
  const year  = $('selYear').value;
  const name  = ($('empName').value.trim() || 'timesheet').replace(/[^\w-]+/g, '_');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}_${MONTHS[month]}_${year}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------------------------------------------------- */
/* init                                                        */
/* ---------------------------------------------------------- */

function init() {
  MONTHS.forEach((m, i) => {
    const opt = el('option', null, m);
    opt.value = i;
    $('selMonth').appendChild(opt);
  });

  // Default to last month — the one you normally submit.
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  $('selMonth').value = prev.getMonth();
  $('selYear').value  = prev.getFullYear();

  loadSettings();

  const origin = location.origin;
  $('originHint').textContent = origin;
  $('originHint2').textContent = origin;
  if (location.protocol === 'file:') {
    toast('Open this app over http://localhost — Google sign-in will not work from file://', true);
  }

  $('btnConnect').addEventListener('click', connect);
  $('btnSignOut').addEventListener('click', signOut);
  $('btnGenerate').addEventListener('click', generate);
  $('btnCsv').addEventListener('click', exportCsv);
  $('btnPrint').addEventListener('click', () => window.print());

  $('setupHelpToggle').addEventListener('click', (e) => {
    e.preventDefault();
    $('setupHelp').classList.toggle('hidden');
  });

  [...FIELDS, ...FLAGS].forEach((k) => $(k).addEventListener('change', saveSettings));

  $('zoom').addEventListener('input', (e) => {
    $('sheets').style.transform = `scale(${e.target.value / 100})`;
  });

  setAuthUI(false);
}

document.addEventListener('DOMContentLoaded', init);
