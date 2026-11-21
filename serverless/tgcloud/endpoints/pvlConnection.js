// endpoints/pvlConnection.js -> On-demand connection payload proxy (Stage 3).
// NEVER caches, stores, or logs the returned configuration payload.
// Per-user rate limit: max 15 fetches per 10 minutes.

import {
  fetchConnection,
  requireTelegramAuth,
} from '../lib/pvl.js';

export default async function (input, ctx) {
  const user = requireTelegramAuth(ctx);

  const res = await fetchConnection(input?.id, user.id);

  if (res && typeof res === 'object' && '_auth_mode' in res) {
    const { _auth_mode, ...clean } = res;
    return clean;
  }
  return res;
}
