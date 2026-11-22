import { db, api } from 'sdk';
import { desc, eq, gte, sql } from 'sdk/db';
import { deliveryDebug, users, pvlCache, subTokens } from '../schema.js';
import {
  ALLOWED_PROTOCOLS,
  extractSnapshotTimestamp,
  getCounters,
  getEffectiveUserLang,
  getOwnerId,
  getPvlApiKey,
  PVL_CACHE_TTL_SEC,
} from '../lib/pvl.js';
import { runDebugProbe, runDebugProbe2, runDebugProbe3 } from '../lib/probe.js';
import { startGetFlow } from '../lib/getFlow.js';
import { sendSubResponse } from '../lib/sub.js';
import {
  appPromptText,
  buildAppKeyboard,
  buildReplyPanelKeyboard,
  fallbackText,
  helpText,
  PANEL_BTN,
  panelShownText,
  settingsKeyboard,
  settingsText,
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
        lastSeen: sql`(unixepoch())`,
        ...(startParam ? { startParam } : {}),
      },
    })
    .run();
}

async function formatOwnerStats() {
  const totalUsers = await db.$count(users);
  const now = Math.floor(Date.now() / 1000);
  const active24h = await db.$count(users, gte(users.lastSeen, now - 86400)).catch(() => 0);
  const active7d = await db.$count(users, gte(users.lastSeen, now - 7 * 86400)).catch(() => 0);
  const apiKey = await getPvlApiKey();
  const cacheRows = await db
    .select()
    .from(pvlCache)
    .orderBy(desc(pvlCache.fetchedAt))
    .all();
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
  const totalSubTokens = await db.$count(subTokens).catch(() => 0);
  const lines = [
    'VPN Finder: Owner Stats',
    '',
    `Total users: ${totalUsers} (24h active: ${active24h}, 7d: ${active7d})`,
    `Connections served: ${counters.connections_served}`,
    `Configs sent in chat: ${counters.configs_sent_chat}`,
    `Get flows started: ${counters.get_flows_started}`,
    `Sub tokens issued: ${totalSubTokens}`,
    `Subs served: ${counters.subs_served || 0}`,
    'VPN traffic: N/A (clients connect directly to third-party servers; bot does not proxy VPN data)',
    `PVL API key: ${apiKey ? 'Configured' : 'MISSING (setup_required: insert pvl_api_key in bot_config)'}`,
    `Cache entries (${cacheRows.length}, TTL ${PVL_CACHE_TTL_SEC / 60}m):`,
  ];

  if (!cacheRows.length) {
    lines.push('  (empty)');
  } else {
    const shown = cacheRows.slice(0, 12);
    for (const r of shown) {
      const ageSec = Math.max(0, now - Number(r.fetchedAt || 0));
      const fresh = ageSec < PVL_CACHE_TTL_SEC ? 'fresh' : 'expired';
      const etagInfo = r.etag ? `etag=${r.etag}` : 'no-etag';
      lines.push(`  • ${r.key} (${fresh}, ${ageSec}s ago, fetched_at=${r.fetchedAt}, ${etagInfo})`);
    }
    if (cacheRows.length > shown.length) {
      lines.push(`  ... (+${cacheRows.length - shown.length} more cache entries)`);
    }
  }

  lines.push('');
  lines.push(`Last PVL snapshot time: ${lastSnapshotTime}`);

  const out = lines.join('\n');
  return out.length > 3950 ? `${out.slice(0, 3947)}...` : out;
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

  const hist = {};
  for (const e of entries) {
    const code = String(e?.reason_code || 'unknown');
    hist[code] = (hist[code] || 0) + 1;
  }

  const ts = new Date(Number(row.createdAt || 0) * 1000).toISOString();
  const lines = [
    `Last /get delivery (#${row.id})`,
    `Time: ${ts}`,
    `Protocol: ${row.protocol} | Country: ${row.country}`,
    `Requested: ${row.requested} | Delivered: ${row.delivered}`,
    `Examined: ${entries.length} | Histogram: ${JSON.stringify(hist)}`,
    `Candidates (first ${Math.min(entries.length, 15)} of ${entries.length}):`,
  ];

  const limit = Math.min(entries.length, 15);
  for (let i = 0; i < limit; i += 1) {
    const e = entries[i] || {};
    const httpPart = e.http_status !== null && e.http_status !== undefined ? ` | http=${e.http_status}` : '';
    const fbPart = e.fallback_invoked !== undefined
      ? ` | fb=${e.fallback_invoked} (${e.fallback_value_state})`
      : '';
    lines.push(`${i + 1}. ${e.id} | ${e.stage_reached} | ${e.reason_code}${httpPart}${fbPart}`);
  }
  if (entries.length > limit) {
    lines.push(`... (+${entries.length - limit} more; see histogram above)`);
  }

  return lines.join('\n').slice(0, 3900);
}

async function formatOwnerDebugProbe() {
  const res = await runDebugProbe('handler');
  return res.text;
}

export default async function (message) {
  if (!message || !message.chat) return;
  const chatType = message.chat.type;
  const isPrivate = chatType === 'private';
  const isGroup = chatType === 'group' || chatType === 'supergroup';
  if (!isPrivate && !isGroup) return;

  const parsed = parseCommand(message.text || '');
  if (isGroup && !parsed) return;

  const fromId = message.from?.id || 0;
  const lang = await getEffectiveUserLang(fromId, message.from?.language_code || 'en');
  const ownerId = isPrivate ? await getOwnerId() : 0;
  const isOwner = Boolean(isPrivate && ownerId && fromId === ownerId);
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
    if (isPrivate) {
      await sendMsg({
        chat_id: message.chat.id,
        text: panelShownText(lang),
        reply_markup: buildReplyPanelKeyboard(lang, { isOwner }),
      });
    }
    return { action: 'start', userId: fromId, lang, text, reply_markup };
  }

  if (parsed && (parsed.cmd === 'menu' || parsed.cmd === 'settings')) {
    if (!isPrivate) return { action: `${parsed.cmd}_ignored_group` };
    await upsertUser(message.from, '');
    if (parsed.cmd === 'settings') {
      await sendMsg({
        chat_id: message.chat.id,
        text: settingsText(lang),
        parse_mode: 'HTML',
        reply_markup: settingsKeyboard(lang),
      });
      return { action: 'settings', userId: fromId, lang };
    }
    await sendMsg({
      chat_id: message.chat.id,
      text: panelShownText(lang),
      reply_markup: buildReplyPanelKeyboard(lang, { isOwner }),
    });
    return { action: 'menu_show', userId: fromId, lang };
  }

  if (isPrivate && message.text) {
    const t = message.text.trim();
    if (t === PANEL_BTN.getEn || t === PANEL_BTN.getFa) {
      await upsertUser(message.from, '');
      const flowRes = await startGetFlow({ chatId: message.chat.id, userId: fromId, lang, sendMsg });
      return { action: 'panel_get', userId: fromId, lang, ...flowRes };
    }
    if (t === PANEL_BTN.subEn || t === PANEL_BTN.subFa) {
      await upsertUser(message.from, '');
      await sendSubResponse({ chatId: message.chat.id, userId: fromId, lang, sendMsg });
      return { action: 'panel_sub', userId: fromId, lang };
    }
    if (t === PANEL_BTN.settingsEn || t === PANEL_BTN.settingsFa) {
      await upsertUser(message.from, '');
      await sendMsg({
        chat_id: message.chat.id,
        text: settingsText(lang),
        parse_mode: 'HTML',
        reply_markup: settingsKeyboard(lang),
      });
      return { action: 'panel_settings', userId: fromId, lang };
    }
    if (t === PANEL_BTN.helpEn || t === PANEL_BTN.helpFa) {
      await upsertUser(message.from, '');
      await sendMsg({
        chat_id: message.chat.id,
        text: helpText(lang),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      return { action: 'panel_help', userId: fromId, lang };
    }
    if ((t === PANEL_BTN.statsEn || t === PANEL_BTN.statsFa) && isOwner) {
      const statsText = await formatOwnerStats();
      await sendMsg({ chat_id: message.chat.id, text: statsText });
      return { action: 'panel_stats', owner: true, statsText };
    }
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

  if (parsed && parsed.cmd === 'sub') {
    if (!isPrivate) return { action: 'sub_ignored_group' };
    await upsertUser(message.from, '');
    await sendSubResponse({
      chatId: message.chat.id,
      userId: fromId,
      lang,
      sendMsg,
    });
    return { action: 'sub', userId: fromId, lang };
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

  if (parsed && parsed.cmd === 'debugprobe3') {
    const ownerId = await getOwnerId();
    if (isPrivate && ownerId && fromId === ownerId) {
      const res = await runDebugProbe3('handler');
      await sendMsg({
        chat_id: message.chat.id,
        text: res.text,
      });
      return { action: 'debugprobe3', owner: true, probeText: res.text };
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
    return { action: 'debugprobe3_denied', owner: false };
  }

  if (parsed && parsed.cmd === 'debugprobe2') {
    const ownerId = await getOwnerId();
    if (isPrivate && ownerId && fromId === ownerId) {
      const res = await runDebugProbe2(fromId);
      await sendMsg({
        chat_id: message.chat.id,
        text: res.text,
      });
      return { action: 'debugprobe2', owner: true, probeText: res.text };
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
    return { action: 'debugprobe2_denied', owner: false };
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
