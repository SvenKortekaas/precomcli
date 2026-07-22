// PreCom web app — browser counterpart of the precomcli tool.
// Talks to the PreCom Mobile API through the stateless Cloudflare Worker proxy
// in ../worker/worker.js (browsers can't reach pre-com.nl directly: no CORS).
//
// Security rules for anyone editing this file:
// - NEVER use innerHTML/insertAdjacentHTML with API data. Everything from the
//   API is untrusted free text (message bodies, capcode descriptions, labels);
//   render it exclusively through el()/textContent.
// - Keep the zero-dependency rule: no CDNs, no npm packages. The CSP in
//   index.html enforces same-origin scripts, which also blocks any injected
//   third-party script.
'use strict';

// ---------- storage (browser-side only; the proxy stores nothing) ----------

const store = {
  get: (key) => localStorage.getItem(`precomcli.${key}`),
  set: (key, value) => localStorage.setItem(`precomcli.${key}`, value),
  del: (key) => localStorage.removeItem(`precomcli.${key}`),
};

// The project's shared relay (worker/worker.js) - stateless and
// credential-blind, so one deployment serves every user. Users only override
// this (login form's Advanced section / Settings) to self-host their own.
// Keep this constant in sync with the actual deployed Worker URL.
const DEFAULT_PROXY = 'https://precomcli.frosty-lake-b494.workers.dev';

function proxyBase() {
  return (store.get('proxy') || DEFAULT_PROXY).trim().replace(/\/+$/, '');
}

// Store an override only when it differs from the default, so everyone else
// automatically follows if the default ever changes.
function setProxy(value) {
  const cleaned = (value || '').trim().replace(/\/+$/, '');
  if (cleaned && cleaned !== DEFAULT_PROXY) store.set('proxy', cleaned);
  else store.del('proxy');
}

// ---------- API client (mirrors PreComClient in src/api.js) ----------

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(method, path, { query, body, form } = {}) {
  const base = proxyBase();
  if (!base) throw new ApiError('No proxy URL configured. Open Settings.', 0);
  let url = base + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) qs.set(key, value);
    }
    const qsStr = qs.toString();
    if (qsStr) url += `?${qsStr}`;
  }
  const headers = {};
  const token = store.get('token');
  if (token && path !== '/Token') headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new ApiError('Network error — check the proxy URL and your connection.', 0);
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/Token' && store.get('token')) {
      clearSession();
      showView('login');
      throw new ApiError('Session expired — log in again.', 401);
    }
    let message =
      (data && (data.Message || data.error_description || data.error)) ||
      `Request failed (HTTP ${res.status})`;
    // Surface ASP.NET's hidden exception detail when present (see src/api.js).
    if (data && typeof data === 'object') {
      if (data.ExceptionMessage && data.ExceptionMessage !== message) {
        message += ` — ${data.ExceptionMessage}`;
      }
      if (data.ModelState) message += ` — ${JSON.stringify(data.ModelState)}`;
    }
    throw new ApiError(message, res.status);
  }
  return data;
}

// Same rule as isNotAvailable in src/render.js (keep them in sync): scheduler
// blocks are AVAILABILITY (on-call) periods, and the typo'd
// NotAvailalbeScheduled flag is INVERTED from its name - true means a
// scheduled availability block is active (user IS available). Unavailable
// when the manual NotAvailable toggle is set, or when no block is active.
function isNotAvailable(info) {
  const scheduledAvailable = info.NotAvailalbeScheduled ?? info.NotAvailableScheduled;
  if (info.NotAvailable) return true;
  if (scheduledAvailable === undefined || scheduledAvailable === null) return false;
  return !scheduledAvailable;
}

// ---------- tiny DOM helpers (no innerHTML, ever) ----------

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function replaceChildren(parent, ...children) {
  parent.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined));
}

function shortTimestamp(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
}

let toastTimer;
function notify(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = isError ? 'error' : 'ok';
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 5000);
}

function spinner(section) {
  replaceChildren(section, el('p', { class: 'hint' }, 'Loading…'));
}

// ---------- session ----------

function clearSession() {
  store.del('token');
  document.getElementById('header-user').textContent = '';
  document.getElementById('nav').hidden = true;
}

async function login(proxy, username, password) {
  setProxy(proxy);
  const data = await api('POST', '/Token', {
    form: { grant_type: 'password', username, password },
  });
  store.set('token', data.access_token);
  store.set('userName', data.userName || username);
}

// ---------- views ----------

const views = ['login', 'home', 'groups', 'alarms', 'messages', 'capcodes', 'settings'];
const loaders = {
  home: loadHome,
  groups: loadGroups,
  alarms: loadAlarms,
  messages: loadMessages,
  capcodes: loadCapcodes,
  settings: loadSettings,
};

function showView(name) {
  for (const view of views) {
    document.getElementById(`view-${view}`).hidden = view !== name;
  }
  for (const button of document.querySelectorAll('#nav button')) {
    button.classList.toggle('active', button.dataset.view === name);
  }
  const loggedIn = Boolean(store.get('token'));
  document.getElementById('nav').hidden = !loggedIn;
  document.getElementById('header-user').textContent = loggedIn
    ? store.get('userName') || ''
    : '';
  if (loaders[name]) loaders[name]();
}

function sectionHeader(title, onRefresh) {
  return el(
    'div',
    { class: 'section-header' },
    el('h2', null, title),
    onRefresh ? el('button', { class: 'small', onclick: onRefresh }, 'Refresh') : null
  );
}

// ----- home -----

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "Make me available now" — live-decoded semantics (mirrors makeAvailable in
// src/api.js, keep in sync): SetAvailable only clears the manual toggle;
// schedule-driven unavailability is cleared by DELETEing the not-available
// markings from the current hour to end of day.
function availableButton(info) {
  return el(
    'button',
    {
      class: 'primary',
      onclick: async () => {
        if (!confirm('Make yourself AVAILABLE for the rest of today?')) return;
        try {
          if (info.NotAvailable) await api('POST', '/api/User/SetAvailable');
          const scheduledAvailable = info.NotAvailalbeScheduled ?? info.NotAvailableScheduled;
          if (scheduledAvailable === false) {
            await api('DELETE', '/api/User/DeleteUserSchedulerAppointment', {
              query: {
                date: localDate(),
                from: `${String(new Date().getHours()).padStart(2, '0')}:00:00`,
                to: '24:00:00',
              },
            });
          }
          notify('You are marked available for the rest of today.');
          loadHome();
        } catch (err) {
          notify(err.message, true);
        }
      },
    },
    'Mark me available'
  );
}

// Marking NOT available = ADDing a scheduler appointment for the range
// (whole hours) — it punches a hole in the availability timeline.
function notAvailableForm() {
  const hoursSelect = el(
    'select',
    null,
    [1, 2, 3, 4, 6, 8].map((h) => el('option', { value: String(h) }, `${h} hour${h > 1 ? 's' : ''}`)),
    el('option', { value: 'eod' }, 'rest of today')
  );
  return el(
    'div',
    { class: 'row' },
    hoursSelect,
    el(
      'button',
      {
        class: 'small bad-btn',
        onclick: async () => {
          const fromHour = new Date().getHours();
          const toHour =
            hoursSelect.value === 'eod' ? 24 : Math.min(fromHour + Number(hoursSelect.value), 24);
          const label = toHour === 24 ? 'midnight' : `${toHour}:00`;
          if (!confirm(`Mark yourself NOT available from ${fromHour}:00 until ${label} today?`)) return;
          try {
            await api('POST', '/api/User/AddUserSchedulerAppointment', {
              query: {
                date: localDate(),
                from: `${String(fromHour).padStart(2, '0')}:00:00`,
                to: toHour === 24 ? '24:00:00' : `${String(toHour).padStart(2, '0')}:00:00`,
              },
            });
            notify(`You are NOT available until ${label}.`);
            loadHome();
          } catch (err) {
            notify(err.message, true);
          }
        },
      },
      'Mark not available'
    )
  );
}

async function loadHome() {
  const section = document.getElementById('view-home');
  spinner(section);
  let info;
  try {
    info = await api('GET', '/api/User/GetUserInfo');
  } catch (err) {
    replaceChildren(section, sectionHeader('Status', loadHome), errorLine(err));
    return;
  }
  const unavailable = isNotAvailable(info);
  replaceChildren(
    section,
    sectionHeader('Status', loadHome),
    el(
      'div',
      { class: 'card' },
      el('p', { class: 'big-name' }, (info.FullName || '').trim() || store.get('userName') || ''),
      el(
        'p',
        null,
        'Availability: ',
        el(
          'span',
          { class: unavailable ? 'badge bad' : 'badge good' },
          unavailable ? 'NOT AVAILABLE' : 'Available'
        )
      ),
      el('p', null, `Understaffed group(s): ${info.NoOccupancy ? 'yes' : 'no'}`),
      unavailable ? availableButton(info) : notAvailableForm()
    ),
    el(
      'p',
      { class: 'hint' },
      'Availability follows your on-call roster (scheduled availability blocks) plus the manual toggle.'
    )
  );
}

// ----- groups (roles + everyone's status) -----

const groupsState = { groups: null, loaded: {} };

async function loadGroups() {
  const section = document.getElementById('view-groups');
  spinner(section);
  try {
    groupsState.groups = (await api('GET', '/api/Group/GetAllUserGroups')) || [];
  } catch (err) {
    replaceChildren(section, sectionHeader('Groups', refreshGroups), errorLine(err));
    return;
  }
  replaceChildren(
    section,
    sectionHeader('Groups', refreshGroups),
    groupsState.groups.length
      ? groupsState.groups.map(groupCard)
      : el('p', { class: 'hint' }, 'No groups.')
  );
}

function refreshGroups() {
  groupsState.loaded = {};
  loadGroups();
}

function groupCard(group) {
  const body = el('div', null, el('p', { class: 'hint' }, 'Loading…'));
  const details = el(
    'details',
    { class: 'card group-card' },
    el('summary', null, `${(group.Label || '').trim() || `Group ${group.GroupID}`}`),
    body
  );
  details.addEventListener('toggle', () => {
    if (details.open) fillGroupFunctions(group.GroupID, body);
  });
  return details;
}

async function fillGroupFunctions(groupID, body) {
  if (groupsState.loaded[groupID]) return; // fetched once per Refresh
  groupsState.loaded[groupID] = true;
  let data;
  try {
    data = await api('GET', '/api/Group/GetAllFunctions', {
      query: { groupID, date: localDate() },
    });
  } catch (err) {
    delete groupsState.loaded[groupID];
    replaceChildren(body, errorLine(err));
    return;
  }
  const functions = data.ServiceFuntions || []; // "Funtions" — PreCom's own typo
  if (!functions.length) {
    replaceChildren(body, el('p', { class: 'hint' }, 'No functions/roles configured for this group.'));
    return;
  }
  // A member can hold several roles — collect them for the detail modal.
  const rolesByUser = {};
  for (const fn of functions) {
    for (const user of fn.Users || []) {
      (rolesByUser[user.UserID] = rolesByUser[user.UserID] || []).push(fn.Label);
    }
  }
  replaceChildren(body, functions.map((fn) => functionBlock(fn, rolesByUser)));
}

// Availability for user objects embedded in GetAllFunctions responses: their
// NotAvailalbeScheduled flag is NOT populated there (false for everyone -
// confirmed live 2026-07-22), so isNotAvailable() would mark the whole group
// unavailable. Instead these objects carry SchedulerDays: a per-hour
// availability map for the requested date (Hour<h> true = available that
// hour - verified against a known-available account). Manual NotAvailable
// still wins.
function isMemberAvailable(user) {
  if (user.NotAvailable) return false;
  const days = user.SchedulerDays || {};
  const key = Object.keys(days).find((k) => k.startsWith(localDate()));
  const day = key ? days[key] : null;
  if (!day) return false;
  return Boolean(day[`Hour${new Date().getHours()}`]);
}

function functionBlock(fn, rolesByUser) {
  // Available people first, then alphabetically within each status.
  const users = (fn.Users || []).slice().sort((a, b) => {
    const availDiff = Number(isMemberAvailable(b)) - Number(isMemberAvailable(a));
    if (availDiff !== 0) return availDiff;
    return (a.FullName || '').trim().localeCompare((b.FullName || '').trim());
  });
  const availableCount = users.filter(isMemberAvailable).length;
  const short = availableCount < (fn.NumberNeeded || 0);
  return el(
    'div',
    { class: 'function-block' },
    el(
      'p',
      { class: 'function-head' },
      el('strong', null, fn.Label || `Function ${fn.ServiceFunctionID}`),
      ' ',
      el(
        'span',
        { class: short ? 'badge bad' : 'badge good' },
        `${availableCount} available / ${fn.NumberNeeded || 0} needed`
      )
    ),
    users.length
      ? users.map((u) =>
          el(
            'button',
            {
              class: 'user-row',
              onclick: () => openMemberModal(u, rolesByUser[u.UserID] || []),
            },
            el('span', { class: isMemberAvailable(u) ? 'dot good' : 'dot bad' }),
            (u.FullName || '').trim() || `User ${u.UserID}`,
            el('span', { class: 'chevron' }, '›')
          )
        )
      : el('p', { class: 'hint' }, 'Nobody assigned.')
  );
}

// Detail overlay for one group member: status, roles, today's hour-by-hour
// availability, and a direct-message box (SendMessage with a Type 1 = user
// receiver — same payload rules as the Messages tab, needs SendBy).
function openMemberModal(user, roles) {
  const name = (user.FullName || '').trim() || `User ${user.UserID}`;
  const available = isMemberAvailable(user);
  const dayKey = Object.keys(user.SchedulerDays || {}).find((k) => k.startsWith(localDate()));
  const day = dayKey ? user.SchedulerDays[dayKey] : null;
  const manualSince =
    user.NotAvailable && user.NotAvailableTimestamp && !user.NotAvailableTimestamp.startsWith('0001')
      ? ` since ${shortTimestamp(user.NotAvailableTimestamp)}`
      : '';
  const msgArea = el('textarea', { rows: '2', placeholder: `Message to ${name}…` });
  const backdrop = el(
    'div',
    {
      class: 'modal-backdrop',
      onclick: (event) => {
        if (event.target === backdrop) backdrop.remove();
      },
    },
    el(
      'div',
      { class: 'modal' },
      el(
        'div',
        { class: 'row spread' },
        el('p', { class: 'big-name' }, name),
        el('button', { class: 'small', onclick: () => backdrop.remove() }, 'Close')
      ),
      el(
        'p',
        null,
        'Status: ',
        el(
          'span',
          { class: available ? 'badge good' : 'badge bad' },
          available ? 'Available' : 'NOT AVAILABLE'
        )
      ),
      el('p', { class: 'meta' }, `User ID: ${user.UserID}`),
      roles.length ? el('p', null, `Roles: ${roles.join(', ')}`) : null,
      user.NotAvailable ? el('p', null, `Manually marked not available${manualSince}.`) : null,
      day
        ? el(
            'div',
            null,
            el('p', { class: 'meta' }, "Today's availability (00:00-24:00, green = available):"),
            el(
              'div',
              { class: 'hour-strip' },
              Array.from({ length: 24 }, (_, h) =>
                el('div', {
                  class: day[`Hour${h}`] ? 'hour-cell good' : 'hour-cell',
                  title: `${h}:00-${h + 1}:00`,
                })
              )
            )
          )
        : null,
      el('h3', null, 'Send a message'),
      msgArea,
      el(
        'button',
        {
          class: 'primary',
          onclick: async () => {
            const message = msgArea.value.trim();
            if (!message) {
              notify('Enter a message first.', true);
              return;
            }
            const sendBy = Number(store.get('sendBy'));
            if (!sendBy) {
              notify('Set your sender ID (SendBy) in Settings first — see the README for how to find it.', true);
              return;
            }
            if (!confirm(`Send this message to ${name}?`)) return;
            try {
              await api('POST', '/api/Msg/SendMessage', {
                body: {
                  Message: message,
                  Receivers: [{ Type: 1, ID: user.UserID, Label: name }],
                  Priority: false,
                  Response: false,
                  SendBy: sendBy,
                },
              });
              notify(`Message sent to ${name}.`);
              backdrop.remove();
            } catch (err) {
              notify(err.message, true);
            }
          },
        },
        'Send'
      )
    )
  );
  document.body.append(backdrop);
}

// ----- alarms -----

const alarmState = { alarms: [] };

// Responding only makes sense right after dispatch — show the coming/not
// coming buttons only within 2 minutes of the alarm's timestamp.
const RESPOND_WINDOW_MS = 2 * 60 * 1000;

function alarmCard(alarm) {
  const ageMs = Date.now() - new Date(alarm.Timestamp).getTime();
  const canRespond = Number.isFinite(ageMs) && ageMs <= RESPOND_WINDOW_MS;
  return el(
    'div',
    { class: 'card' },
    el('p', { class: 'meta' }, `${shortTimestamp(alarm.Timestamp)}  ·  ${alarm.Group?.Label || ''}`),
    el('p', null, alarm.Text || ''),
    canRespond
      ? el(
          'div',
          { class: 'row' },
          el(
            'button',
            {
              class: 'small good-btn',
              onclick: () => respondToAlarm(alarm, true),
            },
            "I'm coming"
          ),
          el(
            'button',
            {
              class: 'small bad-btn',
              onclick: () => respondToAlarm(alarm, false),
            },
            'Not coming'
          )
        )
      : null
  );
}

async function respondToAlarm(alarm, available) {
  const label = available ? 'AVAILABLE' : 'NOT available';
  if (!confirm(`Mark yourself ${label} for this alarm?\n\n"${alarm.Text || ''}"`)) return;
  try {
    await api('POST', '/api/User/SetAvailabilityForAlarmMessage', {
      query: { msgInID: alarm.MsgInID, available },
    });
    notify(`Response sent: ${label.toLowerCase()} for this alarm.`);
  } catch (err) {
    notify(err.message, true);
  }
}

async function loadAlarms() {
  const section = document.getElementById('view-alarms');
  spinner(section);
  try {
    // previousOrNext: 0 = most recent, msgInID ignored but still required by
    // the route — omitting it is a 404 (see CLAUDE.md API notes).
    alarmState.alarms = (await api('GET', '/api/User/GetAlarmMessages', {
      query: { msgInID: 0, previousOrNext: 0 },
    })) || [];
  } catch (err) {
    replaceChildren(section, sectionHeader('Alarms', loadAlarms), errorLine(err));
    return;
  }
  renderAlarms();
}

function renderAlarms() {
  const section = document.getElementById('view-alarms');
  const cards = alarmState.alarms.map(alarmCard);
  replaceChildren(
    section,
    sectionHeader('Alarms', loadAlarms),
    cards.length ? cards : el('p', { class: 'hint' }, 'No alarms.'),
    alarmState.alarms.length
      ? el(
          'button',
          {
            class: 'small',
            onclick: async () => {
              const oldest = alarmState.alarms[alarmState.alarms.length - 1];
              try {
                const older = (await api('GET', '/api/User/GetAlarmMessages', {
                  query: { msgInID: oldest.MsgInID, previousOrNext: -1 },
                })) || [];
                if (!older.length) {
                  notify('No older alarms.');
                  return;
                }
                alarmState.alarms.push(...older);
                renderAlarms();
              } catch (err) {
                notify(err.message, true);
              }
            },
          },
          'Load older'
        )
      : null
  );
}

// ----- messages (inbox + send) -----

const CONTROL_ID_LABELS = { b: 'P2000 alarm', f: 'GPRS', g: 'understaffing' };
const messageState = { receivers: null, templates: null };

async function loadMessages() {
  const section = document.getElementById('view-messages');
  spinner(section);
  let inbox = [];
  let inboxError = null;
  try {
    inbox = (await api('GET', '/api/User/GetMessages')) || [];
  } catch (err) {
    inboxError = err;
  }
  const inboxCards = inbox.map((message) =>
    el(
      'div',
      { class: 'card' },
      el(
        'p',
        { class: 'meta' },
        `${shortTimestamp(message.Timestamp)}  ·  ${CONTROL_ID_LABELS[message.ControlID] || message.ControlID || ''}`
      ),
      el('p', null, message.Text || '')
    )
  );
  replaceChildren(
    section,
    sectionHeader('Messages', loadMessages),
    el('button', { class: 'small', onclick: () => openSendForm(section) }, 'New message'),
    el('div', { id: 'send-form-slot' }),
    inboxError ? errorLine(inboxError) : null,
    inboxCards.length ? inboxCards : inboxError ? null : el('p', { class: 'hint' }, 'No messages.')
  );
}

async function openSendForm(section) {
  const slot = section.querySelector('#send-form-slot');
  replaceChildren(slot, el('p', { class: 'hint' }, 'Loading receivers…'));
  try {
    if (!messageState.receivers) {
      messageState.receivers = (await api('GET', '/api/Msg/GetReceivers')) || [];
    }
    if (!messageState.templates) {
      messageState.templates = (await api('GET', '/api/Msg/GetTemplates')) || [];
    }
  } catch (err) {
    replaceChildren(slot, errorLine(err));
    return;
  }

  const textArea = el('textarea', { rows: '3', placeholder: 'Message text' });
  const templatePicker = el(
    'select',
    {
      onchange: () => {
        const template = messageState.templates.find(
          (t) => String(t.ID) === templatePicker.value
        );
        if (template) textArea.value = template.Text || template.Label || '';
      },
    },
    el('option', { value: '' }, messageState.templates.length ? 'Insert a template…' : 'No templates'),
    messageState.templates.map((t) => el('option', { value: String(t.ID) }, t.Label || t.Text || ''))
  );
  const filterInput = el('input', {
    type: 'search',
    placeholder: 'Filter receivers…',
    oninput: () => {
      const needle = filterInput.value.toLowerCase();
      for (const row of receiverList.children) {
        row.hidden = needle !== '' && !row.dataset.label.includes(needle);
      }
    },
  });
  const receiverList = el(
    'div',
    { class: 'receiver-list' },
    messageState.receivers.map((receiver) => {
      const checkbox = el('input', { type: 'checkbox' });
      checkbox.receiver = receiver;
      const row = el('label', { class: 'receiver-row' }, checkbox, receiver.Label || `${receiver.Type}:${receiver.ID}`);
      row.dataset.label = (receiver.Label || '').toLowerCase();
      return row;
    })
  );
  const priorityBox = el('input', { type: 'checkbox' });
  const responseBox = el('input', { type: 'checkbox' });

  replaceChildren(
    slot,
    el(
      'div',
      { class: 'card' },
      el('h3', null, 'Send a message'),
      templatePicker,
      textArea,
      filterInput,
      receiverList,
      el('label', { class: 'inline' }, priorityBox, ' Priority'),
      el('label', { class: 'inline' }, responseBox, ' Request response'),
      el(
        'div',
        { class: 'row' },
        el(
          'button',
          {
            class: 'primary',
            onclick: async () => {
              const receivers = [...receiverList.querySelectorAll('input:checked')].map(
                (checkbox) => ({
                  Type: checkbox.receiver.Type,
                  ID: checkbox.receiver.ID,
                  Label: checkbox.receiver.Label,
                })
              );
              const message = textArea.value.trim();
              if (!message || !receivers.length) {
                notify('Enter a message and pick at least one receiver.', true);
                return;
              }
              const sendBy = Number(store.get('sendBy'));
              if (!sendBy) {
                notify('Set your sender ID (SendBy) in Settings first — see the README for how to find it.', true);
                return;
              }
              if (!confirm(`Send to ${receivers.length} receiver(s)?`)) return;
              try {
                await api('POST', '/api/Msg/SendMessage', {
                  body: {
                    Message: message,
                    Receivers: receivers,
                    Priority: priorityBox.checked,
                    Response: responseBox.checked,
                    SendBy: sendBy,
                  },
                });
                notify('Message sent.');
                replaceChildren(slot);
              } catch (err) {
                notify(err.message, true);
              }
            },
          },
          'Send'
        ),
        el('button', { class: 'small', onclick: () => replaceChildren(slot) }, 'Cancel')
      )
    )
  );
}

// ----- capcodes -----

async function loadCapcodes() {
  const section = document.getElementById('view-capcodes');
  spinner(section);
  let capcodes;
  try {
    capcodes = (await api('GET', '/api/User/GetUserCapcodes')) || [];
  } catch (err) {
    replaceChildren(section, sectionHeader('Capcodes', loadCapcodes), errorLine(err));
    return;
  }
  replaceChildren(
    section,
    sectionHeader('Capcodes', loadCapcodes),
    capcodes.length
      ? capcodes.map((capcode) =>
          el(
            'div',
            { class: 'card row spread' },
            el(
              'div',
              null,
              el('p', null, String(capcode.CapcodeId)),
              el('p', { class: 'meta' }, capcode.Description || '')
            ),
            el(
              'button',
              {
                class: capcode.Enable ? 'small bad-btn' : 'small good-btn',
                onclick: async () => {
                  const action = capcode.Enable ? 'DISABLE' : 'enable';
                  if (!confirm(`${action} capcode ${capcode.CapcodeId}?\n\nThis changes which real alerts you receive.`)) return;
                  try {
                    await api('POST', '/api/User/UpdateUserCapcode', {
                      query: { capcode: capcode.CapcodeId, enable: !capcode.Enable },
                    });
                    notify(`Capcode ${capcode.CapcodeId} ${capcode.Enable ? 'disabled' : 'enabled'}.`);
                    loadCapcodes();
                  } catch (err) {
                    notify(err.message, true);
                  }
                },
              },
              capcode.Enable ? 'Disable' : 'Enable'
            )
          )
        )
      : el('p', { class: 'hint' }, 'No capcodes.')
  );
}

// ----- settings -----

function loadSettings() {
  const section = document.getElementById('view-settings');
  const proxyInput = el('input', { type: 'url', value: proxyBase() });
  const sendByInput = el('input', {
    type: 'text',
    inputmode: 'numeric',
    value: store.get('sendBy') || '',
    placeholder: 'e.g. 64',
  });
  replaceChildren(
    section,
    sectionHeader('Settings'),
    el(
      'div',
      { class: 'card' },
      el('label', null, 'Proxy URL — leave as-is unless you self-host the relay', proxyInput),
      el('label', null, 'Sender ID (SendBy) — needed only for sending messages', sendByInput),
      el(
        'button',
        {
          class: 'primary',
          onclick: () => {
            setProxy(proxyInput.value);
            if (sendByInput.value.trim()) store.set('sendBy', sendByInput.value.trim());
            else store.del('sendBy');
            notify('Settings saved.');
          },
        },
        'Save'
      )
    ),
    el(
      'div',
      { class: 'card' },
      el('h3', null, 'Install as app'),
      IS_STANDALONE
        ? el('p', { class: 'hint' }, 'Already running as an installed app.')
        : IS_IOS
          ? el(
              'p',
              { class: 'hint' },
              'iPhone/iPad: tap Share ⬆︎ in Safari and choose "Add to Home Screen". (iOS offers no install button to apps.)'
            )
          : deferredInstallPrompt
            ? el(
                'button',
                { class: 'primary', onclick: () => deferredInstallPrompt.prompt() },
                'Install'
              )
            : el(
                'p',
                { class: 'hint' },
                'Use your browser\'s menu → "Install app" / "Add to Home screen" (Chrome and Edge support this).'
              )
    ),
    el(
      'div',
      { class: 'card' },
      el('p', null, `Logged in as ${store.get('userName') || 'unknown'}`),
      el(
        'button',
        {
          class: 'bad-btn',
          onclick: async () => {
            try {
              await api('POST', '/api/Account/Logout');
            } catch {
              // Best effort — the local token is cleared regardless.
            }
            clearSession();
            notify('Logged out.');
            showView('login');
          },
        },
        'Log out'
      )
    ),
    el(
      'p',
      { class: 'hint' },
      'Your session token lives only in this browser. The proxy stores and logs nothing.'
    )
  );
}

// ----- shared -----

function errorLine(err) {
  return el('p', { class: 'error-line' }, err.message);
}

// ---------- boot ----------

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    await login(
      document.getElementById('login-proxy').value,
      document.getElementById('login-username').value,
      document.getElementById('login-password').value
    );
    document.getElementById('login-password').value = '';
    notify('Logged in.');
    showView('home');
  } catch (err) {
    notify(err.message, true);
  } finally {
    button.disabled = false;
  }
});

for (const button of document.querySelectorAll('#nav button')) {
  button.addEventListener('click', () => showView(button.dataset.view));
}

// Only show an explicit override in the Advanced field; empty = shared relay.
document.getElementById('login-proxy').value = store.get('proxy') || '';
document.getElementById('login-username').value = store.get('userName') || '';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Offline caching is a nice-to-have; the app works without it.
  });
}

// ---------- install (hint banner + Settings card) ----------

const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const IS_STANDALONE =
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let deferredInstallPrompt = null;

// iOS Safari has NO install prompt for web apps, ever — the only path is
// Share > Add to Home Screen, so show a one-time hint explaining that.
// Chromium browsers DO fire beforeinstallprompt; capture it and offer a real
// Install button instead.

function installBanner(text, buttonLabel, onButton) {
  const banner = el(
    'div',
    { class: 'install-banner' },
    el('span', null, text),
    onButton ? el('button', { class: 'small', onclick: onButton }, buttonLabel) : null,
    el(
      'button',
      {
        class: 'small',
        onclick: () => {
          store.set('installHintDismissed', '1');
          banner.remove();
        },
      },
      'Dismiss'
    )
  );
  document.querySelector('main').prepend(banner);
  return banner;
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event; // used by the banner and the Settings card
  if (!IS_STANDALONE && !store.get('installHintDismissed')) {
    const banner = installBanner('This site works as an app.', 'Install', () => {
      banner.remove();
      event.prompt();
    });
  }
});

if (IS_IOS && !IS_STANDALONE && !store.get('installHintDismissed')) {
  installBanner('Install as app: tap Share ⬆︎ and then "Add to Home Screen".');
}

showView(store.get('token') ? 'home' : 'login');
