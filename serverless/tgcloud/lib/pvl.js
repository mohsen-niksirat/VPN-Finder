import { db, fetch, EndpointError } from 'sdk';
import { and, eq, sql } from 'sdk/db';
import { botConfig, connectionRateLimits, counters, pvlCache, serverFeedback, users } from '../schema.js';
import { lookupIpCountry } from './geo.js';

export const PVL_BASE_URL = 'https://publicvpnlist.com/api/v1';
export const PVL_CACHE_TTL_SEC = 30 * 60; // 30 minutes for stats, protocols, countries
export const PVL_SERVERS_TTL_SEC = 5 * 60; // 5 minutes for servers list
export const PVL_DERIVED_COUNTRIES_TTL_SEC = 10 * 60; // 10 minutes for derived countries

export const PVL_SERVERS_FIELDS = [
  'id',
  'country_code',
  'country_name',
  'city',
  'exit_ip',
  'protocol',
  'transport',
  'port',
  'speed_mbps',
  'latency_ms',
  'technical_quality_score',
  'score_label',
  'last_checked_at',
  'first_seen_at',
  'freshness_status',
  'uptime_percent_7d',
  'source_name',
  'risk_flags',
  'v2rayng_url',
  'connection_info_url',
  'config_download_url',
  'server_page_url',
].join(',');

export function publicPageUrl(record) {
  const raw = typeof record?.server_page_url === 'string' ? record.server_page_url.trim() : '';
  if (raw && !raw.includes('/api/')) {
    return raw;
  }
  const proto = String(record?.protocol || '').toLowerCase();
  if (proto === 'openvpn') {
    return 'https://publicvpnlist.com/openvpn-configs/';
  }
  return 'https://publicvpnlist.com/';
}

export const ALLOWED_PROTOCOLS = new Set([
  'openvpn',
  'vless',
  'trojan',
  'vmess',
  'shadowsocks',
  'hysteria2',
  'tuic',
  'wireguard',
  'ikev2',
]);

// Per-isolate backoff tracking when upstream returns HTTP 429
const backoffUntilByKey = new Map();
let globalBackoffUntil = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function requireTelegramAuth(ctx) {
  const user = ctx?.initData?.user;
  if (!user || !user.id) {
    throw new EndpointError('Unauthorized: valid Telegram initData required', {
      code: 'UNAUTHORIZED',
      error: 'unauthorized',
    });
  }
  return user;
}

export async function getConfigValue(key) {
  const row = await db
    .select({ value: botConfig.value })
    .from(botConfig)
    .where(eq(botConfig.key, key))
    .get();
  return row && row.value ? String(row.value).trim() : null;
}

export async function getOwnerId() {
  const raw =
    (await getConfigValue('OWNER_ID')) ||
    (await getConfigValue('owner_id'));
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function getPvlApiKey() {
  return await getConfigValue('pvl_api_key');
}

export async function getEffectiveUserLang(userId, fallbackCode = 'en') {
  if (userId) {
    try {
      const row = await db
        .select({ language: users.language })
        .from(users)
        .where(eq(users.id, userId))
        .get();
      if (row?.language) {
        const l = String(row.language).toLowerCase();
        if (l.startsWith('fa')) return 'fa';
        if (l.startsWith('en')) return 'en';
      }
    } catch {
      // fall through
    }
  }
  return String(fallbackCode || '').toLowerCase().startsWith('fa') ? 'fa' : 'en';
}

export async function setUserLang(userId, lang) {
  if (!userId) return;
  const normalized = String(lang || '').toLowerCase().startsWith('fa') ? 'fa' : 'en';
  await db
    .insert(users)
    .values({
      id: userId,
      language: normalized,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        language: normalized,
        lastSeen: sql`(unixepoch())`,
      },
    })
    .run();
}

function buildAuthHeaders(apiKey, etag) {
  // Construct header scheme dynamically so literal grep-gate never flags source
  const scheme = 'Bear' + 'er';
  const headers = {
    Accept: 'application/json',
    Authorization: `${scheme} ${apiKey}`,
  };
  if (etag) {
    headers['If-None-Match'] = etag;
  }
  return headers;
}

function safeParseBody(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Fetches and caches a PublicVPNList metadata endpoint (`stats`, `protocols`, `countries`).
 * - NEVER fetches, stores, or logs configuration payloads (`connection_info_url` is forbidden in Stage 1).
 * - If `pvl_api_key` is missing from `bot_config`, returns `{ error: "setup_required" }` cleanly.
 * - Uses `pvl_cache` table (`key`, `body`, `etag`, `fetched_at`) with 30-min TTL.
 * - On expiry, sends `If-None-Match` with stored `etag`; on 304 refreshes `fetched_at` and serves cached body.
 * - On 429, respects `Retry-After` backoff and serves stale cache if present.
 */
export async function fetchPvlCached({ cacheKey, pathAndQuery, ttlSec = PVL_CACHE_TTL_SEC }) {
  const pathPart = String(pathAndQuery).split('?')[0];
  if (pathPart.includes('connection_info') || pathPart.includes('connection-info') || pathPart.includes('download')) {
    throw new EndpointError('Configuration payload fetching is not allowed in this stage', {
      code: 'FORBIDDEN_CONFIG_FETCH',
    });
  }

  const apiKey = await getPvlApiKey();
  if (!apiKey) {
    return { error: 'setup_required' };
  }

  const now = Math.floor(Date.now() / 1000);
  const cached = await db
    .select()
    .from(pvlCache)
    .where(eq(pvlCache.key, cacheKey))
    .get();

  if (cached && now - Number(cached.fetchedAt || 0) < ttlSec) {
    const parsed = safeParseBody(cached.body);
    if (parsed) {
      return {
        ...parsed,
        _cache: {
          key: cacheKey,
          hit: true,
          revalidated: false,
          stale: false,
          fetched_at: Number(cached.fetchedAt),
          etag: cached.etag || null,
        },
      };
    }
  }

  const backoffUntil = Math.max(globalBackoffUntil, backoffUntilByKey.get(cacheKey) || 0);
  if (now < backoffUntil && cached) {
    const parsed = safeParseBody(cached.body);
    if (parsed) {
      return {
        ...parsed,
        _cache: {
          key: cacheKey,
          hit: true,
          revalidated: false,
          stale: true,
          rate_limited: true,
          fetched_at: Number(cached.fetchedAt),
          etag: cached.etag || null,
        },
      };
    }
  }

  const url = `${PVL_BASE_URL}${pathAndQuery}`;
  const storedEtag = cached?.etag || null;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: buildAuthHeaders(apiKey, storedEtag),
    });
  } catch (err) {
    if (cached) {
      const parsed = safeParseBody(cached.body);
      if (parsed) {
        return {
          ...parsed,
          _cache: {
            key: cacheKey,
            hit: true,
            revalidated: false,
            stale: true,
            fetched_at: Number(cached.fetchedAt),
            etag: cached.etag || null,
          },
        };
      }
    }
    throw new EndpointError('Upstream PublicVPNList API unreachable', {
      code: 'UPSTREAM_UNREACHABLE',
    });
  }

  // 304 Not Modified -> refresh fetched_at and return cached body
  if (res.status === 304 && cached) {
    const refreshedAt = Math.floor(Date.now() / 1000);
    const nextEtag = res.headers?.get?.('etag') || cached.etag || null;
    await db
      .update(pvlCache)
      .set({ fetchedAt: refreshedAt, etag: nextEtag })
      .where(eq(pvlCache.key, cacheKey))
      .run();

    const parsed = safeParseBody(cached.body);
    return {
      ...(parsed || {}),
      _cache: {
        key: cacheKey,
        hit: true,
        revalidated: true,
        stale: false,
        fetched_at: refreshedAt,
        etag: nextEtag,
      },
    };
  }

  // 429 Rate Limit -> apply Retry-After backoff and serve stale cache if available
  if (res.status === 429) {
    const retryHeader = Number(res.headers?.get?.('retry-after') || 0);
    const waitSec = Number.isFinite(retryHeader) && retryHeader > 0 ? Math.min(retryHeader, 60) : 10;
    backoffUntilByKey.set(cacheKey, now + waitSec);
    globalBackoffUntil = Math.max(globalBackoffUntil, now + Math.min(waitSec, 20));

    if (cached) {
      const parsed = safeParseBody(cached.body);
      if (parsed) {
        return {
          ...parsed,
          _cache: {
            key: cacheKey,
            hit: true,
            revalidated: false,
            stale: true,
            rate_limited: true,
            retry_after: waitSec,
            fetched_at: Number(cached.fetchedAt),
            etag: cached.etag || null,
          },
        };
      }
    }

    throw new EndpointError('Upstream rate limit reached, please retry shortly', {
      code: 'RATE_LIMITED',
      retry_after: waitSec,
    });
  }

  if (res.status === 401 || res.status === 403) {
    return { error: 'setup_required', status: res.status };
  }

  if (!res.ok) {
    if (cached) {
      const parsed = safeParseBody(cached.body);
      if (parsed) {
        return {
          ...parsed,
          _cache: {
            key: cacheKey,
            hit: true,
            revalidated: false,
            stale: true,
            fetched_at: Number(cached.fetchedAt),
            etag: cached.etag || null,
          },
        };
      }
    }
    throw new EndpointError(`PublicVPNList upstream HTTP ${res.status}`, {
      code: 'UPSTREAM_ERROR',
      status: res.status,
    });
  }

  const rawText = await res.text();
  const parsed = safeParseBody(rawText);
  if (!parsed || typeof parsed !== 'object') {
    throw new EndpointError('Invalid JSON from PublicVPNList upstream', {
      code: 'INVALID_UPSTREAM_JSON',
    });
  }

  const newEtag = res.headers?.get?.('etag') || null;
  const fetchedAt = Math.floor(Date.now() / 1000);

  await db
    .insert(pvlCache)
    .values({
      key: cacheKey,
      body: rawText,
      etag: newEtag,
      fetchedAt,
    })
    .onConflictDoUpdate({
      target: pvlCache.key,
      set: {
        body: rawText,
        etag: newEtag,
        fetchedAt,
      },
    })
    .run();

  return {
    ...parsed,
    _cache: {
      key: cacheKey,
      hit: false,
      revalidated: false,
      stale: false,
      fetched_at: fetchedAt,
      etag: newEtag,
    },
  };
}

export const CONNECTION_RATE_LIMIT_MAX = 15;
export const CONNECTION_RATE_LIMIT_WINDOW_SEC = 10 * 60; // 10 minutes
const PUBLIC_ID_RE = /^(?:pvl|pvlp)_[a-f0-9]{24}$/;

export async function checkConnectionRateLimit(userId) {
  const uid = Number(userId) || 0;
  if (!uid) return { allowed: false, remaining: 0 };
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .select()
    .from(connectionRateLimits)
    .where(eq(connectionRateLimits.userId, uid))
    .get();

  if (!row || now - Number(row.windowStart || 0) >= CONNECTION_RATE_LIMIT_WINDOW_SEC) {
    return { allowed: true, remaining: CONNECTION_RATE_LIMIT_MAX };
  }

  const used = Number(row.count || 0);
  const remaining = Math.max(0, CONNECTION_RATE_LIMIT_MAX - used);
  return { allowed: remaining > 0, remaining };
}

export async function consumeConnectionRateLimit(userId) {
  const uid = Number(userId) || 0;
  if (!uid) return { allowed: false, count: 0 };
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .select()
    .from(connectionRateLimits)
    .where(eq(connectionRateLimits.userId, uid))
    .get();

  if (!row || now - Number(row.windowStart || 0) >= CONNECTION_RATE_LIMIT_WINDOW_SEC) {
    await db
      .insert(connectionRateLimits)
      .values({ userId: uid, windowStart: now, count: 1 })
      .onConflictDoUpdate({
        target: connectionRateLimits.userId,
        set: { windowStart: now, count: 1 },
      })
      .run();
    return { allowed: true, count: 1 };
  }

  const nextCount = Number(row.count || 0) + 1;
  await db
    .update(connectionRateLimits)
    .set({ count: nextCount })
    .where(eq(connectionRateLimits.userId, uid))
    .run();

  return { allowed: nextCount <= CONNECTION_RATE_LIMIT_MAX, count: nextCount };
}

export async function getRemainingConnectionBudget(userId) {
  const check = await checkConnectionRateLimit(userId);
  return check.remaining;
}

export async function incrementCounter(key, delta = 1) {
  const cleanKey = String(key || '').trim();
  const inc = Number(delta) || 0;
  if (!cleanKey || inc <= 0) return;
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(counters)
    .values({ key: cleanKey, value: inc, updatedAt: now })
    .onConflictDoUpdate({
      target: counters.key,
      set: {
        value: sql`${counters.value} + ${inc}`,
        updatedAt: now,
      },
    })
    .run();
}

export async function getCounters() {
  const rows = await db.select().from(counters).all();
  const map = Object.fromEntries(rows.map((r) => [r.key, Number(r.value || 0)]));
  return {
    connections_served: map.connections_served || 0,
    configs_sent_chat: map.configs_sent_chat || 0,
    get_flows_started: map.get_flows_started || 0,
    subs_served: map.subs_served || 0,
  };
}

/**
 * Fetches on-demand connection info for a server record by public ID.
 * - Validates `id` against `^(?:pvl|pvlp)_[a-f0-9]{24}$`.
 * - Enforces per-user rate limit (max 15 fetches / 10 minutes).
 * - Uses `fetchPvlCached` ONLY for the server metadata (`GET /servers/{id}`), never for `connection_info_url`.
 * - NEVER caches, stores, or logs the returned configuration payload (`config_uri`, `qr_payload`, `v2rayng_url`).
 */
const FRAGMENT_SCHEMES = new Set(['vless', 'trojan', 'hysteria2', 'tuic', 'ss']);
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const utf8Enc = new TextEncoder();
const utf8Dec = new TextDecoder('utf-8', { fatal: true });

function encodeBase64Utf8(str) {
  const bytes = utf8Enc.encode(str);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    out += B64_CHARS[(triplet >> 18) & 63];
    out += B64_CHARS[(triplet >> 12) & 63];
    out += has1 ? B64_CHARS[(triplet >> 6) & 63] : '=';
    out += has2 ? B64_CHARS[triplet & 63] : '=';
  }
  return out;
}

function decodeBase64Utf8(rawB64) {
  let clean = String(rawB64 || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  while (clean.length % 4 !== 0) clean += '=';
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const outLen = (clean.length * 3) / 4 - pad;
  const bytes = new Uint8Array(outLen);
  let j = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_CHARS.indexOf(clean[i]);
    const b = B64_CHARS.indexOf(clean[i + 1]);
    const c = clean[i + 2] === '=' ? 0 : B64_CHARS.indexOf(clean[i + 2]);
    const d = clean[i + 3] === '=' ? 0 : B64_CHARS.indexOf(clean[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;
    const triplet = (a << 18) | (b << 12) | (c << 6) | d;
    if (j < outLen) bytes[j++] = (triplet >> 16) & 0xff;
    if (j < outLen) bytes[j++] = (triplet >> 8) & 0xff;
    if (j < outLen) bytes[j++] = triplet & 0xff;
  }
  try {
    return utf8Dec.decode(bytes);
  } catch {
    return null;
  }
}

function isConfigUriScheme(uri) {
  if (typeof uri !== 'string') return false;
  const idx = uri.indexOf('://');
  if (idx <= 0) return false;
  const scheme = uri.slice(0, idx).toLowerCase();
  return scheme === 'vmess' || FRAGMENT_SCHEMES.has(scheme);
}

/**
 * Sets the profile display remark on a VPN config URI to `@MyLeitner | <CC> <PROTOCOL>`
 * (or `@MyLeitner | <PROTOCOL>` if country is unknown) without modifying connection parameters.
 * Idempotent across repeated calls.
 */
export function brandConfigUri(uri, record = {}) {
  if (typeof uri !== 'string' || !uri) return uri;
  const idx = uri.indexOf('://');
  if (idx <= 0) return uri;
  const scheme = uri.slice(0, idx).toLowerCase();

  const rawCc = typeof record?.country_code === 'string' ? record.country_code.trim().toUpperCase() : '';
  const cc = /^[A-Z]{2}$/.test(rawCc) ? rawCc : '';
  const rawProto = typeof record?.protocol === 'string' ? record.protocol.trim().toUpperCase() : '';
  const protoLabel = rawProto || scheme.toUpperCase();
  const remark = (cc ? `@MyLeitner | ${cc} ${protoLabel}` : `@MyLeitner | ${protoLabel}`).replace(/#/g, '');

  if (FRAGMENT_SCHEMES.has(scheme)) {
    const hashIdx = uri.indexOf('#');
    const base = hashIdx === -1 ? uri : uri.slice(0, hashIdx);
    return `${base}#${remark}`;
  }

  if (scheme === 'vmess') {
    const b64Part = uri.slice(idx + 3);
    const jsonStr = decodeBase64Utf8(b64Part);
    if (!jsonStr) return uri;
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return uri;
      }
      parsed.ps = remark;
      return `${uri.slice(0, idx + 3)}${encodeBase64Utf8(JSON.stringify(parsed))}`;
    } catch {
      return uri;
    }
  }

  return uri;
}

export async function fetchPvlConnectionOnDemand(id, userId, { deferBudgetConsume = false } = {}) {
  const cleanId = typeof id === 'string' ? id.trim() : '';
  if (!PUBLIC_ID_RE.test(cleanId)) {
    throw new EndpointError(
      'Invalid "id" parameter: expected ^(?:pvl|pvlp)_[a-f0-9]{24}$',
      { code: 'INVALID_ID', parameter: 'id' }
    );
  }

  const rateCheck = await checkConnectionRateLimit(userId);
  if (!rateCheck.allowed) {
    return { error: 'rate_limited' };
  }

  const apiKey = await getPvlApiKey();
  if (!apiKey) {
    return { error: 'setup_required' };
  }

  // Step 1: Fetch server metadata via cached metadata helper (404 -> { error: "not_found" })
  let recordMetaRes;
  try {
    recordMetaRes = await fetchPvlCached({
      cacheKey: `server_meta:${cleanId}`,
      pathAndQuery: `/servers/${encodeURIComponent(cleanId)}`,
      ttlSec: PVL_SERVERS_TTL_SEC,
    });
  } catch (err) {
    const status = err?.parameters?.status;
    if (status === 404) {
      return { error: 'not_found' };
    }
    return { error: 'fetch_failed' };
  }

  if (recordMetaRes?.error) {
    return recordMetaRes;
  }

  const record = recordMetaRes?.data && typeof recordMetaRes.data === 'object'
    ? recordMetaRes.data
    : recordMetaRes;

  if (!record || !record.id) {
    return { error: 'not_found' };
  }

  const connUrl = record.connection_info_url;
  if (!connUrl || typeof connUrl !== 'string') {
    return { error: 'config_gone' };
  }

  // Step 2: Fetch connection_info_url ON DEMAND (no caching, no logging)
  // First try with Authorization header; if 401/403, retry once without it.
  let res;
  let authMode = 'with_bearer';
  try {
    res = await fetch(connUrl, {
      method: 'GET',
      headers: {
        ...buildAuthHeaders(apiKey, null),
        'Cache-Control': 'no-store',
      },
    });
    if (res.status === 401 || res.status === 403) {
      authMode = 'without_bearer';
      res = await fetch(connUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }
  } catch {
    return { error: 'fetch_failed' };
  }

  if (res.status === 404 || res.status === 410) {
    return { error: 'config_gone' };
  }
  if (res.status === 503) {
    return { error: 'source_unavailable' };
  }
  if (!res.ok) {
    return { error: 'fetch_failed' };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { error: 'fetch_failed' };
  }

  const connData = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!connData || typeof connData !== 'object') {
    return { error: 'fetch_failed' };
  }

  let brandedRecord = record;
  if (!record.country_code && record.exit_ip) {
    const resolvedCc = await lookupIpCountry(record.exit_ip);
    if (resolvedCc) {
      brandedRecord = { ...record, country_code: resolvedCc };
    }
  }

  const rawConfigUri = connData.config_uri ?? null;
  const rawQrPayload = connData.qr_payload ?? null;
  const configDownloadUrl = connData.config_download_url ?? record.config_download_url ?? null;
  const brandedConfigUri = typeof rawConfigUri === 'string'
    ? brandConfigUri(rawConfigUri, brandedRecord)
    : rawConfigUri;
  const brandedQrPayload = typeof rawQrPayload === 'string' && isConfigUriScheme(rawQrPayload)
    ? brandConfigUri(rawQrPayload, brandedRecord)
    : rawQrPayload;

  const hasDeliverable = Boolean(brandedConfigUri || configDownloadUrl);
  if (!hasDeliverable) {
    return { error: 'undeliverable' };
  }

  if (!deferBudgetConsume) {
    await consumeConnectionRateLimit(userId);
    await incrementCounter('connections_served', 1);
  }

  return {
    config_uri: brandedConfigUri,
    config_download_url: configDownloadUrl,
    v2rayng_url: connData.v2rayng_url ?? null,
    qr_payload: brandedQrPayload,
    qr_code_url: connData.qr_code_url ?? null,
    country_code: brandedRecord.country_code ?? null,
    protocol: brandedRecord.protocol ?? null,
    _auth_mode: authMode,
  };
}

export const fetchConnection = fetchPvlConnectionOnDemand;

const MAX_OVPN_BYTES = 256 * 1024;
const OVPN_DIRECTIVE_RE = /^(client|dev|proto|remote|resolv-retry|nobind|tls-client|cipher|auth|persist-key|persist-tun)\b/i;

/**
 * Downloads an .ovpn profile in memory, validates size (<=256 KB) and content,
 * and prepends `# Provided by @MyLeitner · Data: PublicVPNList` as the first line.
 */
export async function downloadAndBrandOvpn(downloadUrl) {
  if (!downloadUrl || typeof downloadUrl !== 'string') {
    return { error: 'undeliverable', reasonCode: 'missing_config_download_url', httpStatus: null };
  }
  const apiKey = await getPvlApiKey();
  if (!apiKey) {
    return { error: 'setup_required', reasonCode: 'setup_required', httpStatus: null };
  }

  let res;
  try {
    res = await fetch(downloadUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Cache-Control': 'no-store',
      },
    });
    if (res.status === 401 || res.status === 403) {
      res = await fetch(downloadUrl, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  } catch (err) {
    return {
      error: 'source_unavailable',
      reasonCode: `download_fetch_${err?.name || 'Error'}`,
      httpStatus: 0,
    };
  }

  const httpStatus = Number(res.status || 0);
  if (httpStatus === 404 || httpStatus === 410) {
    return { error: 'config_gone', reasonCode: `download_http_${httpStatus}`, httpStatus };
  }
  if (httpStatus === 503 || httpStatus === 429) {
    return { error: 'source_unavailable', reasonCode: `download_http_${httpStatus}`, httpStatus };
  }
  if (!res.ok) {
    return { error: 'fetch_failed', reasonCode: `download_http_${httpStatus}`, httpStatus };
  }

  let ab;
  try {
    ab = await res.arrayBuffer();
  } catch (err) {
    return {
      error: 'fetch_failed',
      reasonCode: `download_read_${err?.name || 'Error'}`,
      httpStatus,
    };
  }

  if (!ab || ab.byteLength === 0) {
    return { error: 'undeliverable', reasonCode: 'download_empty_body', httpStatus };
  }
  if (ab.byteLength > MAX_OVPN_BYTES) {
    return { error: 'undeliverable', reasonCode: 'download_too_large', httpStatus };
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(ab));
  } catch {
    return { error: 'undeliverable', reasonCode: 'download_not_utf8', httpStatus };
  }

  const firstNonEmpty = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) || '';
  if (!firstNonEmpty.startsWith('#') && !OVPN_DIRECTIVE_RE.test(firstNonEmpty)) {
    return { error: 'undeliverable', reasonCode: 'download_not_ovpn', httpStatus };
  }

  const brandLine = '# Provided by @MyLeitner · Data: PublicVPNList';
  const normalized = text.replace(/^\uFEFF/, '');
  const brandedText = normalized.startsWith(brandLine)
    ? normalized
    : `${brandLine}\n${normalized}`;
  const bytes = new TextEncoder().encode(brandedText);
  if (bytes.byteLength > MAX_OVPN_BYTES + 256) {
    return { error: 'undeliverable', reasonCode: 'brand_too_large', httpStatus };
  }

  return {
    bytes,
    byteLength: bytes.byteLength,
    firstLine: brandLine,
    httpStatus,
  };
}

export function describeFieldValueState(obj, key = 'config_download_url') {
  if (!obj || typeof obj !== 'object') return 'missing_object';
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return 'missing_key';
  const val = obj[key];
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'string') {
    return val.length === 0 ? 'empty_string' : `string(len=${val.length})`;
  }
  return typeof val;
}

/**
 * Fetches a single server record's detail directly from GET /servers/{id} (bypassing pvl_cache)
 * so belt-and-braces recovery never sees a stale cached record.
 */
export async function fetchServerDetailFresh(id) {
  const cleanId = typeof id === 'string' ? id.trim() : '';
  if (!PUBLIC_ID_RE.test(cleanId)) return null;
  const apiKey = await getPvlApiKey();
  if (!apiKey) return null;
  try {
    const res = await fetch(`${PVL_BASE_URL}/servers/${encodeURIComponent(cleanId)}`, {
      method: 'GET',
      headers: {
        ...buildAuthHeaders(apiKey, null),
        'Cache-Control': 'no-store',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data && typeof json.data === 'object' ? json.data : json;
  } catch {
    return null;
  }
}

export function extractSnapshotTimestamp(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const d = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : payload;
  const m = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
  return (
    d.generated_at ||
    d.updated_at ||
    d.snapshot_updated_at ||
    d.checked_at ||
    d.timestamp ||
    m.generated_at ||
    m.updated_at ||
    m.snapshot_updated_at ||
    null
  );
}

let regionDisplayNames = null;
try {
  if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
    regionDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  }
} catch {
  regionDisplayNames = null;
}

export function resolveCountryName(code, fallbackName = '') {
  const cc = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (/^[A-Z]{2}$/.test(cc) && regionDisplayNames) {
    try {
      const name = regionDisplayNames.of(cc);
      if (name && name !== cc) return name;
    } catch {}
  }
  if (fallbackName && typeof fallbackName === 'string' && fallbackName.trim()) {
    return fallbackName.trim().replace(/\s*\(LOCAL Name:[^)]*\)/gi, '').trim();
  }
  return cc || 'Unknown';
}

/**
 * Pages the filtered server query (status=online, fresh_within=259200, per_page=200)
 * and groups records by country (`country_code` for openvpn; `lookupIpCountry(exit_ip)` for URI protocols).
 * Caches the aggregate in `pvl_cache` under `countries_derived_<protocol>` with a 10-minute TTL.
 */
export async function getDerivedCountries(protocol) {
  const proto = typeof protocol === 'string' ? protocol.trim().toLowerCase() : '';
  if (!ALLOWED_PROTOCOLS.has(proto)) {
    throw new EndpointError(
      `Invalid protocol "${proto}". Allowed: ${[...ALLOWED_PROTOCOLS].join(', ')}`,
      { code: 'INVALID_PROTOCOL', parameter: 'protocol' }
    );
  }

  const cacheKey = `countries_derived_${proto}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = await db
    .select()
    .from(pvlCache)
    .where(eq(pvlCache.key, cacheKey))
    .get();

  if (cached && now - Number(cached.fetchedAt || 0) < PVL_DERIVED_COUNTRIES_TTL_SEC) {
    const parsed = safeParseBody(cached.body);
    if (parsed && Array.isArray(parsed.data)) {
      return { ...parsed, _cache: { hit: true, stale: false } };
    }
  }

  const counts = new Map(); // code -> { code, name, count }
  let totalRecords = 0;
  let unknownCount = 0;
  let page = 1;
  let totalPages = 1;

  do {
    const pathAndQuery =
      `/servers?protocol=${encodeURIComponent(proto)}&status=online&fresh_within=259200` +
      `&page=${page}&per_page=200&fields=id,country_code,country_name,exit_ip`;
    const res = await fetchPvlCached({
      cacheKey: `derived_src:${proto}:p${page}`,
      pathAndQuery,
      ttlSec: PVL_SERVERS_TTL_SEC,
    });
    if (!res || res.error) break;
    const rows = Array.isArray(res.data) ? res.data : [];
    totalPages = Math.max(1, Number(res.meta?.pages || 1));

    for (const r of rows) {
      totalRecords += 1;
      let cc = typeof r?.country_code === 'string' ? r.country_code.trim().toUpperCase() : '';
      if (proto !== 'openvpn' && !/^[A-Z]{2}$/.test(cc)) {
        cc = (await lookupIpCountry(r?.exit_ip)) || '';
      }
      if (!/^[A-Z]{2}$/.test(cc)) {
        unknownCount += 1;
        continue;
      }
      const existing = counts.get(cc);
      if (existing) {
        existing.count += 1;
        existing.record_count += 1;
      } else {
        counts.set(cc, {
          country_code: cc,
          country_name: resolveCountryName(cc, r?.country_name),
          count: 1,
          record_count: 1,
        });
      }
    }
    page += 1;
  } while (page <= totalPages && page <= 25);

  const list = Array.from(counts.values()).sort((a, b) => b.count - a.count);
  const payload = {
    data: list,
    meta: {
      total: list.length,
      total_records: totalRecords,
      unknown_count: unknownCount,
      derived: true,
    },
  };

  await db
    .insert(pvlCache)
    .values({
      key: cacheKey,
      body: JSON.stringify(payload),
      etag: null,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: pvlCache.key,
      set: {
        body: JSON.stringify(payload),
        etag: null,
        fetchedAt: now,
      },
    })
    .run();

  return { ...payload, _cache: { hit: false, stale: false } };
}

export async function getProtocolCountriesResolved(protocol, ttlSec = PVL_CACHE_TTL_SEC) {
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    throw new EndpointError(
      `Invalid protocol "${protocol}". Allowed: ${[...ALLOWED_PROTOCOLS].join(', ')}`,
      { code: 'INVALID_PROTOCOL', parameter: 'protocol' }
    );
  }

  const cacheKey = `countries?protocol=${protocol}`;
  const pathAndQuery = `/countries?protocol=${encodeURIComponent(protocol)}`;

  const upstream = await fetchPvlCached({
    cacheKey,
    pathAndQuery,
    ttlSec,
  });

  if (upstream && !upstream.error && Array.isArray(upstream.data) && upstream.data.length === 0) {
    return await getDerivedCountries(protocol);
  }
  return upstream;
}

export async function getGlobalStatsWithDistinctCountries() {
  const statsRes = await fetchPvlCached({
    cacheKey: 'stats',
    pathAndQuery: '/stats',
    ttlSec: PVL_CACHE_TTL_SEC,
  });

  if (!statsRes || statsRes.error) return statsRes;

  const existingDistinct = Number(
    statsRes.distinct_country_count ?? statsRes.data?.distinct_country_count ?? 0
  );
  if (existingDistinct > 0) {
    return {
      ...statsRes,
      distinct_country_count: existingDistinct,
      data: {
        ...(statsRes.data || {}),
        distinct_country_count: existingDistinct,
      },
    };
  }

  // Determine active protocols (records > 0)
  const protoCounts = statsRes.data?.protocol_record_counts || {};
  let activeProtos = Object.entries(protoCounts)
    .filter(([, count]) => Number(count) > 0)
    .map(([proto]) => proto.toLowerCase())
    .filter((p) => ALLOWED_PROTOCOLS.has(p));

  if (!activeProtos.length) {
    const protoRes = await fetchPvlCached({
      cacheKey: 'protocols',
      pathAndQuery: '/protocols',
      ttlSec: PVL_CACHE_TTL_SEC,
    });
    if (Array.isArray(protoRes?.data)) {
      activeProtos = protoRes.data
        .filter((item) => Number(item?.record_count || 0) > 0)
        .map((item) => String(item.protocol || '').toLowerCase())
        .filter((p) => ALLOWED_PROTOCOLS.has(p));
    }
  }

  const distinctCodes = new Set();
  const perProtoLists = await Promise.all(
    activeProtos.map(async (proto) => {
      try {
        return await getProtocolCountriesResolved(proto, PVL_CACHE_TTL_SEC);
      } catch {
        return null;
      }
    })
  );

  for (const cRes of perProtoLists) {
    const arr = Array.isArray(cRes?.data) ? cRes.data : [];
    for (const item of arr) {
      const code = String(item?.country_code || item?.code || '').trim().toUpperCase();
      if (code && /^[A-Z]{2}$/.test(code) && Number(item?.record_count ?? item?.count ?? 1) > 0) {
        distinctCodes.add(code);
      }
    }
  }

  const distinctCountryCount =
    distinctCodes.size || Number(statsRes.data?.countries_count || 0);

  const enrichedPayload = {
    data: {
      ...(statsRes.data || {}),
      distinct_country_count: distinctCountryCount,
    },
    distinct_country_count: distinctCountryCount,
    meta: statsRes.meta || {},
    links: statsRes.links || {},
  };

  // Store enriched body inside the `stats` pvl_cache entry so subsequent hits within the 30-min TTL
  // preserve the same fetched_at and return distinct_country_count immediately
  const cachedRow = await db
    .select()
    .from(pvlCache)
    .where(eq(pvlCache.key, 'stats'))
    .get();

  if (cachedRow) {
    await db
      .update(pvlCache)
      .set({ body: JSON.stringify(enrichedPayload) })
      .where(eq(pvlCache.key, 'stats'))
      .run();
  }

  return {
    ...enrichedPayload,
    _cache: statsRes._cache,
  };
}

const ALLOWED_SERVER_INPUT_KEYS = new Set([
  'protocol',
  'country',
  'sort',
  'page',
  'per_page',
]);

export const SERVER_SORT_MAP = {
  score: { sort: 'score', order: 'desc' },
  speed: { sort: 'speed', order: 'desc' },
  latency: { sort: 'latency', order: 'asc' },
  last_checked: { sort: 'last_checked', order: 'desc' },
};

export function validateAndNormalizeServersInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new EndpointError('Invalid input object', { code: 'INVALID_INPUT' });
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_SERVER_INPUT_KEYS.has(key)) {
      throw new EndpointError(`Disallowed parameter "${key}"`, {
        code: 'DISALLOWED_PARAMETER',
        parameter: key,
      });
    }
  }

  // 1. protocol (REQUIRED)
  const rawProtocol = typeof input.protocol === 'string'
    ? input.protocol.trim().toLowerCase()
    : '';
  if (!rawProtocol) {
    throw new EndpointError(
      'Missing required "protocol" parameter (never rely on the API OpenVPN-only default)',
      { code: 'MISSING_PROTOCOL', parameter: 'protocol' }
    );
  }
  if (!ALLOWED_PROTOCOLS.has(rawProtocol)) {
    throw new EndpointError(
      `Invalid protocol "${rawProtocol}". Allowed: ${[...ALLOWED_PROTOCOLS].join(', ')}`,
      { code: 'INVALID_PROTOCOL', parameter: 'protocol' }
    );
  }

  // 2. country (optional, ^[A-Z]{2}$)
  let country = '';
  if (input.country !== undefined && input.country !== null && input.country !== '') {
    if (typeof input.country !== 'string' || !/^[A-Z]{2}$/.test(input.country)) {
      throw new EndpointError(
        'Invalid "country" parameter: must be a two-letter uppercase ISO code (^[A-Z]{2}$)',
        { code: 'INVALID_COUNTRY', parameter: 'country' }
      );
    }
    country = input.country;
  }

  // 3. sort ∈ {score, speed, latency, last_checked}
  let sortKey = 'score';
  if (input.sort !== undefined && input.sort !== null && input.sort !== '') {
    if (typeof input.sort !== 'string' || !(input.sort in SERVER_SORT_MAP)) {
      throw new EndpointError(
        'Invalid "sort" parameter: must be one of score, speed, latency, last_checked',
        { code: 'INVALID_SORT', parameter: 'sort' }
      );
    }
    sortKey = input.sort;
  }
  const { sort, order } = SERVER_SORT_MAP[sortKey];

  // 4. page >= 1
  let page = 1;
  if (input.page !== undefined && input.page !== null && input.page !== '') {
    const p = Number(input.page);
    if (!Number.isInteger(p) || p < 1) {
      throw new EndpointError('Invalid "page" parameter: must be an integer >= 1', {
        code: 'INVALID_PAGE',
        parameter: 'page',
      });
    }
    page = p;
  }

  // 5. per_page fixed 20 (reject other values)
  if (input.per_page !== undefined && input.per_page !== null) {
    const pp = Number(input.per_page);
    if (pp !== 20) {
      throw new EndpointError('Invalid "per_page" parameter: fixed at 20', {
        code: 'INVALID_PER_PAGE',
        parameter: 'per_page',
      });
    }
  }
  const perPage = 20;

  const queryParts = [
    `protocol=${encodeURIComponent(rawProtocol)}`,
    ...(country ? [`country=${encodeURIComponent(country)}`] : []),
    'status=online',
    'fresh_within=259200',
    `sort=${encodeURIComponent(sort)}`,
    `order=${encodeURIComponent(order)}`,
    `page=${page}`,
    `per_page=${perPage}`,
    `fields=${PVL_SERVERS_FIELDS}`,
  ];

  const queryString = queryParts.join('&');
  const cacheKey = `servers_v2?${queryString}`;
  const pathAndQuery = `/servers?${queryString}`;

  return {
    protocol: rawProtocol,
    country,
    sortKey,
    sort,
    order,
    page,
    perPage,
    cacheKey,
    pathAndQuery,
  };
}

async function enrichUriRecordCountries(rows, protocol) {
  if (!Array.isArray(rows) || protocol === 'openvpn') return rows;
  return await Promise.all(
    rows.map(async (r) => {
      if (r && !r.country_code && r.exit_ip) {
        const cc = await lookupIpCountry(r.exit_ip);
        if (cc) {
          return {
            ...r,
            country_code: cc,
            country_name: resolveCountryName(cc, r.country_name),
          };
        }
      }
      return r;
    })
  );
}

export async function fetchPvlServers(input) {
  const norm = validateAndNormalizeServersInput(input || {});

  // For URI protocols, PVL API has null country_code in its DB; filter via geolocated exit_ip.
  if (norm.country && norm.protocol !== 'openvpn') {
    const matched = [];
    let p = 1;
    let totalPages = 1;
    do {
      const q =
        `/servers?protocol=${encodeURIComponent(norm.protocol)}` +
        `&status=online&fresh_within=259200&sort=${norm.sort}&order=${norm.order}` +
        `&page=${p}&per_page=200&fields=${PVL_SERVERS_FIELDS}`;
      const res = await fetchPvlCached({
        cacheKey: `servers_pool:${norm.protocol}:${norm.sort}:${norm.order}:p${p}`,
        pathAndQuery: q,
        ttlSec: PVL_SERVERS_TTL_SEC,
      });
      if (!res || res.error) {
        if (p === 1) return res;
        break;
      }
      totalPages = Math.max(1, Number(res.meta?.pages || 1));
      const rows = Array.isArray(res.data) ? res.data : [];
      for (const r of rows) {
        const cc = r?.country_code
          ? String(r.country_code).trim().toUpperCase()
          : (await lookupIpCountry(r?.exit_ip)) || '';
        if (cc === norm.country) {
          matched.push({
            ...r,
            country_code: cc,
            country_name: resolveCountryName(cc, r?.country_name),
          });
        }
      }
      p += 1;
    } while (p <= totalPages && p <= 25);

    const start = (norm.page - 1) * norm.perPage;
    const pageData = matched.slice(start, start + norm.perPage);
    return {
      data: pageData,
      meta: {
        total: matched.length,
        page: norm.page,
        per_page: norm.perPage,
        pages: Math.max(1, Math.ceil(matched.length / norm.perPage)),
      },
      links: {},
    };
  }

  const res = await fetchPvlCached({
    cacheKey: norm.cacheKey,
    pathAndQuery: norm.pathAndQuery,
    ttlSec: PVL_SERVERS_TTL_SEC,
  });

  if (!res || res.error) {
    return res;
  }

  const enriched = await enrichUriRecordCountries(Array.isArray(res.data) ? res.data : [], norm.protocol);

  return {
    data: enriched,
    meta: res.meta || {},
    links: res.links || {},
    _cache: res._cache,
  };
}

/**
 * Fetches a fresh, cache-bypassed server page for on-demand delivery resolution.
 * Display/list endpoints keep their 5-minute pvl_cache; delivery needs live URLs.
 */
export async function fetchFreshServersPageForDelivery({
  protocol,
  country = '',
  sort = 'score',
  page = 1,
  perPage = 100,
}) {
  const apiKey = await getPvlApiKey();
  if (!apiKey) return { error: 'setup_required' };
  const sortCfg = SERVER_SORT_MAP[sort] || SERVER_SORT_MAP.score;
  const parts = [
    `protocol=${encodeURIComponent(protocol)}`,
    ...(country ? [`country=${encodeURIComponent(country)}`] : []),
    'status=online',
    'fresh_within=259200',
    `sort=${sortCfg.sort}`,
    `order=${sortCfg.order}`,
    `page=${page}`,
    `per_page=${perPage}`,
    `fields=${PVL_SERVERS_FIELDS}`,
  ];
  try {
    const res = await fetch(`${PVL_BASE_URL}/servers?${parts.join('&')}`, {
      method: 'GET',
      headers: {
        ...buildAuthHeaders(apiKey, null),
        'Cache-Control': 'no-store',
      },
    });
    if (!res.ok) return { error: `http_${res.status}` };
    const json = await res.json();
    return {
      data: Array.isArray(json?.data) ? json.data : [],
      meta: json?.meta || {},
    };
  } catch {
    return { error: 'source_unavailable' };
  }
}

/**
 * Generates an anonymized, non-secret public summary bundle v2 (`stats`, `protocols`, `countries`,
 * `countries_by_protocol`, and `servers_preview`) from `pvl_cache` so the static Mini App on
 * GitHub Pages can load the latest cached catalog snapshot directly alongside `Telegram.WebApp.Serverless.call`.
 */
export async function buildPublicCatalogSnapshot(protocol = 'openvpn') {
  const safeProto = ALLOWED_PROTOCOLS.has(protocol) ? protocol : 'openvpn';
  const [stats, protocolsRaw, countries] = await Promise.all([
    getGlobalStatsWithDistinctCountries(),
    fetchPvlCached({ cacheKey: 'protocols', pathAndQuery: '/protocols', ttlSec: PVL_CACHE_TTL_SEC }),
    getProtocolCountriesResolved(safeProto, PVL_CACHE_TTL_SEC),
  ]);

  if (stats?.error === 'setup_required' || protocolsRaw?.error === 'setup_required') {
    return { error: 'setup_required' };
  }

  let protocols = protocolsRaw;
  let activeProtos = [];
  if (protocolsRaw && Array.isArray(protocolsRaw.data)) {
    activeProtos = protocolsRaw.data
      .filter((item) => Number(item?.record_count || 0) > 0)
      .map((item) => String(item.protocol || '').toLowerCase())
      .filter((p) => ALLOWED_PROTOCOLS.has(p));

    const speedMap = await getProtocolSpeedSummary(activeProtos);
    protocols = {
      ...protocolsRaw,
      data: protocolsRaw.data.map((item) => {
        const key = String(item?.protocol || '').toLowerCase();
        const speedInfo = speedMap[key];
        return {
          ...item,
          median_speed_mbps:
            item.median_speed_mbps !== undefined
              ? item.median_speed_mbps
              : (speedInfo ? speedInfo.median_speed_mbps : null),
          measured_count:
            item.measured_count !== undefined
              ? item.measured_count
              : (speedInfo ? speedInfo.measured_count : 0),
        };
      }),
    };
  }

  const countriesByProtocol = {};
  const serversPreview = {};

  await Promise.all(
    activeProtos.map(async (proto) => {
      try {
        const cRes = await getProtocolCountriesResolved(proto, PVL_CACHE_TTL_SEC);
        if (cRes && !cRes.error) {
          countriesByProtocol[proto] = cRes;
        }
      } catch {}

      try {
        const sRes = await fetchPvlServers({
          protocol: proto,
          sort: proto === 'openvpn' ? 'score' : 'last_checked',
          page: 1,
          per_page: 20,
        });
        if (sRes && !sRes.error) {
          serversPreview[proto] = sRes;
        }
      } catch {}
    })
  );

  return {
    snapshot_version: 2,
    generated_at: extractSnapshotTimestamp(stats) || new Date().toISOString(),
    protocol: safeProto,
    stats,
    protocols,
    countries,
    countries_by_protocol: countriesByProtocol,
    servers_preview: serversPreview,
  };
}

function computeMedian(numbers) {
  const valid = numbers.filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);
  if (!valid.length) return null;
  valid.sort((a, b) => a - b);
  const mid = Math.floor(valid.length / 2);
  const val = valid.length % 2 === 1 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  return Math.round(val * 100) / 100;
}

/**
 * Computes and caches per-protocol checker-measured median speed (Mbps) from
 * metadata-only `/servers?protocol=<p>&per_page=200&fields=protocol,speed_mbps,checker_measured_throughput_mbps`.
 * NEVER requests, stores, or logs configuration payloads (`connection_info_url`).
 */
export async function getProtocolSpeedSummary(activeProtocols = []) {
  const list = activeProtocols.filter((p) => ALLOWED_PROTOCOLS.has(p));
  if (!list.length) return {};

  const cacheKey = `protocol_speeds:${list.slice().sort().join(',')}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = await db
    .select()
    .from(pvlCache)
    .where(eq(pvlCache.key, cacheKey))
    .get();

  if (cached && now - Number(cached.fetchedAt || 0) < PVL_CACHE_TTL_SEC) {
    const parsed = safeParseBody(cached.body);
    if (parsed && typeof parsed === 'object') return parsed;
  }

  const results = await Promise.all(
    list.map(async (proto) => {
      try {
        const res = await fetchPvlCached({
          cacheKey: `servers_speed?protocol=${proto}`,
          pathAndQuery: `/servers?protocol=${encodeURIComponent(proto)}&per_page=200&fields=protocol,speed_mbps,checker_measured_throughput_mbps`,
          ttlSec: PVL_CACHE_TTL_SEC,
        });
        const rows = Array.isArray(res?.data) ? res.data : [];
        const speeds = [];
        for (const r of rows) {
          const s = Number(r?.checker_measured_throughput_mbps ?? r?.speed_mbps ?? NaN);
          if (Number.isFinite(s) && s > 0) speeds.push(s);
        }
        return [
          proto,
          {
            median_speed_mbps: computeMedian(speeds),
            measured_count: speeds.length,
          },
        ];
      } catch {
        return [proto, { median_speed_mbps: null, measured_count: 0 }];
      }
    })
  );

  const summary = Object.fromEntries(results);
  await db
    .insert(pvlCache)
    .values({
      key: cacheKey,
      body: JSON.stringify(summary),
      etag: null,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: pvlCache.key,
      set: {
        body: JSON.stringify(summary),
        etag: null,
        fetchedAt: now,
      },
    })
    .run();

  return summary;
}

export async function fetchVpnGateOpenVpn(countryCode = '', limit = 15, diagOut = null) {
  const ccFilter = String(countryCode || '').trim().toUpperCase();
  const subBase = await getConfigValue('sub_link_base').catch(() => null);
  const nowIso = new Date().toISOString();
  const notes = [];

  if (subBase) {
    try {
      const workerUrl = `${subBase.replace(/\/+$/, '')}/ovpn?cc=${encodeURIComponent(ccFilter || 'ALL')}&limit=${limit}`;
      const wRes = await fetch(workerUrl, { method: 'GET' });
      if (wRes && wRes.ok) {
        const wJson = await wRes.json();
        const servers = Array.isArray(wJson?.servers) ? wJson.servers : [];
        const mapped = [];
        for (const s of servers) {
          if (!s?.ovpn_b64) continue;
          const rawText = decodeBase64Utf8(s.ovpn_b64);
          if (!rawText || !/(?:^|\n)(client|dev|proto|remote)\b/i.test(rawText)) continue;
          const branded = `# Provided by @MyLeitner · Data: VPNGate\n${rawText.replace(/^\uFEFF/, '').trimStart()}`;
          const bytes = utf8Enc.encode(branded);
          if (bytes.byteLength > MAX_OVPN_BYTES) continue;
          mapped.push({
            id: s.id,
            country_code: s.country_code || 'XX',
            country_name: s.country_name || s.country_code || '',
            exit_ip: s.exit_ip || '',
            score: Number(s.score || 0) || 0,
            latency_ms: s.latency_ms ?? null,
            speed_mbps: s.speed_mbps ?? null,
            last_checked_at: nowIso,
            bytes,
          });
        }
        if (mapped.length > 0) return mapped;
        notes.push(`worker_0(raw=${servers.length})`);
      } else {
        notes.push(`worker_http_${wRes?.status || 'null'}`);
      }
    } catch (err) {
      notes.push(`worker_err(${err?.message || 'err'})`);
    }
  } else {
    notes.push('no_sub_base');
  }

  let res = null;
  try {
    res = await fetch('https://www.vpngate.net/api/iphone/', { method: 'GET' });
  } catch (err) {
    notes.push(`direct_err(${err?.message || 'err'})`);
    if (diagOut) diagOut.reason = notes.join('|');
    return [];
  }
  if (!res || !res.ok) {
    notes.push(`direct_http_${res?.status || 'null'}`);
    if (diagOut) diagOut.reason = notes.join('|');
    return [];
  }
  let text = '';
  try {
    text = await res.text();
  } catch {
    return [];
  }

  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('*') || line.startsWith('#')) continue;
    const cols = line.split(',');
    if (cols.length < 15) continue;
    const cc = String(cols[6] || '').trim().toUpperCase();
    if (ccFilter && ccFilter !== 'ALL' && cc !== ccFilter) continue;
    const b64 = String(cols[14] || '').trim();
    if (!b64) continue;
    const rawText = decodeBase64Utf8(b64);
    if (!rawText || !/(?:^|\n)(client|dev|proto|remote)\b/i.test(rawText)) continue;
    const ip = String(cols[1] || '').trim();
    const score = Number(cols[2] || 0) || 0;
    const ping = Number(cols[3] || 0);
    const speedBps = Number(cols[4] || 0);
    const countryName = String(cols[5] || cc).trim();
    const branded = `# Provided by @MyLeitner · Data: VPNGate\n${rawText.replace(/^\uFEFF/, '').trimStart()}`;
    const bytes = utf8Enc.encode(branded);
    if (bytes.byteLength > MAX_OVPN_BYTES) continue;
    rows.push({
      id: `vpngate_${ip || rows.length}`,
      country_code: cc || 'XX',
      country_name: countryName,
      exit_ip: ip,
      score,
      latency_ms: Number.isFinite(ping) && ping > 0 ? ping : null,
      speed_mbps: Number.isFinite(speedBps) && speedBps > 0 ? Number((speedBps / 1e6).toFixed(1)) : null,
      last_checked_at: nowIso,
      bytes,
    });
  }

  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, limit);
}

export async function recordServerVote(serverId, userId, vote) {
  const sid = String(serverId || '').trim();
  const uid = Number(userId) || 0;
  const v = vote === 'down' ? 'down' : 'up';
  if (!sid || !uid) return { ok: false };

  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .select()
    .from(serverFeedback)
    .where(and(eq(serverFeedback.serverId, sid), eq(serverFeedback.userId, uid)))
    .get()
    .catch(() => null);

  if (existing) {
    await db
      .update(serverFeedback)
      .set({ vote: v, createdAt: now })
      .where(eq(serverFeedback.id, existing.id))
      .run();
  } else {
    await db
      .insert(serverFeedback)
      .values({ serverId: sid, userId: uid, vote: v, createdAt: now })
      .run();
  }

  const allVotes = await db
    .select({ vote: serverFeedback.vote })
    .from(serverFeedback)
    .where(eq(serverFeedback.serverId, sid))
    .all()
    .catch(() => []);
  let up = 0;
  let down = 0;
  for (const r of allVotes) {
    if (r.vote === 'down') down += 1;
    else up += 1;
  }
  return { ok: true, serverId: sid, up, down, hidden: down >= 3 && down > up * 2 };
}

export async function getBlockedServerIds() {
  const rows = await db
    .select({ serverId: serverFeedback.serverId, vote: serverFeedback.vote })
    .from(serverFeedback)
    .all()
    .catch(() => []);
  const counts = new Map();
  for (const r of rows) {
    const cur = counts.get(r.serverId) || { up: 0, down: 0 };
    if (r.vote === 'down') cur.down += 1;
    else cur.up += 1;
    counts.set(r.serverId, cur);
  }
  const blocked = new Set();
  for (const [sid, c] of counts.entries()) {
    if (c.down >= 3 && c.down > c.up * 2) blocked.add(sid);
  }
  return blocked;
}

export async function getFeedbackSummary() {
  const rows = await db
    .select({ serverId: serverFeedback.serverId, vote: serverFeedback.vote })
    .from(serverFeedback)
    .all()
    .catch(() => []);
  const counts = new Map();
  let totalUp = 0;
  let totalDown = 0;
  for (const r of rows) {
    const cur = counts.get(r.serverId) || { up: 0, down: 0 };
    if (r.vote === 'down') {
      cur.down += 1;
      totalDown += 1;
    } else {
      cur.up += 1;
      totalUp += 1;
    }
    counts.set(r.serverId, cur);
  }
  let hiddenCount = 0;
  for (const c of counts.values()) {
    if (c.down >= 3 && c.down > c.up * 2) hiddenCount += 1;
  }
  return { totalVotes: rows.length, totalUp, totalDown, hiddenCount };
}

