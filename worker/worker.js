// Cloudflare Worker: stateless CORS proxy for the PreCom APIs.
//
// Security design (deliberate — do not "improve" these away):
// - The upstreams are HARDCODED (two of them, see UPSTREAMS). The client can
//   never make this Worker fetch an arbitrary URL, so it cannot be abused as an
//   open proxy.
// - Only an exact allowlist of known PreCom endpoints is forwarded, each with
//   its exact HTTP method. Keep the ENDPOINTS maps in sync with src/api.js when
//   the web app grows a new feature.
// - Every /api endpoint (except password reset / token) requires a Bearer
//   header before we even contact PreCom — garbage traffic dies here.
// - Only Authorization and Content-Type are forwarded in either direction
//   (plus the response status/body). Cookies never pass through.
// - Completely stateless: no storage, no KV, and NO LOGGING of headers or
//   bodies — a token only exists inside the single request that carries it.
// - Browser-only by design: requests without an allowed Origin are rejected.
//   Non-browser clients don't need this proxy; they can hit PreCom directly.
//
// Two upstreams: the classic Mobile API, and the newer app.pre-com.nl API (a
// SEPARATE auth realm — its own token) that hosts the pager/provider endpoints
// the Mobile API lacks. The web app reaches the app realm by prefixing its
// request path with "/app" (e.g. POST /app/Token, GET /app/api/v2/Pager/...);
// the Worker strips that, routes to app.pre-com.nl, and checks the app
// allowlist. No prefix = Mobile API, exactly as before.
//
// Deploy: Cloudflare dashboard > Workers > Create > paste this file, or
// `npx wrangler deploy` from this directory. Stay on the FREE plan (hard
// request cap, no bill) and put 2FA on the Cloudflare account.

const UPSTREAMS = {
  mobile: 'https://pre-com.nl/Mobile',
  app: 'https://app.pre-com.nl',
};

// Origins allowed to use this proxy. Add 'http://localhost:8000' temporarily
// if you serve web/ locally during development (`npx serve web` etc.).
const ALLOWED_ORIGINS = [
  'https://svenkortekaas.github.io',
];

// --- Mobile API (no /app prefix) ---
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

// --- app.pre-com.nl API (reached via the /app prefix) ---
const APP_OPEN_ENDPOINTS = {
  '/Token': 'POST',
};
const APP_ENDPOINTS = {
  '/api/v2/Pager/GetPagerInfo': 'GET',
  '/api/v2/Information/GetProviderInformation': 'GET',
  '/api/v2/Group/GetAllServiceFunctions': 'GET',
  '/api/v2/PreComMessage/SendMessageToMyself': 'POST',
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

// Picks the upstream + allowlists for a request path. The "/app" prefix selects
// the app.pre-com.nl realm; the prefix is stripped so the allowlists and the
// forwarded URL both use the real PreCom path.
function route(pathname) {
  if (pathname === '/app' || pathname.startsWith('/app/')) {
    return {
      upstream: UPSTREAMS.app,
      path: pathname.slice('/app'.length) || '/',
      open: APP_OPEN_ENDPOINTS,
      endpoints: APP_ENDPOINTS,
    };
  }
  return {
    upstream: UPSTREAMS.mobile,
    path: pathname,
    open: OPEN_ENDPOINTS,
    endpoints: ENDPOINTS,
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      return deny(403, 'Origin not allowed.', null);
    }

    const url = new URL(request.url);
    const { upstream, path, open, endpoints } = route(url.pathname);
    const allowedMethod = open[path] || endpoints[path];
    const isOpen = Boolean(open[path]);

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
    if (!isOpen && !/^Bearer .+/.test(auth || '')) {
      return deny(401, 'Missing bearer token.', origin);
    }

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_BODY_BYTES) return deny(413, 'Body too large.', origin);

    const headers = new Headers();
    if (auth) headers.set('Authorization', auth);
    const contentType = request.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);

    const upstreamResponse = await fetch(upstream + path + url.search, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
    });

    const responseHeaders = new Headers(corsHeaders(origin));
    responseHeaders.set('X-Content-Type-Options', 'nosniff');
    const upstreamType = upstreamResponse.headers.get('Content-Type');
    if (upstreamType) responseHeaders.set('Content-Type', upstreamType);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  },
};
