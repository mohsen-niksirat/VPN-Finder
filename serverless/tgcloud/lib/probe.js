import { db, fetch } from 'sdk';
import { desc, eq } from 'sdk/db';
import { deliveryDebug, probeCompare, pvlCache } from '../schema.js';
import {
  describeFieldValueState,
  fetchFreshServersPageForDelivery,
  fetchPvlServers,
  fetchServerDetailFresh,
  getPvlApiKey,
  PVL_BASE_URL,
  PVL_SERVERS_FIELDS,
  validateAndNormalizeServersInput,
} from './pvl.js';

export async function runDebugProbe(sourceContext = 'handler') {
  const targetId = 'pvl_06e3a641e26fd238f0c37947';
  const norm = validateAndNormalizeServersInput({
    protocol: 'openvpn',
    country: 'US',
    sort: 'score',
    page: 1,
  });

  // a. Exact candidate record deliverConfigsBatch receives via fetchPvlServers
  const listRes = await fetchPvlServers({ protocol: 'openvpn', country: 'US', sort: 'score', page: 1 });
  const candidate = (listRes?.data || []).find((r) => r?.id === targetId) || null;
  const aState = candidate ? describeFieldValueState(candidate, 'config_download_url') : 'not_in_page1';

  // b. pvl_cache servers list entry the handler would read
  const cacheListRow = await db.select().from(pvlCache).where(eq(pvlCache.key, norm.cacheKey)).get();
  let bState = 'cache_miss';
  if (cacheListRow?.body) {
    try {
      const parsed = JSON.parse(cacheListRow.body);
      const rec = (parsed?.data || []).find((r) => r?.id === targetId) || null;
      bState = rec ? describeFieldValueState(rec, 'config_download_url') : 'not_in_cached_list';
    } catch {
      bState = 'parse_error';
    }
  }

  // c. pvl_cache server_meta:<id> entry if present
  const cacheMetaRow = await db.select().from(pvlCache).where(eq(pvlCache.key, `server_meta:${targetId}`)).get();
  let cState = 'cache_miss';
  if (cacheMetaRow?.body) {
    try {
      const parsed = JSON.parse(cacheMetaRow.body);
      const rec = parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;
      cState = describeFieldValueState(rec, 'config_download_url');
    } catch {
      cState = 'parse_error';
    }
  }

  // d. Fresh list fetch through fetchPvlServers
  await db.delete(pvlCache).where(eq(pvlCache.key, norm.cacheKey)).run();
  const freshListRes = await fetchPvlServers({ protocol: 'openvpn', country: 'US', sort: 'score', page: 1 });
  const freshRec = (freshListRes?.data || []).find((r) => r?.id === targetId) || null;
  const dState = freshRec ? describeFieldValueState(freshRec, 'config_download_url') : 'not_in_page1';

  // e. fetchServerDetailFresh(id)
  const detailFresh = await fetchServerDetailFresh(targetId);
  const eState = describeFieldValueState(detailFresh, 'config_download_url');

  // f. Raw PVL API list call WITHOUT fields parameter
  const apiKey = await getPvlApiKey();
  let fState = 'no_api_key';
  if (apiKey) {
    try {
      const rawRes = await fetch(
        `${PVL_BASE_URL}/servers?protocol=openvpn&country=US&status=online&fresh_within=259200&sort=score&order=desc&page=1&per_page=20`,
        { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }
      );
      if (!rawRes.ok) {
        fState = `http_${rawRes.status}`;
      } else {
        const rawJson = await rawRes.json();
        const rawRec = (rawJson?.data || []).find((r) => r?.id === targetId) || null;
        fState = rawRec ? describeFieldValueState(rawRec, 'config_download_url') : 'not_in_page1';
      }
    } catch (err) {
      fState = `fetch_${err?.name || 'Error'}`;
    }
  }

  // g. connection_info_url state on fresh detail record
  const gState = describeFieldValueState(detailFresh, 'connection_info_url');

  // h. Fetch connection_info_url (with_bearer) and inspect shape/states (no URLs or content)
  let hSummary = 'no_connection_info_url';
  const connUrl = detailFresh?.connection_info_url;
  if (typeof connUrl === 'string' && connUrl.length > 0 && apiKey) {
    try {
      const hRes = await fetch(connUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Cache-Control': 'no-store',
        },
      });
      const ct = hRes.headers.get('content-type') || '';
      const ab = await hRes.arrayBuffer();
      const txt = new TextDecoder('utf-8').decode(new Uint8Array(ab));
      let parsed = null;
      try {
        parsed = JSON.parse(txt);
      } catch {
        parsed = null;
      }
      if (parsed && typeof parsed === 'object') {
        const inner = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
        const keys = Object.keys(inner);
        const linkStates = {};
        for (const k of keys) {
          if (/(url|download|config|data|file|uri|payload)/i.test(k)) {
            linkStates[k] = describeFieldValueState(inner, k);
          }
        }
        hSummary = `http=${hRes.status} keys=[${keys.join(',')}] states=${JSON.stringify(linkStates)}`;
      } else {
        const firstLine = txt.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
        const looksOvpn = firstLine.startsWith('#') || /^(client|dev|proto|remote)\b/i.test(firstLine);
        hSummary = `http=${hRes.status} ct=${ct} bytes=${ab.byteLength} looks_like_ovpn=${looksOvpn}`;
      }
    } catch (err) {
      hSummary = `fetch_${err?.name || 'Error'}`;
    }
  }

  // i. Dataset surface (/dataset?protocol=openvpn) *_url value states
  let iSummary = 'no_api_key';
  if (apiKey) {
    try {
      const dsRes = await fetch(`${PVL_BASE_URL}/dataset?protocol=openvpn`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      if (!dsRes.ok) {
        iSummary = `http_${dsRes.status}`;
      } else {
        const dsJson = await dsRes.json();
        const dsObj = dsJson?.data && typeof dsJson.data === 'object' ? dsJson.data : dsJson;
        const urlStates = {};
        for (const k of Object.keys(dsObj || {})) {
          if (k.endsWith('_url') || k === 'export_urls') {
            urlStates[k] = k === 'export_urls' && dsObj[k] && typeof dsObj[k] === 'object'
              ? Object.fromEntries(Object.keys(dsObj[k]).map((ek) => [ek, describeFieldValueState(dsObj[k], ek)]))
              : describeFieldValueState(dsObj, k);
          }
        }
        iSummary = `http=${dsRes.status} states=${JSON.stringify(urlStates)}`;
      }
    } catch (err) {
      iSummary = `fetch_${err?.name || 'Error'}`;
    }
  }

  const record = {
    source_context: sourceContext,
    a_candidate: aState,
    b_cache_servers_list: bState,
    c_cache_server_meta: cState,
    d_fresh_fetchPvlServers: dState,
    e_fetchServerDetailFresh: eState,
    f_raw_no_fields_list: fState,
    g_conn_info_url_state: gState,
    h_conn_info_payload: hSummary,
    i_dataset_record: iSummary,
  };

  try {
    await db
      .insert(probeCompare)
      .values({
        sourceContext,
        createdAt: Math.floor(Date.now() / 1000),
        detail: JSON.stringify(record),
      })
      .run();
  } catch {}

  const lines = [
    `DebugProbe (${targetId}, ctx=${sourceContext})`,
    `a_candidate: ${aState}`,
    `b_cache_servers_list: ${bState}`,
    `c_cache_server_meta: ${cState}`,
    `d_fresh_fetchPvlServers: ${dState}`,
    `e_fetchServerDetailFresh: ${eState}`,
    `f_raw_no_fields_list: ${fState}`,
    `g_conn_info_url_state: ${gState}`,
    `h_conn_info_payload: ${hSummary}`,
    `i_dataset_record: ${iSummary}`,
    `j_self_endpoint_compare: saved_to_probe_compare(${sourceContext})`,
  ];

  return { record, text: lines.join('\n') };
}

export async function runDebugProbe2(ownerUserId) {
  const targetId = 'pvl_d520729f887d4b3754a8e4b6';
  const apiKey = await getPvlApiKey();

  const inspectList = async (url, label) => {
    if (!apiKey) return 'no_api_key';
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Cache-Control': 'no-store',
        },
      });
      if (!res.ok) return `http_${res.status}`;
      const json = await res.json();
      const rows = Array.isArray(json?.data) ? json.data : [];
      const rec = rows.find((r) => r?.id === targetId) || null;
      return rec ? describeFieldValueState(rec, 'config_download_url') : `not_in_rows(count=${rows.length})`;
    } catch (err) {
      return `fetch_${err?.name || 'Error'}`;
    }
  };

  // a_prod_query: exact fetchFreshServersPageForDelivery request
  const prodParams = [
    'protocol=openvpn',
    'country=US',
    'status=online',
    'fresh_within=259200',
    'sort=score',
    'order=desc',
    'page=1',
    'per_page=100',
    `fields=${PVL_SERVERS_FIELDS}`,
  ];
  const aRes = await fetchFreshServersPageForDelivery({
    protocol: 'openvpn',
    country: 'US',
    sort: 'score',
    page: 1,
    perPage: 100,
  });
  let aState = aRes?.error ? aRes.error : 'not_in_page1';
  if (!aRes?.error) {
    const rec = (aRes?.data || []).find((r) => r?.id === targetId) || null;
    aState = rec ? describeFieldValueState(rec, 'config_download_url') : `not_in_rows(count=${(aRes?.data || []).length})`;
  }

  // b_no_fields
  const bUrl = `${PVL_BASE_URL}/servers?protocol=openvpn&country=US&status=online&fresh_within=259200&sort=score&order=desc&page=1&per_page=100`;
  const bState = await inspectList(bUrl, 'b_no_fields');

  // c_fields_only_urls
  const cUrl = `${PVL_BASE_URL}/servers?protocol=openvpn&country=US&status=online&fresh_within=259200&sort=score&order=desc&page=1&per_page=100&fields=id,config_download_url,connection_info_url`;
  const cState = await inspectList(cUrl, 'c_fields_only_urls');

  // d_small_page (per_page=20, page=1)
  const dUrl = `${PVL_BASE_URL}/servers?protocol=openvpn&country=US&status=online&fresh_within=259200&sort=score&order=desc&page=1&per_page=20&fields=${PVL_SERVERS_FIELDS}`;
  const dState = await inspectList(dUrl, 'd_small_page');

  // e_detail_no_fields
  let eState = 'no_api_key';
  if (apiKey) {
    try {
      const eRes = await fetch(`${PVL_BASE_URL}/servers/${encodeURIComponent(targetId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Cache-Control': 'no-store' },
      });
      if (!eRes.ok) {
        eState = `http_${eRes.status}`;
      } else {
        const eJson = await eRes.json();
        const eRec = eJson?.data && typeof eJson.data === 'object' ? eJson.data : eJson;
        eState = describeFieldValueState(eRec, 'config_download_url');
      }
    } catch (err) {
      eState = `fetch_${err?.name || 'Error'}`;
    }
  }

  // f_detail_prod: exact fetchServerDetailFresh
  const fRec = await fetchServerDetailFresh(targetId);
  const fState = describeFieldValueState(fRec, 'config_download_url');

  // g_scan_examined: latest delivery_debug row for owner
  let gSummary = 'no_delivery_debug_rows';
  const lastRow = await db
    .select()
    .from(deliveryDebug)
    .where(eq(deliveryDebug.userId, Number(ownerUserId) || 0))
    .orderBy(desc(deliveryDebug.id))
    .limit(1)
    .get();
  if (lastRow) {
    let entries = [];
    try { entries = JSON.parse(lastRow.detail || '[]'); } catch { entries = []; }
    const hist = {};
    for (const e of entries) {
      const code = String(e?.reason_code || 'unknown');
      hist[code] = (hist[code] || 0) + 1;
    }
    gSummary = `batch=#${lastRow.id} entries=${entries.length} delivered=${lastRow.delivered}/${lastRow.requested} hist=${JSON.stringify(hist)}`;
  }

  const lines = [
    `DebugProbe2 (${targetId})`,
    `a_prod_query: ${aState}`,
    `a_params: ${prodParams.join('&')}`,
    `b_no_fields: ${bState}`,
    `c_fields_only_urls: ${cState}`,
    `d_small_page(per_page=20,p=1): ${dState}`,
    `e_detail_no_fields: ${eState}`,
    `f_detail_prod(GET /servers/{id}, no params): ${fState}`,
    `g_scan_examined: ${gSummary}`,
  ];

  return { text: lines.join('\n') };
}

function sha256HexPrefix(str, len = 8) {
  const bytes = new TextEncoder().encode(str);
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bitLen = bytes.length * 8;
  const padLen = ((bytes.length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 4, bitLen >>> 0, false);

  const w = new Int32Array(64);
  const rotr = (n, x) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < padLen; i += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = dv.getInt32(i + t * 4, false);
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
      const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t += 1) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('').slice(0, len);
}

export async function runDebugProbe3(ctxLabel = 'handler') {
  const targetId = 'pvl_d520729f887d4b3754a8e4b6';
  const runtimeAppId =
    (typeof process !== 'undefined' && process?.env?.TGCLOUD_APP_ID) ||
    'app9074617711 (texts.js)';

  const apiKey = await getPvlApiKey();
  let keyState = 'missing';
  let keyFingerprint = 'none';
  if (apiKey !== null && apiKey !== undefined) {
    if (String(apiKey).length === 0) {
      keyState = 'empty';
    } else {
      keyState = `string(len=${String(apiKey).length})`;
      keyFingerprint = sha256HexPrefix(String(apiKey), 8);
    }
  }
  const authAttached = Boolean(apiKey);
  const hostMatch = /^https?:\/\/([^/]+)/i.exec(PVL_BASE_URL);
  const baseHost = hostMatch ? hostMatch[1] : PVL_BASE_URL;

  const url =
    `${PVL_BASE_URL}/servers?protocol=openvpn&country=US&status=online&fresh_within=259200` +
    `&sort=score&order=desc&page=1&per_page=100`;
  const headers = { Accept: 'application/json', 'Cache-Control': 'no-store' };
  if (authAttached) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let metaTotal = null;
  let rowsReturned = 0;
  let firstRowId = null;
  let targetPresent = false;
  let targetUrlState = 'absent';

  try {
    const res = await fetch(url, { method: 'GET', headers });
    if (res.ok) {
      const json = await res.json();
      const rows = Array.isArray(json?.data) ? json.data : [];
      metaTotal = json?.meta?.total ?? null;
      rowsReturned = rows.length;
      firstRowId = rows[0]?.id || null;
      const target = rows.find((r) => r?.id === targetId) || null;
      targetPresent = Boolean(target);
      if (target) {
        targetUrlState = describeFieldValueState(target, 'config_download_url');
      }
    } else {
      metaTotal = `http_${res.status}`;
    }
  } catch (err) {
    metaTotal = `fetch_${err?.name || 'Error'}`;
  }

  const lines = [
    `ctx: ${ctxLabel}`,
    `app_identity: ${runtimeAppId}`,
    `auth_attached: ${authAttached}`,
    `key_state: ${keyState}`,
    `key_fingerprint: ${keyFingerprint}`,
    `base_host: ${baseHost}`,
    `meta_total: ${metaTotal}`,
    `rows_returned: ${rowsReturned}`,
    `first_row_id: ${firstRowId}`,
    `target_present: ${targetPresent}`,
    `target_url_state: ${targetUrlState}`,
  ];

  return { text: lines.join('\n') };
}
