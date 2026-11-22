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
import { flowExpiredText } from '../lib/texts.js';
import {
  getSubLinkBase,
  regenerateSubToken,
  revokeSubToken,
  sendSubResponse,
  subKeyboard,
  subLinkText,
  subRevokedText,
  subSetupPendingText,
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
  const lang = cq.from.language_code || 'en';
  const data = String(cq.data || '');
  const dryRun = Boolean(cq._dry_run);

  if (!dryRun && cq.id) {
    await api.answerCallbackQuery({ callback_query_id: cq.id }).catch(() => {});
  }

  if (data === 'sub:open') {
    await sendSubResponse({ chatId, userId, lang, sendMsg });
    return { action: 'sub_open', userId };
  }

  if (data === 'sub:regen') {
    const base = await getSubLinkBase();
    if (!base) {
      await sendMsg({ chat_id: chatId, text: subSetupPendingText(lang) });
      return { action: 'sub_regen_pending', userId };
    }
    const token = await regenerateSubToken(userId);
    const url = `${base}/sub/${token}`;
    const text = subLinkText(url, lang, { regenerated: true });
    const reply_markup = subKeyboard(lang);
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
    return { action: 'sub_regen', userId };
  }

  if (data === 'sub:revoke') {
    await revokeSubToken(userId);
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
