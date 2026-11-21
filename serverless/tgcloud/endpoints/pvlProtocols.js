// endpoints/pvlProtocols.js -> GET https://publicvpnlist.com/api/v1/protocols
// Enriches active protocols (record_count > 0) with checker-measured median_speed_mbps.
import {
  fetchPvlCached,
  getProtocolSpeedSummary,
  PVL_CACHE_TTL_SEC,
  requireTelegramAuth,
} from '../lib/pvl.js';

export default async function (input, ctx) {
  requireTelegramAuth(ctx);

  const res = await fetchPvlCached({
    cacheKey: 'protocols',
    pathAndQuery: '/protocols',
    ttlSec: PVL_CACHE_TTL_SEC,
  });

  if (!res || res.error || !Array.isArray(res.data)) {
    return res;
  }

  const activeProtos = res.data
    .filter((item) => Number(item?.record_count || 0) > 0)
    .map((item) => String(item.protocol || '').toLowerCase())
    .filter(Boolean);

  const speedMap = await getProtocolSpeedSummary(activeProtos);

  const enrichedData = res.data.map((item) => {
    const key = String(item?.protocol || '').toLowerCase();
    const speedInfo = speedMap[key];
    return {
      ...item,
      median_speed_mbps:
        item.median_speed_mbps !== undefined
          ? item.median_speed_mbps
          : (speedInfo ? speedInfo.median_speed_mbps : null),
      measured_count:
        item.measured_count !== undefined
          ? item.measured_count
          : (speedInfo ? speedInfo.measured_count : 0),
    };
  });

  return {
    ...res,
    data: enrichedData,
  };
}

