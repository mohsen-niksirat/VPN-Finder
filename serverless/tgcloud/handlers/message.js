import { db, api, fetch } from 'sdk';
import { desc, eq, sql } from 'sdk/db';
import { deliveryDebug, users, pvlCache } from '../schema.js';
import {
  ALLOWED_PROTOCOLS,
  describeFieldValueState,
  extractSnapshotTimestamp,
  fetchPvlServers,
  fetchServerDetailFresh,
  getCounters,
  getOwnerId,
  getPvlApiKey,
  PVL_BASE_URL,
  PVL_CACHE_TTL_SEC,
  validateAndNormalizeServersInput,
} from '../lib/pvl.js';
import { startGetFlow } from '../lib/getFlow.js';
import {
  appPromptText,
  buildAppKeyboard,
  fallbackText,
  helpText,
  welcomeText,
} from '../lib/texts.js';

function parseCommand(text) {
  if (!text || !text.startsWith('/')) return null;
  const parts = text.trim().split(/\s+/);
  const head = parts[0].slice(1);
  const atIdx = head.indexOf('@');
  const cmd = (atIdx === -1 ? head : head.slice(0, atIdx)).toLowerCase();
  const param = parts[1] || '';
  return { cmd, param };
}

async function upsertUser(from, startParam) {
  if (!from || !from.id) return;
  await db
    .insert(users)
    .values({
      id: from.id,
      language: from.language_code || null,
      startParam: startParam || null,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        language: from.language_code || null,
        lastSeen: sql`(unixepoch())`,
        startParam: startParam || null,
      },
    })
    .run();
}

async function formatOwnerStats() {
  const totalUsers = await db.$count(users);
  const apiKey = await getPvlApiKey();
  const cacheRows = await db
    .select()
    .from(pvlCache)
    .orderBy(desc(pvlCache.fetchedAt))
    .all();

  const now = Math.floor(Date.now() / 1000);
  let lastSnapshotTime = 'N/A';

  for (const row of cacheRows) {
    if (row.key === 'stats' || row.key === 'protocols') {
      try {
        const parsed = JSON.parse(row.body);
        const snap = extractSnapshotTimestamp(parsed);
        if (snap) {
          lastSnapshotTime = String(snap);
          break;
        }
      } catch {}
    }
  }

  if (lastSnapshotTime === 'N/A' && cacheRows.length > 0) {
    const latestFetch = Number(cacheRows[0].fetchedAt || 0);
    if (latestFetch > 0) {
      lastSnapshotTime = new Date(latestFetch * 1000).toISOString();
    }
  }

  const counters = await getCounters();
  const lines = [
    'VPN Finder: Owner Stats',
    '',
    `Total users: ${totalUsers}`,
    `Connections served: ${counters.connections_served}`,
    `Configs sent in chat: ${counters.configs_sent_chat}`,
    `Get flows started: ${counters.get_flows_started}`,
    `PVL API key: ${apiKey ? 'Configured' : 'MISSING (setup_required: insert pvl_api_key in bot_config)'}`,
    `Cache entries (${cacheRows.length}, TTL ${PVL_CACHE_TTL_SEC / 60}m):`,
  ];

  if (!cacheRows.length) {
    lines.push('  (empty)');
  } else {
    for (const r of cacheRows) {
      const ageSec = Math.max(0, now - Number(r.fetchedAt || 0));
      const fresh = ageSec < PVL_CACHE_TTL_SEC ? 'fresh' : 'expired';
      const etagInfo = r.etag ? `etag=${r.etag}` : 'no-etag';
      lines.push(`  • ${r.key} (${fresh}, ${ageSec}s ago, fetched_at=${r.fetchedAt}, ${etagInfo})`);
    }
  }

  lines.push('');
  lines.push(`Last PVL snapshot time: ${lastSnapshotTime}`);

  return lines.join('\n');
}

async function formatOwnerDebugLast(userId) {
  const row = await db
    .select()
    .from(deliveryDebug)
    .where(eq(deliveryDebug.userId, Number(userId) || 0))
    .orderBy(desc(deliveryDebug.id))
    .limit(1)
    .get();

  if (!row) {
    return 'No delivery_debug rows recorded yet for your account.';
  }

  let entries = [];
  try {
    entries = JSON.parse(row.detail || '[]');
  } catch {
    entries = [];
  }

  const ts = new Date(Number(row.createdAt || 0) * 1000).toISOString();
  const lines = [
    `Last /get delivery (#${row.id})`,
    `Time: ${ts}`,
    `Protocol: ${row.protocol} | Country: ${row.country}`,
    `Requested: ${row.requested} | Delivered: ${row.delivered}`,
    `Candidates (${entries.length}):`,
  ];

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i] || {};
    const httpPart = e.http_status !== null && e.http_status !== undefined ? ` | http=${e.http_status}` : '';
    const fbPart = e.fallback_invoked !== undefined
      ? ` | fb=${e.fallback_invoked} (${e.fallback_value_state})`
      : '';
    lines.push(`${i + 1}. ${e.id} | ${e.stage_reached} | ${e.reason_code}${httpPart}${fbPart}`);
  }

  return lines.join('\n');
}

async function formatOwnerDebugProbe() {
  const targetId = 'pvl_06e3a641e26fd238f0c37947';
  const norm = validateAndNormalizeServersInput({
    protocol: 'openvpn',
    country: 'US',
    sort: 'score',
    page: 1,
  });

  // a. Exact candidate record deliverConfigsBatch receives via fetchPvlServers
  const listRes = await fetchPvlServers({ protocol: 'openvpn', country: 'US', sort: 'score', page: 1 });
  const candidate = (listRes?.data || []).find((r) => r?.id === targetId) || null;
  const aState = candidate ? describeFieldValueState(candidate, 'config_download_url') : 'not_in_page1';

  // b. pvl_cache servers list entry the handler would read
  const cacheListRow = await db.select().from(pvlCache).where(eq(pvlCache.key, norm.cacheKey)).get();
  let bState = 'cache_miss';
  if (cacheListRow?.body) {
    try {
      const parsed = JSON.parse(cacheListRow.body);
      const rec = (parsed?.data || []).find((r) => r?.id === targetId) || null;
      bState = rec ? describeFieldValueState(rec, 'config_download_url') : 'not_in_cached_list';
    } catch {
      bState = 'parse_error';
    }
  }

  // c. pvl_cache server_meta:<id> entry if present
  const cacheMetaRow = await db.select().from(pvlCache).where(eq(pvlCache.key, `server_meta:${targetId}`)).get();
  let cState = 'cache_miss';
  if (cacheMetaRow?.body) {
    try {
      const parsed = JSON.parse(cacheMetaRow.body);
      const rec = parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;
      cState = describeFieldValueState(rec, 'config_download_url');
    } catch {
      cState = 'parse_error';
    }
  }

  // d. Fresh list fetch through fetchPvlServers (temporarily clear norm.cacheKey)
  await db.delete(pvlCache).where(eq(pvlCache.key, norm.cacheKey)).run();
  const freshListRes = await fetchPvlServers({ protocol: 'openvpn', country: 'US', sort: 'score', page: 1 });
  const freshRec = (freshListRes?.data || []).find((r) => r?.id === targetId) || null;
  const dState = freshRec ? describeFieldValueState(freshRec, 'config_download_url') : 'not_in_page1';

  // e. fetchServerDetailFresh(id)
  const detailFresh = await fetchServerDetailFresh(targetId);
  const eState = describeFieldValueState(detailFresh, 'config_download_url');

  // f. Raw PVL API list call WITHOUT fields parameter
  let fState = 'no_api_key';
  const apiKey = await getPvlApiKey();
  if (apiKey) {
    try {
      const rawRes = await fetch(
        `${PVL_BASE_URL}/servers?protocol=openvpn&country=US&status=online&fresh_within=259200&sort=score&order=desc&page=1&per_page=20`,
        { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }
      );
      if (!rawRes.ok) {
        fState = `http_${rawRes.status}`;
      } else {
        const rawJson = await rawRes.json();
        const rawRec = (rawJson?.data || []).find((r) => r?.id === targetId) || null;
        fState = rawRec ? describeFieldValueState(rawRec, 'config_download_url') : 'not_in_page1';
      }
    } catch (err) {
      fState = `fetch_${err?.name || 'Error'}`;
    }
  }

  return [
    `DebugProbe (${targetId})`,
    `a_candidate: ${aState}`,
    `b_cache_servers_list: ${bState}`,
    `c_cache_server_meta: ${cState}`,
    `d_fresh_fetchPvlServers: ${dState}`,
    `e_fetchServerDetailFresh: ${eState}`,
    `f_raw_no_fields_list: ${fState}`,
  ].join('\n');
}

export default async function (message) {
  if (!message || !message.chat) return;
  const chatType = message.chat.type;
  const isPrivate = chatType === 'private';
  const isGroup = chatType === 'group' || chatType === 'supergroup';
  if (!isPrivate && !isGroup) return;

  const parsed = parseCommand(message.text || '');
  if (isGroup && !parsed) return;

  const lang = message.from?.language_code || 'en';
  const fromId = message.from?.id || 0;
  const dryRun = Boolean(message._dry_run);
  const sendMsg = async (params) => {
    if (dryRun) return { dry_run: true, ...params };
    return await api.sendMessage(params);
  };

  if (parsed && parsed.cmd === 'start') {
    if (isPrivate) {
      await upsertUser(message.from, parsed.param);
      const sp = String(parsed.param || '').trim();
      const getMatch = /^get_([a-z0-9]+)(?:_([A-Z]{2}))?$/i.exec(sp);
      if (getMatch && ALLOWED_PROTOCOLS.has(getMatch[1].toLowerCase())) {
        const preProto = getMatch[1].toLowerCase();
        const preCc = getMatch[2] ? getMatch[2].toUpperCase() : '';
        const flowRes = await startGetFlow({
          chatId: message.chat.id,
          userId: fromId,
          lang,
          sendMsg,
          preselectProtocol: preProto,
          preselectCountry: preCc,
        });
        return { action: 'start_get', userId: fromId, lang, ...flowRes };
      }
    }
    const text = welcomeText(lang);
    const reply_markup = buildAppKeyboard(lang, parsed.param, { includeGetButton: isPrivate });
    await sendMsg({
      chat_id: message.chat.id,
      text,
      reply_markup,
    });
    return { action: 'start', userId: fromId, lang, text, reply_markup };
  }

  if (parsed && parsed.cmd === 'get') {
    if (!isPrivate) return { action: 'get_ignored_group' };
    await upsertUser(message.from, '');
    const flowRes = await startGetFlow({
      chatId: message.chat.id,
      userId: fromId,
      lang,
      sendMsg,
    });
    return { action: 'get', userId: fromId, lang, ...flowRes };
  }

  if (parsed && parsed.cmd === 'app') {
    if (isPrivate) {
      await upsertUser(message.from, parsed.param);
    }
    const text = appPromptText(lang);
    const reply_markup = buildAppKeyboard(lang, '');
    await sendMsg({
      chat_id: message.chat.id,
      text,
      reply_markup,
    });
    return { action: 'app', userId: fromId, lang, text, reply_markup };
  }

  if (parsed && parsed.cmd === 'help') {
    const text = helpText(lang);
    const reply_markup = buildAppKeyboard(lang, '');
    await sendMsg({
      chat_id: message.chat.id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup,
    });
    return { action: 'help', userId: fromId, lang, text, reply_markup };
  }

  if (parsed && parsed.cmd === 'debugprobe') {
    const ownerId = await getOwnerId();
    if (isPrivate && ownerId && fromId === ownerId) {
      const probeText = await formatOwnerDebugProbe();
      await sendMsg({
        chat_id: message.chat.id,
        text: probeText,
      });
      return { action: 'debugprobe', owner: true, probeText };
    }
    const text = helpText(lang);
    const reply_markup = buildAppKeyboard(lang, '');
    await sendMsg({
      chat_id: message.chat.id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup,
    });
    return { action: 'debugprobe_denied', owner: false };
  }

  if (parsed && parsed.cmd === 'debuglast') {
    const ownerId = await getOwnerId();
    if (isPrivate && ownerId && fromId === ownerId) {
      const debugText = await formatOwnerDebugLast(fromId);
      await sendMsg({
        chat_id: message.chat.id,
        text: debugText,
      });
      return { action: 'debuglast', owner: true, debugText };
    }
    const text = helpText(lang);
    const reply_markup = buildAppKeyboard(lang, '');
    await sendMsg({
      chat_id: message.chat.id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup,
    });
    return { action: 'debuglast_denied', owner: false };
  }

  if (parsed && parsed.cmd === 'stats') {
    const ownerId = await getOwnerId();
    if (isPrivate && ownerId && fromId === ownerId) {
      const statsText = await formatOwnerStats();
      await sendMsg({
        chat_id: message.chat.id,
        text: statsText,
      });
      return { action: 'stats', owner: true, statsText };
    }
    const text = helpText(lang);
    const reply_markup = buildAppKeyboard(lang, '');
    await sendMsg({
      chat_id: message.chat.id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup,
    });
    return { action: 'stats_denied', owner: false };
  }

  if (isPrivate) {
    const text = fallbackText(lang);
    const reply_markup = buildAppKeyboard(lang, '');
    await sendMsg({
      chat_id: message.chat.id,
      text,
      reply_markup,
    });
    return { action: 'fallback', userId: fromId, lang, text, reply_markup };
  }
}
