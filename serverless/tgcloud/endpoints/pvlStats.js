// endpoints/pvlStats.js → GET https://publicvpnlist.com/api/v1/stats
// Supports optional `protocol` input (explicitly passed when filtering by protocol).
import { EndpointError } from 'sdk';
import {
  ALLOWED_PROTOCOLS,
  fetchPvlCached,
  PVL_CACHE_TTL_SEC,
  requireTelegramAuth,
} from '../lib/pvl.js';

export default async function (input, ctx) {
  requireTelegramAuth(ctx);

  const rawProtocol = input && typeof input.protocol === 'string'
    ? input.protocol.trim().toLowerCase()
    : '';

  if (rawProtocol) {
    if (!ALLOWED_PROTOCOLS.has(rawProtocol)) {
      throw new EndpointError(
        `Invalid protocol "${rawProtocol}". Allowed: ${[...ALLOWED_PROTOCOLS].join(', ')}`,
        { code: 'INVALID_PROTOCOL', parameter: 'protocol' }
      );
    }
    return await fetchPvlCached({
      cacheKey: `stats?protocol=${rawProtocol}`,
      pathAndQuery: `/stats?protocol=${encodeURIComponent(rawProtocol)}`,
      ttlSec: PVL_CACHE_TTL_SEC,
    });
  }

  return await fetchPvlCached({
    cacheKey: 'stats',
    pathAndQuery: '/stats',
    ttlSec: PVL_CACHE_TTL_SEC,
  });
}
