import { db } from 'sdk';
import { and, asc, eq, isNull } from 'sdk/db';
import { subTokens } from '../schema.js';
import { getConfigValue } from './pvl.js';
import { isFa } from './texts.js';

const MAX_PROFILES_PER_USER = 3;

export function generateSubToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getSubLinkBase() {
  const raw = await getConfigValue('sub_link_base');
  return raw ? raw.replace(/\/+$/, '') : null;
}

export async function listActiveSubTokens(userId) {
  return await db
    .select()
    .from(subTokens)
    .where(and(eq(subTokens.userId, userId), isNull(subTokens.revokedAt)))
    .orderBy(asc(subTokens.id))
    .all();
}

export async function getActiveSubToken(userId, profileId = null) {
  const rows = await listActiveSubTokens(userId);
  if (!rows.length) return null;
  if (profileId) {
    const match = rows.find((r) => Number(r.id) === Number(profileId));
    if (match) return match;
  }
  return rows[0];
}

export async function issueSubToken(userId, { label = null, cc = 'ALL', isp = 'ALL' } = {}) {
  const token = generateSubToken();
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(subTokens)
    .values({
      userId,
      token,
      label: label || null,
      cc: cc || 'ALL',
      isp: isp || 'ALL',
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    })
    .run();
  return token;
}

export async function updateSubFilters(userId, profileId, { cc, isp }) {
  const row = await getActiveSubToken(userId, profileId);
  if (!row) return null;
  const nextCc = cc !== undefined ? cc : (row.cc || 'ALL');
  const nextIsp = isp !== undefined ? isp : (row.isp || 'ALL');
  await db
    .update(subTokens)
    .set({ cc: nextCc, isp: nextIsp })
    .where(eq(subTokens.id, row.id))
    .run();
  return { ...row, cc: nextCc, isp: nextIsp };
}

export async function revokeSubToken(userId, profileId = null) {
  const now = Math.floor(Date.now() / 1000);
  if (profileId) {
    await db
      .update(subTokens)
      .set({ revokedAt: now })
      .where(and(eq(subTokens.userId, userId), eq(subTokens.id, Number(profileId)), isNull(subTokens.revokedAt)))
      .run();
    return;
  }
  await db
    .update(subTokens)
    .set({ revokedAt: now })
    .where(and(eq(subTokens.userId, userId), isNull(subTokens.revokedAt)))
    .run();
}

export async function regenerateSubToken(userId, profileId = null) {
  const existing = await getActiveSubToken(userId, profileId);
  const cc = existing?.cc || 'ALL';
  const isp = existing?.isp || 'ALL';
  const label = existing?.label || null;
  if (existing) {
    await revokeSubToken(userId, existing.id);
  }
  return await issueSubToken(userId, { label, cc, isp });
}

export function buildSubUrl(base, token, { cc = 'ALL', isp = 'ALL' } = {}) {
  const params = [];
  if (cc && cc !== 'ALL') params.push(`cc=${encodeURIComponent(cc)}`);
  if (isp && isp !== 'ALL') params.push(`isp=${encodeURIComponent(isp)}`);
  return params.length ? `${base}/sub/${token}?${params.join('&')}` : `${base}/sub/${token}`;
}

export function subSetupPendingText(lang) {
  return isFa(lang)
    ? '⏳ سرویس لینک اشتراک در حال راه‌اندازی است. لطفاً کمی بعد دوباره امتحان کنید.'
    : '⏳ Subscription link service is being set up. Please try again shortly.';
}

export function subRevokedText(lang) {
  return isFa(lang)
    ? '🚫 لینک اشتراک انتخاب‌شده باطل شد. هر زمان خواستید می‌توانید با /sub لینک جدید بسازید.'
    : '🚫 Subscription link revoked. Run /sub anytime to issue a new one.';
}

const ISP_LABELS = {
  ALL: { en: 'All ISPs', fa: 'همه اپراتورها' },
  mci: { en: 'Hamrah-e-Aval (MCI)', fa: 'همراه اول' },
  irancell: { en: 'Irancell (MTN)', fa: 'ایرانسل' },
  tci: { en: 'Mokhaberat (TCI)', fa: 'مخابرات' },
};

export function subLinkText(url, lang, { regenerated = false, cc = 'ALL', isp = 'ALL', profileNum = 1, totalProfiles = 1 } = {}) {
  const fa = isFa(lang);
  const ccLabel = cc && cc !== 'ALL' ? cc : (fa ? 'همه کشورها' : 'All');
  const ispLabel = ISP_LABELS[isp]?.[fa ? 'fa' : 'en'] || ISP_LABELS.ALL[fa ? 'fa' : 'en'];
  const profBadge = totalProfiles > 1 ? ` [#${profileNum}/${totalProfiles}]` : '';

  if (fa) {
    const prefix = regenerated
      ? `♻️ لینک اشتراک جدید${profBadge} ساخته شد (لینک قبلی باطل شد):\n\n`
      : `🔗 لینک اشتراک شخصی شما${profBadge}:\n\n`;
    return (
      `${prefix}<code>${url}</code>\n\n` +
      `🎯 <b>فیلتر فعال:</b> ${ccLabel} · ${ispLabel}\n` +
      '📱 <b>نحوه استفاده:</b> لینک را کپی کرده و در Hiddify، v2rayNG، Karing یا Streisand با <b>Import / Add from clipboard</b> اضافه کنید (هر ۶ ساعت خودکار آپدیت می‌شود).\n\n' +
      'ℹ️ شامل VLESS Reality، Hysteria2، TUIC، Trojan، VMess و Shadowsocks از چند منبع با اولویت نت ایران (بدون محدودیت حجم از سمت ربات).\n' +
      '⚠️ <b>امنیت:</b> هر کسی این لینک را داشته باشد می‌تواند استفاده کند — در صورت لو رفتن «بازسازی» را بزنید.'
    );
  }
  const prefix = regenerated
    ? `♻️ New subscription link${profBadge} issued (previous revoked):\n\n`
    : `🔗 Your personal subscription link${profBadge}:\n\n`;
  return (
    `${prefix}<code>${url}</code>\n\n` +
    `🎯 <b>Active filter:</b> ${ccLabel} · ${ispLabel}\n` +
    '📱 <b>How to import:</b> Copy the URL and tap <b>Import / Add from clipboard</b> in Hiddify, v2rayNG, Karing, or Streisand (auto-updates every 6h).\n\n' +
    'ℹ️ Includes VLESS Reality, Hysteria2, TUIC, Trojan, VMess, and Shadowsocks from curated multi-source feeds (no per-user data cap).\n' +
    '⚠️ <b>Security:</b> Anyone with this link can use it — tap Regenerate if it leaks.'
  );
}

const SUB_COUNTRIES = [
  ['ALL', '🌍 All'],
  ['US', '🇺🇸 US'],
  ['DE', '🇩🇪 DE'],
  ['NL', '🇳🇱 NL'],
  ['GB', '🇬🇧 GB'],
  ['FR', '🇫🇷 FR'],
  ['FI', '🇫🇮 FI'],
  ['TR', '🇹🇷 TR'],
];

const SUB_ISPS = [
  ['ALL', '🌐 همه', '🌐 All ISPs'],
  ['mci', '📱 همراه اول', '📱 MCI'],
  ['irancell', '🟡 ایرانسل', '🟡 Irancell'],
  ['tci', '☎️ مخابرات', '☎️ TCI'],
];

export function subKeyboard(lang, { cc = 'ALL', isp = 'ALL', profiles = [], activeId = null } = {}) {
  const activeCc = (cc || 'ALL').toUpperCase();
  const activeIsp = isp || 'ALL';
  const fa = isFa(lang);
  const pid = activeId || (profiles[0]?.id ?? 0);

  const countries = SUB_COUNTRIES.map(([code, label]) => [
    code,
    code === 'ALL' && fa ? '🌍 همه' : label,
  ]);
  const ccRow1 = countries.slice(0, 4).map(([code, label]) => ({
    text: activeCc === code ? `✓ ${label}` : label,
    callback_data: `sub:cc:${code}:${pid}`,
  }));
  const ccRow2 = countries.slice(4, 8).map(([code, label]) => ({
    text: activeCc === code ? `✓ ${label}` : label,
    callback_data: `sub:cc:${code}:${pid}`,
  }));
  const ispRow = SUB_ISPS.map(([code, labelFa, labelEn]) => {
    const lbl = fa ? labelFa : labelEn;
    return {
      text: activeIsp === code ? `✓ ${lbl}` : lbl,
      callback_data: `sub:isp:${code}:${pid}`,
    };
  });

  const rows = [ccRow1, ccRow2, ispRow];

  if (profiles.length > 0) {
    const profRow = profiles.map((p, idx) => ({
      text: Number(p.id) === Number(pid) ? `● #${idx + 1}` : `#${idx + 1}`,
      callback_data: `sub:sel:${p.id}`,
    }));
    if (profiles.length < MAX_PROFILES_PER_USER) {
      profRow.push({
        text: fa ? '➕ لینک جدید' : '➕ New link',
        callback_data: 'sub:new',
      });
    }
    rows.push(profRow);
  }

  rows.push([
    { text: fa ? '♻️ بازسازی' : '♻️ Regenerate', callback_data: `sub:regen:${pid}` },
    { text: fa ? '🚫 باطل کردن' : '🚫 Revoke', callback_data: `sub:revoke:${pid}` },
  ]);

  return { inline_keyboard: rows };
}

export async function sendSubResponse({ chatId, userId, lang, sendMsg, profileId = null }) {
  const base = await getSubLinkBase();
  if (!base) {
    await sendMsg({ chat_id: chatId, text: subSetupPendingText(lang) });
    return;
  }

  let profiles = await listActiveSubTokens(userId);
  if (profiles.length === 0) {
    await issueSubToken(userId, { cc: 'ALL', isp: 'ALL' });
    profiles = await listActiveSubTokens(userId);
  }

  const active =
    (profileId ? profiles.find((p) => Number(p.id) === Number(profileId)) : null) || profiles[0];
  const idx = profiles.findIndex((p) => Number(p.id) === Number(active.id)) + 1;
  const cc = active.cc || 'ALL';
  const isp = active.isp || 'ALL';
  const url = buildSubUrl(base, active.token, { cc, isp });

  await sendMsg({
    chat_id: chatId,
    text: subLinkText(url, lang, { cc, isp, profileNum: idx, totalProfiles: profiles.length }),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: subKeyboard(lang, { cc, isp, profiles, activeId: active.id }),
  });
}
