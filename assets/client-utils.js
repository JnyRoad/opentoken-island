// Factory that returns the three shared client helpers for each island HTML view.
// Each view passes its own layer name and optional apiBase so all logging, auth,
// and fetch calls stay consistent without duplicating code across files.
(function () {
  window.createIslandClient = function ({ layer, apiBase } = {}) {
    const base = apiBase || '/api';
    let _token = '';

    function tokenHeaders(extra) {
      const h = extra ? { ...extra } : {};
      if (_token) h['x-opentoken-island-token'] = _token;
      return h;
    }

    async function loadClientConfig() {
      const response = await fetch(base + '/client-config');
      const data = await response.json();
      _token = data.apiToken || '';
      return _token;
    }

    function logClientEvent(event, details) {
      if (!_token) return Promise.resolve(false);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), 1500) : null;
      return fetch(base + '/logs/event', {
        method: 'POST',
        headers: tokenHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ layer: layer || 'client', event, flow: event, details: details || {} }),
        keepalive: true,
        signal: controller ? controller.signal : undefined,
      })
        .then(() => true)
        .catch(() => false)
        .finally(() => { if (timeout) clearTimeout(timeout); });
    }

    function getToken() { return _token; }

    return { loadClientConfig, logClientEvent, tokenHeaders, getToken };
  };
})();
