import { db } from 'sdk';
import { and, eq, sql } from 'sdk/db';
import { deliveryDebug, users } from '../schema.js';
import {
  ALLOWED_PROTOCOLS,
  checkConnectionRateLimit,
  consumeConnectionRateLimit,
  describeFieldValueState,
  downloadAndBrandOvpn,
  fetchConnection,
  fetchFreshServersPageForDelivery,
  fetchPvlCached,
  fetchPvlServers,
  getDerivedCountries,
  getRemainingConnectionBudget,
  incrementCounter,
  PVL_CACHE_TTL_SEC,
  resolveCountryName,
} from './pvl.js';
import {
  batchSummaryKeyboard,
  batchSummaryText,
  chooseAmountText,
  chooseCountryText,
  chooseProtocolText,
  countryCodeToFlag,
  flowCancelledText,
  flowExpiredText,
  formatConfigMessage,
  formatOvpnCaption,
  formatOvpnServerPageMessage,
  formatProtoLabel,
  isFa,
  noneFreshText,
  rateLimitExhaustedText,
  riskGateKeyboard,
  riskGateText,
} from './texts.js';

function truncateAtWord(str, maxLen = 18) {
  const s = String(str || '').trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 4 ? cut.slice(0, lastSpace) : cut;
  return `${base.trim()}…`;
}

export const FLOW_TTL_SEC = 10 * 60;
const COUNTRIES_PER_PAGE = 8;

export async function getUserRow(userId) {
  const uid = Number(userId) || 0;
  if (!uid) return null;
  return await db.select().from(users).where(eq(users.id, uid)).get();
}

export async function saveUserFlow(userId, flowObj) {
  const uid = Number(userId) || 0;
  if (!uid) return;
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(users)
    .values({
      id: uid,
      flowState: flowObj ? JSON.stringify(flowObj) : null,
      flowExpiresAt: flowObj ? now + FLOW_TTL_SEC : null,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        flowState: flowObj ? JSON.stringify(flowObj) : null,
        flowExpiresAt: flowObj ? now + FLOW_TTL_SEC : null,
        lastSeen: sql`(unixepoch())`,
      },
    })
    .run();
}

export async function clearUserFlow(userId) {
  await saveUserFlow(userId, null);
}

export async function setUserRiskAck(userId) {
  const uid = Number(userId) || 0;
  if (!uid) return;
  await db
    .insert(users)
    .values({ id: uid, riskAck: 1 })
    .onConflictDoUpdate({
      target: users.id,
      set: { riskAck: 1, lastSeen: sql`(unixepoch())` },
    })
    .run();
}

export function parseActiveFlow(userRow) {
  if (!userRow || !userRow.flowState) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Number(userRow.flowExpiresAt || 0) < now) {
    return null;
  }
  try {
    const parsed = typeof userRow.flowState === 'string'
      ? JSON.parse(userRow.flowState)
      : userRow.flowState;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function getFilteredTotalForProtocol(protocol) {
  const sort = protocol === 'openvpn' ? 'score' : 'last_checked';
  const res = await fetchPvlServers({ protocol, sort, page: 1 });
  return Number(res?.meta?.total ?? (Array.isArray(res?.data) ? res.data.length : 0));
}

export async function showProtocolStep({ chatId, userId, lang, sendMsg }) {
  const protoRes = await fetchPvlCached({
    cacheKey: 'protocols',
    pathAndQuery: '/protocols',
    ttlSec: PVL_CACHE_TTL_SEC,
  });

  const activeProtos = (Array.isArray(protoRes?.data) ? protoRes.data : [])
    .filter((p) => Number(p?.record_count || 0) > 0)
    .map((p) => String(p.protocol || '').toLowerCase())
    .filter((p) => ALLOWED_PROTOCOLS.has(p));

  const totals = await Promise.all(
    activeProtos.map(async (proto) => ({
      proto,
      total: await getFilteredTotalForProtocol(proto).catch(() => 0),
    }))
  );

  const nonZero = totals.filter((item) => item.total > 0);
  const buttons = (nonZero.length ? nonZero : totals).map((item) => ({
    text: `${formatProtoLabel(item.proto)} · ${item.total}`,
    callback_data: `get_p_${item.proto}`,
  }));

  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  await saveUserFlow(userId, { step: 'protocol' });

  const text = chooseProtocolText(lang);
  const reply_markup = { inline_keyboard: rows };
  await sendMsg({ chat_id: chatId, text, reply_markup });
  return { step: 'protocol', text, reply_markup, protocols: totals };
}

export async function showCountryStep({ chatId, userId, lang, protocol, page = 0, sendMsg }) {
  const proto = String(protocol || '').toLowerCase();
  if (!ALLOWED_PROTOCOLS.has(proto)) {
    return await showProtocolStep({ chatId, userId, lang, sendMsg });
  }

  const derived = await getDerivedCountries(proto);
  const countries = Array.isArray(derived?.data) ? derived.data : [];
  const totalFresh = Number(
    derived?.meta?.total_records ?? (await getFilteredTotalForProtocol(proto))
  );

  if (totalFresh < 1) {
    const text = noneFreshText(lang, formatProtoLabel(proto));
    const reply_markup = {
      inline_keyboard: [[
        { text: isFa(lang) ? '← تغییر پروتکل' : '← Choose protocol', callback_data: 'get_back_proto' },
      ]],
    };
    await sendMsg({ chat_id: chatId, text, reply_markup });
    return { step: 'none_fresh', protocol: proto, totalFresh: 0, text, reply_markup };
  }

  const totalPages = Math.max(1, Math.ceil(countries.length / COUNTRIES_PER_PAGE));
  const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const slice = countries.slice(
    safePage * COUNTRIES_PER_PAGE,
    (safePage + 1) * COUNTRIES_PER_PAGE
  );

  const rows = [];
  for (let i = 0; i < slice.length; i += 2) {
    const pair = slice.slice(i, i + 2).map((c) => {
      const cc = String(c.country_code || '').toUpperCase();
      const cnt = Number(c.count ?? c.record_count ?? 0);
      const name = truncateAtWord(resolveCountryName(cc, c.country_name), 18);
      return {
        text: `${countryCodeToFlag(cc)} ${name} · ${cnt}`,
        callback_data: `get_c_${proto}_${cc}_${safePage}`,
      };
    });
    rows.push(pair);
  }

  // All countries row
  const allLabel = isFa(lang) ? `🌍 همه کشورها · ${totalFresh}` : `🌍 All countries · ${totalFresh}`;
  rows.push([{ text: allLabel, callback_data: `get_c_${proto}_ALL_${safePage}` }]);

  // Pagination + Back row
  const navRow = [];
  if (safePage > 0) {
    navRow.push({
      text: isFa(lang) ? '◂ قبلی' : '◂ Prev',
      callback_data: `get_c_${proto}_PAGE_${safePage - 1}`,
    });
  }
  if (safePage + 1 < totalPages) {
    navRow.push({
      text: isFa(lang) ? 'کشورهای بیشتر ▸' : 'More countries ▸',
      callback_data: `get_c_${proto}_PAGE_${safePage + 1}`,
    });
  }
  navRow.push({
    text: isFa(lang) ? '← پروتکل‌ها' : '← Protocols',
    callback_data: 'get_back_proto',
  });
  rows.push(navRow);

  await saveUserFlow(userId, { step: 'country', protocol: proto, page: safePage });

  const text = chooseCountryText(lang, totalFresh, formatProtoLabel(proto));
  const reply_markup = { inline_keyboard: rows };
  await sendMsg({ chat_id: chatId, text, reply_markup });
  return { step: 'country', protocol: proto, page: safePage, totalFresh, text, reply_markup };
}

export async function showAmountStep({ chatId, userId, lang, protocol, country, sendMsg }) {
  const proto = String(protocol || '').toLowerCase();
  const cc = country && country !== 'ALL' ? String(country).toUpperCase() : 'ALL';
  if (!ALLOWED_PROTOCOLS.has(proto)) {
    return await showProtocolStep({ chatId, userId, lang, sendMsg });
  }

  let available = 0;
  let countryLabel = isFa(lang) ? 'همه کشورها' : 'All countries';

  if (cc === 'ALL') {
    available = await getFilteredTotalForProtocol(proto);
  } else {
    const derived = await getDerivedCountries(proto);
    const match = (derived?.data || []).find(
      (c) => String(c.country_code || '').toUpperCase() === cc
    );
    available = Number(match?.count ?? match?.record_count ?? 0);
    countryLabel = `${countryCodeToFlag(cc)} ${match?.country_name || resolveCountryName(cc)}`;
  }

  const protoLabel = formatProtoLabel(proto);
  if (available < 1) {
    const text = noneFreshText(lang, protoLabel, countryLabel);
    const reply_markup = {
      inline_keyboard: [[
        { text: isFa(lang) ? '🌍 تغییر کشور' : '🌍 Change country', callback_data: `get_p_${proto}` },
      ]],
    };
    await sendMsg({ chat_id: chatId, text, reply_markup });
    return { step: 'none_fresh', protocol: proto, country: cc, available: 0, text, reply_markup };
  }

  const remaining = await getRemainingConnectionBudget(userId);
  if (remaining < 1) {
    const text = rateLimitExhaustedText(lang);
    const reply_markup = {
      inline_keyboard: [[
        { text: isFa(lang) ? '← پروتکل‌ها' : '← Protocols', callback_data: 'get_back_proto' },
      ]],
    };
    await sendMsg({ chat_id: chatId, text, reply_markup });
    return { step: 'rate_limited', protocol: proto, country: cc, remaining: 0, text, reply_markup };
  }

  const maxAllowed = Math.min(available, remaining);
  const presetCounts = [1, 3, 5, 10].filter((n) => n <= maxAllowed);
  if (!presetCounts.length && maxAllowed >= 1) {
    presetCounts.push(maxAllowed);
  }

  const buttons = presetCounts.map((n) => ({
    text: String(n),
    callback_data: `get_n_${n}`,
  }));

  const rows = [
    buttons,
    [{ text: isFa(lang) ? '🌍 تغییر کشور' : '🌍 Change country', callback_data: `get_p_${proto}` }],
  ];

  await saveUserFlow(userId, {
    step: 'amount',
    protocol: proto,
    country: cc,
    available,
    deliveredIds: [],
    delivering: false,
    batchToken: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  });

  const text = chooseAmountText(lang, available, protoLabel, countryLabel, remaining);
  const reply_markup = { inline_keyboard: rows };
  await sendMsg({ chat_id: chatId, text, reply_markup });
  return { step: 'amount', protocol: proto, country: cc, available, remaining, text, reply_markup };
}

export async function deliverConfigsBatch({
  chatId,
  userId,
  lang,
  count,
  sendMsg,
  sendDoc,
  extraCandidateIds = [],
  forceOnlyExtra = false,
  expectedStep = null,
}) {
  const userRow = await getUserRow(userId);
  const flow = parseActiveFlow(userRow);
  if (!flow || !flow.protocol) {
    const text = flowExpiredText(lang);
    await sendMsg({ chat_id: chatId, text });
    return { step: 'expired', text };
  }

  // Idempotency guard against duplicate callback deliveries / re-entrant taps
  if (flow.delivering === true) {
    return { step: 'duplicate_ignored', duplicateIgnored: true };
  }
  if (expectedStep === 'amount' && flow.step !== 'amount') {
    return { step: 'duplicate_ignored', duplicateIgnored: true };
  }
  if (expectedStep === 'more' && flow.step !== 'delivered') {
    return { step: 'duplicate_ignored', duplicateIgnored: true };
  }

  // Atomically stamp delivering=true before any network/delivery work
  const lockedState = JSON.stringify({ ...flow, delivering: true });
  const nowLock = Math.floor(Date.now() / 1000);
  const lockRes = await db
    .update(users)
    .set({ flowState: lockedState, flowExpiresAt: nowLock + FLOW_TTL_SEC })
    .where(and(eq(users.id, Number(userId) || 0), eq(users.flowState, userRow.flowState)))
    .run();
  if (!lockRes || Number(lockRes.rowsAffected ?? lockRes.changes ?? 1) === 0) {
    return { step: 'duplicate_ignored', duplicateIgnored: true };
  }

  const proto = flow.protocol;
  const cc = flow.country && flow.country !== 'ALL' ? flow.country : '';
  const alreadyDelivered = new Set(Array.isArray(flow.deliveredIds) ? flow.deliveredIds : []);
  const requested = Math.max(1, Math.min(10, Number(count) || 1));

  const sort = proto === 'openvpn' ? 'score' : 'last_checked';
  const candidates = [];

  for (const staleId of extraCandidateIds) {
    if (staleId && !alreadyDelivered.has(staleId)) {
      candidates.push({ id: staleId, protocol: proto, transport: 'tcp', speed_mbps: null, last_checked_at: null });
    }
  }

  if (!forceOnlyExtra) {
    if (proto === 'openvpn') {
      // Scan country pool fresh (cache-bypassed), bounded to at most 5 pages / 100 records per page
      let page = 1;
      let totalPages = 1;
      let examined = 0;
      let deliverableCount = 0;
      const neededDeliverable = requested + 5;
      do {
        const res = await fetchFreshServersPageForDelivery({
          protocol: 'openvpn',
          country: cc,
          sort,
          page,
          perPage: 100,
        });
        if (!res || res.error) break;
        const rows = Array.isArray(res.data) ? res.data : [];
        totalPages = Math.max(1, Number(res.meta?.pages || 1));
        for (const r of rows) {
          if (examined >= 100) break;
          if (!r || !r.id || alreadyDelivered.has(r.id)) continue;
          examined += 1;
          candidates.push(r);
          if (
            (typeof r.config_download_url === 'string' && r.config_download_url.length > 0) ||
            (typeof r.server_page_url === 'string' && r.server_page_url.length > 0)
          ) {
            deliverableCount += 1;
            if (deliverableCount >= neededDeliverable) break;
          }
        }
        page += 1;
      } while (deliverableCount < neededDeliverable && examined < 100 && page <= totalPages && page <= 5);
    } else {
      let page = 1;
      let totalPages = 1;
      const maxCandidatesNeeded = requested + 5;
      do {
        const res = await fetchPvlServers({
          protocol: proto,
          ...(cc ? { country: cc } : {}),
          sort,
          page,
        });
        const rows = Array.isArray(res?.data) ? res.data : [];
        totalPages = Math.max(1, Number(res?.meta?.pages || 1));
        for (const r of rows) {
          if (r && r.id && !alreadyDelivered.has(r.id)) {
            candidates.push(r);
          }
        }
        page += 1;
      } while (candidates.length < maxCandidatesNeeded && page <= totalPages && page <= 10);
    }
  }

  if (candidates.length === 0) {
    await saveUserFlow(userId, { ...flow, delivering: false });
    const countryLabel = cc ? `${countryCodeToFlag(cc)} ${resolveCountryName(cc)}` : '';
    const text = noneFreshText(lang, formatProtoLabel(proto), countryLabel);
    const reply_markup = {
      inline_keyboard: [[
        { text: isFa(lang) ? '🌍 تغییر کشور' : '🌍 Change country', callback_data: `get_p_${proto}` },
      ]],
    };
    await sendMsg({ chat_id: chatId, text, reply_markup });
    return { step: 'none_fresh', protocol: proto, country: cc || 'ALL', delivered: 0 };
  }

  const maxAttempts = requested + 5;
  let attempts = 0;
  let delivered = 0;
  let huskCount = 0;
  let rateLimited = false;
  let sendFailedCount = 0;
  let openVpnPageUsed = false;
  const skippedIds = [];
  const debugEntries = [];
  const deliveredMeta = [];

  for (const srv of candidates) {
    if (delivered >= requested || attempts >= maxAttempts) break;

    if (!srv || !srv.id) {
      attempts += 1;
      skippedIds.push({ id: 'unknown', reason: 'missing_record_id' });
      debugEntries.push({
        id: 'unknown',
        stage_reached: 'record_resolve',
        reason_code: 'missing_record_id',
        http_status: null,
      });
      continue;
    }

    if (proto === 'openvpn') {
      const dlUrl = typeof srv.config_download_url === 'string' && srv.config_download_url.length > 0
        ? srv.config_download_url
        : null;
      const serverPageUrl = typeof srv.server_page_url === 'string' && srv.server_page_url.length > 0
        ? srv.server_page_url
        : null;

      // Skip dead-husk records with neither download URL nor server page URL WITHOUT consuming an attempt
      if (!dlUrl && !serverPageUrl) {
        huskCount += 1;
        debugEntries.push({
          id: srv.id,
          stage_reached: 'record_resolve',
          reason_code: 'not_deliverable_null_url',
          http_status: null,
          ...(debugEntries.length === 0 ? { fallback_invoked: false, fallback_value_state: 'null' } : {}),
        });
        continue;
      }

      attempts += 1;
      const rateCheck = await checkConnectionRateLimit(userId);
      if (!rateCheck.allowed) {
        rateLimited = true;
        debugEntries.push({
          id: srv.id,
          stage_reached: 'payload_fetch',
          reason_code: 'rate_limited',
          http_status: null,
        });
        break;
      }

      if (!dlUrl && serverPageUrl) {
        const nextIdx = delivered + 1;
        const msgText = formatOvpnServerPageMessage(nextIdx, requested, srv, lang);
        const btnText = isFa(lang)
          ? '🌐 دانلود .ovpn از صفحه سرور'
          : '🌐 Download .ovpn from the server page';
        try {
          await sendMsg({
            chat_id: chatId,
            text: msgText,
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [[{ text: btnText, url: serverPageUrl }]],
            },
          });
        } catch (err) {
          sendFailedCount += 1;
          debugEntries.push({
            id: srv.id,
            stage_reached: 'send',
            reason_code: `send_${err?.name || 'Error'}`,
            http_status: 200,
          });
          continue;
        }

        delivered = nextIdx;
        openVpnPageUsed = true;
        alreadyDelivered.add(srv.id);
        await consumeConnectionRateLimit(userId);
        await incrementCounter('connections_served', 1);
        await incrementCounter('configs_sent_chat', 1);
        debugEntries.push({
          id: srv.id,
          stage_reached: 'send',
          reason_code: 'ok_via_server_page',
          http_status: 200,
        });

        deliveredMeta.push({
          id: srv.id,
          type: 'ovpn_server_page',
          url: serverPageUrl,
        });
        continue;
      }

      const ovpn = await downloadAndBrandOvpn(dlUrl);
      if (ovpn?.error || !ovpn?.bytes) {
        const reasonCode = ovpn?.reasonCode || ovpn?.error || 'ovpn_download_failed';
        const stageReached = String(reasonCode).startsWith('brand_') ? 'brand' : 'download';
        skippedIds.push({ id: srv.id, reason: ovpn?.error || 'ovpn_download_failed' });
        debugEntries.push({
          id: srv.id,
          stage_reached: stageReached,
          reason_code: reasonCode,
          http_status: ovpn?.httpStatus ?? null,
        });
        continue;
      }

      const nextIdx = delivered + 1;
      const ccPart = (srv.country_code || cc || 'OpenVPN').toUpperCase();
      const filename = `MyLeitner-${ccPart === 'OPENVPN' ? 'OpenVPN' : ccPart}-${nextIdx}.ovpn`;
      const caption = formatOvpnCaption(nextIdx, requested, srv, lang);

      try {
        await sendDoc({
          chat_id: chatId,
          documentBytes: ovpn.bytes,
          filename,
          caption,
        });
      } catch (err) {
        sendFailedCount += 1;
        debugEntries.push({
          id: srv.id,
          stage_reached: 'send',
          reason_code: `send_${err?.name || 'Error'}`,
          http_status: ovpn.httpStatus ?? 200,
        });
        continue;
      }

      delivered = nextIdx;
      alreadyDelivered.add(srv.id);
      await consumeConnectionRateLimit(userId);
      await incrementCounter('connections_served', 1);
      await incrementCounter('configs_sent_chat', 1);
      debugEntries.push({
        id: srv.id,
        stage_reached: 'send',
        reason_code: 'ok',
        http_status: ovpn.httpStatus ?? 200,
      });

      deliveredMeta.push({
        id: srv.id,
        type: 'ovpn',
        filename,
        byteLength: ovpn.byteLength,
        firstLine: ovpn.firstLine,
        caption,
      });
      continue;
    }

    attempts += 1;
    const conn = await fetchConnection(srv.id, userId, { deferBudgetConsume: true });
    if (conn?.error === 'rate_limited') {
      rateLimited = true;
      debugEntries.push({
        id: srv.id,
        stage_reached: 'payload_fetch',
        reason_code: 'rate_limited',
        http_status: null,
      });
      break;
    }
    if (conn?.error) {
      skippedIds.push({ id: srv.id, reason: conn.error });
      debugEntries.push({
        id: srv.id,
        stage_reached: 'payload_fetch',
        reason_code: `fetch_${conn.error}`,
        http_status: null,
      });
      continue;
    }

    if (!conn.config_uri) {
      skippedIds.push({ id: srv.id, reason: 'no_uri' });
      debugEntries.push({
        id: srv.id,
        stage_reached: 'payload_fetch',
        reason_code: 'missing_config_uri',
        http_status: null,
      });
      continue;
    }

    const nextIdx = delivered + 1;
    const uri = String(conn.config_uri);
    const schemeIdx = uri.indexOf('://');
    const schemePrefix = schemeIdx > 0 ? `${uri.slice(0, schemeIdx + 3)}...` : 'unknown';
    const msgHtml = formatConfigMessage(nextIdx, requested, srv, uri, lang);

    try {
      await sendMsg({
        chat_id: chatId,
        text: msgHtml,
        parse_mode: 'HTML',
      });
    } catch (err) {
      sendFailedCount += 1;
      debugEntries.push({
        id: srv.id,
        stage_reached: 'send',
        reason_code: `send_${err?.name || 'Error'}`,
        http_status: 200,
      });
      continue;
    }

    delivered = nextIdx;
    alreadyDelivered.add(srv.id);
    await consumeConnectionRateLimit(userId);
    await incrementCounter('connections_served', 1);
    await incrementCounter('configs_sent_chat', 1);
    debugEntries.push({
      id: srv.id,
      stage_reached: 'send',
      reason_code: 'ok',
      http_status: 200,
    });

    deliveredMeta.push({
      id: srv.id,
      type: 'uri',
      scheme: schemePrefix,
      length: uri.length,
    });
  }

  try {
    await db
      .insert(deliveryDebug)
      .values({
        userId: Number(userId) || 0,
        createdAt: Math.floor(Date.now() / 1000),
        protocol: proto,
        country: cc || 'ALL',
        requested,
        delivered,
        detail: JSON.stringify(debugEntries),
      })
      .run();
  } catch {
    // Telemetry write must never break delivery
  }

  await saveUserFlow(userId, {
    step: 'delivered',
    protocol: proto,
    country: cc || 'ALL',
    lastCount: requested,
    deliveredIds: Array.from(alreadyDelivered),
    delivering: false,
    batchToken: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  });

  if (delivered === 0 && rateLimited) {
    const text = rateLimitExhaustedText(lang);
    await sendMsg({ chat_id: chatId, text });
    return {
      step: 'delivered',
      protocol: proto,
      country: cc || 'ALL',
      requested,
      delivered: 0,
      rateLimited: true,
      deliveredMeta,
      skippedIds,
      sendFailedCount,
    };
  }

  const allFailed = delivered === 0 && !rateLimited;
  const fewerWorkingNote = delivered < requested && !rateLimited && huskCount > 0 && skippedIds.length === 0;
  const summary = batchSummaryText(lang, delivered, requested, {
    rateLimited,
    skippedCount: skippedIds.length,
    sendFailedCount,
    fewerWorkingNote,
    openVpnPageMode: openVpnPageUsed,
  });
  const summaryKb = batchSummaryKeyboard(lang, proto, cc || 'ALL', { allFailed });
  await sendMsg({
    chat_id: chatId,
    text: summary,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: summaryKb,
  });

  return {
    step: 'delivered',
    protocol: proto,
    country: cc || 'ALL',
    requested,
    delivered,
    huskCount,
    rateLimited,
    allFailed,
    deliveredMeta,
    skippedIds,
    sendFailedCount,
    summaryText: summary,
    summaryKeyboard: summaryKb,
  };
}

export async function startGetFlow({
  chatId,
  userId,
  lang,
  sendMsg,
  preselectProtocol = '',
  preselectCountry = '',
}) {
  await incrementCounter('get_flows_started', 1);
  const userRow = await getUserRow(userId);
  const proto = ALLOWED_PROTOCOLS.has(String(preselectProtocol || '').toLowerCase())
    ? String(preselectProtocol).toLowerCase()
    : '';
  const cc = /^[A-Z]{2}$/.test(String(preselectCountry || '').toUpperCase())
    ? String(preselectCountry).toUpperCase()
    : '';

  if (!userRow || !userRow.riskAck) {
    await saveUserFlow(userId, {
      step: 'risk_ack',
      pendingProtocol: proto || null,
      pendingCountry: cc || null,
    });
    const text = riskGateText(lang);
    const reply_markup = riskGateKeyboard(lang);
    await sendMsg({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup,
    });
    return { step: 'risk_ack', text, reply_markup };
  }

  if (proto && cc) {
    return await showAmountStep({ chatId, userId, lang, protocol: proto, country: cc, sendMsg });
  }
  if (proto) {
    return await showCountryStep({ chatId, userId, lang, protocol: proto, page: 0, sendMsg });
  }
  return await showProtocolStep({ chatId, userId, lang, sendMsg });
}

export async function handleRiskAckDecision({ chatId, userId, lang, accepted, sendMsg }) {
  const userRow = await getUserRow(userId);
  const flow = parseActiveFlow(userRow);

  if (!accepted) {
    await clearUserFlow(userId);
    const text = flowCancelledText(lang);
    await sendMsg({ chat_id: chatId, text });
    return { step: 'cancelled', text };
  }

  await setUserRiskAck(userId);
  const proto = flow?.pendingProtocol || '';
  const cc = flow?.pendingCountry || '';

  if (proto && cc) {
    return await showAmountStep({ chatId, userId, lang, protocol: proto, country: cc, sendMsg });
  }
  if (proto) {
    return await showCountryStep({ chatId, userId, lang, protocol: proto, page: 0, sendMsg });
  }
  return await showProtocolStep({ chatId, userId, lang, sendMsg });
}
