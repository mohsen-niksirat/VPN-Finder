// endpoints/pvlProtocols.js → GET https://publicvpnlist.com/api/v1/protocols
import { fetchPvlCached, PVL_CACHE_TTL_SEC, requireTelegramAuth } from '../lib/pvl.js';

export default async function (input, ctx) {
  requireTelegramAuth(ctx);

  return await fetchPvlCached({
    cacheKey: 'protocols',
    pathAndQuery: '/protocols',
    ttlSec: PVL_CACHE_TTL_SEC,
  });
}
