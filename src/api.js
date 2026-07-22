const DEFAULT_BASE_URL = 'https://pre-com.nl/Mobile';

class PreComError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'PreComError';
    this.status = status;
    this.body = body;
  }
}

class PreComClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, token } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  // OAuth2 Resource Owner Password Credentials grant against POST {baseUrl}/Token
  async login(username, password) {
    const res = await fetch(`${this.baseUrl}/Token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', username, password }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data.error_description || data.error || `Login failed (HTTP ${res.status})`;
      throw new PreComError(message, res.status, data);
    }
    this.token = data.access_token;
    return data; // { access_token, token_type, expires_in, userName, .issued, .expires }
  }

  async request(method, path, { query, body } = {}) {
    if (!this.token) {
      throw new PreComError('Not authenticated. Run "precomcli login" first.', 401);
    }
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) qs.set(key, value);
      }
      const qsStr = qs.toString();
      if (qsStr) url += `?${qsStr}`;
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
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
      const message = (data && data.Message) || `Request failed (HTTP ${res.status})`;
      throw new PreComError(message, res.status, data);
    }
    return data;
  }

  getUserInfo() {
    return this.request('GET', '/api/User/GetUserInfo');
  }

  getAllUserGroups() {
    return this.request('GET', '/api/Group/GetAllUserGroups');
  }

  getAllGroups() {
    return this.request('GET', '/api/Group/GetAllGroups');
  }

  // Returns { "<isoDate>": level, ... }; positive = enough, negative = short, 0 = exact.
  getOccupancyLevels(groupID, from, to) {
    return this.request('GET', '/api/Group/GetOccupancyLevels', { query: { groupID, from, to } });
  }

  logoutRemote() {
    return this.request('POST', '/api/Account/Logout');
  }

  // Returns [{ Type, ID, Label }, ...] covering users, groups, and message groups.
  getReceivers() {
    return this.request('GET', '/api/Msg/GetReceivers');
  }
}

module.exports = { PreComClient, PreComError, DEFAULT_BASE_URL };
