// endpoints/pvlServers.js -> GET https://publicvpnlist.com/api/v1/servers
// Allowlisted parameters only:
//   - protocol (REQUIRED: missing protocol -> 400, never fall back to OpenVPN default)
//   - country (optional, ^[A-Z]{2}$)
//   - sort ∈ {score, speed, latency, last_checked}
//   - page >= 1
//   - per_page fixed 20 (reject any other value if passed)
// Forced parameters: status=online, fresh_within=86400, explicit fields list.
// Cached in pvl_cache with 5-minute TTL + ETag revalidation + 429 stale fallback.

import {
  fetchPvlServers,
  requireTelegramAuth,
} from '../lib/pvl.js';

export default async function (input, ctx) {
  requireTelegramAuth(ctx);

  return await fetchPvlServers(input || {});
}
