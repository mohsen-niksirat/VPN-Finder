export const APP_URL = 'https://mohsen-niksirat.github.io/vpn-finder/';
export const TGCLOUD_APP_URL = 'https://app9074617711.tgcloud.ai/';
export const BOT_NAME = 'VPN Finder';

export const ABOUT_EN =
  'Browse checked public VPN servers from PublicVPNList by country and protocol. Third-party servers; no privacy SLA.';

export const ABOUT_FA =
  'جستجوی سرورهای VPN عمومی بررسی‌شده از PublicVPNList بر اساس کشور و پروتکل. سرورها شخص ثالث و بدون تضمین امنیت.';

export const DESC_EN =
  'Find technically-checked public VPN servers from the PublicVPNList catalog. Filter by country and protocol (VLESS, Shadowsocks, VMess, OpenVPN, Hysteria2, Trojan), see measured speed/latency and how recently each server was checked, and get a QR code or v2rayNG import link.\n\n' +
  'Disclaimer: All listed servers are operated by third parties. A technical check verifies reachability and throughput only and is not a privacy or safety guarantee.';

export const DESC_FA =
  'سرورهای VPN عمومی بررسی‌شده از کاتالوگ PublicVPNList را پیدا کنید. بر اساس کشور و پروتکل (VLESS، Shadowsocks، VMess، OpenVPN، Hysteria2، Trojan) فیلتر کنید، سرعت، تأخیر و زمان آخرین بررسی فنی هر سرور را ببینید و کد QR یا لینک ورود مستقیم به v2rayNG دریافت کنید.\n\n' +
  'سلب مسئولیت: تمام سرورها متعلق به اشخاص ثالث هستند؛ بررسی فنی صرفاً اتصال را می‌سنجد و تضمین حریم خصوصی یا امنیت نیست.';

export const COMMANDS_EN = [
  { command: 'start', description: 'Open VPN Finder' },
  { command: 'app', description: 'Launch the Mini App' },
  { command: 'help', description: 'How filtering, QR & v2rayNG work + disclaimer' },
];

export const COMMANDS_FA = [
  { command: 'start', description: 'باز کردن VPN Finder' },
  { command: 'app', description: 'اجرای مینی‌اپ' },
  { command: 'help', description: 'راهنمای فیلتر، QR و v2rayNG + سلب مسئولیت' },
];

export function isFa(lang) {
  return String(lang || '').toLowerCase().startsWith('fa');
}

export function buildAppKeyboard(lang, startParam = '') {
  const url = startParam ? `${APP_URL}?start=${encodeURIComponent(startParam)}` : APP_URL;
  const text = isFa(lang) ? 'باز کردن VPN Finder' : 'Open VPN Finder';
  return {
    inline_keyboard: [[{ text, web_app: { url } }]],
  };
}

export function welcomeText(lang) {
  if (isFa(lang)) {
    return (
      'به VPN Finder خوش آمدید.\n\n' +
      'سرورهای VPN عمومی بررسی‌شده از کاتالوگ PublicVPNList را بر اساس کشور و پروتکل (VLESS، Shadowsocks، VMess، OpenVPN، Hysteria2، Trojan) همراه با سرعت، تأخیر و زمان آخرین بررسی فنی مرور کنید.\n\n' +
      'سلب مسئولیت: تمام سرورها متعلق به اشخاص ثالث هستند؛ بررسی فنی صرفاً اتصال را می‌سنجد و تضمین حریم خصوصی یا امنیت نیست.'
    );
  }
  return (
    'Welcome to VPN Finder.\n\n' +
    'Browse technically-checked public VPN servers from the PublicVPNList catalog by country and protocol (VLESS, Shadowsocks, VMess, OpenVPN, Hysteria2, Trojan) with measured speed, latency, and last-checked times.\n\n' +
    'Disclaimer: Servers are operated by third parties; a technical check is not a privacy or safety guarantee.'
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
      '• <b>کد QR و v2rayNG:</b> برای هر سرور می‌توانید کد QR محلی دریافت کنید یا با لینک مستقیم در برنامه v2rayNG (اندروید) یا کلاینت OpenVPN وارد نمایید.\n\n' +
      '<b>سلب مسئولیت:</b> تمام سرورها توسط اشخاص ثالث اداره می‌شوند. بررسی فنی صرفاً دسترس‌پذیری و سرعت عبور ترافیک را در لحظه تست نشان می‌دهد و به هیچ عنوان تضمین حریم خصوصی، هویت اپراتور یا امنیت نیست.\n\n' +
      'Data: <a href="https://publicvpnlist.com/api/">PublicVPNList</a>'
    );
  }
  return (
    '<b>How VPN Finder Works</b>\n\n' +
    '• <b>Filtering & Metrics:</b> Filter checked public servers by country and protocol (VLESS, Shadowsocks, VMess, OpenVPN, Hysteria2, Trojan). Speed and latency figures are representative measurements from the checker region alongside each server\'s last-checked timestamp.\n' +
    '• <b>QR Code & v2rayNG:</b> Connect via locally rendered QR codes, one-tap v2rayNG Android deep-link imports, or OpenVPN configuration downloads.\n\n' +
    '<b>Disclaimer:</b> All listed servers are operated by third parties. A technical check verifies reachability and throughput only and is not a privacy, identity, or safety guarantee.\n\n' +
    'Data: <a href="https://publicvpnlist.com/api/">PublicVPNList</a>'
  );
}

export function fallbackText(lang) {
  return isFa(lang)
    ? 'برای مرور کاتالوگ سرورها، دکمه زیر را بزنید یا دستور /help را بفرستید.'
    : 'Tap the button below to open VPN Finder, or send /help for details.';
}
