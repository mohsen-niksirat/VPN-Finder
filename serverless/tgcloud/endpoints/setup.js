import { api, db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { botConfig } from '../schema.js';
import { getOwnerId } from '../lib/pvl.js';
import {
  ABOUT_EN,
  ABOUT_FA,
  COMMANDS_EN,
  COMMANDS_FA,
  DESC_EN,
  DESC_FA,
} from '../lib/texts.js';

export default async function (input, ctx) {
  const existingOwnerId = await getOwnerId();
  const callerId = Number(ctx?.initData?.user?.id || 0);

  // If OWNER_ID is already configured, only the owner (or CLI run passing owner ctx) can call setup
  if (existingOwnerId && callerId !== existingOwnerId) {
    throw new EndpointError('Forbidden: only OWNER_ID may run setup', { code: 'FORBIDDEN' });
  }

  const now = Math.floor(Date.now() / 1000);
  const savedKeys = [];

  if (input && typeof input === 'object') {
    for (const key of ['pvl_api_key', 'OWNER_ID', 'sub_worker_secret', 'sub_link_base']) {
      if (input[key] !== undefined && input[key] !== null && String(input[key]).trim() !== '') {
        const val = String(input[key]).trim();
        await db
          .insert(botConfig)
          .values({ key, value: val, updatedAt: now })
          .onConflictDoUpdate({
            target: botConfig.key,
            set: { value: val, updatedAt: now },
          })
          .run();
        savedKeys.push(key);
      }
    }
  }

  if (!input || !input.skipBotMeta) {
    await api.setMyCommands({ commands: COMMANDS_EN });
    await api.setMyCommands({ commands: COMMANDS_FA, language_code: 'fa' });

    await api.setMyDescription({ description: DESC_EN });
    await api.setMyDescription({ description: DESC_FA, language_code: 'fa' });

    await api.setMyShortDescription({ short_description: ABOUT_EN });
    await api.setMyShortDescription({ short_description: ABOUT_FA, language_code: 'fa' });
  }

  const hasKeyRow = await db
    .select({ updatedAt: botConfig.updatedAt })
    .from(botConfig)
    .where(eq(botConfig.key, 'pvl_api_key'))
    .get();

  const ownerRow = await db
    .select({ value: botConfig.value })
    .from(botConfig)
    .where(eq(botConfig.key, 'OWNER_ID'))
    .get();

  return {
    ok: true,
    savedKeys,
    pvl_api_key_configured: Boolean(hasKeyRow),
    owner_id_configured: ownerRow ? Number(ownerRow.value) : null,
    languages: ['default (en)', 'fa'],
  };
}

