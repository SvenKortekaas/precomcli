// Cloudflare Worker: stateless CORS proxy for the PreCom Mobile API.
//
// Security design (deliberate — do not "improve" these away):
// - The upstream is HARDCODED. The client can never make this Worker fetch an
//   arbitrary URL, so it cannot be abused as an open proxy.
// - Only an exact allowlist of known PreCom endpoints is forwarded, each with
//   its exact HTTP method. Keep ENDPOINTS in sync with src/api.js when the web
//   app grows a new feature.
// - Every /api endpoint (except password reset) requires a Bearer header
//   before we even contact PreCom — garbage traffic dies here, at the edge.
// - Only Authorization and Content-Type are forwarded in either direction
//   (plus the response status/body). Cookies never pass through.
// - Completely stateless: no storage, no KV, and NO LOGGING of headers or
//   bodies — a token only exists inside the single request that carries it.
// - Browser-only by design: requests without an allowed Origin are rejected.
//   Non-browser clients don't need this proxy; they can hit PreCom directly.
//
// Deploy: Cloudflare dashboard > Workers > Create > paste this file, or
// `npx wrangler deploy` from this directory. Stay on the FREE plan (hard
// request cap, no bill) and put 2FA on the Cloudflare account.

const UPSTREAM = 'https://pre-com.nl/Mobile';

// Origins allowed to use this proxy. Add 'http://localhost:8000' temporarily
// if you serve web/ locally during development (`npx serve web` etc.).
const ALLOWED_ORIGINS = [
  'https://svenkortekaas.github.io',
];

// No bearer token required (must work when the user can't log in).
const OPEN_ENDPOINTS = {
  '/Token': 'POST',
  '/api/Account/ResetPassword': 'POST',
};

// Exact path -> exact method, mirroring the PreComClient methods in src/api.js.
const ENDPOINTS = {
  '/api/Account/Logout': 'POST',
  '/api/User/GetUserInfo': 'GET',
  '/api/User/GetMessages': 'GET',
  '/api/User/GetAlarmMessages': 'GET',
  '/api/User/SetAvailabilityForAlarmMessage': 'POST',
  '/api/User/SetAvailable': 'POST',
  '/api/User/GetUserSchedulerAppointments': 'GET',
  '/api/User/AddUserSchedulerAppointment': 'POST',
  '/api/User/DeleteUserSchedulerAppointment': 'DELETE',
  '/api/User/GetUserCapcodes': 'GET',
  '/api/User/UpdateUserCapcode': 'POST',
  '/api/User/UpdateUserSchedulerPeriod': 'POST',
  '/api/User/SetOutsideRegion': 'POST',
  '/api/User/UpdateUserSound': 'POST',
  '/api/User/GetGroupChange': 'GET',
  '/api/User/GetAllGroupChanges': 'GET',
  '/api/User/AddGroupChangeForDays': 'POST',
  '/api/User/UpdateGroupChangeForDays': 'POST',
  '/api/User/AddGroupChangeForPeriod': 'POST',
  '/api/User/UpdateGroupChangeForPeriod': 'POST',
  '/api/User/AddGroupChangePeriodically': 'POST',
  '/api/User/UpdateGroupChangePeriodically': 'POST',
  '/api/User/DeleteOneTypeGroupChange': 'DELETE',
  '/api/User/DeleteGroupChange': 'DELETE',
  '/api/User/DeleteOneGroupChange': 'DELETE',
  '/api/User/GetShiftAppointments': 'GET',
  '/api/Group/GetAllUserGroups': 'GET',
  '/api/Group/GetAllGroups': 'GET',
  '/api/Group/GetOccupancyLevels': 'GET',
  '/api/Group/GetAllDaysNoOccupancy': 'GET',
  '/api/Group/GetAllFunctions': 'GET',
  '/api/Msg/GetReceivers': 'GET',
  '/api/Msg/GetTemplates': 'GET',
  '/api/Msg/SendMessage': 'POST',
  '/api/v2/Information/GetInformation': 'GET',
  '/api/v2/Piket/GetSchedule': 'GET',
};

const MAX_BODY_BYTES = 64 * 1024; // largest legitimate payload is a short message

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function deny(status, message, origin) {
  return new Response(JSON.stringify({ Message: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      return deny(403, 'Origin not allowed.', null);
    }

    const path = new URL(request.url).pathname;
    const allowedMethod = OPEN_ENDPOINTS[path] || ENDPOINTS[path];

    if (request.method === 'OPTIONS') {
      if (!allowedMethod) return deny(404, 'Unknown endpoint.', origin);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!allowedMethod) return deny(404, 'Unknown endpoint.', origin);
    if (request.method !== allowedMethod) {
      return deny(405, 'Method not allowed for this endpoint.', origin);
    }

    // Reject unauthenticated junk before it ever reaches PreCom.
    const auth = request.headers.get('Authorization');
    if (!OPEN_ENDPOINTS[path] && !/^Bearer .+/.test(auth || '')) {
      return deny(401, 'Missing bearer token.', origin);
    }

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_BODY_BYTES) return deny(413, 'Body too large.', origin);

    const headers = new Headers();
    if (auth) headers.set('Authorization', auth);
    const contentType = request.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);

    const upstream = await fetch(UPSTREAM + path + new URL(request.url).search, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
    });

    const responseHeaders = new Headers(corsHeaders(origin));
    responseHeaders.set('X-Content-Type-Options', 'nosniff');
    const upstreamType = upstream.headers.get('Content-Type');
    if (upstreamType) responseHeaders.set('Content-Type', upstreamType);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  },
};
