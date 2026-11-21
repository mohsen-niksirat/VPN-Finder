// ============================================================
// VPN Finder Mini App Shell (Stage 1)
// Talks ONLY to the tgcloud proxy endpoints (pvlStats, pvlProtocols, pvlCountries).
// Never embeds or touches the PublicVPNList API key.
// ============================================================

(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  // Optional tgcloud static origin fallback if opened on GitHub Pages with ?api_base=
  const urlParams = new URLSearchParams(window.location.search);
  const DEFAULT_PROXY_BASE = urlParams.get('api_base') || window.VPN_FINDER_API_BASE || '';

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
      protocolsTitle: 'Protocols & Checker Median Speed',
      protocolsNote: 'Checker-region throughput',
      thProtocol: 'Protocol',
      thRecords: 'Records',
      thSpeed: 'Median Speed',
      notMeasured: 'Not measured',
      mbpsUnit: 'Mbps',
      countriesTitle: 'Top 5 Countries by Record Count',
      countriesMetaPrefix: 'Protocol:',
      recordsLabel: 'records',
      dataLabel: 'Data:',
      snapshotLabel: 'Snapshot:',
      disclaimer:
        'Servers are operated by third parties; a technical check verifies reachability and speed only and is not a privacy or safety guarantee.',
      errUnavailableTitle: 'Temporarily Unavailable',
      errUnavailableBody: 'The catalog service is temporarily unavailable. Please try again later.',
      errAuthTitle: 'Open Inside Telegram',
      errAuthBody:
        'VPN Finder validates Telegram Mini App initData on every proxy request. Please launch this Mini App from the @VPNFinder bot in Telegram.',
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
      protocolsTitle: 'پروتکل‌ها و میانه سرعت بررسی‌کننده',
      protocolsNote: 'سرعت اندازه‌گیری‌شده در ناحیه تست',
      thProtocol: 'پروتکل',
      thRecords: 'تعداد رکورد',
      thSpeed: 'میانه سرعت',
      notMeasured: 'اندازه‌گیری نشده',
      mbpsUnit: 'مگابیت/ثانیه',
      countriesTitle: '۵ کشور برتر بر اساس تعداد سرور',
      countriesMetaPrefix: 'پروتکل:',
      recordsLabel: 'سرور',
      dataLabel: 'Data:',
      snapshotLabel: 'اسنپ‌شات:',
      disclaimer:
        'تمام سرورها توسط اشخاص ثالث اداره می‌شوند؛ بررسی فنی صرفاً اتصال و سرعت را می‌سنجد و تضمین حریم خصوصی یا امنیت نیست.',
      errUnavailableTitle: 'موقتاً در دسترس نیست',
      errUnavailableBody: 'سرویس کاتالوگ موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.',
      errAuthTitle: 'اجرا در داخل تلگرام',
      errAuthBody:
        'هر درخواست پروکسی نیازمند احراز هویت معتبر تلگرام (initData) است. لطفاً مینی‌اپ را از داخل ربات تلگرام باز کنید.',
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

  let currentLang = detectInitialLanguage();
  let lastLoadedModel = null;

  function applyTheme() {
    const scheme = tg?.colorScheme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', scheme === 'dark' ? 'dark' : 'light');
  }

  function applyLanguageSettings() {
    const isFa = currentLang === 'fa';
    document.documentElement.lang = isFa ? 'fa' : 'en';
    document.documentElement.dir = isFa ? 'rtl' : 'ltr';

    const t = I18N[currentLang];
    document.getElementById('app-title').textContent = t.title;
    document.getElementById('app-subtitle').textContent = t.subtitle;
    document.getElementById('refresh-btn').textContent = t.refresh;
    document.getElementById('retry-btn').textContent = t.retry;
    document.getElementById('empty-retry-btn').textContent = t.checkAgain;
    document.getElementById('lang-toggle').textContent = t.langToggle;

    document.getElementById('label-total-records').textContent = t.totalRecords;
    document.getElementById('label-country-count').textContent = t.countryCount;
    document.getElementById('label-snapshot-time').textContent = t.snapshotUpdated;

    document.getElementById('protocols-heading').textContent = t.protocolsTitle;
    document.getElementById('protocols-note').textContent = t.protocolsNote;
    document.getElementById('th-protocol').textContent = t.thProtocol;
    document.getElementById('th-records').textContent = t.thRecords;
    document.getElementById('th-speed').textContent = t.thSpeed;

    document.getElementById('countries-heading').textContent = t.countriesTitle;
    document.getElementById('footer-data-label').textContent = t.dataLabel;
    document.getElementById('footer-snapshot-label').textContent = t.snapshotLabel;
    document.getElementById('footer-disclaimer').textContent = t.disclaimer;

    if (lastLoadedModel) {
      renderModel(lastLoadedModel);
    }
  }

  function setViewState(state) {
    document.getElementById('state-loading').hidden = state !== 'loading';
    document.getElementById('state-error').hidden = state !== 'error';
    document.getElementById('state-empty').hidden = state !== 'empty';
    document.getElementById('state-ready').hidden = state !== 'ready';
  }

  function formatNumber(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '..';
    try {
      return Number(n).toLocaleString(currentLang === 'fa' ? 'fa-IR' : 'en-US');
    } catch {
      return String(n);
    }
  }

  function formatSpeed(val) {
    const t = I18N[currentLang];
    if (val === null || val === undefined || val === '' || Number.isNaN(Number(val))) {
      return t.notMeasured;
    }
    const num = Number(val);
    if (!Number.isFinite(num) || num <= 0) {
      return t.notMeasured;
    }
    const formatted = num.toFixed(2);
    return `${formatted} ${t.mbpsUnit}`;
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

  /**
   * Calls a tgcloud endpoint (`pvlStats`, `pvlProtocols`, `pvlCountries`).
   * Uses `Telegram.WebApp.Serverless.call` when on the tgcloud host, or
   * falls back to POST `${DEFAULT_PROXY_BASE}/api/<name>` with TMA initData.
   */
  function callProxyEndpoint(name, input = {}) {
    return new Promise((resolve, reject) => {
      // Allow automated Playwright / local verification harness to inject a mock transport
      if (typeof window.__VPN_FINDER_MOCK_CALL__ === 'function') {
        Promise.resolve(window.__VPN_FINDER_MOCK_CALL__(name, input)).then(resolve, reject);
        return;
      }

      const hasInitData = Boolean(tg && typeof tg.initData === 'string' && tg.initData.length > 0);

      // If no custom cross-origin api_base is set and Telegram.WebApp.Serverless.call is available
      if (!DEFAULT_PROXY_BASE && tg && tg.Serverless && typeof tg.Serverless.call === 'function') {
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

      if (!hasInitData) {
        const authErr = new Error('WebAppServerlessInitDataUnavailable');
        authErr.code = 'NO_INIT_DATA';
        reject(authErr);
        return;
      }

      const base = DEFAULT_PROXY_BASE.replace(/\/+$/, '');
      const endpointUrl = `${base}/api/${name}`;
      fetch(endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: 'TMA ' + window.btoa(tg.initData),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input || {}),
        credentials: 'omit',
      })
        .then(async (res) => {
          const text = await res.text();
          let data = null;
          try {
            data = JSON.parse(text);
          } catch {}
          if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean') {
            const e = new Error(`HTTP ${res.status}`);
            e.status = res.status;
            throw e;
          }
          if (!data.ok) {
            const e = new Error(data.description || `HTTP ${res.status}`);
            e.status = data.error_code || res.status;
            e.type = data.error_type || '';
            e.parameters = data.parameters || {};
            throw e;
          }
          return data.result;
        })
        .then(resolve, reject);
    });
  }

  /**
   * Normalizes the response shapes from PublicVPNList API v1 `/stats` and `/protocols`
   * so that total server records, country count, snapshot timestamp, and the per-protocol
   * table (records + median speed) are built dynamically from the proxy responses.
   */
  function normalizeCatalogData(statsRes, protocolsRes, countriesRes, activeProtocol) {
    const statsData = (statsRes && typeof statsRes.data === 'object' && !Array.isArray(statsRes.data))
      ? statsRes.data
      : (statsRes || {});
    const statsMeta = (statsRes && typeof statsRes.meta === 'object') ? statsRes.meta : {};

    const protoRoot = protocolsRes?.data ?? protocolsRes?.protocols ?? statsData?.protocols ?? statsData?.by_protocol ?? [];
    const protoMeta = (protocolsRes && typeof protocolsRes.meta === 'object') ? protocolsRes.meta : {};

    // Extract protocol list from array or keyed object map
    const rawProtocols = [];
    if (Array.isArray(protoRoot)) {
      rawProtocols.push(...protoRoot);
    } else if (protoRoot && typeof protoRoot === 'object') {
      for (const [key, val] of Object.entries(protoRoot)) {
        if (val && typeof val === 'object') {
          rawProtocols.push({ protocol: key, ...val });
        } else if (typeof val === 'number') {
          rawProtocols.push({ protocol: key, record_count: val });
        }
      }
    }

    // Also look for per-protocol stats in statsData if protocols endpoint only gave metadata
    const statsByProto = {};
    const statsProtoSource = statsData.protocols || statsData.by_protocol || statsMeta.protocols || null;
    if (Array.isArray(statsProtoSource)) {
      for (const item of statsProtoSource) {
        const k = String(item?.protocol || item?.id || item?.name || '').toLowerCase();
        if (k) statsByProto[k] = item;
      }
    } else if (statsProtoSource && typeof statsProtoSource === 'object') {
      for (const [k, v] of Object.entries(statsProtoSource)) {
        statsByProto[k.toLowerCase()] = typeof v === 'object' ? v : { record_count: v };
      }
    }

    const seenProtocols = new Set();
    const protocolRows = [];

    for (const item of rawProtocols) {
      const id = String(item?.protocol || item?.id || item?.code || item?.name || '').trim().toLowerCase();
      if (!id || seenProtocols.has(id)) continue;
      seenProtocols.add(id);

      const extra = statsByProto[id] || {};
      const records = Number(
        item.record_count ??
        item.records ??
        item.count ??
        item.total ??
        item.servers ??
        item.online_count ??
        extra.record_count ??
        extra.records ??
        extra.count ??
        extra.total ??
        0
      );

      const medianSpeed =
        item.median_speed_mbps ??
        item.median_measured_speed_mbps ??
        item.checker_measured_median_speed_mbps ??
        item.median_speed ??
        item.speed_median_mbps ??
        extra.median_speed_mbps ??
        extra.median_measured_speed_mbps ??
        extra.median_speed ??
        null;

      const countryCount = Number(
        item.country_count ??
        item.countries ??
        extra.country_count ??
        extra.countries ??
        0
      );

      protocolRows.push({
        id,
        label: item.label || item.display_name || PROTOCOL_LABELS[id] || id.toUpperCase(),
        records: Number.isFinite(records) ? records : 0,
        medianSpeed: medianSpeed !== null && medianSpeed !== undefined ? Number(medianSpeed) : null,
        countries: Number.isFinite(countryCount) ? countryCount : 0,
      });
    }

    // Sort protocols by record count descending, preserving 0-record protocols at the bottom
    protocolRows.sort((a, b) => b.records - a.records);

    // Countries list from pvlCountries
    const countriesRoot =
      countriesRes?.data?.countries ??
      countriesRes?.data ??
      countriesRes?.countries ??
      [];
    const rawCountries = [];
    if (Array.isArray(countriesRoot)) {
      rawCountries.push(...countriesRoot);
    } else if (countriesRoot && typeof countriesRoot === 'object') {
      for (const [code, val] of Object.entries(countriesRoot)) {
        if (val && typeof val === 'object') {
          rawCountries.push({ country_code: code, ...val });
        } else if (typeof val === 'number') {
          rawCountries.push({ country_code: code, count: val });
        }
      }
    }

    const countryRows = rawCountries
      .map((c) => {
        const code = String(c?.country_code || c?.code || c?.iso || '').toUpperCase();
        const name = String(c?.country_name || c?.name || code || 'Unknown').trim();
        const count = Number(c?.record_count ?? c?.records ?? c?.count ?? c?.total ?? c?.servers ?? 0);
        const medianSpeed =
          c?.median_speed_mbps ??
          c?.median_measured_speed_mbps ??
          c?.median_speed ??
          null;
        return {
          code: code || '--',
          name,
          count: Number.isFinite(count) ? count : 0,
          medianSpeed: medianSpeed !== null && medianSpeed !== undefined ? Number(medianSpeed) : null,
        };
      })
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);

    // Compute total server records across catalog
    const sumProtocolRecords = protocolRows.reduce((acc, r) => acc + (r.records || 0), 0);
    const explicitTotal = Number(
      statsData.total_records ??
      statsData.record_count ??
      statsData.records ??
      statsData.total_servers ??
      statsData.total ??
      statsMeta.total_records ??
      statsMeta.total ??
      protoMeta.total_records ??
      0
    );
    const totalRecords = Math.max(explicitTotal || 0, sumProtocolRecords || 0);

    // Compute total country count
    const explicitCountries = Number(
      statsData.country_count ??
      statsData.countries_count ??
      statsData.total_countries ??
      (typeof statsData.countries === 'number' ? statsData.countries : 0) ??
      statsMeta.country_count ??
      protoMeta.country_count ??
      0
    );
    const maxProtoCountries = protocolRows.reduce((m, r) => Math.max(m, r.countries || 0), 0);
    const countryCount = explicitCountries || maxProtoCountries || countryRows.length || 0;

    // Extract snapshot timestamp
    const snapshotTimestamp =
      statsData.generated_at ||
      statsData.updated_at ||
      statsData.snapshot_updated_at ||
      statsData.last_checked_at ||
      statsMeta.generated_at ||
      statsMeta.updated_at ||
      protoMeta.generated_at ||
      protoMeta.updated_at ||
      statsRes?._cache?.fetched_at ||
      protocolsRes?._cache?.fetched_at ||
      null;

    return {
      totalRecords,
      countryCount,
      snapshotTimestamp,
      protocolRows,
      topCountries: countryRows.slice(0, 5),
      activeProtocol,
    };
  }

  function renderModel(model) {
    const t = I18N[currentLang];

    document.getElementById('val-total-records').textContent = formatNumber(model.totalRecords);
    document.getElementById('val-country-count').textContent = formatNumber(model.countryCount);
    document.getElementById('val-snapshot-time').textContent = formatTimestamp(model.snapshotTimestamp);

    const footerTime = document.getElementById('footer-snapshot-date');
    footerTime.textContent = formatDateShort(model.snapshotTimestamp);
    if (model.snapshotTimestamp) {
      const d = typeof model.snapshotTimestamp === 'number'
        ? new Date(model.snapshotTimestamp * 1000)
        : new Date(model.snapshotTimestamp);
      if (!Number.isNaN(d.getTime())) {
        footerTime.setAttribute('datetime', d.toISOString());
      }
    }

    // Render Per-Protocol Table (protocols with 0 records shown greyed/muted, never faked)
    const tbody = document.getElementById('protocols-tbody');
    tbody.innerHTML = '';
    for (const row of model.protocolRows) {
      const tr = document.createElement('tr');
      if (row.records === 0) {
        tr.className = 'protocol-zero';
      }

      const th = document.createElement('th');
      th.scope = 'row';
      th.className = 'proto-name';
      th.textContent = row.label;

      const tdRecords = document.createElement('td');
      tdRecords.className = 'num-col';
      tdRecords.textContent = formatNumber(row.records);

      const tdSpeed = document.createElement('td');
      tdSpeed.className = 'num-col';
      tdSpeed.textContent = row.records === 0 ? t.notMeasured : formatSpeed(row.medianSpeed);

      tr.appendChild(th);
      tr.appendChild(tdRecords);
      tr.appendChild(tdSpeed);
      tbody.appendChild(tr);
    }

    // Render Top 5 Countries List
    const protoLabel = PROTOCOL_LABELS[model.activeProtocol] || String(model.activeProtocol || '').toUpperCase();
    document.getElementById('countries-meta').textContent = protoLabel
      ? `${t.countriesMetaPrefix} ${protoLabel}`
      : '';

    const countryList = document.getElementById('countries-list');
    countryList.innerHTML = '';
    model.topCountries.forEach((c, idx) => {
      const li = document.createElement('li');
      li.className = 'country-item';

      const main = document.createElement('div');
      main.className = 'country-main';

      const rank = document.createElement('span');
      rank.className = 'country-rank';
      rank.textContent = formatNumber(idx + 1);

      const code = document.createElement('span');
      code.className = 'country-code-badge';
      code.textContent = c.code;

      const name = document.createElement('span');
      name.className = 'country-name';
      name.textContent = c.name;

      main.appendChild(rank);
      main.appendChild(code);
      main.appendChild(name);

      const stats = document.createElement('div');
      stats.className = 'country-stats';

      const countEl = document.createElement('span');
      countEl.className = 'country-count';
      countEl.textContent = `${formatNumber(c.count)} ${t.recordsLabel}`;
      stats.appendChild(countEl);

      if (c.medianSpeed !== null && c.medianSpeed > 0) {
        const speedEl = document.createElement('span');
        speedEl.className = 'country-speed';
        speedEl.textContent = `· ${formatSpeed(c.medianSpeed)}`;
        stats.appendChild(speedEl);
      }

      li.appendChild(main);
      li.appendChild(stats);
      countryList.appendChild(li);
    });
  }

  function showError(kind) {
    const t = I18N[currentLang];
    const titleEl = document.getElementById('error-title');
    const msgEl = document.getElementById('error-message');

    if (kind === 'auth') {
      titleEl.textContent = t.errAuthTitle;
      msgEl.textContent = t.errAuthBody;
    } else if (kind === 'setup_required') {
      // Per Stage 1 spec: users see a generic "temporarily unavailable" when pvl_api_key is missing
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
    setViewState('loading');

    try {
      const [statsRes, protocolsRes] = await Promise.all([
        callProxyEndpoint('pvlStats', {}),
        callProxyEndpoint('pvlProtocols', {}),
      ]);

      if (statsRes?.error === 'setup_required' || protocolsRes?.error === 'setup_required') {
        showError('setup_required');
        return;
      }

      // Determine top protocol with records to pass explicitly to pvlCountries
      // (ALWAYS pass protocol explicitly; never rely on the API's OpenVPN-only default)
      const initialNormalized = normalizeCatalogData(statsRes, protocolsRes, null, 'openvpn');
      const topProto = initialNormalized.protocolRows.find((p) => p.records > 0)?.id || 'openvpn';

      // If /protocols did not embed per-protocol record counts or median speeds,
      // fetch per-protocol stats explicitly for active protocols via pvlStats
      const hasCountsInProtocols = initialNormalized.protocolRows.some((p) => p.records > 0);
      if (!hasCountsInProtocols && initialNormalized.protocolRows.length > 0) {
        const perProtoResults = await Promise.all(
          initialNormalized.protocolRows.map(async (p) => {
            try {
              const s = await callProxyEndpoint('pvlStats', { protocol: p.id });
              return { id: p.id, data: s?.data || s };
            } catch {
              return { id: p.id, data: null };
            }
          })
        );
        for (const res of perProtoResults) {
          const row = initialNormalized.protocolRows.find((r) => r.id === res.id);
          if (row && res.data) {
            row.records = Number(
              res.data.total_records ??
              res.data.record_count ??
              res.data.records ??
              res.data.total ??
              row.records
            ) || 0;
            const spd =
              res.data.median_speed_mbps ??
              res.data.median_measured_speed_mbps ??
              res.data.median_speed ??
              null;
            if (spd !== null && spd !== undefined) {
              row.medianSpeed = Number(spd);
            }
          }
        }
        initialNormalized.protocolRows.sort((a, b) => b.records - a.records);
      }

      const chosenProtocol =
        initialNormalized.protocolRows.find((p) => p.records > 0)?.id || topProto;

      const countriesRes = await callProxyEndpoint('pvlCountries', {
        protocol: chosenProtocol,
      });

      if (countriesRes?.error === 'setup_required') {
        showError('setup_required');
        return;
      }

      const finalModel = normalizeCatalogData(
        statsRes,
        protocolsRes,
        countriesRes,
        chosenProtocol
      );

      // Preserve any enriched protocol rows if we fetched per-protocol stats
      if (!hasCountsInProtocols && initialNormalized.protocolRows.length > 0) {
        finalModel.protocolRows = initialNormalized.protocolRows;
        finalModel.totalRecords = Math.max(
          finalModel.totalRecords,
          finalModel.protocolRows.reduce((acc, r) => acc + r.records, 0)
        );
      }

      if (finalModel.totalRecords === 0 && finalModel.topCountries.length === 0) {
        setViewState('empty');
        return;
      }

      lastLoadedModel = finalModel;
      renderModel(finalModel);
      setViewState('ready');
    } catch (err) {
      if (
        err &&
        (err.code === 'NO_INIT_DATA' ||
          err.message === 'WebAppServerlessInitDataUnavailable' ||
          err.status === 401 ||
          err.type === 'UNAUTHORIZED')
      ) {
        showError('auth');
      } else {
        showError('network');
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
    document.getElementById('lang-toggle').addEventListener('click', function () {
      currentLang = currentLang === 'fa' ? 'en' : 'fa';
      applyLanguageSettings();
    });

    loadCatalog();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
