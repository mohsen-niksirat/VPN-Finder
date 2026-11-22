import { db } from 'sdk';
import { and, eq, isNull } from 'sdk/db';
import { subTokens } from '../schema.js';
import {
  brandConfigUri,
  fetchConnection,
  fetchFreshServersPageForDelivery,
  getConfigValue,
  incrementCounter,
} from '../lib/pvl.js';

const SUB_PROTOCOLS = ['vless', 'vmess', 'shadowsocks', 'trojan', 'hysteria2'];
const MAX_PER_PROTOCOL = 6;
const MAX_TOTAL = 30;
const RATE_FLOOR_SEC = 60;
const LAST_USED_UPDATE_SEC = 600;

const lastAssemblyByToken = new Map();

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function getHeader(ctx, name) {
  const lower = name.toLowerCase();
  if (ctx?.headers && typeof ctx.headers === 'object') {
    for (const [k, v] of Object.entries(ctx.headers)) {
      if (k.toLowerCase() === lower) return String(v || '');
    }
  }
  if (ctx?.request?.headers?.get) {
    return String(ctx.request.headers.get(name) || '');
  }
  return '';
}

export default async function (input, ctx) {
  const expectedSecret = await getConfigValue('sub_worker_secret');
  const providedSecret = getHeader(ctx, 'x-sub-secret');
  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return { status: 401, error: 'unauthorized' };
  }

  const token = typeof input?.token === 'string' ? input.token.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{48}$/.test(token)) {
    return { status: 404, error: 'not_found' };
  }

  const row = await db
    .select()
    .from(subTokens)
    .where(and(eq(subTokens.token, token), isNull(subTokens.revokedAt)))
    .get();
  if (!row) {
    return { status: 404, error: 'not_found' };
  }

  const now = Math.floor(Date.now() / 1000);
  const lastRun = lastAssemblyByToken.get(token) || 0;
  if (now - lastRun < RATE_FLOOR_SEC) {
    return { status: 429, error: 'slow_down' };
  }
  lastAssemblyByToken.set(token, now);

  const uris = [];
  for (const proto of SUB_PROTOCOLS) {
    if (uris.length >= MAX_TOTAL) break;
    let pageRes;
    try {
      pageRes = await fetchFreshServersPageForDelivery({
        protocol: proto,
        country: '',
        sort: 'score',
        page: 1,
        perPage: 20,
      });
    } catch {
      continue;
    }
    const rows = Array.isArray(pageRes?.data) ? pageRes.data : [];
    let protoCount = 0;
    for (const srv of rows) {
      if (protoCount >= MAX_PER_PROTOCOL || uris.length >= MAX_TOTAL) break;
      if (!srv || !srv.id) continue;
      try {
        const conn = await fetchConnection(srv.id, row.userId, { bypassRateLimit: true });
        const rawUri = conn?.v2rayng_url || conn?.config_url || conn?.uri || null;
        if (!rawUri || typeof rawUri !== 'string') continue;
        const branded = brandConfigUri(rawUri, srv.country_code, proto);
        if (branded) {
          uris.push(branded);
          protoCount += 1;
        }
      } catch {
        // Skip failures silently
      }
    }
  }

  if (uris.length === 0) {
    return { status: 503, error: 'no_configs' };
  }

  if (!row.lastUsedAt || now - Number(row.lastUsedAt) > LAST_USED_UPDATE_SEC) {
    await db
      .update(subTokens)
      .set({ lastUsedAt: now })
      .where(eq(subTokens.id, row.id))
      .run();
  }
  await incrementCounter('subs_served', 1);

  return {
    status: 200,
    body: toBase64Utf8(uris.join('\n')),
  };
}
