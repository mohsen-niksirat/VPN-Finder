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

export function subLinkText(url, lang, { regenerated = false } = {}) {
  if (isFa(lang)) {
    const prefix = regenerated ? '♻️ لینک اشتراک جدید ساخته شد (لینک قبلی باطل شد):\n\n' : '🔗 لینک اشتراک شخصی شما:\n\n';
    return (
      `${prefix}<code>${url}</code>\n\n` +
      '📱 <b>نحوه استفاده (v2rayNG / Streisand / NekoBox):</b>\n' +
      'در v2rayNG روی <b>+</b> بزنید ← <b>Import config from QR / subscription group</b> و لینک بالا را جای‌گذاری کنید.\n\n' +
      'ℹ️ پروتکل‌های URI (مانند VLESS، VMess، Trojan، Shadowsocks و Hysteria2) در اشتراک قرار می‌گیرند. OpenVPN در لینک اشتراک پشتیبانی نمی‌شود و از طریق /get در دسترس است.\n\n' +
      '⚠️ <b>هشدار امنیتی:</b> هر کسی این لینک را داشته باشد می‌تواند از آن استفاده کند — اگر لو رفت، دکمه <b>بازسازی</b> را بزنید.'
    );
  }
  const prefix = regenerated ? '♻️ New subscription link issued (previous link revoked):\n\n' : '🔗 Your personal subscription link:\n\n';
  return (
    `${prefix}<code>${url}</code>\n\n` +
    '📱 <b>How to import (v2rayNG / Streisand / NekoBox):</b>\n' +
    'In v2rayNG tap <b>+</b> → <b>Import config from QR / subscription group</b> and paste the URL above.\n\n' +
    'ℹ️ Includes URI protocols (VLESS, VMess, Trojan, Shadowsocks, Hysteria2). OpenVPN cannot be included in a URI subscription and is available via /get.\n\n' +
    '⚠️ <b>Security:</b> Anyone with this link can use it — tap <b>Regenerate</b> if it leaks.'
  );
}

export function subKeyboard(lang) {
  return {
    inline_keyboard: [
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
