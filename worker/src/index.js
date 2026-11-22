const PVL_BASE_URL = 'https://publicvpnlist.com/api/v1';
const SUB_PATH_RE = /^\/sub\/([a-f0-9]{48})$/;
const SUB_PROTOCOLS = ['vless', 'vmess', 'shadowsocks', 'trojan', 'hysteria2'];
const MAX_PER_PROTOCOL = 6;
const MAX_TOTAL = 30;
const RATE_FLOOR_MS = 60_000;

const lastAssemblyByToken = new Map();

function plainText(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function brandConfigUri(uri, countryCode, protocol) {
  const cc = (countryCode || 'XX').toUpperCase();
  const protoLabel = String(protocol || '').toUpperCase();
  const remark = `@MyLeitner | ${cc} ${protoLabel}`;
  if (uri.startsWith('vmess://')) {
    try {
      const b64 = uri.slice('vmess://'.length);
      const json = JSON.parse(atob(b64));
      json.ps = remark;
      return `vmess://${toBase64Utf8(JSON.stringify(json))}`;
    } catch {
      return uri;
    }
  }
  const hashIdx = uri.indexOf('#');
  const base = hashIdx === -1 ? uri : uri.slice(0, hashIdx);
  return `${base}#${encodeURIComponent(remark)}`;
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET') {
      return plainText('Method not allowed', 405);
    }

    const url = new URL(request.url);
    const match = SUB_PATH_RE.exec(url.pathname);
    if (!match) {
      return plainText('Not found', 404);
    }

    const token = match[1];
    const now = Date.now();
    const lastRun = lastAssemblyByToken.get(token) || 0;
    if (now - lastRun < RATE_FLOOR_MS) {
      return plainText('Slow down', 429);
    }
    lastAssemblyByToken.set(token, now);

    const apiKey = env?.PVL_API_KEY || '';
    if (!apiKey) {
      return plainText('Service unavailable', 503);
    }

    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    const uris = [];
    for (const proto of SUB_PROTOCOLS) {
      if (uris.length >= MAX_TOTAL) break;
      let rows = [];
      try {
        const listUrl = `${PVL_BASE_URL}/servers?protocol=${proto}&status=online&fresh_within=259200&sort=score&order=desc&page=1&per_page=20`;
        const res = await fetch(listUrl, { headers });
        if (!res.ok) continue;
        const json = await res.json();
        rows = Array.isArray(json?.data) ? json.data : [];
      } catch {
        continue;
      }

      let protoCount = 0;
      for (const srv of rows) {
        if (protoCount >= MAX_PER_PROTOCOL || uris.length >= MAX_TOTAL) break;
        if (!srv || !srv.id) continue;
        let rawUri = typeof srv.v2rayng_url === 'string' && srv.v2rayng_url ? srv.v2rayng_url : null;
        if (!rawUri && srv.connection_info_url) {
          try {
            const cRes = await fetch(srv.connection_info_url, { headers });
            if (cRes.ok) {
              const cJson = await cRes.json();
              rawUri = cJson?.v2rayng_url || cJson?.config_url || cJson?.uri || null;
            }
          } catch {
            continue;
          }
        }
        if (!rawUri || typeof rawUri !== 'string') continue;
        uris.push(brandConfigUri(rawUri, srv.country_code, proto));
        protoCount += 1;
      }
    }

    if (uris.length === 0) {
      return plainText('No configs available', 503);
    }

    return plainText(toBase64Utf8(uris.join('\n')), 200);
  },
};
