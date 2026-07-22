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

function proxyBase() {
  return (store.get('proxy') || '').trim().replace(/\/+$/, '');
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

// Same rule as isNotAvailable in src/render.js: the manual toggle OR a
// scheduled block (NotAvailalbeScheduled is PreCom's own typo; the correctly
// spelled fallback covers a possible future server-side fix).
function isNotAvailable(info) {
  const scheduled = info.NotAvailalbeScheduled ?? info.NotAvailableScheduled;
  return Boolean(info.NotAvailable) || Boolean(scheduled);
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
  store.set('proxy', proxy.trim().replace(/\/+$/, ''));
  const data = await api('POST', '/Token', {
    form: { grant_type: 'password', username, password },
  });
  store.set('token', data.access_token);
  store.set('userName', data.userName || username);
}

// ---------- views ----------

const views = ['login', 'home', 'alarms', 'messages', 'capcodes', 'settings'];
const loaders = {
  home: loadHome,
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
      unavailable
        ? el(
            'button',
            {
              class: 'primary',
              onclick: async () => {
                if (!confirm('Mark yourself as available now?')) return;
                try {
                  await api('POST', '/api/User/SetAvailable');
                  notify('You are now marked as available.');
                  loadHome();
                } catch (err) {
                  notify(err.message, true);
                }
              },
            },
            'Mark me available'
          )
        : null
    ),
    el(
      'p',
      { class: 'hint' },
      'PreCom can take a while to reflect a status change — a stale value here is usually their delay, not this app.'
    )
  );
}

// ----- alarms -----

const alarmState = { alarms: [] };

function alarmCard(alarm) {
  return el(
    'div',
    { class: 'card' },
    el('p', { class: 'meta' }, `${shortTimestamp(alarm.Timestamp)}  ·  ${alarm.Group?.Label || ''}`),
    el('p', null, alarm.Text || ''),
    el(
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
    // previousOrNext: 0 = most recent, msgInID ignored (see CLAUDE.md API notes).
    alarmState.alarms = (await api('GET', '/api/User/GetAlarmMessages', {
      query: { previousOrNext: 0 },
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
      el('label', null, 'Proxy URL', proxyInput),
      el('label', null, 'Sender ID (SendBy) — needed only for sending messages', sendByInput),
      el(
        'button',
        {
          class: 'primary',
          onclick: () => {
            store.set('proxy', proxyInput.value.trim().replace(/\/+$/, ''));
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

document.getElementById('login-proxy').value = proxyBase();
document.getElementById('login-username').value = store.get('userName') || '';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Offline caching is a nice-to-have; the app works without it.
  });
}

showView(store.get('token') ? 'home' : 'login');
