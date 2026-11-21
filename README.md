# VPN Finder

Telegram Mini App + Bot that browses the [PublicVPNList](https://publicvpnlist.com/api/) catalog (API v1) by country and protocol (`VLESS`, `Shadowsocks`, `VMess`, `OpenVPN`, `Hysteria2`, `Trojan`).

## Architecture & Security

- **Static Mini App**: Vanilla JS + CSS at the repository root (`index.html`, `styles.css`, `app.js`) for GitHub Pages and `tgcloud` static hosting (`serverless/dist/`).
- **Serverless Proxy & Bot (`serverless/tgcloud/`)**: Runs on Telegram Serverless (`tgcloud`).
- **Hard Security Rules**:
  - The PublicVPNList permanent API key (`pvl_api_key`), Bot API token, and `tgcloud` CLI token **never** appear in code, commits, logs, or the client bundle.
  - The proxy reads `pvl_api_key` at runtime from the SQLite `bot_config` table (`key = 'pvl_api_key'`) and calls `https://publicvpnlist.com/api/v1/` server-side with `Authorization: Bearer <pvl_api_key>`.
  - Pre-push grep gate (`npm run grep-gate` and `.githooks/pre-push`) fails if a PublicVPNList key literal, a literal token after `Authorization`, a Bot token, or a `tgcloud` CLI token appears anywhere in the repo.
  - Configuration payloads (`connection_info_url`) are never fetched, cached, or logged in Stage 1.

## Repository Layout

```text
vpn-finder/
├── index.html                           # Mini App shell (GitHub Pages root)
├── styles.css                           # Flat, Telegram theme-aware CSS (RTL/LTR)
├── app.js                               # Proxy-only client logic (Serverless.call)
├── package.json                         # Root scripts (grep-gate, local verification)
├── .githooks/pre-push                   # Git pre-push hook running grep-gate
├── scripts/
│   ├── grep-gate.js                     # Secret literal scanner
│   └── sync-static.js                   # Syncs root Mini App files into serverless/dist/
└── serverless/
    ├── AGENTS.md                        # tgcloud orientation
    ├── BOTFATHER.md                     # Exact EN + FA texts for @BotFather
    ├── package.json                     # @tgcloud/cli scripts
    ├── tgcloud.jsonc                    # Static & project config
    ├── docs/tgcloud-sdk.md              # tgcloud SDK reference
    └── tgcloud/
        ├── schema.js                    # SQLite tables: users, bot_config, pvl_cache
        ├── handlers/
        │   └── message.js               # /start, /app, /help, owner-only /stats
        ├── endpoints/
        │   ├── pvlStats.js              # Proxy -> GET /api/v1/stats
        │   ├── pvlProtocols.js          # Proxy -> GET /api/v1/protocols
        │   ├── pvlCountries.js          # Proxy -> GET /api/v1/countries?protocol=<p>
        │   └── setup.js                 # One-time Bot API EN/FA command & description setup
        └── lib/
            ├── pvl.js                   # ETag + 30m TTL cache, 429 backoff, initData auth
            └── texts.js                 # EN & FA bot strings and Web App keyboards
```

## Owner Setup (STOP Points)

1. **BotFather**: Paste the texts in [serverless/BOTFATHER.md](serverless/BOTFATHER.md) into `@BotFather` (or run `npx tgcloud run endpoints/setup` after logging in).
2. **tgcloud Login**: Inside `serverless/`, run:
   ```powershell
   cd serverless
   npx tgcloud login
   ```
3. **Deploy & Migrate**:
   ```powershell
   npm run deploy
   npx tgcloud migrate --safe
   ```
4. **Insert `pvl_api_key` and `OWNER_ID` into `bot_config`** (in your own private session).

## Attribution & Disclaimer

Data: [PublicVPNList](https://publicvpnlist.com/api/). All listed servers are operated by third parties; a technical check verifies reachability and throughput from the checker region only and is not a privacy or safety guarantee.
