import { db, api } from 'sdk';
import { desc, eq, sql } from 'sdk/db';
import { deliveryDebug, users, pvlCache, subTokens } from '../schema.js';
import {
  ALLOWED_PROTOCOLS,
  extractSnapshotTimestamp,
  getCounters,
  getEffectiveUserLang,
  getFeedbackSummary,
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

async function formatOwnerStats(lang = 'en') {
  try {
    const fa = String(lang || '').toLowerCase().startsWith('fa');
    const totalUsers = await db.$count(users).catch(() => 0);
    const now = Math.floor(Date.now() / 1000);
    const allUsers = await db
      .select({ id: users.id, lastSeen: users.lastSeen })
      .from(users)
      .all()
      .catch(() => []);
    let active24h = 0;
    let active7d = 0;
    for (const u of allUsers) {
      const ts = u.lastSeen instanceof Date
        ? Math.floor(u.lastSeen.getTime() / 1000)
        : Number(u.lastSeen || 0);
      if (ts >= now - 86400) active24h += 1;
      if (ts >= now - 7 * 86400) active7d += 1;
    }

    const apiKey = await getPvlApiKey();
    const cacheRows = await db
      .select({ fetchedAt: pvlCache.fetchedAt })
      .from(pvlCache)
      .all()
      .catch(() => []);
    let freshCache = 0;
    for (const r of cacheRows) {
      if (Math.max(0, now - Number(r.fetchedAt || 0)) < PVL_CACHE_TTL_SEC) freshCache += 1;
    }

    const counters = await getCounters();
    const totalSubTokens = await db.$count(subTokens).catch(() => 0);
    const fb = await getFeedbackSummary().catch(() => ({ totalVotes: 0, totalUp: 0, totalDown: 0, hiddenCount: 0 }));

    // 7-day daily delivery chart & recent proxy health
    const recentDeliveries = await db
      .select({
        createdAt: deliveryDebug.createdAt,
        requested: deliveryDebug.requested,
        delivered: deliveryDebug.delivered,
      })
      .from(deliveryDebug)
      .orderBy(desc(deliveryDebug.id))
      .limit(100)
      .all()
      .catch(() => []);

    const dayBuckets = new Array(7).fill(0);
    let recentReq = 0;
    let recentDeliv = 0;
    const todayDayIdx = Math.floor(now / 86400);
    for (const d of recentDeliveries) {
      recentReq += Number(d.requested || 0);
      recentDeliv += Number(d.delivered || 0);
      const dIdx = Math.floor(Number(d.createdAt || 0) / 86400);
      const diff = todayDayIdx - dIdx;
      if (diff >= 0 && diff < 7) {
        dayBuckets[6 - diff] += Number(d.delivered || 0);
      }
    }
    const bars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const maxDay = Math.max(1, ...dayBuckets);
    const sparkline = dayBuckets
      .map((v) => (v === 0 ? '·' : bars[Math.min(bars.length - 1, Math.floor((v / maxDay) * (bars.length - 1)))]))
      .join(' ');
    const successPct = recentReq > 0 ? Math.round((recentDeliv / recentReq) * 100) : 100;

    if (fa) {
      return [
        '📊 <b>آمار مدیریتی VPN Finder</b>',
        '',
        `👥 <b>کاربران:</b> ${totalUsers} نفر (۲۴ ساعت: ${active24h} · ۷ روز: ${active7d})`,
        `📥 <b>کانفیگ‌های ارسالی در چت:</b> ${counters.configs_sent_chat}`,
        `⚡ <b>اتصال‌های مینی‌اپ:</b> ${counters.connections_served}`,
        `🧭 <b>فرایندهای /get:</b> ${counters.get_flows_started}`,
        `🔗 <b>لینک‌های اشتراک فعال/کل:</b> ${totalSubTokens}`,
        '',
        `📈 <b>نمودار ۷ روز اخیر (تحویل):</b> <code>${sparkline}</code> (${dayBuckets.join(', ')})`,
        `🩺 <b>سلامت پروکسی‌ها:</b> نرخ تحویل ${successPct}% · 👍 ${fb.totalUp} / 👎 ${fb.totalDown} (مخفی‌شده: ${fb.hiddenCount})`,
        '',
        '📶 <b>مصرف اینترنت کاربران:</b> قابل اندازه‌گیری نیست (ترافیک مستقیم به سرورهای شخص ثالث می‌رود).',
        `⚙️ <b>وضعیت سیستم:</b> کلید PVL ${apiKey ? 'فعال ✅' : 'تنظیم‌نشده ❌'} · کش: ${freshCache}/${cacheRows.length} تازه`,
      ].join('\n');
    }

    return [
      '📊 <b>VPN Finder — Admin Stats</b>',
      '',
      `👥 <b>Users:</b> ${totalUsers} total (${active24h} active 24h · ${active7d} active 7d)`,
      `📥 <b>Configs sent in chat:</b> ${counters.configs_sent_chat}`,
      `⚡ <b>Connections served:</b> ${counters.connections_served}`,
      `🧭 <b>/get flows started:</b> ${counters.get_flows_started}`,
      `🔗 <b>Sub tokens issued:</b> ${totalSubTokens}`,
      '',
      `📈 <b>7-Day Deliveries:</b> <code>${sparkline}</code> (${dayBuckets.join(', ')})`,
      `🩺 <b>Proxy Health:</b> ${successPct}% delivery rate · 👍 ${fb.totalUp} / 👎 ${fb.totalDown} (auto-hidden: ${fb.hiddenCount})`,
      '',
      '📶 <b>VPN Bandwidth:</b> Not measurable (users connect directly to third-party servers).',
      `⚙️ <b>System:</b> PVL Key ${apiKey ? 'Configured ✅' : 'Missing ❌'} · Cache: ${freshCache}/${cacheRows.length} fresh`,
    ].join('\n');
  } catch (err) {
    return `Stats error: ${err?.message || String(err)}`;
  }
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
    const reply_markup = isPrivate
      ? buildReplyPanelKeyboard(lang, { isOwner })
      : buildAppKeyboard(lang, parsed.param, { includeGetButton: false });
    await sendMsg({
      chat_id: message.chat.id,
      text,
      reply_markup,
    });
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
    if (t === PANEL_BTN.appEn || t === PANEL_BTN.appFa) {
      await upsertUser(message.from, '');
      const text = appPromptText(lang);
      const reply_markup = buildAppKeyboard(lang, '');
      await sendMsg({ chat_id: message.chat.id, text, reply_markup });
      return { action: 'panel_app', userId: fromId, lang };
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
      const statsText = await formatOwnerStats(lang);
      await sendMsg({ chat_id: message.chat.id, text: statsText, parse_mode: 'HTML' });
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
      const statsText = await formatOwnerStats(lang);
      await sendMsg({
        chat_id: message.chat.id,
        text: statsText,
        parse_mode: 'HTML',
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
