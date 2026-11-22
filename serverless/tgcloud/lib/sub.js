import { db } from 'sdk';
import { and, eq, isNull } from 'sdk/db';
import { subTokens } from '../schema.js';
import { getConfigValue } from './pvl.js';
import { isFa } from './texts.js';

export function generateSubToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getSubLinkBase() {
  const raw = await getConfigValue('sub_link_base');
  return raw ? raw.replace(/\/+$/, '') : null;
}

export async function getActiveSubToken(userId) {
  return await db
    .select()
    .from(subTokens)
    .where(and(eq(subTokens.userId, userId), isNull(subTokens.revokedAt)))
    .get();
}

export async function issueSubToken(userId) {
  const token = generateSubToken();
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(subTokens)
    .values({
      userId,
      token,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    })
    .run();
  return token;
}

export async function revokeSubToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(subTokens)
    .set({ revokedAt: now })
    .where(and(eq(subTokens.userId, userId), isNull(subTokens.revokedAt)))
    .run();
}

export async function regenerateSubToken(userId) {
  await revokeSubToken(userId);
  return await issueSubToken(userId);
}

export function subSetupPendingText(lang) {
  return isFa(lang)
    ? '⏳ سرویس لینک اشتراک در حال راه‌اندازی است. لطفاً کمی بعد دوباره امتحان کنید.'
    : '⏳ Subscription link service is being set up. Please try again shortly.';
}

export function subRevokedText(lang) {
  return isFa(lang)
    ? '🚫 لینک اشتراک شما باطل شد. هر زمان خواستید می‌توانید با /sub لینک جدید بسازید.'
    : '🚫 Your subscription link has been revoked. Run /sub anytime to issue a new one.';
}

export function subLinkText(url, lang, { regenerated = false, cc = 'ALL' } = {}) {
  const ccLabel = cc && cc !== 'ALL' ? ` (${cc})` : '';
  if (isFa(lang)) {
    const prefix = regenerated
      ? `♻️ لینک اشتراک جدید${ccLabel} ساخته شد (لینک قبلی باطل شد):\n\n`
      : `🔗 لینک اشتراک شخصی شما${ccLabel}:\n\n`;
    return (
      `${prefix}<code>${url}</code>\n\n` +
      '📱 <b>نحوه استفاده (v2rayNG / Hiddify / Streisand / NekoBox):</b>\n' +
      'لینک را کپی کرده و در برنامه با <b>Import / Add from clipboard</b> اضافه کنید (به‌صورت خودکار آپدیت می‌شود).\n\n' +
      '🌍 برای فیلتر بر اساس کشور، یکی از دکمه‌های کشور زیر را بزنید.\n' +
      'ℹ️ شامل پروتکل‌های VLESS، VMess، Trojan، Shadowsocks و Hysteria2 از چند منبع بررسی‌شده. OpenVPN در /get در دسترس است.\n\n' +
      '⚠️ <b>هشدار امنیتی:</b> هر کسی این لینک را داشته باشد می‌تواند از آن استفاده کند — اگر لو رفت، دکمه <b>بازسازی</b> را بزنید.'
    );
  }
  const prefix = regenerated
    ? `♻️ New subscription link${ccLabel} issued (previous link revoked):\n\n`
    : `🔗 Your personal subscription link${ccLabel}:\n\n`;
  return (
    `${prefix}<code>${url}</code>\n\n` +
    '📱 <b>How to import (v2rayNG / Hiddify / Streisand / NekoBox):</b>\n' +
    'Copy the URL above and tap <b>Import / Add from clipboard</b> in your client (auto-refreshes with fresh configs).\n\n' +
    '🌍 Tap a country button below to filter your subscription by country.\n' +
    'ℹ️ Includes VLESS, VMess, Trojan, Shadowsocks, and Hysteria2 from curated checked feeds. OpenVPN is available via /get.\n\n' +
    '⚠️ <b>Security:</b> Anyone with this link can use it — tap <b>Regenerate</b> if it leaks.'
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

export function subKeyboard(lang, selectedCc = 'ALL') {
  const active = (selectedCc || 'ALL').toUpperCase();
  const fa = isFa(lang);
  const countries = SUB_COUNTRIES.map(([code, label]) => [
    code,
    code === 'ALL' && fa ? '🌍 همه' : label,
  ]);
  const row1 = countries.slice(0, 4).map(([code, label]) => ({
    text: active === code ? `✓ ${label}` : label,
    callback_data: `sub:cc:${code}`,
  }));
  const row2 = countries.slice(4, 8).map(([code, label]) => ({
    text: active === code ? `✓ ${label}` : label,
    callback_data: `sub:cc:${code}`,
  }));
  return {
    inline_keyboard: [
      row1,
      row2,
      [
        { text: isFa(lang) ? '♻️ بازسازی' : '♻️ Regenerate', callback_data: 'sub:regen' },
        { text: isFa(lang) ? '🚫 باطل کردن' : '🚫 Revoke', callback_data: 'sub:revoke' },
      ],
    ],
  };
}

export async function sendSubResponse({ chatId, userId, lang, sendMsg }) {
  const base = await getSubLinkBase();
  if (!base) {
    await sendMsg({ chat_id: chatId, text: subSetupPendingText(lang) });
    return;
  }

  let row = await getActiveSubToken(userId);
  let token = row?.token || null;
  if (!token) {
    token = await issueSubToken(userId);
  }

  const url = `${base}/sub/${token}`;
  await sendMsg({
    chat_id: chatId,
    text: subLinkText(url, lang),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: subKeyboard(lang),
  });
}
