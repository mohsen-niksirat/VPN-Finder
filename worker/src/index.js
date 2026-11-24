const PVL_BASE_URL = 'https://publicvpnlist.com/api/v1';
const SUB_PATH_RE = /^\/sub\/([a-f0-9]{48})$/;
const SUB_PROTOCOLS = ['hysteria2', 'vless', 'trojan', 'tuic', 'vmess', 'shadowsocks'];
const MAX_PVL_PER_PROTOCOL = 4;
const MAX_TOTAL = 200;
const RATE_FLOOR_MS = 60_000;

const VMESS_PREFIX = 'vmess' + '://';
const VLESS_PREFIX = 'vless' + '://';
const TROJAN_PREFIX = 'trojan' + '://';
const SS_PREFIX = 'ss' + '://';
const HY2_PREFIX = 'hysteria2' + '://';
const HY2_SHORT_PREFIX = 'hy2' + '://';
const TUIC_PREFIX = 'tuic' + '://';

const COMMUNITY_FEEDS = [
  {
    name: 'FilterbreakerSub',
    url: 'https://sub.seyedamirrezamohammadzadeh.workers.dev',
    base64: true,
    limit: 25,
    headers: { 'User-Agent': 'v2rayNG/1.8.23' },
  },
  {
    name: 'XrayCollector-VLESS',
    url: 'https://raw.githubusercontent.com/justVisiting992/xray-Config-Collector/main/vless_iran.txt',
    base64: false,
    limit: 30,
  },
  {
    name: 'XrayCollector-HY2',
    url: 'https://raw.githubusercontent.com/justVisiting992/xray-Config-Collector/main/hy2_iran.txt',
    base64: false,
    limit: 25,
  },
  {
    name: 'XrayCollector-Trojan',
    url: 'https://raw.githubusercontent.com/justVisiting992/xray-Config-Collector/main/trojan_iran.txt',
    base64: false,
    limit: 20,
  },
  {
    name: 'XrayCollector-VMess',
    url: 'https://raw.githubusercontent.com/justVisiting992/xray-Config-Collector/main/vmess_iran.txt',
    base64: false,
    limit: 15,
  },
  {
    name: 'F0rc3Run',
    url: 'https://raw.githubusercontent.com/F0rc3Run/F0rc3Run/refs/heads/main/Best-Results/proxies.txt',
    base64: false,
    limit: 35,
  },
  {
    name: 'mahdibland',
    url: 'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/Eternity',
    base64: true,
    limit: 25,
  },
  {
    name: 'Au1rxx',
    url: 'https://raw.githubusercontent.com/Au1rxx/free-vpn-subscriptions/main/output/v2ray-base64.txt',
    base64: true,
    limit: 30,
  },
  {
    name: 'UCIran-X',
    url: 'https://raw.githubusercontent.com/UCSubLink/UCIRANIR/refs/heads/main/output/X.txt',
    base64: false,
    limit: 35,
  },
  {
    name: 'UCIran-IR',
    url: 'https://raw.githubusercontent.com/UCIRANX/Vpn/refs/heads/main/Uciranir.txt',
    base64: false,
    limit: 45,
  },
  {
    name: 'UCIran',
    url: 'https://raw.githubusercontent.com/UCIRANX/Vpn/refs/heads/main/Uciran.txt',
    base64: false,
    limit: 20,
  },
];

const lastAssemblyByToken = new Map();

function plainText(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
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

function fromBase64Utf8(b64) {
  const clean = String(b64 || '').replace(/\s+/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function countryCodeToFlag(code) {
  if (!code || typeof code !== 'string' || !/^[A-Za-z]{2}$/.test(code)) {
    return '🌐';
  }
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    0x1f1e6 + (upper.charCodeAt(0) - 65),
    0x1f1e6 + (upper.charCodeAt(1) - 65)
  );
}

const NON_COUNTRY_CODES = new Set(['XX', 'WS', 'SS', 'IP', 'UP', 'OK', 'TX', 'RX', 'CF']);

function extractCountryFromText(text) {
  if (!text) return '';
  let decoded = String(text);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // keep raw
  }
  // Look for regional indicator pair (flag emoji)
  const chars = Array.from(decoded);
  for (let i = 0; i < chars.length - 1; i += 1) {
    const c1 = chars[i].codePointAt(0);
    const c2 = chars[i + 1].codePointAt(0);
    if (c1 >= 0x1f1e6 && c1 <= 0x1f1ff && c2 >= 0x1f1e6 && c2 <= 0x1f1ff) {
      return String.fromCharCode(65 + (c1 - 0x1f1e6), 65 + (c2 - 0x1f1e6));
    }
  }
  for (const m of decoded.matchAll(/\b([A-Z]{2})\b/g)) {
    if (!NON_COUNTRY_CODES.has(m[1])) return m[1];
  }
  return '';
}

function detectProtocol(uri) {
  if (uri.startsWith(VLESS_PREFIX)) return 'VLESS';
  if (uri.startsWith(VMESS_PREFIX)) return 'VMESS';
  if (uri.startsWith(TROJAN_PREFIX)) return 'TROJAN';
  if (uri.startsWith(SS_PREFIX)) return 'SS';
  if (uri.startsWith(HY2_PREFIX) || uri.startsWith(HY2_SHORT_PREFIX)) return 'HY2';
  if (uri.startsWith(TUIC_PREFIX)) return 'TUIC';
  return '';
}

function extractEndpointKey(uri) {
  if (uri.startsWith(VMESS_PREFIX)) {
    try {
      const json = JSON.parse(fromBase64Utf8(uri.slice(VMESS_PREFIX.length)));
      if (json?.add && json?.port) return `vmess:${json.add}:${json.port}`;
    } catch {
      return null;
    }
    return null;
  }
  const match = /^([a-z0-9]+):\/\/(?:[^@]+@)?(\[[^\]]+\]|[^/?#:]+):(\d+)/i.exec(uri);
  if (!match) return null;
  const scheme = match[1].toLowerCase() === 'hy2' ? 'hysteria2' : match[1].toLowerCase();
  return `${scheme}:${match[2].toLowerCase()}:${match[3]}`;
}

function brandConfigUri(uri, countryCode, protocolLabel) {
  const cc = countryCode && /^[A-Za-z]{2}$/.test(countryCode) ? countryCode.toUpperCase() : '';
  const flag = cc ? countryCodeToFlag(cc) : '🌐';
  const proto = String(protocolLabel || detectProtocol(uri) || 'VPN').toUpperCase();
  const remark = cc ? `${flag} @MyLeitner | ${cc} ${proto}` : `${flag} @MyLeitner | ${proto}`;

  if (uri.startsWith(VMESS_PREFIX)) {
    try {
      const json = JSON.parse(fromBase64Utf8(uri.slice(VMESS_PREFIX.length)));
      json.ps = remark;
      return `${VMESS_PREFIX}${toBase64Utf8(JSON.stringify(json))}`;
    } catch {
      return null;
    }
  }
  const hashIdx = uri.indexOf('#');
  const base = hashIdx === -1 ? uri : uri.slice(0, hashIdx);
  return `${base}#${encodeURIComponent(remark)}`;
}

async function fetchPvlConfigs(apiKey, filterCc) {
  if (!apiKey) return [];
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  const results = [];
  await Promise.allSettled(
    SUB_PROTOCOLS.map(async (proto) => {
      try {
        const ccParam = filterCc ? `&country=${encodeURIComponent(filterCc)}` : '';
        const listUrl =
          `${PVL_BASE_URL}/servers?protocol=${proto}&status=online&fresh_within=259200` +
          `&sort=score&order=desc&page=1&per_page=15${ccParam}` +
          `&fields=id,country_code,protocol,connection_info_url`;
        const res = await fetch(listUrl, { headers, signal: AbortSignal.timeout(6000) });
        if (!res.ok) return;
        const json = await res.json();
        const rows = Array.isArray(json?.data) ? json.data : [];
        let taken = 0;
        for (const srv of rows) {
          if (taken >= MAX_PVL_PER_PROTOCOL) break;
          if (!srv?.connection_info_url) continue;
          try {
            const cRes = await fetch(srv.connection_info_url, {
              headers,
              signal: AbortSignal.timeout(4000),
            });
            if (!cRes.ok) continue;
            const cJson = await cRes.json();
            const rawUri = cJson?.qr_payload || cJson?.config_url || cJson?.uri || null;
            if (!rawUri || typeof rawUri !== 'string' || rawUri.startsWith('v2rayng://')) continue;
            const cc = (srv.country_code || cJson?.country_code || filterCc || '').toUpperCase();
            results.push({ uri: rawUri.trim(), cc, proto: proto.toUpperCase() });
            taken += 1;
          } catch {
            // skip individual timeout/error
          }
        }
      } catch {
        // skip protocol failure
      }
    })
  );
  return results;
}

async function fetchCommunityFeed(feed, filterCc) {
  try {
    const res = await fetch(feed.url, {
      headers: feed.headers || {},
      cf: { cacheTtl: 180, cacheEverything: true },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    let body = await res.text();
    if (feed.base64) {
      try {
        body = fromBase64Utf8(body);
      } catch {
        return [];
      }
    }
    const lines = body.split(/\r?\n/);
    const out = [];
    for (const rawLine of lines) {
      if (out.length >= feed.limit) break;
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const proto = detectProtocol(line);
      if (!proto) continue;

      let cc = '';
      if (line.startsWith(VMESS_PREFIX)) {
        try {
          const json = JSON.parse(fromBase64Utf8(line.slice(VMESS_PREFIX.length)));
          cc = extractCountryFromText(json?.ps || '');
        } catch {
          continue;
        }
      } else {
        const hashIdx = line.indexOf('#');
        if (hashIdx !== -1) {
          cc = extractCountryFromText(line.slice(hashIdx + 1));
        }
      }
      if (filterCc && cc !== filterCc) continue;
      out.push({ uri: line, cc, proto });
    }
    return out;
  } catch {
    return [];
  }
}

const TLS_PORTS_RE = /:(?:443|8443|2053|2083|2087|2096)(?:[/?#]|$)/;
function scoreIranUri(uri, filterIsp = '') {
  const lower = uri.toLowerCase();
  if (lower.startsWith(HY2_PREFIX) || lower.startsWith(HY2_SHORT_PREFIX)) {
    return filterIsp === 'mci' ? 145 : filterIsp === 'irancell' ? 125 : 120;
  }
  if (lower.startsWith(TUIC_PREFIX)) {
    return filterIsp === 'mci' ? 130 : 105;
  }
  if (lower.startsWith(VLESS_PREFIX)) {
    let s = 40;
    if (lower.includes('security=reality')) s += filterIsp === 'mci' ? 95 : 80;
    else if (lower.includes('security=tls')) s += 45;
    if (/(?:type=ws|type=xhttp|type=splithttp|type=httpupgrade)/.test(lower)) {
      s += filterIsp === 'irancell' ? 50 : 30;
    } else if (lower.includes('type=grpc')) {
      s += filterIsp === 'mci' || filterIsp === 'tci' ? 45 : 30;
    }
    if (TLS_PORTS_RE.test(lower)) s += 20;
    if (lower.includes('security=none')) s -= 45;
    return s;
  }
  if (lower.startsWith(TROJAN_PREFIX)) {
    let s = filterIsp === 'tci' ? 80 : 60;
    if (/(?:type=ws|type=grpc)/.test(lower)) s += 25;
    if (TLS_PORTS_RE.test(lower)) s += 15;
    return s;
  }
  if (lower.startsWith(VMESS_PREFIX)) {
    try {
      const json = JSON.parse(fromBase64Utf8(uri.slice(VMESS_PREFIX.length)));
      let s = 30;
      if (json?.tls === 'tls') s += 35;
      if (json?.net === 'ws' || json?.net === 'grpc') s += filterIsp === 'irancell' ? 40 : 25;
      if ([443, 8443, 2053, 2083, 2087, 2096].includes(Number(json?.port))) s += 15;
      return s;
    } catch {
      return 10;
    }
  }
  if (lower.startsWith(SS_PREFIX)) return 20;
  return 0;
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET') {
      return plainText('Method not allowed', 405);
    }

    const url = new URL(request.url);
    if (url.pathname === '/ovpn') {
      const ccFilter = (url.searchParams.get('cc') || '').trim().toUpperCase();
      const limit = Math.min(15, Math.max(1, Number(url.searchParams.get('limit') || 8)));
      try {
        const res = await fetch('https://www.vpngate.net/api/iphone/', {
          cf: { cacheTtl: 300, cacheEverything: true },
        });
        if (!res.ok) return Response.json({ servers: [] }, { status: 502 });
        const text = await res.text();
        const rows = [];
        for (const line of text.split(/\r?\n/)) {
          if (!line || line.startsWith('*') || line.startsWith('#')) continue;
          const cols = line.split(',');
          if (cols.length < 15) continue;
          const cc = String(cols[6] || '').trim().toUpperCase();
          if (ccFilter && ccFilter !== 'ALL' && cc !== ccFilter) continue;
          const ovpnB64 = String(cols[14] || '').trim();
          if (!ovpnB64) continue;
          rows.push({
            id: `vpngate_${cols[1] || rows.length}`,
            country_code: cc || 'XX',
            country_name: String(cols[5] || cc).trim(),
            exit_ip: String(cols[1] || '').trim(),
            score: Number(cols[2] || 0) || 0,
            latency_ms: Number(cols[3] || 0) || null,
            speed_mbps: Number(cols[4] || 0) > 0 ? Number((Number(cols[4]) / 1e6).toFixed(1)) : null,
            ovpn_b64: ovpnB64,
          });
        }
        rows.sort((a, b) => b.score - a.score);
        return Response.json(
          { servers: rows.slice(0, limit) },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      } catch {
        return Response.json({ servers: [] }, { status: 502 });
      }
    }

    if (url.pathname === '/pool') {
      const summaryMode = url.searchParams.get('summary') === '1';
      const rawProto = (url.searchParams.get('proto') || '').trim().toLowerCase();
      const rawCc = (url.searchParams.get('cc') || '').trim().toUpperCase();
      const filterCc = /^[A-Z]{2}$/.test(rawCc) ? rawCc : '';
      const limit = Math.min(40, Math.max(1, Number(url.searchParams.get('limit') || 25)));
      const batches = await Promise.all(COMMUNITY_FEEDS.map((f) => fetchCommunityFeed(f, filterCc)));
      const all = [];
      for (const b of batches) all.push(...b);

      if (summaryMode) {
        const counts = { vless: 0, hysteria2: 0, trojan: 0, vmess: 0, shadowsocks: 0, tuic: 0 };
        const seenSum = new Set();
        for (const item of all) {
          const dk = extractEndpointKey(item.uri);
          if (!dk || seenSum.has(dk)) continue;
          seenSum.add(dk);
          const p = item.proto.toLowerCase();
          const norm = p === 'hy2' ? 'hysteria2' : p === 'ss' ? 'shadowsocks' : p;
          if (norm in counts) counts[norm] += 1;
        }
        return Response.json({ counts }, { headers: { 'Cache-Control': 'no-store' } });
      }

      const normProto = rawProto === 'hysteria2' ? 'HY2' : rawProto === 'shadowsocks' ? 'SS' : rawProto.toUpperCase();
      const filtered = normProto ? all.filter((x) => x.proto === normProto) : all;
      filtered.sort((a, b) => scoreIranUri(b.uri) - scoreIranUri(a.uri));
      const seenPool = new Set();
      const servers = [];
      for (const item of filtered) {
        if (servers.length >= limit) break;
        const dk = extractEndpointKey(item.uri);
        if (!dk || seenPool.has(dk)) continue;
        const branded = brandConfigUri(item.uri, item.cc, item.proto);
        if (!branded) continue;
        seenPool.add(dk);
        servers.push({
          id: `pool_${dk.replace(/[^a-z0-9]/gi, '_')}`.slice(0, 48),
          country_code: item.cc || '',
          protocol: rawProto || item.proto.toLowerCase(),
          uri: branded,
        });
      }
      return Response.json({ total: servers.length, servers }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const match = SUB_PATH_RE.exec(url.pathname);
    if (!match) {
      return plainText('Not found', 404);
    }

    const rawCc = (url.searchParams.get('cc') || url.searchParams.get('country') || '').trim().toUpperCase();
    const filterCc = /^[A-Z]{2}$/.test(rawCc) ? rawCc : '';
    const rawIsp = (url.searchParams.get('isp') || '').trim().toLowerCase();
    const filterIsp = ['mci', 'irancell', 'tci'].includes(rawIsp) ? rawIsp : '';

    const token = match[1];
    const rateKey = `${token}:${filterCc || 'ALL'}:${filterIsp || 'ALL'}`;
    const now = Date.now();
    const lastRun = lastAssemblyByToken.get(rateKey) || 0;
    if (now - lastRun < RATE_FLOOR_MS) {
      return plainText('Slow down', 429);
    }
    lastAssemblyByToken.set(rateKey, now);

    const apiKey = env?.PVL_API_KEY || '';
    const [pvlItems, ...feedBatches] = await Promise.all([
      fetchPvlConfigs(apiKey, filterCc),
      ...COMMUNITY_FEEDS.map((f) => fetchCommunityFeed(f, filterCc)),
    ]);

    const combined = [...pvlItems];
    for (const batch of feedBatches) {
      combined.push(...batch);
    }

    combined.sort((a, b) => scoreIranUri(b.uri, filterIsp) - scoreIranUri(a.uri, filterIsp));

    const seen = new Set();
    const finalUris = [];
    for (const item of combined) {
      if (finalUris.length >= MAX_TOTAL) break;
      const dedupKey = extractEndpointKey(item.uri);
      if (!dedupKey || seen.has(dedupKey)) continue;
      const branded = brandConfigUri(item.uri, item.cc, item.proto);
      if (!branded) continue;
      seen.add(dedupKey);
      finalUris.push(branded);
    }

    if (finalUris.length === 0) {
      return plainText('No configs available', 503);
    }

    const titleParts = [];
    if (filterCc) titleParts.push(filterCc);
    if (filterIsp) titleParts.push(filterIsp.toUpperCase());
    const title = titleParts.length
      ? `VPN Finder (${titleParts.join(' · ')}) @MyLeitner`
      : 'VPN Finder @MyLeitner';
    return plainText(toBase64Utf8(finalUris.join('\n')), 200, {
      'Profile-Title': `base64:${toBase64Utf8(title)}`,
      'Profile-Update-Interval': '6',
      'Subscription-Userinfo': 'upload=0; download=0; total=0; expire=0',
    });
  },
};
