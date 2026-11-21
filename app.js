// ============================================================
// VPN Finder Mini App (Stage 2: Server List + Filters)
// Talks ONLY to the tgcloud proxy endpoints (pvlStats, pvlProtocols, pvlCountries, pvlServers)
// or reads the proxy-generated pvl-snapshot.json v2 fallback outside Telegram.
// Never embeds or touches the PublicVPNList API key.
// ============================================================

(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const urlParams = new URLSearchParams(window.location.search);

  const I18N = {
    en: {
      title: 'VPN Finder',
      subtitle: 'PublicVPNList Checked Catalog',
      refresh: 'Refresh',
      retry: 'Retry',
      checkAgain: 'Check Again',
      totalRecords: 'Server Records',
      countryCount: 'Countries',
      snapshotUpdated: 'Snapshot Updated',
      liveBadge: 'Live',
      previewBadge: 'Preview data',
      previewBanner:
        'Preview mode: showing top 20 servers per protocol by score from the latest snapshot. Open inside Telegram (@publicvpnlist_bot) for live country filtering, sorting, and pagination.',
      protocolFilterLabel: 'Protocol',
      medianSpeedPrefix: 'Checker median:',
      countryFilterLabel: 'Country',
      allCountries: 'All countries',
      countrySheetTitle: 'Select Country',
      countrySearchPlaceholder: 'Search country or ISO code...',
      noCountryGeoNote: 'Country is not published for this protocol',
      sortFilterLabel: 'Sort by',
      sortScore: 'Best score',
      sortSpeed: 'Fastest',
      sortLatency: 'Lowest latency',
      sortRecent: 'Most recent',
      serversHeading: 'Online Servers',
      checkerRegionNote:
        'Speed and latency are representative measurements from the PublicVPNList checker region.',
      showingRange: 'Showing {shown} of {total}',
      loadMore: 'Load more',
      loadingMore: 'Loading...',
      filterEmptyTitle: 'No online servers match',
      filterEmptyBody: 'Try another country or protocol filter.',
      resetFilters: 'Reset filters',
      listErrorTitle: 'Could not load servers',
      listErrorBody: 'Failed to fetch servers for the selected filters.',
      notMeasured: 'Not measured',
      unknownDash: '-',
      mbpsUnit: 'Mbps',
      msUnit: 'ms',
      speedLabel: 'Speed:',
      latencyLabel: 'Latency:',
      scorePrefix: 'Score',
      riskWarningLabel: 'Caution',
      riskTooltipPrefix: 'Risk flags:',
      checkedJustNow: 'checked just now',
      checkedMinAgo: 'checked {n} min ago',
      checkedHrAgo: 'checked {n} hr ago',
      checkedDayAgo: 'checked {n} d ago',
      unknownLocation: 'Location not published',
      detailsExpand: 'Details ▾',
      detailsCollapse: 'Hide details ▴',
      detailSource: 'Source',
      detailFirstSeen: 'First seen',
      detailUptime7d: '7d Uptime',
      detailFreshness: 'Freshness',
      detailServerId: 'Record ID',
      detailCatalogLink: 'Open on PublicVPNList ↗',
      recordsLabel: 'records',
      dataLabel: 'Data:',
      snapshotLabel: 'Snapshot:',
      disclaimer:
        'Servers are operated by third parties; a technical check verifies reachability and speed only and is not a privacy or safety guarantee.',
      errUnavailableTitle: 'Temporarily Unavailable',
      errUnavailableBody: 'The catalog service is temporarily unavailable. Please try again later.',
      errAuthTitle: 'Open Inside Telegram',
      errAuthBody:
        'VPN Finder validates Telegram Mini App initData on every proxy request. Please launch this Mini App from the @publicvpnlist_bot bot in Telegram.',
      errNetworkBody: 'Could not reach the proxy endpoint. Check your connection and retry.',
      emptyTitle: 'No Active Records',
      emptyBody: 'The current PublicVPNList snapshot returned zero server records.',
      langToggle: 'FA',
    },
    fa: {
      title: 'VPN Finder',
      subtitle: 'کاتالوگ سرورهای بررسی‌شده PublicVPNList',
      refresh: 'بروزرسانی',
      retry: 'تلاش مجدد',
      checkAgain: 'بررسی مجدد',
      totalRecords: 'رکوردهای سرور',
      countryCount: 'کشورها',
      snapshotUpdated: 'بروزرسانی اسنپ‌شات',
      liveBadge: 'زنده',
      previewBadge: 'داده پیش‌نمایش',
      previewBanner:
        'حالت پیش‌نمایش: نمایش ۲۰ سرور برتر هر پروتکل بر اساس امتیاز از آخرین اسنپ‌شات. برای فیلتر زنده کشور، مرتب‌سازی و صفحه‌بندی، مینی‌اپ را در تلگرام (@publicvpnlist_bot) باز کنید.',
      protocolFilterLabel: 'پروتکل',
      medianSpeedPrefix: 'میانه سرعت تست:',
      countryFilterLabel: 'کشور',
      allCountries: 'همه کشورها',
      countrySheetTitle: 'انتخاب کشور',
      countrySearchPlaceholder: 'جستجوی نام یا کد کشور...',
      noCountryGeoNote: 'کشور برای این پروتکل منتشر نشده است',
      sortFilterLabel: 'مرتب‌سازی',
      sortScore: 'بهترین امتیاز',
      sortSpeed: 'سریع‌ترین',
      sortLatency: 'کمترین تأخیر',
      sortRecent: 'جدیدترین بررسی',
      serversHeading: 'سرورهای آنلاین',
      checkerRegionNote:
        'سرعت و تأخیر، مقادیر اندازه‌گیری‌شده در ناحیه سرور تست PublicVPNList هستند.',
      showingRange: 'نمایش {shown} از {total}',
      loadMore: 'نمایش بیشتر',
      loadingMore: 'در حال دریافت...',
      filterEmptyTitle: 'سرور آنلاینی با این فیلتر یافت نشد',
      filterEmptyBody: 'کشور یا پروتکل دیگری را امتحان کنید.',
      resetFilters: 'بازنشانی فیلترها',
      listErrorTitle: 'خطا در دریافت لیست سرورها',
      listErrorBody: 'دریافت سرورها برای فیلتر انتخاب‌شده انجام نشد.',
      notMeasured: 'اندازه‌گیری نشده',
      unknownDash: '-',
      mbpsUnit: 'مگابیت/ثانیه',
      msUnit: 'میلی‌ثانیه',
      speedLabel: 'سرعت:',
      latencyLabel: 'تأخیر:',
      scorePrefix: 'امتیاز',
      riskWarningLabel: 'هشدار',
      riskTooltipPrefix: 'پرچم‌های ریسک:',
      checkedJustNow: 'بررسی‌شده همین الان',
      checkedMinAgo: 'بررسی‌شده {n} دقیقه پیش',
      checkedHrAgo: 'بررسی‌شده {n} ساعت پیش',
      checkedDayAgo: 'بررسی‌شده {n} روز پیش',
      unknownLocation: 'موقعیت منتشر نشده',
      detailsExpand: 'جزئیات ▾',
      detailsCollapse: 'بستن جزئیات ▴',
      detailSource: 'منبع',
      detailFirstSeen: 'اولین ثبت',
      detailUptime7d: 'آپ‌تایم ۷ روزه',
      detailFreshness: 'تازگی',
      detailServerId: 'شناسه رکورد',
      detailCatalogLink: 'مشاهده در PublicVPNList ↗',
      recordsLabel: 'سرور',
      dataLabel: 'Data:',
      snapshotLabel: 'اسنپ‌شات:',
      disclaimer:
        'تمام سرورها توسط اشخاص ثالث اداره می‌شوند؛ بررسی فنی صرفاً اتصال و سرعت را می‌سنجد و تضمین حریم خصوصی یا امنیت نیست.',
      errUnavailableTitle: 'موقتاً در دسترس نیست',
      errUnavailableBody: 'سرویس کاتالوگ موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.',
      errAuthTitle: 'اجرا در داخل تلگرام',
      errAuthBody:
        'هر درخواست پروکسی نیازمند احراز هویت معتبر تلگرام (initData) است. لطفاً مینی‌اپ را از داخل ربات @publicvpnlist_bot در تلگرام باز کنید.',
      errNetworkBody: 'ارتباط با پروکسی برقرار نشد. اتصال اینترنت را بررسی کرده و دوباره تلاش کنید.',
      emptyTitle: 'سروری یافت نشد',
      emptyBody: 'اسنپ‌شات فعلی هیچ رکورد سروری برنگرداند.',
      langToggle: 'EN',
    },
  };

  const PROTOCOL_LABELS = {
    openvpn: 'OpenVPN',
    vless: 'VLESS',
    shadowsocks: 'Shadowsocks',
    vmess: 'VMess',
    hysteria2: 'Hysteria2',
    trojan: 'Trojan',
    tuic: 'TUIC',
    wireguard: 'WireGuard',
    ikev2: 'IKEv2',
  };

  // Preferred display order for protocol chips when active
  const PROTOCOL_ORDER = [
    'vless',
    'shadowsocks',
    'vmess',
    'openvpn',
    'hysteria2',
    'trojan',
    'tuic',
    'wireguard',
    'ikev2',
  ];

  const VALID_SORTS = new Set(['score', 'speed', 'latency', 'last_checked']);

  function detectInitialLanguage() {
    const paramLang = urlParams.get('lang');
    if (paramLang) {
      return paramLang.toLowerCase().startsWith('fa') ? 'fa' : 'en';
    }
    const tgLang = tg?.initDataUnsafe?.user?.language_code || '';
    if (String(tgLang).toLowerCase().startsWith('fa')) {
      return 'fa';
    }
    return 'en';
  }

  /**
   * Parses deep-link preselection from `?protocol=` & `?country=`, or from
   * Telegram's `start_param` / `?start=` (e.g. `protocol_vless_country_NL` or `vless_NL`).
   */
  function parseDeepLinkPreselection() {
    let proto = (urlParams.get('protocol') || '').trim().toLowerCase();
    let country = (urlParams.get('country') || '').trim().toUpperCase();

    const startRaw =
      urlParams.get('start') ||
      urlParams.get('tgWebAppStartParam') ||
      tg?.initDataUnsafe?.start_param ||
      '';

    if (startRaw) {
      const s = String(startRaw).trim();
      const pm = s.match(/(?:^|[_&-])protocol[=_-]([a-z0-9]+)/i);
      const cm = s.match(/(?:^|[_&-])country[=_-]([A-Za-z]{2})(?:$|[_&-])/i);
      if (!proto && pm) proto = pm[1].toLowerCase();
      if (!country && cm) country = cm[1].toUpperCase();

      if (!proto && !country) {
        const directMatch = s.match(/^([a-z0-9]+)(?:[_-]([A-Za-z]{2}))?$/i);
        if (directMatch && PROTOCOL_LABELS[directMatch[1].toLowerCase()]) {
          proto = directMatch[1].toLowerCase();
          if (directMatch[2]) country = directMatch[2].toUpperCase();
        }
      }
    }

    if (country && !/^[A-Z]{2}$/.test(country)) {
      country = '';
    }
    return { protocol: proto, country };
  }

  const deepLinkInit = parseDeepLinkPreselection();

  // Application State
  const state = {
    lang: detectInitialLanguage(),
    isPreviewFallback: false,
    totalRecords: 0,
    distinctCountryCount: 0,
    snapshotTimestamp: null,
    activeProtocols: [], // [{ id, label, records, medianSpeed }]
    countriesByProtocol: {}, // { [proto]: [{ code, name, count }] }
    selectedProtocol: 'vless',
    selectedCountry: '', // '' = All countries
    selectedSort: 'score',
    page: 1,
    totalMatching: 0,
    hasMorePages: false,
    servers: [],
    expandedCardIds: new Set(),
    isLoadingList: false,
    isLoadingMore: false,
    listError: false,
    reqSeq: 0,
    filterDebounceTimer: null,
    deepLinkApplied: false,
  };

  let cachedSnapshotBundle = null;

  function applyTheme() {
    const scheme =
      tg?.colorScheme ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light');
    document.documentElement.setAttribute('data-theme', scheme === 'dark' ? 'dark' : 'light');
  }

  function formatNumber(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '..';
    try {
      return Number(n).toLocaleString(state.lang === 'fa' ? 'fa-IR' : 'en-US');
    } catch {
      return String(n);
    }
  }

  function formatDecimal(n, digits = 2) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
    const num = Number(n);
    if (!Number.isFinite(num)) return null;
    try {
      return num.toLocaleString(state.lang === 'fa' ? 'fa-IR' : 'en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    } catch {
      return num.toFixed(digits);
    }
  }

  function formatSpeed(val) {
    const t = I18N[state.lang];
    if (val === null || val === undefined || val === '' || Number.isNaN(Number(val))) {
      return t.notMeasured;
    }
    const num = Number(val);
    if (!Number.isFinite(num) || num <= 0) {
      return t.notMeasured;
    }
    return `${formatDecimal(num, 2)} ${t.mbpsUnit}`;
  }

  function formatLatency(val) {
    const t = I18N[state.lang];
    if (val === null || val === undefined || val === '' || Number.isNaN(Number(val))) {
      return t.unknownDash;
    }
    const num = Math.round(Number(val));
    if (!Number.isFinite(num) || num <= 0) {
      return t.unknownDash;
    }
    return `${formatNumber(num)} ${t.msUnit}`;
  }

  function formatTimestamp(ts) {
    if (!ts) return '..';
    const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    const isoDate = d.toISOString().slice(0, 10);
    const isoTime = d.toISOString().slice(11, 16) + ' UTC';
    return `${isoDate} ${isoTime}`;
  }

  function formatDateShort(ts) {
    if (!ts) return '..';
    const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toISOString().slice(0, 10);
  }

  function formatRelativeChecked(isoStr) {
    const t = I18N[state.lang];
    if (!isoStr) return t.unknownDash;
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return String(isoStr);
    const refMs = state.snapshotTimestamp ? new Date(state.snapshotTimestamp).getTime() : Date.now();
    const baseNow = Number.isFinite(refMs) && refMs > d.getTime() ? Math.max(Date.now(), refMs) : Date.now();
    const diffMin = Math.max(0, Math.floor((baseNow - d.getTime()) / 60000));
    if (diffMin < 1) return t.checkedJustNow;
    if (diffMin < 60) return t.checkedMinAgo.replace('{n}', formatNumber(diffMin));
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 48) return t.checkedHrAgo.replace('{n}', formatNumber(diffHr));
    const diffDays = Math.floor(diffHr / 24);
    return t.checkedDayAgo.replace('{n}', formatNumber(diffDays));
  }

  function countryCodeToFlag(code) {
    const clean = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(clean)) return '🌐';
    const first = 0x1f1e6 + (clean.charCodeAt(0) - 65);
    const second = 0x1f1e6 + (clean.charCodeAt(1) - 65);
    return String.fromCodePoint(first, second);
  }

  function setViewState(view) {
    document.getElementById('state-loading').hidden = view !== 'loading';
    document.getElementById('state-error').hidden = view !== 'error';
    document.getElementById('state-empty').hidden = view !== 'empty';
    document.getElementById('state-ready').hidden = view !== 'ready';
  }

  async function loadSnapshotBundleFallback() {
    if (cachedSnapshotBundle) return cachedSnapshotBundle;
    const res = await fetch('./pvl-snapshot.json', { cache: 'no-store' });
    if (!res.ok) {
      const e = new Error(`HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    cachedSnapshotBundle = await res.json();
    return cachedSnapshotBundle;
  }

  /**
   * Client-side filter/sort over snapshot preview records when running outside Telegram
   * so country selection, sorting, and deep links remain responsive in preview mode.
   */
  function querySnapshotPreviewServers(bundle, input) {
    const proto = String(input?.protocol || 'vless').toLowerCase();
    const previewBlock = bundle?.servers_preview?.[proto];
    let rows = Array.isArray(previewBlock?.data) ? [...previewBlock.data] : [];

    const country = String(input?.country || '').trim().toUpperCase();
    if (country && /^[A-Z]{2}$/.test(country)) {
      rows = rows.filter((r) => String(r?.country_code || '').toUpperCase() === country);
    }

    const sortKey = input?.sort || 'score';
    if (sortKey === 'speed') {
      rows.sort((a, b) => Number(b?.speed_mbps || -1) - Number(a?.speed_mbps || -1));
    } else if (sortKey === 'latency') {
      rows.sort((a, b) => {
        const la = a?.latency_ms !== null && a?.latency_ms !== undefined ? Number(a.latency_ms) : 999999;
        const lb = b?.latency_ms !== null && b?.latency_ms !== undefined ? Number(b.latency_ms) : 999999;
        return la - lb;
      });
    } else if (sortKey === 'last_checked') {
      rows.sort((a, b) => {
        const ta = a?.last_checked_at ? new Date(a.last_checked_at).getTime() : 0;
        const tb = b?.last_checked_at ? new Date(b.last_checked_at).getTime() : 0;
        return tb - ta;
      });
    } else {
      rows.sort((a, b) => {
        const sa = Number(a?.technical_quality_score ?? -1);
        const sb = Number(b?.technical_quality_score ?? -1);
        if (sb !== sa) return sb - sa;
        return Number(b?.speed_mbps || 0) - Number(a?.speed_mbps || 0);
      });
    }

    return {
      data: rows,
      meta: {
        ...(previewBlock?.meta || {}),
        total: country ? rows.length : Number(previewBlock?.meta?.total ?? rows.length),
        page: 1,
        per_page: 20,
        pages: 1,
        is_preview: true,
      },
    };
  }

  /**
   * Calls a tgcloud proxy endpoint (`pvlStats`, `pvlProtocols`, `pvlCountries`, `pvlServers`).
   * 1. When inside Telegram on the tgcloud host (or via test mock), calls the proxy directly.
   * 2. When outside Telegram (e.g. GitHub Pages in a plain browser), uses the proxy-generated
   *    `pvl-snapshot.json` v2 fallback and sets `state.isPreviewFallback = true`.
   */
  function callProxyEndpoint(name, input = {}) {
    return new Promise((resolve, reject) => {
      if (typeof window.__VPN_FINDER_MOCK_CALL__ === 'function') {
        state.isPreviewFallback = Boolean(window.__VPN_FINDER_FORCE_PREVIEW__);
        Promise.resolve(window.__VPN_FINDER_MOCK_CALL__(name, input)).then(resolve, reject);
        return;
      }

      const hasInitData = Boolean(tg && typeof tg.initData === 'string' && tg.initData.length > 0);
      const isTgcloudHost = window.location.hostname.endsWith('.tgcloud.ai');

      if (isTgcloudHost && hasInitData && tg && tg.Serverless && typeof tg.Serverless.call === 'function') {
        state.isPreviewFallback = false;
        try {
          tg.Serverless.call(name, input, function (err, result) {
            if (err) {
              reject(err);
              return;
            }
            resolve(result);
          });
          return;
        } catch (err) {
          reject(err);
          return;
        }
      }

      // Outside-Telegram fallback -> read proxy-generated snapshot v2
      state.isPreviewFallback = true;
      loadSnapshotBundleFallback()
        .then((bundle) => {
          if (!bundle || bundle.error) {
            resolve({ error: bundle?.error || 'setup_required' });
            return;
          }
          if (name === 'pvlStats') {
            resolve(bundle.stats);
          } else if (name === 'pvlProtocols') {
            resolve(bundle.protocols);
          } else if (name === 'pvlCountries') {
            const proto = String(input?.protocol || 'openvpn').toLowerCase();
            if (bundle.countries_by_protocol && bundle.countries_by_protocol[proto]) {
              resolve(bundle.countries_by_protocol[proto]);
            } else if (proto === bundle.protocol && bundle.countries) {
              resolve(bundle.countries);
            } else {
              resolve({ data: [], meta: { total: 0 } });
            }
          } else if (name === 'pvlServers') {
            resolve(querySnapshotPreviewServers(bundle, input));
          } else {
            reject(new Error(`Unknown proxy endpoint: ${name}`));
          }
        })
        .catch(reject);
    });
  }

  function parseCatalogSummary(statsRes, protocolsRes) {
    const statsData =
      statsRes && typeof statsRes.data === 'object' && !Array.isArray(statsRes.data)
        ? statsRes.data
        : statsRes || {};
    const statsMeta = statsRes && typeof statsRes.meta === 'object' ? statsRes.meta : {};

    const protoListRaw = Array.isArray(protocolsRes?.data) ? protocolsRes.data : [];
    const protoCountsMap = statsData.protocol_record_counts || {};

    const activeProtocols = [];
    let sumRecords = 0;

    for (const item of protoListRaw) {
      const id = String(item?.protocol || '').trim().toLowerCase();
      if (!id) continue;
      const records = Number(item?.record_count ?? protoCountsMap[id] ?? 0) || 0;
      sumRecords += records;
      if (records > 0) {
        activeProtocols.push({
          id,
          label: PROTOCOL_LABELS[id] || id.toUpperCase(),
          records,
          medianSpeed:
            item.median_speed_mbps !== null && item.median_speed_mbps !== undefined
              ? Number(item.median_speed_mbps)
              : null,
        });
      }
    }

    // Sort protocol chips by PROTOCOL_ORDER or record count
    activeProtocols.sort((a, b) => {
      const ia = PROTOCOL_ORDER.indexOf(a.id);
      const ib = PROTOCOL_ORDER.indexOf(b.id);
      if (ia !== -1 && ib !== -1) return ia - ib;
      return b.records - a.records;
    });

    const totalRecords = Math.max(
      sumRecords,
      Number(statsData.total_records ?? statsData.record_count ?? 0) || 0
    );

    const distinctCountryCount = Number(
      statsData.distinct_country_count ??
        statsRes?.distinct_country_count ??
        statsData.countries_count ??
        statsData.country_count ??
        0
    );

    const snapshotTimestamp =
      statsMeta.generated_at ||
      statsData.generated_at ||
      protocolsRes?.meta?.generated_at ||
      statsRes?._cache?.fetched_at ||
      null;

    return {
      totalRecords,
      distinctCountryCount,
      snapshotTimestamp,
      activeProtocols,
    };
  }

  function normalizeCountriesList(countriesRes) {
    const raw = Array.isArray(countriesRes?.data) ? countriesRes.data : [];
    return raw
      .map((c) => ({
        code: String(c?.country_code || c?.code || '').trim().toUpperCase(),
        name: String(c?.country_name || c?.name || c?.country_code || '').trim(),
        count: Number(c?.record_count ?? c?.count ?? 0) || 0,
      }))
      .filter((c) => /^[A-Z]{2}$/.test(c.code) && c.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  async function ensureCountriesForProtocol(proto) {
    if (state.countriesByProtocol[proto]) {
      return state.countriesByProtocol[proto];
    }
    try {
      const res = await callProxyEndpoint('pvlCountries', { protocol: proto });
      const list = normalizeCountriesList(res);
      state.countriesByProtocol[proto] = list;
      return list;
    } catch {
      state.countriesByProtocol[proto] = [];
      return [];
    }
  }

  function renderHeaderAndCounters() {
    const t = I18N[state.lang];
    document.getElementById('val-total-records').textContent = formatNumber(state.totalRecords);
    document.getElementById('val-country-count').textContent = formatNumber(state.distinctCountryCount);
    document.getElementById('val-snapshot-time').textContent = formatTimestamp(state.snapshotTimestamp);

    const badgeEl = document.getElementById('freshness-badge');
    if (badgeEl) {
      const tsStr = formatTimestamp(state.snapshotTimestamp);
      if (state.isPreviewFallback) {
        badgeEl.className = 'freshness-badge is-preview';
        badgeEl.textContent = `${t.previewBadge} · ${tsStr}`;
      } else {
        badgeEl.className = 'freshness-badge is-live';
        badgeEl.textContent = `${t.liveBadge} · ${tsStr}`;
      }
      badgeEl.hidden = false;
    }

    const previewBanner = document.getElementById('preview-mode-banner');
    if (previewBanner) {
      previewBanner.hidden = !state.isPreviewFallback;
      document.getElementById('preview-banner-text').textContent = t.previewBanner;
    }

    const footerTime = document.getElementById('footer-snapshot-date');
    footerTime.textContent = formatDateShort(state.snapshotTimestamp);
    if (state.snapshotTimestamp) {
      const d =
        typeof state.snapshotTimestamp === 'number'
          ? new Date(state.snapshotTimestamp * 1000)
          : new Date(state.snapshotTimestamp);
      if (!Number.isNaN(d.getTime())) {
        footerTime.setAttribute('datetime', d.toISOString());
      }
    }
  }

  function protocolSupportsScore(proto) {
    return String(proto || '').toLowerCase() === 'openvpn';
  }

  function renderProtocolChips() {
    const t = I18N[state.lang];
    const container = document.getElementById('protocol-chips');
    container.innerHTML = '';

    for (const p of state.activeProtocols) {
      const isSelected = p.id === state.selectedProtocol;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `proto-chip${isSelected ? ' is-active' : ''}`;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      btn.setAttribute('data-protocol', p.id);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.label;

      const countSpan = document.createElement('span');
      countSpan.className = 'proto-chip-count';
      countSpan.textContent = formatNumber(p.records);

      btn.appendChild(nameSpan);
      btn.appendChild(countSpan);

      btn.addEventListener('click', () => {
        if (state.selectedProtocol === p.id) return;
        state.selectedProtocol = p.id;
        state.selectedCountry = '';
        if (!protocolSupportsScore(p.id) && state.selectedSort === 'score') {
          state.selectedSort = 'last_checked';
        } else if (protocolSupportsScore(p.id) && state.selectedSort === 'last_checked') {
          state.selectedSort = 'score';
        }
        renderProtocolChips();
        renderSortButtons();
        scheduleFilterReload();
      });

      container.appendChild(btn);
    }

    const currentProtoObj = state.activeProtocols.find((p) => p.id === state.selectedProtocol);
    const speedHint = document.getElementById('protocol-speed-hint');
    if (currentProtoObj && currentProtoObj.medianSpeed) {
      speedHint.textContent = `${t.medianSpeedPrefix} ${formatSpeed(currentProtoObj.medianSpeed)}`;
    } else {
      speedHint.textContent = '';
    }
  }

  function renderCountryTrigger() {
    const t = I18N[state.lang];
    const btn = document.getElementById('country-picker-btn');
    const labelEl = document.getElementById('country-picker-label');
    const noteEl = document.getElementById('country-filter-note');
    const countries = state.countriesByProtocol[state.selectedProtocol] || [];
    const hasCountries = countries.length > 0;

    if (!hasCountries || !state.selectedCountry) {
      labelEl.textContent = hasCountries
        ? `${t.allCountries} (${formatNumber(countries.length)})`
        : t.allCountries;
    } else {
      const match = countries.find((c) => c.code === state.selectedCountry);
      const flag = countryCodeToFlag(state.selectedCountry);
      if (match) {
        labelEl.textContent = `${flag} ${match.name} (${formatNumber(match.count)})`;
      } else {
        labelEl.textContent = `${flag} ${state.selectedCountry}`;
      }
    }

    const isDisabled = state.isPreviewFallback || !hasCountries;
    btn.disabled = isDisabled;
    if (isDisabled) {
      btn.setAttribute('aria-disabled', 'true');
    } else {
      btn.removeAttribute('aria-disabled');
    }

    if (noteEl) {
      if (!hasCountries) {
        noteEl.textContent = t.noCountryGeoNote;
        noteEl.hidden = false;
      } else {
        noteEl.textContent = '';
        noteEl.hidden = true;
      }
    }
  }

  function renderSortButtons() {
    const t = I18N[state.lang];
    const labels = {
      score: t.sortScore,
      speed: t.sortSpeed,
      latency: t.sortLatency,
      last_checked: t.sortRecent,
    };

    const supportsScore = protocolSupportsScore(state.selectedProtocol);
    if (!supportsScore && state.selectedSort === 'score') {
      state.selectedSort = 'last_checked';
    }
    if (state.isPreviewFallback) {
      state.selectedSort = supportsScore ? 'score' : 'last_checked';
    }

    const buttons = document.querySelectorAll('#sort-segmented .sort-btn');
    buttons.forEach((btn) => {
      const sortVal = btn.getAttribute('data-sort');
      if (labels[sortVal]) {
        btn.textContent = labels[sortVal];
      }
      if (sortVal === 'score') {
        btn.hidden = !supportsScore;
      }
      const active = sortVal === state.selectedSort;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
      btn.disabled = state.isPreviewFallback;
      if (state.isPreviewFallback) {
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.removeAttribute('aria-disabled');
      }
    });
  }

  function renderServerCards() {
    const t = I18N[state.lang];
    const listEl = document.getElementById('servers-list');
    const emptyEl = document.getElementById('list-empty');
    const errorEl = document.getElementById('list-error');
    const loadingEl = document.getElementById('list-loading');
    const paginationBar = document.getElementById('pagination-bar');
    const loadMoreBtn = document.getElementById('load-more-btn');
    const showingTextEl = document.getElementById('showing-count-text');

    loadingEl.hidden = !state.isLoadingList;
    errorEl.hidden = !state.listError || state.isLoadingList;
    emptyEl.hidden =
      state.isLoadingList || state.listError || state.servers.length > 0;
    listEl.hidden = state.isLoadingList || state.listError || state.servers.length === 0;

    if (state.isLoadingList || state.listError || state.servers.length === 0) {
      showingTextEl.textContent = '';
      paginationBar.hidden = true;
      return;
    }

    const shownCount = state.servers.length;
    const totalCount = Math.max(shownCount, state.totalMatching || shownCount);
    showingTextEl.textContent = t.showingRange
      .replace('{shown}', formatNumber(shownCount))
      .replace('{total}', formatNumber(totalCount));

    listEl.innerHTML = '';

    for (const srv of state.servers) {
      const cardId = String(srv.id || '');
      const isExpanded = state.expandedCardIds.has(cardId);

      const card = document.createElement('article');
      card.className = 'server-card';
      card.setAttribute('data-server-id', cardId);

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'server-card-trigger';
      trigger.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

      // Row 1: Flag + Country (+ City) + Quality Badge + Risk Flag Warning
      const topRow = document.createElement('div');
      topRow.className = 'server-card-top';

      const locGroup = document.createElement('div');
      locGroup.className = 'server-location';

      const flagSpan = document.createElement('span');
      flagSpan.className = 'server-flag';
      flagSpan.setAttribute('aria-hidden', 'true');
      flagSpan.textContent = countryCodeToFlag(srv.country_code);

      const countrySpan = document.createElement('span');
      countrySpan.className = 'server-country-text';
      const cName = srv.country_name || srv.country_code || t.unknownLocation;
      countrySpan.textContent = srv.country_code
        ? `${cName} (${srv.country_code})`
        : cName;

      locGroup.appendChild(flagSpan);
      locGroup.appendChild(countrySpan);

      if (srv.city) {
        const citySpan = document.createElement('span');
        citySpan.className = 'server-city-text';
        citySpan.textContent = `· ${srv.city}`;
        locGroup.appendChild(citySpan);
      }

      const badgesGroup = document.createElement('div');
      badgesGroup.className = 'server-badges';

      if (srv.technical_quality_score !== null && srv.technical_quality_score !== undefined) {
        const qBadge = document.createElement('span');
        const scoreNum = Number(srv.technical_quality_score);
        qBadge.className = `quality-badge${scoreNum >= 70 ? ' is-high' : ''}`;
        const labelPart = srv.score_label ? ` (${srv.score_label})` : '';
        qBadge.textContent = `${t.scorePrefix} ${formatNumber(scoreNum)}${labelPart}`;
        badgesGroup.appendChild(qBadge);
      } else if (srv.freshness_status) {
        const fChip = document.createElement('span');
        const freshNorm = String(srv.freshness_status).toLowerCase();
        fChip.className = `freshness-chip${freshNorm === 'fresh' ? ' is-fresh' : ''}`;
        fChip.textContent = String(srv.freshness_status);
        badgesGroup.appendChild(fChip);
      }

      if (Array.isArray(srv.risk_flags) && srv.risk_flags.length > 0) {
        const rBadge = document.createElement('span');
        rBadge.className = 'risk-badge';
        const flagsText = srv.risk_flags.join(', ');
        rBadge.title = `${t.riskTooltipPrefix} ${flagsText}`;
        rBadge.setAttribute('aria-label', `${t.riskTooltipPrefix} ${flagsText}`);
        rBadge.textContent = `⚠ ${t.riskWarningLabel} (${formatNumber(srv.risk_flags.length)})`;
        badgesGroup.appendChild(rBadge);
      }

      topRow.appendChild(locGroup);
      topRow.appendChild(badgesGroup);

      // Row 2: protocol · transport · port + speed + latency
      const midRow = document.createElement('div');
      midRow.className = 'server-card-mid';

      const protoLabel = PROTOCOL_LABELS[String(srv.protocol || '').toLowerCase()] || String(srv.protocol || '').toUpperCase();
      const transportStr = srv.transport ? String(srv.transport).toUpperCase() : 'TCP';
      const portStr = srv.port ? String(srv.port) : t.unknownDash;

      const endpointMeta = document.createElement('span');
      endpointMeta.className = 'server-endpoint-meta';
      endpointMeta.textContent = `${protoLabel} · ${transportStr} · :${portStr}`;

      const metricsGroup = document.createElement('div');
      metricsGroup.className = 'server-metrics';

      const speedItem = document.createElement('span');
      speedItem.className = 'metric-item';
      const speedLbl = document.createElement('span');
      speedLbl.className = 'metric-label';
      speedLbl.textContent = t.speedLabel;
      const speedVal = document.createElement('span');
      speedVal.className = 'metric-val';
      speedVal.textContent = formatSpeed(srv.speed_mbps);
      speedItem.appendChild(speedLbl);
      speedItem.appendChild(speedVal);

      const latItem = document.createElement('span');
      latItem.className = 'metric-item';
      const latLbl = document.createElement('span');
      latLbl.className = 'metric-label';
      latLbl.textContent = t.latencyLabel;
      const latVal = document.createElement('span');
      latVal.className = 'metric-val';
      latVal.textContent = formatLatency(srv.latency_ms);
      latItem.appendChild(latLbl);
      latItem.appendChild(latVal);

      metricsGroup.appendChild(speedItem);
      metricsGroup.appendChild(latItem);

      midRow.appendChild(endpointMeta);
      midRow.appendChild(metricsGroup);

      // Row 3: Relative checked time + Expand details indicator
      const bottomRow = document.createElement('div');
      bottomRow.className = 'server-card-bottom';

      const checkedSpan = document.createElement('span');
      checkedSpan.textContent = formatRelativeChecked(srv.last_checked_at);

      const expandSpan = document.createElement('span');
      expandSpan.className = 'expand-hint';
      expandSpan.textContent = isExpanded ? t.detailsCollapse : t.detailsExpand;

      bottomRow.appendChild(checkedSpan);
      bottomRow.appendChild(expandSpan);

      trigger.appendChild(topRow);
      trigger.appendChild(midRow);
      trigger.appendChild(bottomRow);

      trigger.addEventListener('click', () => {
        if (state.expandedCardIds.has(cardId)) {
          state.expandedCardIds.delete(cardId);
        } else {
          state.expandedCardIds.add(cardId);
        }
        renderServerCards();
      });

      card.appendChild(trigger);

      // Inline Detail Area (Expanded on Tap)
      if (isExpanded) {
        const details = document.createElement('div');
        details.className = 'server-card-details';

        const grid = document.createElement('div');
        grid.className = 'details-grid';

        const addDetail = (label, val, wide = false) => {
          const cell = document.createElement('div');
          cell.className = `detail-cell${wide ? ' detail-cell-wide' : ''}`;
          const l = document.createElement('span');
          l.className = 'detail-label';
          l.textContent = label;
          const v = document.createElement('span');
          v.className = 'detail-value';
          v.textContent = val || t.unknownDash;
          cell.appendChild(l);
          cell.appendChild(v);
          grid.appendChild(cell);
        };

        addDetail(t.detailSource, srv.source_name || t.unknownDash, true);
        addDetail(
          t.detailFirstSeen,
          srv.first_seen_at ? formatTimestamp(srv.first_seen_at) : t.unknownDash
        );
        addDetail(
          t.detailUptime7d,
          srv.uptime_percent_7d !== null && srv.uptime_percent_7d !== undefined
            ? `${formatDecimal(srv.uptime_percent_7d, 1)}%`
            : t.unknownDash
        );
        addDetail(t.detailFreshness, srv.freshness_status || t.unknownDash);
        addDetail(t.detailServerId, cardId);

        if (Array.isArray(srv.risk_flags) && srv.risk_flags.length > 0) {
          addDetail(t.riskTooltipPrefix, srv.risk_flags.join(', '), true);
        }

        details.appendChild(grid);

        if (srv.server_page_url) {
          const linkRow = document.createElement('div');
          linkRow.className = 'detail-link-row';

          const extLink = document.createElement('a');
          extLink.className = 'detail-ext-link';
          extLink.href = srv.server_page_url;
          extLink.target = '_blank';
          extLink.rel = 'noopener noreferrer';
          extLink.textContent = t.detailCatalogLink;

          linkRow.appendChild(extLink);
          details.appendChild(linkRow);
        }

        card.appendChild(details);
      }

      listEl.appendChild(card);
    }

    // Load more pagination visibility
    if (state.hasMorePages && !state.isPreviewFallback) {
      paginationBar.hidden = false;
      loadMoreBtn.disabled = state.isLoadingMore;
      loadMoreBtn.textContent = state.isLoadingMore ? t.loadingMore : t.loadMore;
    } else {
      paginationBar.hidden = true;
    }
  }

  function applyLanguageSettings() {
    const isFa = state.lang === 'fa';
    document.documentElement.lang = isFa ? 'fa' : 'en';
    document.documentElement.dir = isFa ? 'rtl' : 'ltr';

    const t = I18N[state.lang];
    document.getElementById('app-title').textContent = t.title;
    document.getElementById('app-subtitle').textContent = t.subtitle;
    document.getElementById('refresh-btn').textContent = t.refresh;
    document.getElementById('retry-btn').textContent = t.retry;
    document.getElementById('empty-retry-btn').textContent = t.checkAgain;
    document.getElementById('lang-toggle').textContent = t.langToggle;

    document.getElementById('label-total-records').textContent = t.totalRecords;
    document.getElementById('label-country-count').textContent = t.countryCount;
    document.getElementById('label-snapshot-time').textContent = t.snapshotUpdated;

    document.getElementById('label-protocol-filter').textContent = t.protocolFilterLabel;
    document.getElementById('label-country-filter').textContent = t.countryFilterLabel;
    document.getElementById('label-sort-filter').textContent = t.sortFilterLabel;

    document.getElementById('servers-heading').textContent = t.serversHeading;
    document.getElementById('checker-region-note').textContent = t.checkerRegionNote;
    document.getElementById('filter-empty-title').textContent = t.filterEmptyTitle;
    document.getElementById('filter-empty-body').textContent = t.filterEmptyBody;
    document.getElementById('reset-filters-btn').textContent = t.resetFilters;
    document.getElementById('list-error-title').textContent = t.listErrorTitle;
    document.getElementById('list-error-body').textContent = t.listErrorBody;
    document.getElementById('list-retry-btn').textContent = t.retry;

    document.getElementById('country-sheet-title').textContent = t.countrySheetTitle;
    document.getElementById('country-search-input').placeholder = t.countrySearchPlaceholder;

    document.getElementById('footer-data-label').textContent = t.dataLabel;
    document.getElementById('footer-snapshot-label').textContent = t.snapshotLabel;
    document.getElementById('footer-disclaimer').textContent = t.disclaimer;

    renderHeaderAndCounters();
    renderProtocolChips();
    renderCountryTrigger();
    renderSortButtons();
    renderServerCards();
  }

  function scheduleFilterReload() {
    if (state.filterDebounceTimer) {
      clearTimeout(state.filterDebounceTimer);
    }
    state.filterDebounceTimer = setTimeout(() => {
      state.filterDebounceTimer = null;
      loadServersPage({ reset: true, scrollToTop: true });
    }, 300);
  }

  async function loadServersPage({ reset = true, scrollToTop = false } = {}) {
    const seq = ++state.reqSeq;

    if (reset) {
      state.page = 1;
      state.servers = [];
      state.expandedCardIds.clear();
      state.isLoadingList = true;
      state.listError = false;
      renderServerCards();
      if (scrollToTop) {
        const sectionEl = document.querySelector('.filters-panel');
        if (sectionEl && typeof sectionEl.scrollIntoView === 'function') {
          sectionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    } else {
      state.isLoadingMore = true;
      renderServerCards();
    }

    try {
      await ensureCountriesForProtocol(state.selectedProtocol);
      if (seq !== state.reqSeq) return;

      // Validate selectedCountry against current protocol's country list
      const validCountries = state.countriesByProtocol[state.selectedProtocol] || [];
      if (
        state.selectedCountry &&
        !validCountries.some((c) => c.code === state.selectedCountry)
      ) {
        state.selectedCountry = '';
      }
      renderCountryTrigger();

      const reqInput = {
        protocol: state.selectedProtocol,
        sort: state.selectedSort,
        page: state.page,
        per_page: 20,
      };
      if (state.selectedCountry) {
        reqInput.country = state.selectedCountry;
      }

      const res = await callProxyEndpoint('pvlServers', reqInput);
      if (seq !== state.reqSeq) return;

      if (!res || res.error) {
        state.isLoadingList = false;
        state.isLoadingMore = false;
        state.listError = true;
        renderServerCards();
        return;
      }

      const newRows = Array.isArray(res.data) ? res.data : [];
      const meta = res.meta || {};

      if (reset) {
        state.servers = newRows;
      } else {
        const existingIds = new Set(state.servers.map((r) => r.id));
        for (const r of newRows) {
          if (!existingIds.has(r.id)) {
            state.servers.push(r);
          }
        }
      }

      const rawMetaTotal = Number(meta.total ?? newRows.length) || 0;
      const lastPage = Number(meta.last_page ?? meta.pages ?? 1) || 1;

      // Part A.5: Y is always the filtered response's meta.total (or preview bundle's stored meta.total)
      state.totalMatching = Math.max(rawMetaTotal, state.servers.length);

      state.hasMorePages =
        !state.isPreviewFallback &&
        newRows.length === 20 &&
        (state.page < lastPage || state.servers.length < rawMetaTotal);

      state.isLoadingList = false;
      state.isLoadingMore = false;
      state.listError = false;
      renderHeaderAndCounters();
      renderServerCards();
    } catch {
      if (seq !== state.reqSeq) return;
      state.isLoadingList = false;
      state.isLoadingMore = false;
      state.listError = true;
      renderServerCards();
    }
  }

  function openCountrySheet() {
    const backdrop = document.getElementById('country-sheet-backdrop');
    const trigger = document.getElementById('country-picker-btn');
    const searchInput = document.getElementById('country-search-input');

    searchInput.value = '';
    renderCountryOptions('');
    backdrop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    setTimeout(() => searchInput.focus(), 20);
  }

  function closeCountrySheet() {
    const backdrop = document.getElementById('country-sheet-backdrop');
    const trigger = document.getElementById('country-picker-btn');
    backdrop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function renderCountryOptions(filterText = '') {
    const t = I18N[state.lang];
    const listEl = document.getElementById('country-options-list');
    const countries = state.countriesByProtocol[state.selectedProtocol] || [];
    const q = String(filterText || '').trim().toLowerCase();

    listEl.innerHTML = '';

    // 1. "All countries" option
    const protoObj = state.activeProtocols.find((p) => p.id === state.selectedProtocol);
    const allCount = protoObj ? protoObj.records : countries.reduce((s, c) => s + c.count, 0);

    if (!q || t.allCountries.toLowerCase().includes(q) || 'all'.includes(q)) {
      const liAll = document.createElement('li');
      liAll.className = 'country-option-item';
      const btnAll = document.createElement('button');
      btnAll.type = 'button';
      btnAll.className = `country-option-btn${state.selectedCountry === '' ? ' is-selected' : ''}`;
      btnAll.setAttribute('role', 'option');
      btnAll.setAttribute('aria-selected', state.selectedCountry === '' ? 'true' : 'false');
      btnAll.setAttribute('data-country-code', '');

      const left = document.createElement('span');
      left.className = 'country-option-left';
      left.textContent = `🌐 ${t.allCountries}`;

      const right = document.createElement('span');
      right.className = 'country-option-count';
      right.textContent = formatNumber(allCount);

      btnAll.appendChild(left);
      btnAll.appendChild(right);
      btnAll.addEventListener('click', () => {
        closeCountrySheet();
        if (state.selectedCountry !== '') {
          state.selectedCountry = '';
          renderCountryTrigger();
          scheduleFilterReload();
        }
      });
      liAll.appendChild(btnAll);
      listEl.appendChild(liAll);
    }

    if (countries.length === 0) {
      const liNote = document.createElement('li');
      liNote.className = 'country-option-item';
      const divNote = document.createElement('div');
      divNote.style.padding = '12px 16px';
      divNote.style.fontSize = '0.82rem';
      divNote.style.color = 'var(--text-secondary)';
      divNote.textContent = t.noCountryGeoNote;
      liNote.appendChild(divNote);
      listEl.appendChild(liNote);
      return;
    }

    const filtered = countries.filter(
      (c) =>
        !q ||
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q)
    );

    for (const c of filtered) {
      const isSelected = state.selectedCountry === c.code;
      const li = document.createElement('li');
      li.className = 'country-option-item';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `country-option-btn${isSelected ? ' is-selected' : ''}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      btn.setAttribute('data-country-code', c.code);

      const left = document.createElement('span');
      left.className = 'country-option-left';
      left.textContent = `${countryCodeToFlag(c.code)} ${c.name} (${c.code})`;

      const right = document.createElement('span');
      right.className = 'country-option-count';
      right.textContent = formatNumber(c.count);

      btn.appendChild(left);
      btn.appendChild(right);

      btn.addEventListener('click', () => {
        closeCountrySheet();
        if (state.selectedCountry !== c.code) {
          state.selectedCountry = c.code;
          renderCountryTrigger();
          scheduleFilterReload();
        }
      });

      li.appendChild(btn);
      listEl.appendChild(li);
    }
  }

  function showTopError(kind) {
    const t = I18N[state.lang];
    const titleEl = document.getElementById('error-title');
    const msgEl = document.getElementById('error-message');

    if (kind === 'auth') {
      titleEl.textContent = t.errAuthTitle;
      msgEl.textContent = t.errAuthBody;
    } else if (kind === 'setup_required') {
      titleEl.textContent = t.errUnavailableTitle;
      msgEl.textContent = t.errUnavailableBody;
    } else {
      titleEl.textContent = t.errUnavailableTitle;
      msgEl.textContent = t.errNetworkBody;
    }

    setViewState('error');
  }

  async function loadCatalog() {
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.disabled = true;
    cachedSnapshotBundle = null;
    setViewState('loading');

    try {
      const [statsRes, protocolsRes] = await Promise.all([
        callProxyEndpoint('pvlStats', {}),
        callProxyEndpoint('pvlProtocols', {}),
      ]);

      if (statsRes?.error === 'setup_required' || protocolsRes?.error === 'setup_required') {
        showTopError('setup_required');
        return;
      }

      const summary = parseCatalogSummary(statsRes, protocolsRes);
      state.totalRecords = summary.totalRecords;
      state.distinctCountryCount = summary.distinctCountryCount;
      state.snapshotTimestamp = summary.snapshotTimestamp;
      state.activeProtocols = summary.activeProtocols;

      if (state.activeProtocols.length === 0) {
        setViewState('empty');
        return;
      }

      // Apply deep-link preselection on first load if valid, else default to 'vless'
      if (!state.deepLinkApplied) {
        state.deepLinkApplied = true;
        if (
          deepLinkInit.protocol &&
          state.activeProtocols.some((p) => p.id === deepLinkInit.protocol)
        ) {
          state.selectedProtocol = deepLinkInit.protocol;
        } else if (state.activeProtocols.some((p) => p.id === 'vless')) {
          state.selectedProtocol = 'vless';
        } else {
          state.selectedProtocol = state.activeProtocols[0].id;
        }

        await ensureCountriesForProtocol(state.selectedProtocol);
        const countriesForProto = state.countriesByProtocol[state.selectedProtocol] || [];
        if (
          deepLinkInit.country &&
          countriesForProto.some((c) => c.code === deepLinkInit.country)
        ) {
          state.selectedCountry = deepLinkInit.country;
        } else {
          state.selectedCountry = '';
        }
      } else if (!state.activeProtocols.some((p) => p.id === state.selectedProtocol)) {
        state.selectedProtocol =
          state.activeProtocols.find((p) => p.id === 'vless')?.id ||
          state.activeProtocols[0].id;
        state.selectedCountry = '';
      }

      state.selectedSort = protocolSupportsScore(state.selectedProtocol) ? 'score' : 'last_checked';
      renderHeaderAndCounters();
      renderProtocolChips();
      renderCountryTrigger();
      renderSortButtons();
      setViewState('ready');

      await loadServersPage({ reset: true, scrollToTop: false });
    } catch (err) {
      if (
        err &&
        (err.code === 'NO_INIT_DATA' ||
          err.message === 'WebAppServerlessInitDataUnavailable' ||
          err.status === 401 ||
          err.type === 'UNAUTHORIZED')
      ) {
        showTopError('auth');
      } else {
        showTopError('network');
      }
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function init() {
    if (tg) {
      try {
        tg.ready();
        tg.expand();
        if (typeof tg.onEvent === 'function') {
          tg.onEvent('themeChanged', applyTheme);
        }
      } catch {}
    }

    applyTheme();
    applyLanguageSettings();

    document.getElementById('refresh-btn').addEventListener('click', loadCatalog);
    document.getElementById('retry-btn').addEventListener('click', loadCatalog);
    document.getElementById('empty-retry-btn').addEventListener('click', loadCatalog);
    document.getElementById('list-retry-btn').addEventListener('click', () => {
      loadServersPage({ reset: true, scrollToTop: false });
    });

    document.getElementById('reset-filters-btn').addEventListener('click', () => {
      state.selectedProtocol =
        state.activeProtocols.find((p) => p.id === 'vless')?.id ||
        state.activeProtocols[0]?.id ||
        'vless';
      state.selectedCountry = '';
      state.selectedSort = protocolSupportsScore(state.selectedProtocol) ? 'score' : 'last_checked';
      renderProtocolChips();
      renderCountryTrigger();
      renderSortButtons();
      loadServersPage({ reset: true, scrollToTop: true });
    });

    document.getElementById('load-more-btn').addEventListener('click', () => {
      if (state.isLoadingMore || !state.hasMorePages) return;
      state.page += 1;
      loadServersPage({ reset: false, scrollToTop: false });
    });

    document.getElementById('lang-toggle').addEventListener('click', () => {
      state.lang = state.lang === 'fa' ? 'en' : 'fa';
      applyLanguageSettings();
    });

    // Sort segmented control listeners
    document.querySelectorAll('#sort-segmented .sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sortVal = btn.getAttribute('data-sort');
        if (!VALID_SORTS.has(sortVal) || state.selectedSort === sortVal) return;
        state.selectedSort = sortVal;
        renderSortButtons();
        scheduleFilterReload();
      });
    });

    // Country picker sheet listeners
    document.getElementById('country-picker-btn').addEventListener('click', openCountrySheet);
    document.getElementById('country-sheet-close').addEventListener('click', closeCountrySheet);
    document.getElementById('country-sheet-backdrop').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        closeCountrySheet();
      }
    });
    document.getElementById('country-search-input').addEventListener('input', (e) => {
      renderCountryOptions(e.target.value);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('country-sheet-backdrop').hidden) {
        closeCountrySheet();
      }
    });

    loadCatalog();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
