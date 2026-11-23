import { api, InputFile } from 'sdk';
import {
  deliverConfigsBatch,
  getUserRow,
  handleRiskAckDecision,
  parseActiveFlow,
  showAmountStep,
  showCountryStep,
  showProtocolStep,
  startGetFlow,
} from '../lib/getFlow.js';
import { getEffectiveUserLang, getOwnerId, recordServerVote, setUserLang } from '../lib/pvl.js';
import {
  appsMenuKeyboard,
  appsMenuText,
  buildReplyPanelKeyboard,
  flowExpiredText,
  isFa,
  langUpdatedText,
  panelShownText,
  settingsKeyboard,
  settingsText,
} from '../lib/texts.js';
import {
  buildSubUrl,
  getActiveSubToken,
  getSubLinkBase,
  issueSubToken,
  listActiveSubTokens,
  regenerateSubToken,
  revokeSubToken,
  sendSubResponse,
  subKeyboard,
  subLinkText,
  subRevokedText,
  subSetupPendingText,
  updateSubFilters,
} from '../lib/sub.js';

export default async function (cq) {
  if (!cq || !cq.from || !cq.message || !cq.message.chat) return;
  const chat = cq.message.chat;
  // Configs and /get flows are strictly private-chat only
  if (chat.type !== 'private') {
    if (!cq._dry_run && cq.id) {
      await api.answerCallbackQuery({ callback_query_id: cq.id }).catch(() => {});
    }
    return;
  }

  const userId = cq.from.id;
  const chatId = chat.id;
  const lang = await getEffectiveUserLang(userId, cq.from.language_code || 'en');
  const data = String(cq.data || '');
  const dryRun = Boolean(cq._dry_run);

  if (!dryRun && cq.id && !data.startsWith('fb:')) {
    await api.answerCallbackQuery({ callback_query_id: cq.id }).catch(() => {});
  }

  const sendMsg = async (params) => {
    if (dryRun) return { dry_run: true, ...params };
    return await api.sendMessage(params);
  };
  const sendDoc = async ({ chat_id, documentBytes, filename, caption }) => {
    const inputFile = new InputFile(documentBytes, filename, {
      type: 'application/x-openvpn-profile',
    });
    if (dryRun) {
      return {
        dry_run: true,
        filename,
        byteLength: documentBytes?.byteLength || 0,
        caption,
        hasInputFile: Boolean(inputFile),
      };
    }
    return await api.sendDocument({
      chat_id,
      document: inputFile,
      caption,
    });
  };

  if (data === 'panel:show') {
    const ownerId = await getOwnerId();
    const isOwner = Boolean(ownerId && userId === ownerId);
    await sendMsg({
      chat_id: chatId,
      text: panelShownText(lang),
      reply_markup: buildReplyPanelKeyboard(lang, { isOwner }),
    });
    return { action: 'panel_show', userId };
  }

  if (data === 'lang:set:en' || data === 'lang:set:fa') {
    const chosen = data === 'lang:set:fa' ? 'fa' : 'en';
    await setUserLang(userId, chosen);
    const ownerId = await getOwnerId();
    const isOwner = Boolean(ownerId && userId === ownerId);
    const msgId = cq.message?.message_id;
    const text = langUpdatedText(chosen);
    const reply_markup = settingsKeyboard(chosen);
    if (!dryRun && msgId) {
      await api
        .editMessageText({
          chat_id: chatId,
          message_id: msgId,
          text,
          parse_mode: 'HTML',
          reply_markup,
        })
        .catch(() => sendMsg({ chat_id: chatId, text, parse_mode: 'HTML', reply_markup }));
    } else {
      await sendMsg({ chat_id: chatId, text, parse_mode: 'HTML', reply_markup });
    }
    await sendMsg({
      chat_id: chatId,
      text: panelShownText(chosen),
      reply_markup: buildReplyPanelKeyboard(chosen, { isOwner }),
    });
    return { action: 'lang_set', userId, lang: chosen };
  }

  if (data === 'apps:menu' || data === 'settings:open') {
    const isApps = data === 'apps:menu';
    const text = isApps ? appsMenuText(lang) : settingsText(lang);
    const reply_markup = isApps ? appsMenuKeyboard(lang) : settingsKeyboard(lang);
    const msgId = cq.message?.message_id;
    if (!dryRun && msgId) {
      await api
        .editMessageText({
          chat_id: chatId,
          message_id: msgId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup,
        })
        .catch(() => sendMsg({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup }));
    } else {
      await sendMsg({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup });
    }
    return { action: isApps ? 'apps_menu' : 'settings_open', userId };
  }

  if (data.startsWith('fb:up:') || data.startsWith('fb:down:')) {
    const isDown = data.startsWith('fb:down:');
    const sid = data.slice(isDown ? 'fb:down:'.length : 'fb:up:'.length);
    const res = await recordServerVote(sid, userId, isDown ? 'down' : 'up');
    const fa = isFa(lang);
    const toast = res.hidden
      ? (fa ? '👎 ثبت شد — این سرور از لیست عمومی پنهان شد.' : '👎 Recorded — server auto-hidden due to reports.')
      : isDown
        ? (fa ? `👎 گزارش خرابی ثبت شد (${res.down})` : `👎 Reported broken (${res.down})`)
        : (fa ? `👍 امتیاز سالم ثبت شد (${res.up})` : `👍 Marked working (${res.up})`);
    if (!dryRun && cq.id) {
      await api.answerCallbackQuery({ callback_query_id: cq.id, text: toast }).catch(() => {});
    }
    return { action: 'server_feedback', userId, serverId: sid, ...res };
  }

  if (data === 'sub:open') {
    await sendSubResponse({ chatId, userId, lang, sendMsg });
    return { action: 'sub_open', userId };
  }

  const renderEditedSub = async (active, { regenerated = false } = {}) => {
    const base = await getSubLinkBase();
    if (!base) {
      await sendMsg({ chat_id: chatId, text: subSetupPendingText(lang) });
      return;
    }
    const profiles = await listActiveSubTokens(userId);
    const idx = Math.max(1, profiles.findIndex((p) => Number(p.id) === Number(active.id)) + 1);
    const cc = active.cc || 'ALL';
    const isp = active.isp || 'ALL';
    const url = buildSubUrl(base, active.token, { cc, isp });
    const text = subLinkText(url, lang, {
      regenerated,
      cc,
      isp,
      profileNum: idx,
      totalProfiles: profiles.length,
    });
    const reply_markup = subKeyboard(lang, { cc, isp, profiles, activeId: active.id });
    const msgId = cq.message?.message_id;
    if (!dryRun && msgId) {
      await api
        .editMessageText({
          chat_id: chatId,
          message_id: msgId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup,
        })
        .catch(() => sendMsg({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup }));
    } else {
      await sendMsg({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup });
    }
  };

  if (data.startsWith('sub:cc:') || data.startsWith('sub:isp:')) {
    const parts = data.split(':');
    const kind = parts[1]; // 'cc' | 'isp'
    const val = parts[2] || 'ALL';
    const pid = Number(parts[3] || 0) || null;
    const updated = await updateSubFilters(
      userId,
      pid,
      kind === 'cc' ? { cc: val.toUpperCase() } : { isp: val }
    );
    if (updated) {
      await renderEditedSub(updated);
    } else {
      await sendSubResponse({ chatId, userId, lang, sendMsg });
    }
    return { action: `sub_${kind}`, userId, val };
  }

  if (data.startsWith('sub:sel:')) {
    const pid = Number(data.slice('sub:sel:'.length) || 0) || null;
    const active = await getActiveSubToken(userId, pid);
    if (active) {
      await renderEditedSub(active);
    } else {
      await sendSubResponse({ chatId, userId, lang, sendMsg });
    }
    return { action: 'sub_sel', userId, pid };
  }

  if (data === 'sub:new') {
    const existing = await listActiveSubTokens(userId);
    if (existing.length < 3) {
      await issueSubToken(userId, { cc: 'ALL', isp: 'ALL' });
    }
    const updated = await listActiveSubTokens(userId);
    const newest = updated[updated.length - 1];
    if (newest) {
      await renderEditedSub(newest);
    }
    return { action: 'sub_new', userId, count: updated.length };
  }

  if (data === 'sub:regen' || data.startsWith('sub:regen:')) {
    const pid = data.startsWith('sub:regen:') ? Number(data.slice('sub:regen:'.length) || 0) || null : null;
    const newTok = await regenerateSubToken(userId, pid);
    const profiles = await listActiveSubTokens(userId);
    const active = profiles.find((p) => p.token === newTok) || profiles[0];
    if (active) {
      await renderEditedSub(active, { regenerated: true });
    }
    return { action: 'sub_regen', userId };
  }

  if (data === 'sub:revoke' || data.startsWith('sub:revoke:')) {
    const pid = data.startsWith('sub:revoke:') ? Number(data.slice('sub:revoke:'.length) || 0) || null : null;
    await revokeSubToken(userId, pid);
    const remaining = await listActiveSubTokens(userId);
    if (remaining.length > 0) {
      await renderEditedSub(remaining[0]);
      return { action: 'sub_revoke_profile', userId };
    }
    const text = subRevokedText(lang);
    const msgId = cq.message?.message_id;
    if (!dryRun && msgId) {
      await api
        .editMessageText({
          chat_id: chatId,
          message_id: msgId,
          text,
        })
        .catch(() => sendMsg({ chat_id: chatId, text }));
    } else {
      await sendMsg({ chat_id: chatId, text });
    }
    return { action: 'sub_revoke', userId };
  }

  if (data === 'get_start' || data === 'get_back_proto') {
    return await startGetFlow({ chatId, userId, lang, sendMsg });
  }

  if (data === 'risk_ack_ok') {
    return await handleRiskAckDecision({ chatId, userId, lang, accepted: true, sendMsg });
  }

  if (data === 'risk_ack_cancel') {
    return await handleRiskAckDecision({ chatId, userId, lang, accepted: false, sendMsg });
  }

  if (data.startsWith('get_p_')) {
    const proto = data.slice('get_p_'.length);
    return await showCountryStep({ chatId, userId, lang, protocol: proto, page: 0, sendMsg });
  }

  if (data.startsWith('get_c_')) {
    const rest = data.slice('get_c_'.length);
    const parts = rest.split('_');
    if (parts.length >= 3) {
      const page = Number(parts[parts.length - 1]) || 0;
      const target = parts[parts.length - 2];
      const proto = parts.slice(0, parts.length - 2).join('_');
      if (target === 'PAGE') {
        return await showCountryStep({ chatId, userId, lang, protocol: proto, page, sendMsg });
      }
      return await showAmountStep({
        chatId,
        userId,
        lang,
        protocol: proto,
        country: target,
        sendMsg,
      });
    }
  }

  if (data.startsWith('get_n_')) {
    const count = Number(data.slice('get_n_'.length)) || 1;
    return await deliverConfigsBatch({
      chatId,
      userId,
      lang,
      count,
      sendMsg,
      sendDoc,
      extraCandidateIds: Array.isArray(cq._extra_candidate_ids) ? cq._extra_candidate_ids : [],
      forceOnlyExtra: Boolean(cq._force_only_extra),
      expectedStep: 'amount',
    });
  }

  if (data === 'get_more' || data === 'get_retry') {
    const userRow = await getUserRow(userId);
    const flow = parseActiveFlow(userRow);
    if (!flow || !flow.protocol) {
      const text = flowExpiredText(lang);
      await sendMsg({ chat_id: chatId, text });
      return { step: 'expired', text };
    }
    return await deliverConfigsBatch({
      chatId,
      userId,
      lang,
      count: Number(flow.lastCount || 3),
      sendMsg,
      sendDoc,
      expectedStep: 'more',
    });
  }

  if (data === 'get_chg_country') {
    const userRow = await getUserRow(userId);
    const flow = parseActiveFlow(userRow);
    if (!flow || !flow.protocol) {
      return await showProtocolStep({ chatId, userId, lang, sendMsg });
    }
    return await showCountryStep({
      chatId,
      userId,
      lang,
      protocol: flow.protocol,
      page: 0,
      sendMsg,
    });
  }
}
