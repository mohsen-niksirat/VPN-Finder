// endpoints/pvlCountries.js -> GET https://publicvpnlist.com/api/v1/countries?protocol=<p>
// ALWAYS pass `protocol` explicitly when a protocol is meant; never rely on the API's OpenVPN-only default.
import { EndpointError } from 'sdk';
import {
  ALLOWED_PROTOCOLS,
  getProtocolCountriesResolved,
  PVL_CACHE_TTL_SEC,
  requireTelegramAuth,
} from '../lib/pvl.js';

export default async function (input, ctx) {
  requireTelegramAuth(ctx);

  const rawProtocol = input && typeof input.protocol === 'string'
    ? input.protocol.trim().toLowerCase()
    : '';

  if (!rawProtocol) {
    throw new EndpointError(
      'Missing required "protocol" parameter (never rely on the API OpenVPN-only default)',
      { code: 'MISSING_PROTOCOL' }
    );
  }

  if (!ALLOWED_PROTOCOLS.has(rawProtocol)) {
    throw new EndpointError(
      `Invalid protocol "${rawProtocol}". Allowed: ${[...ALLOWED_PROTOCOLS].join(', ')}`,
      { code: 'INVALID_PROTOCOL', parameter: 'protocol' }
    );
  }

  return await getProtocolCountriesResolved(rawProtocol, PVL_CACHE_TTL_SEC);
}
