export const APP_URL = 'https://app9074617711.tgcloud.ai/';
export const TGCLOUD_APP_URL = 'https://app9074617711.tgcloud.ai/';
export const BOT_NAME = 'VPN Finder';

export const ABOUT_EN =
  'Browse checked public VPN servers from PublicVPNList by country and protocol. Third-party servers; no privacy SLA.';

export const ABOUT_FA =
  'جستجوی سرورهای VPN عمومی بررسی‌شده از PublicVPNList بر اساس کشور و پروتکل. سرورها شخص ثالث و بدون تضمین امنیت.';

export const DESC_EN =
  'Find technically-checked public VPN servers from the PublicVPNList catalog. Filter by country and protocol (VLESS, Shadowsocks, VMess, OpenVPN, Hysteria2, Trojan), see measured speed/latency and how recently each server was checked, and get a QR code or v2rayNG import link.\n\n' +
  'Disclaimer: All listed servers are operated by third parties. A technical check verifies reachability and throughput only and is not a privacy or safety guarantee.\n\n' +
  'Creator: @MyLeitner · https://t.me/MyLeitner';

export const DESC_FA =
  'سرورهای VPN عمومی بررسی‌شده از کاتالوگ PublicVPNList را پیدا کنید. بر اساس کشور و پروتکل (VLESS، Shadowsocks، VMess، OpenVPN، Hysteria2، Trojan) فیلتر کنید، سرعت، تأخیر و زمان آخرین بررسی فنی هر سرور را ببینید و کد QR یا لینک ورود مستقیم به v2rayNG دریافت کنید.\n\n' +
  'سلب مسئولیت: تمام سرورها متعلق به اشخاص ثالث هستند؛ بررسی فنی صرفاً اتصال را می‌سنجد و تضمین حریم خصوصی یا امنیت نیست.\n\n' +
  'سازنده: @MyLeitner · https://t.me/MyLeitner';

export const COMMANDS_EN = [
  { command: 'start', description: 'Open VPN Finder' },
  { command: 'get', description: 'Get working VPN configs right in chat' },
  { command: 'sub', description: 'Get your personal subscription link' },
  { command: 'app', description: 'Launch the Mini App' },
  { command: 'settings', description: 'Language and bot settings' },
  { command: 'menu', description: 'Refresh the in-chat quick panel' },
  { command: 'help', description: 'How filtering, QR & v2rayNG work + disclaimer' },
];

export const COMMANDS_FA = [
  { command: 'start', description: 'باز کردن VPN Finder' },
  { command: 'get', description: 'دریافت مستقیم کانفیگ در چت' },
  { command: 'sub', description: 'دریافت لینک اشتراک شخصی' },
  { command: 'app', description: 'اجرای مینی‌اپ' },
  { command: 'settings', description: 'تنظیمات زبان ربات' },
  { command: 'menu', description: 'به‌روزرسانی پنل سریع چت' },
  { command: 'help', description: 'راهنمای فیلتر، QR و v2rayNG + سلب مسئولیت' },
];

export function isFa(lang) {
  return String(lang || '').toLowerCase().startsWith('fa');
}

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildAppUrl(lang, startParam = '') {
  const l = isFa(lang) ? 'fa' : 'en';
  const params = [`lang=${l}`, 'v=20261123b'];
  if (startParam) params.push(`start=${encodeURIComponent(startParam)}`);
  return `${APP_URL}?${params.join('&')}`;
}

export function buildAppKeyboard(lang, startParam = '', { includeGetButton = false } = {}) {
  const url = buildAppUrl(lang, startParam);
  const openText = isFa(lang) ? 'باز کردن VPN Finder' : 'Open VPN Finder';
  const rows = [[{ text: openText, web_app: { url } }]];
  if (includeGetButton) {
    const getText = isFa(lang) ? '📥 دریافت کانفیگ' : '📥 Get configs';
    const subText = isFa(lang) ? '🔗 اشتراک' : '🔗 Subscription';
    rows.push([
      { text: getText, callback_data: 'get_start' },
      { text: subText, callback_data: 'sub:open' },
    ]);
    rows.push([{ text: '📣 MyLeitner', url: 'https://t.me/MyLeitner' }]);
  }
  return { inline_keyboard: rows };
}

export const PANEL_BTN = {
  getEn: '📥 Get configs',
  getFa: '📥 دریافت کانفیگ',
  subEn: '🔗 Subscription',
  subFa: '🔗 اشتراک',
  appEn: '🌐 Mini App',
  appFa: '🌐 مینی‌اپ',
  settingsEn: '⚙️ Settings',
  settingsFa: '⚙️ تنظیمات',
  helpEn: '❓ Help',
  helpFa: '❓ راهنما',
  statsEn: '📊 Stats',
  statsFa: '📊 آمار',
};

export function buildReplyPanelKeyboard(lang, { isOwner = false } = {}) {
  const fa = isFa(lang);
  const appUrl = buildAppUrl(lang);
  const row3 = [{ text: fa ? PANEL_BTN.helpFa : PANEL_BTN.helpEn }];
  if (isOwner) {
    row3.push({ text: fa ? PANEL_BTN.statsFa : PANEL_BTN.statsEn });
  }
  return {
    keyboard: [
      [
        { text: fa ? PANEL_BTN.getFa : PANEL_BTN.getEn },
        { text: fa ? PANEL_BTN.subFa : PANEL_BTN.subEn },
      ],
      [
        { text: fa ? PANEL_BTN.appFa : PANEL_BTN.appEn, web_app: { url: appUrl } },
        { text: fa ? PANEL_BTN.settingsFa : PANEL_BTN.settingsEn },
      ],
      row3,
    ],
    resize_keyboard: true,
  };
}

export function panelShownText(lang) {
  return isFa(lang)
    ? '🎛 پنل سریع پایین صفحه فعال شد. با دکمه چهارنقطه‌ای کنار کادر پیام می‌توانید هر زمان پنل را جمع یا باز کنید.'
    : '🎛 Quick panel is active below. Use the 4-dot icon in the message bar anytime to collapse or expand it.';
}

export function settingsText(lang) {
  return isFa(lang)
    ? '⚙️ <b>تنظیمات ربات</b>\n\nزبان مورد نظر خود را انتخاب کنید:'
    : '⚙️ <b>Bot Settings</b>\n\nChoose your preferred language:';
}

export function langUpdatedText(lang) {
  return isFa(lang)
    ? '✅ زبان ربات به <b>فارسی</b> تغییر یافت.'
    : '✅ Bot language updated to <b>English</b>.';
}

export function settingsKeyboard(lang) {
  const fa = isFa(lang);
  return {
    inline_keyboard: [
      [
        { text: fa ? '🇺🇸 English' : '✓ 🇺🇸 English', callback_data: 'lang:set:en' },
        { text: fa ? '✓ 🇮🇷 فارسی' : '🇮🇷 فارسی', callback_data: 'lang:set:fa' },
      ],
    ],
  };
}

export function welcomeText(lang) {
  if (isFa(lang)) {
    return (
      'به VPN Finder خوش آمدید.\n\n' +
      '🔗 سریع‌ترین راه: دکمه «اشتراک» یا دستور /sub را بزنید تا یک لینک اشتراک شخصی و خودآپدیت (برای Hiddify، v2rayNG، Streisand و NekoBox) بگیرید.\n\n' +
      'سرورهای VPN عمومی بررسی‌شده را بر اساس کشور و پروتکل (VLESS، Shadowsocks، VMess، OpenVPN، Hysteria2، Trojan) همراه با سرعت، تأخیر و زمان آخرین بررسی مرور کنید.\n\n' +
      'سلب مسئولیت: تمام سرورها متعلق به اشخاص ثالث هستند؛ بررسی فنی صرفاً اتصال را می‌سنجد و تضمین حریم خصوصی یا امنیت نیست.\n\n' +
      'ساخته‌ی @MyLeitner'
    );
  }
  return (
    'Welcome to VPN Finder.\n\n' +
    '🔗 Fastest option: tap Subscription or send /sub to get a personal auto-updating subscription link for Hiddify, v2rayNG, Streisand, or NekoBox.\n\n' +
    'Browse technically-checked public VPN servers by country and protocol (VLESS, Shadowsocks, VMess, OpenVPN, Hysteria2, Trojan) with measured speed, latency, and last-checked times.\n\n' +
    'Disclaimer: Servers are operated by third parties; a technical check is not a privacy or safety guarantee.\n\n' +
    'Made by @MyLeitner'
  );
}

export function appPromptText(lang) {
  if (isFa(lang)) {
    return (
      'برای باز کردن مینی‌اپ VPN Finder دکمه زیر را بزنید.\n\n' +
      'سلب مسئولیت: تمام سرورها متعلق به اشخاص ثالث هستند؛ بررسی فنی تضمین حریم خصوصی یا امنیت نیست.'
    );
  }
  return (
    'Tap the button below to launch the VPN Finder Mini App.\n\n' +
    'Disclaimer: Servers are third-party; a technical check is not a privacy or safety guarantee.'
  );
}

export function helpText(lang) {
  if (isFa(lang)) {
    return (
      '<b>راهنمای VPN Finder</b>\n\n' +
      '• <b>فیلتر و جستجو:</b> کاتالوگ PublicVPNList را بر اساس کشور و پروتکل (VLESS، Shadowsocks، VMess، OpenVPN، Hysteria2، Trojan) فیلتر کنید و سرعت و تأخیر اندازه‌گیری‌شده در ناحیه بررسی‌کننده و زمان آخرین تست فنی را ببینید.\n' +
      '• <b>کد QR و v2rayNG:</b> برای هر سرور می‌توانید کد QR محلی دریافت کنید یا با لینک مستقیم در برنامه v2rayNG (اندروید) یا کلاینت OpenVPN وارد نمایید.\n' +
      '• <b>لینک اشتراک (/sub):</b> یک لینک اشتراک شخصی برای v2rayNG، Streisand و NekoBox بسازید که در هر بار به‌روزرسانی، کانفیگ‌های تازه می‌سازد (بدون OpenVPN).\n\n' +
      '<b>سلب مسئولیت:</b> تمام سرورها توسط اشخاص ثالث اداره می‌شوند. بررسی فنی صرفاً دسترس‌پذیری و سرعت عبور ترافیک را در لحظه تست نشان می‌دهد و به هیچ عنوان تضمین حریم خصوصی، هویت اپراتور یا امنیت نیست.\n\n' +
      'Data: <a href="https://publicvpnlist.com/api/">PublicVPNList</a>\n' +
      'سازنده: <a href="https://t.me/MyLeitner">@MyLeitner</a>'
    );
  }
  return (
    '<b>How VPN Finder Works</b>\n\n' +
    '• <b>Filtering & Metrics:</b> Filter checked public servers by country and protocol (VLESS, Shadowsocks, VMess, OpenVPN, Hysteria2, Trojan). Speed and latency figures are representative measurements from the checker region alongside each server\'s last-checked timestamp.\n' +
    '• <b>QR Code & v2rayNG:</b> Connect via locally rendered QR codes, one-tap v2rayNG Android deep-link imports, or OpenVPN configuration downloads.\n' +
    '• <b>Subscription (/sub):</b> Get a personal subscription URL for v2rayNG, Streisand, or NekoBox that assembles fresh URI configs on each refresh (OpenVPN excluded).\n\n' +
    '<b>Disclaimer:</b> All listed servers are operated by third parties. A technical check verifies reachability and throughput only and is not a privacy, identity, or safety guarantee.\n\n' +
    'Data: <a href="https://publicvpnlist.com/api/">PublicVPNList</a>\n' +
    'Creator: <a href="https://t.me/MyLeitner">@MyLeitner</a>'
  );
}

export function fallbackText(lang) {
  return isFa(lang)
    ? 'برای مرور کاتالوگ سرورها، دکمه زیر را بزنید یا دستور /get یا /help را بفرستید.'
    : 'Tap a button below to open VPN Finder, use /get for in-chat configs, or send /help.';
}

export function countryCodeToFlag(code) {
  if (!code || typeof code !== 'string' || !/^[A-Za-z]{2}$/.test(code)) {
    return '🌐';
  }
  const upper = code.toUpperCase();
  const cp1 = 0x1f1e6 + (upper.charCodeAt(0) - 65);
  const cp2 = 0x1f1e6 + (upper.charCodeAt(1) - 65);
  return String.fromCodePoint(cp1, cp2);
}

export function formatProtoLabel(proto) {
  const map = {
    vless: 'VLESS',
    vmess: 'VMess',
    trojan: 'Trojan',
    shadowsocks: 'Shadowsocks',
    hysteria2: 'Hysteria2',
    openvpn: 'OpenVPN',
    tuic: 'TUIC',
    wireguard: 'WireGuard',
    ikev2: 'IKEv2',
  };
  return map[String(proto || '').toLowerCase()] || String(proto || '').toUpperCase();
}

export function formatRelativeTime(isoString, lang) {
  if (!isoString) return isFa(lang) ? 'نامشخص' : 'unknown';
  const ts = Date.parse(isoString);
  if (Number.isNaN(ts)) return isFa(lang) ? 'نامشخص' : 'unknown';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return isFa(lang) ? 'همین الان' : 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return isFa(lang) ? `${diffMin} دقیقه پیش` : `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return isFa(lang) ? `${diffHr} ساعت پیش` : `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return isFa(lang) ? `${diffDay} روز پیش` : `${diffDay}d ago`;
}

export function riskGateText(lang) {
  if (isFa(lang)) {
    return (
      '<b>هشدار سرورهای شخص ثالث</b>\n\n' +
      'سرورهای عمومی فهرست‌شده توسط اشخاص ثالث اداره می‌شوند. بررسی فنی صرفاً اتصال و سرعت را می‌سنجد و تضمین حریم خصوصی، هویت اپراتور یا امنیت نیست. استفاده با مسئولیت خودتان است.'
    );
  }
  return (
    '<b>Third-Party Server Notice</b>\n\n' +
    'Public servers listed here are operated by third parties. A technical check verifies reachability and speed only and is not a privacy, identity, or safety guarantee. Use at your own risk.'
  );
}

export function riskGateKeyboard(lang) {
  const ok = isFa(lang) ? '✅ متوجه شدم' : '✅ I understand';
  const cancel = isFa(lang) ? 'انصراف' : 'Cancel';
  return {
    inline_keyboard: [[
      { text: ok, callback_data: 'risk_ack_ok' },
      { text: cancel, callback_data: 'risk_ack_cancel' },
    ]],
  };
}

export function flowCancelledText(lang) {
  return isFa(lang)
    ? 'درخواست دریافت کانفیگ لغو شد. هر زمان خواستید /get را بفرستید.'
    : 'Cancelled. Send /get anytime when you want to fetch configs.';
}

export function chooseProtocolText(lang) {
  return isFa(lang)
    ? 'یک پروتکل را انتخاب کنید:'
    : 'Choose a protocol:';
}

export function chooseCountryText(lang, total, protocolLabel) {
  if (isFa(lang)) {
    return `✅ ${total} کانفیگ تازه برای ${protocolLabel} موجود است. کشور را انتخاب کنید:`;
  }
  return `✅ ${total} fresh configs for ${protocolLabel}. Choose a country:`;
}

export function chooseAmountText(lang, countAvailable, protocolLabel, countryLabel, remainingBudget) {
  const capLine =
    remainingBudget < countAvailable && remainingBudget < 10
      ? isFa(lang)
        ? `\n\nسقف باقی‌مانده شما در چند دقیقه آینده: حداکثر ${remainingBudget} کانفیگ.`
        : `\n\nYou can receive up to ${remainingBudget} more in the next few minutes.`
      : '';
  if (isFa(lang)) {
    return `${countAvailable} کانفیگ تازه ${protocolLabel} برای ${countryLabel} موجود است. چند تا می‌خواهید؟${capLine}`;
  }
  return `${countAvailable} fresh ${protocolLabel} configs for ${countryLabel}. How many do you want?${capLine}`;
}

export function noneFreshText(lang, protocolLabel, countryLabel = '') {
  if (isFa(lang)) {
    return countryLabel
      ? `در حال حاضر کانفیگ تازه ${protocolLabel} برای ${countryLabel} موجود نیست. بعداً یا کشور دیگری را امتحان کنید.`
      : `در حال حاضر کانفیگ تازه برای ${protocolLabel} موجود نیست. بعداً یا پروتکل دیگری را امتحان کنید.`;
  }
  return countryLabel
    ? `No fresh ${protocolLabel} configs for ${countryLabel} right now. Try later or pick another country.`
    : `No fresh configs for ${protocolLabel} right now. Try later or pick another protocol.`;
}

export function rateLimitExhaustedText(lang) {
  return isFa(lang)
    ? 'به سقف مجاز دریافت (۱۵ کانفیگ در هر ۱۰ دقیقه) رسیدید. لطفاً چند دقیقه صبر کنید.'
    : 'You have reached the 15-config / 10-minute rate limit. Please wait a few minutes and try again.';
}

export function flowExpiredText(lang) {
  return isFa(lang)
    ? 'نشست قبلی منقضی شده است. لطفاً دوباره /get را بزنید.'
    : 'This selection expired. Send /get to start a fresh request.';
}

export function formatConfigMessage(idx, total, srv, configUri, lang) {
  const protoLabel = formatProtoLabel(srv.protocol);
  const transport = srv.transport || 'tcp';
  const speed = srv.speed_mbps !== null && srv.speed_mbps !== undefined
    ? `${Number(srv.speed_mbps).toFixed(1)} Mbps`
    : '-';
  const rel = formatRelativeTime(srv.last_checked_at, lang);
  const header = isFa(lang)
    ? `${idx}/${total} · ${protoLabel} · ${transport} · ${speed} · بررسی ${rel}`
    : `${idx}/${total} · ${protoLabel} · ${transport} · ${speed} · checked ${rel}`;
  return `${escapeHtml(header)}\n<code>${escapeHtml(configUri)}</code>`;
}

export function formatOvpnCaption(idx, total, srv, lang) {
  const speed = srv.speed_mbps !== null && srv.speed_mbps !== undefined
    ? `${Number(srv.speed_mbps).toFixed(1)} Mbps`
    : '-';
  const rel = formatRelativeTime(srv.last_checked_at, lang);
  return isFa(lang)
    ? `${idx}/${total} · OpenVPN · ${speed} · بررسی ${rel} · @MyLeitner`
    : `${idx}/${total} · OpenVPN · ${speed} · checked ${rel} · @MyLeitner`;
}

export function formatOvpnServerPageMessage(idx, total, srv, lang) {
  const cc = (srv.country_code || '').toUpperCase();
  const flag = cc.length === 2
    ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : '🌐';
  const country = srv.country_name || cc || 'OpenVPN';
  const speed = srv.speed_mbps !== null && srv.speed_mbps !== undefined
    ? `${Number(srv.speed_mbps).toFixed(1)} Mbps`
    : '-';
  const latency = srv.latency_ms !== null && srv.latency_ms !== undefined
    ? `${Math.round(Number(srv.latency_ms))} ms`
    : '-';
  const rel = formatRelativeTime(srv.last_checked_at, lang);
  const ipPart = srv.exit_ip ? ` · ${srv.exit_ip}` : '';
  return isFa(lang)
    ? `${idx}/${total} · ${flag} ${country}${ipPart} · ${speed} · ${latency} · بررسی ${rel} · @MyLeitner`
    : `${idx}/${total} · ${flag} ${country}${ipPart} · ${speed} · ${latency} · checked ${rel} · @MyLeitner`;
}

export function batchSummaryText(
  lang,
  delivered,
  requested,
  { rateLimited = false, skippedCount = 0, sendFailedCount = 0, fewerWorkingNote = false, openVpnPageMode = false } = {}
) {
  const fewerLine =
    fewerWorkingNote && !rateLimited
      ? isFa(lang)
        ? `\n\nℹ️ در حال حاضر فقط ${delivered} کانفیگ فعال موجود است.`
        : `\n\nℹ️ Only ${delivered} working configs available right now.`
      : '';
  const skippedLine =
    skippedCount > 0 && !fewerWorkingNote
      ? isFa(lang)
        ? `\n\n⚠️ ${skippedCount} سرور قابل دریافت نبود و رد شد.`
        : `\n\n⚠️ ${skippedCount} servers couldn't be fetched and were skipped.`
      : '';
  const sendFailedLine =
    sendFailedCount > 0
      ? isFa(lang)
        ? `\n\n⚠️ ارسال ${sendFailedCount} فایل ناموفق بود. لطفاً دوباره تلاش کنید.`
        : `\n\n⚠️ ${sendFailedCount} files couldn't be sent, please try again.`
      : '';
  const limitNote = rateLimited
    ? isFa(lang)
      ? `\n\nسقف درخواست (۱۵ کانفیگ در ۱۰ دقیقه) پر شد: ${delivered} از ${requested} کانفیگ ارسال شد.`
      : `\n\nStopped early at the shared rate limit (${delivered} of ${requested} delivered).`
    : '';

  if (delivered === 0) {
    if (isFa(lang)) {
      return (
        `⚠️ هیچ کانفیگی قابل ارسال نبود.${fewerLine}${skippedLine}${sendFailedLine}${limitNote}\n\n` +
        'Data: <a href="https://publicvpnlist.com/api/">PublicVPNList</a>\n' +
        'ساخته‌ی <a href="https://t.me/MyLeitner">@MyLeitner</a>'
      );
    }
    return (
      `⚠️ 0 configs sent.${fewerLine}${skippedLine}${sendFailedLine}${limitNote}\n\n` +
      'Data: <a href="https://publicvpnlist.com/api/">PublicVPNList</a>\n' +
      'Made by <a href="https://t.me/MyLeitner">@MyLeitner</a>'
    );
  }

  const openVpnPageLine =
    openVpnPageMode && delivered > 0
      ? isFa(lang)
        ? '\n\nفایل‌های OpenVPN در کاتالوگ PublicVPNList ارائه می‌شوند — روی دانلود بزنید.\n💡 پیشنهاد: برای اتصال فوری بدون دانلود دستی، از /sub یا پروتکل‌های VLESS / Hysteria2 در /get استفاده کنید.'
        : "\n\nOpenVPN files are provided in the PublicVPNList catalog — tap Download.\n💡 Tip: For instant import without manual downloads, use /sub or pick VLESS / Hysteria2 in /get."
      : '';

  if (isFa(lang)) {
    return (
      `✅ ${delivered} کانفیگ ارسال شد. این سرورها توسط PublicVPNList بررسی فنی شده‌اند؛ سرورها شخص ثالث هستند و استفاده با مسئولیت خودتان است.${openVpnPageLine}${fewerLine}${skippedLine}${sendFailedLine}${limitNote}\n\n` +
      'Data: <a href="https://publicvpnlist.com/api/">PublicVPNList</a>\n' +
      'ساخته‌ی <a href="https://t.me/MyLeitner">@MyLeitner</a>'
    );
  }
  return (
    `✅ ${delivered} configs sent. They were checked by PublicVPNList; servers are third-party, use at your own risk.${openVpnPageLine}${fewerLine}${skippedLine}${sendFailedLine}${limitNote}\n\n` +
    'Data: <a href="https://publicvpnlist.com/api/">PublicVPNList</a>\n' +
    'Made by <a href="https://t.me/MyLeitner">@MyLeitner</a>'
  );
}

export function batchSummaryKeyboard(lang, protocol, country, { allFailed = false } = {}) {
  const parts = [`lang=${isFa(lang) ? 'fa' : 'en'}`, 'v=20261123b'];
  if (protocol) parts.push(`protocol=${encodeURIComponent(protocol)}`);
  if (country && country !== 'ALL') parts.push(`country=${encodeURIComponent(country)}`);
  const qs = parts.join('&');
  const appUrl = qs ? `${APP_URL}?${qs}` : APP_URL;

  const firstBtn = allFailed
    ? { text: isFa(lang) ? '🔁 تلاش مجدد' : '🔁 Try again', callback_data: 'get_retry' }
    : { text: isFa(lang) ? '🔁 بیشتر مثل اینها' : '🔁 More like these', callback_data: 'get_more' };

  return {
    inline_keyboard: [
      [
        firstBtn,
        { text: isFa(lang) ? '🌍 تغییر کشور' : '🌍 Change country', callback_data: 'get_chg_country' },
      ],
      [
        { text: isFa(lang) ? '📱 باز کردن در مینی‌اپ' : '📱 Open in the app', web_app: { url: appUrl } },
        { text: '📣 MyLeitner', url: 'https://t.me/MyLeitner' },
      ],
    ],
  };
}
