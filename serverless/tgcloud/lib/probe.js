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
