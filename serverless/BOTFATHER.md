# BotFather Setup Checklist (`VPN Finder`)

> **Important:** Paste the texts below into `@BotFather` yourself. Or, after `npx tgcloud login` and `npx tgcloud push`, run `npx tgcloud run endpoints/setup` inside `serverless/` to apply both English (default) and Persian (`language_code: 'fa'`) descriptions, short descriptions, and commands via the Telegram Bot API automatically.

## 1. Name (`/setname`)

```text
VPN Finder
```

## 2. About / Short Description (`/setabouttext`) (max 120 chars)

### English (114 / 120 chars)
```text
Browse checked public VPN servers from PublicVPNList by country and protocol. Third-party servers; no privacy SLA.
```

### Persian (`language_code: "fa"`, 111 / 120 chars)
```text
جستجوی سرورهای VPN عمومی بررسی‌شده از PublicVPNList بر اساس کشور و پروتکل. سرورها شخص ثالث و بدون تضمین امنیت.
```

## 3. Description (`/setdescription`) (max 512 chars)

### English (436 / 512 chars)
```text
Find technically-checked public VPN servers from the PublicVPNList catalog. Filter by country and protocol (VLESS, Shadowsocks, VMess, OpenVPN, Hysteria2, Trojan), see measured speed/latency and how recently each server was checked, and get a QR code or v2rayNG import link.

Disclaimer: All listed servers are operated by third parties. A technical check verifies reachability and throughput only and is not a privacy or safety guarantee.
```

### Persian (`language_code: "fa"`, 427 / 512 chars)
```text
سرورهای VPN عمومی بررسی‌شده از کاتالوگ PublicVPNList را پیدا کنید. بر اساس کشور و پروتکل (VLESS، Shadowsocks، VMess، OpenVPN، Hysteria2، Trojan) فیلتر کنید، سرعت، تأخیر و زمان آخرین بررسی فنی هر سرور را ببینید و کد QR یا لینک ورود مستقیم به v2rayNG دریافت کنید.

سلب مسئولیت: تمام سرورها متعلق به اشخاص ثالث هستند؛ بررسی فنی صرفاً اتصال را می‌سنجد و تضمین حریم خصوصی یا امنیت نیست.
```

## 4. Commands (`/setcommands`) (only active commands, no dead commands)

### English
```text
start - Open VPN Finder
app - Launch the Mini App
get - Get working VPN configs right in chat
help - How filtering, QR & v2rayNG work + disclaimer
```

### Persian (`language_code: "fa"`)
```text
start - باز کردن VPN Finder
app - اجرای مینی‌اپ
get - دریافت مستقیم کانفیگ در چت
help - راهنمای فیلتر، QR و v2rayNG + سلب مسئولیت
```
