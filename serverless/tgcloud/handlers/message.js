import { db, api } from 'sdk';
import { desc, sql } from 'sdk/db';
import { users, pvlCache } from '../schema.js';
import {
  extractSnapshotTimestamp,
  getOwnerId,
  getPvlApiKey,
  PVL_CACHE_TTL_SEC,
} from '../lib/pvl.js';
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

  const lines = [
    'VPN Finder: Owner Stats',
    '',
    `Total users: ${totalUsers}`,
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

  if (parsed && parsed.cmd === 'start') {
    if (isPrivate) {
      await upsertUser(message.from, parsed.param);
    }
    const text = welcomeText(lang);
    const reply_markup = buildAppKeyboard(lang, parsed.param);
    await api.sendMessage({
      chat_id: message.chat.id,
      text,
      reply_markup,
    });
    return { action: 'start', userId: fromId, lang };
  }

  if (parsed && parsed.cmd === 'app') {
    if (isPrivate) {
      await upsertUser(message.from, parsed.param);
    }
    const text = appPromptText(lang);
    const reply_markup = buildAppKeyboard(lang, '');
    await api.sendMessage({
      chat_id: message.chat.id,
      text,
      reply_markup,
    });
    return { action: 'app', userId: fromId, lang };
  }

  if (parsed && parsed.cmd === 'help') {
    const text = helpText(lang);
    const reply_markup = buildAppKeyboard(lang, '');
    await api.sendMessage({
      chat_id: message.chat.id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup,
    });
    return { action: 'help', userId: fromId, lang };
  }

  if (parsed && parsed.cmd === 'stats') {
    const ownerId = await getOwnerId();
    if (isPrivate && ownerId && fromId === ownerId) {
      const statsText = await formatOwnerStats();
      await api.sendMessage({
        chat_id: message.chat.id,
        text: statsText,
      });
      return { action: 'stats', owner: true, statsText };
    }
    await api.sendMessage({
      chat_id: message.chat.id,
      text: helpText(lang),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: buildAppKeyboard(lang, ''),
    });
    return { action: 'stats_denied', owner: false };
  }

  if (isPrivate) {
    await api.sendMessage({
      chat_id: message.chat.id,
      text: fallbackText(lang),
      reply_markup: buildAppKeyboard(lang, ''),
    });
    return { action: 'fallback', userId: fromId, lang };
  }
}
