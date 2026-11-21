// Pure-JS MaxMind DB (.mmdb) reader + ip_geo SQLite cache for DB-IP Country Lite.
//
// Attribution / License (DB-IP Lite):
// IP Geolocation by DB-IP (https://db-ip.com) — DB-IP Country Lite database,
// licensed under Creative Commons Attribution 4.0 International (CC BY 4.0):
// https://creativecommons.org/licenses/by/4.0/

import { db } from 'sdk';
import { eq } from 'sdk/db';
import { ipGeo } from '../schema.js';
import p0 from './dbipPart0.js';
import p1 from './dbipPart1.js';
import p2 from './dbipPart2.js';
import p3 from './dbipPart3.js';
import p4 from './dbipPart4.js';
import p5 from './dbipPart5.js';

const DBIP_COUNTRY_LITE_B64_GZ = p0 + p1 + p2 + p3 + p4 + p5;

const METADATA_MARKER = [
  0xab, 0xcd, 0xef, 0x4d, 0x61, 0x78, 0x4d, 0x69, 0x6e, 0x64, 0x2e, 0x63, 0x6f, 0x6d,
];
const utf8Decoder = new TextDecoder('utf-8');

let cachedReaderPromise = null;
let mmdbLookupCounter = 0;

export function getMmdbLookupCount() {
  return mmdbLookupCounter;
}

export function resetMmdbLookupCount() {
  mmdbLookupCounter = 0;
}

function base64ToUint8Array(b64) {
  const clean = b64.replace(/\s+/g, '');
  const len = clean.length;
  let pad = 0;
  if (clean[len - 1] === '=') pad += 1;
  if (clean[len - 2] === '=') pad += 1;
  const outLen = (len * 3) / 4 - pad;
  const out = new Uint8Array(outLen);

  const lut = new Int16Array(128).fill(-1);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < 64; i += 1) lut[chars.charCodeAt(i)] = i;

  let j = 0;
  for (let i = 0; i < len; i += 4) {
    const a = lut[clean.charCodeAt(i)];
    const b = lut[clean.charCodeAt(i + 1)];
    const c = clean[i + 2] === '=' ? 0 : lut[clean.charCodeAt(i + 2)];
    const d = clean[i + 3] === '=' ? 0 : lut[clean.charCodeAt(i + 3)];
    const triplet = (a << 18) | (b << 12) | (c << 6) | d;
    if (j < outLen) out[j++] = (triplet >> 16) & 0xff;
    if (j < outLen) out[j++] = (triplet >> 8) & 0xff;
    if (j < outLen) out[j++] = triplet & 0xff;
  }
  return out;
}

async function gunzipBytes(gz) {
  if (gz[0] !== 0x1f || gz[1] !== 0x8b || gz[2] !== 8) {
    throw new Error('Invalid gzip header');
  }
  const flg = gz[3];
  let pos = 10;
  if (flg & 4) {
    const xlen = gz[pos] | (gz[pos + 1] << 8);
    pos += 2 + xlen;
  }
  if (flg & 8) { while (gz[pos++] !== 0) {} }
  if (flg & 16) { while (gz[pos++] !== 0) {} }
  if (flg & 2) { pos += 2; }

  const isize =
    (gz[gz.length - 4] | (gz[gz.length - 3] << 8) | (gz[gz.length - 2] << 16) | (gz[gz.length - 1] << 24)) >>> 0;
  const out = new Uint8Array(isize || gz.length * 4);
  let outPos = 0;

  let bitBuf = 0;
  let bitCnt = 0;
  function needBits(n) {
    while (bitCnt < n) {
      bitBuf |= gz[pos++] << bitCnt;
      bitCnt += 8;
    }
  }
  function readBits(n) {
    needBits(n);
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return val;
  }
  function alignByte() {
    bitBuf = 0;
    bitCnt = 0;
  }
  function buildHuff(lengths) {
    const maxLen = Math.max(...lengths, 0);
    const blCount = new Int32Array(maxLen + 1);
    for (let i = 0; i < lengths.length; i += 1) if (lengths[i] > 0) blCount[lengths[i]] += 1;
    const nextCode = new Int32Array(maxLen + 1);
    let code = 0;
    for (let bits = 1; bits <= maxLen; bits += 1) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }
    const table = new Map();
    for (let sym = 0; sym < lengths.length; sym += 1) {
      const len = lengths[sym];
      if (len > 0) table.set((nextCode[len]++ << 5) | len, sym);
    }
    return { table, maxLen };
  }
  function decodeSym(huff) {
    let code = 0;
    for (let len = 1; len <= huff.maxLen; len += 1) {
      code = (code << 1) | readBits(1);
      const sym = huff.table.get((code << 5) | len);
      if (sym !== undefined) return sym;
    }
    throw new Error('Invalid Huffman code');
  }

  const LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  const CL_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  const fixedLit = (() => {
    const l = new Array(288);
    for (let i = 0; i <= 143; i += 1) l[i] = 8;
    for (let i = 144; i <= 255; i += 1) l[i] = 9;
    for (let i = 256; i <= 279; i += 1) l[i] = 7;
    for (let i = 280; i <= 287; i += 1) l[i] = 8;
    return buildHuff(l);
  })();
  const fixedDist = buildHuff(new Array(32).fill(5));

  let bfinal = 0;
  do {
    bfinal = readBits(1);
    const btype = readBits(2);
    if (btype === 0) {
      alignByte();
      const len = gz[pos] | (gz[pos + 1] << 8);
      pos += 4;
      out.set(gz.subarray(pos, pos + len), outPos);
      outPos += len;
      pos += len;
    } else {
      let litHuff = fixedLit;
      let distHuff = fixedDist;
      if (btype === 2) {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const clLens = new Array(19).fill(0);
        for (let i = 0; i < hclen; i += 1) clLens[CL_ORDER[i]] = readBits(3);
        const clHuff = buildHuff(clLens);
        const allLens = [];
        while (allLens.length < hlit + hdist) {
          const sym = decodeSym(clHuff);
          if (sym < 16) allLens.push(sym);
          else if (sym === 16) {
            const rep = readBits(2) + 3;
            const prev = allLens[allLens.length - 1];
            for (let i = 0; i < rep; i += 1) allLens.push(prev);
          } else if (sym === 17) {
            const rep = readBits(3) + 3;
            for (let i = 0; i < rep; i += 1) allLens.push(0);
          } else {
            const rep = readBits(7) + 11;
            for (let i = 0; i < rep; i += 1) allLens.push(0);
          }
        }
        litHuff = buildHuff(allLens.slice(0, hlit));
        distHuff = buildHuff(allLens.slice(hlit));
      }
      while (true) {
        const sym = decodeSym(litHuff);
        if (sym === 256) break;
        if (sym < 256) {
          out[outPos++] = sym;
        } else {
          const li = sym - 257;
          const length = LEN_BASE[li] + readBits(LEN_EXTRA[li]);
          const di = decodeSym(distHuff);
          const dist = DIST_BASE[di] + readBits(DIST_EXTRA[di]);
          for (let i = 0; i < length; i += 1) {
            out[outPos] = out[outPos - dist];
            outPos += 1;
          }
        }
      }
    }
  } while (!bfinal);
  return out.subarray(0, outPos);
}

function findMetadataOffset(buf) {
  const start = Math.max(0, buf.length - 128 * 1024);
  for (let i = buf.length - METADATA_MARKER.length; i >= start; i -= 1) {
    let match = true;
    for (let j = 0; j < METADATA_MARKER.length; j += 1) {
      if (buf[i + j] !== METADATA_MARKER[j]) {
        match = false;
        break;
      }
    }
    if (match) return i + METADATA_MARKER.length;
  }
  throw new Error('MMDB metadata marker not found');
}

function createMmdbReader(buf) {
  const metaStart = findMetadataOffset(buf);

  function decodeValue(offset, baseOffset) {
    let pos = offset;
    const ctrl = buf[pos++];
    let type = ctrl >> 5;
    if (type === 1) {
      // Pointer
      const ptrSize = ((ctrl >> 3) & 0x03) + 1;
      const valBits = ctrl & 0x07;
      let ptr = 0;
      if (ptrSize === 1) {
        ptr = (valBits << 8) | buf[pos++];
      } else if (ptrSize === 2) {
        ptr = ((valBits << 16) | (buf[pos++] << 8) | buf[pos++]) + 2048;
      } else if (ptrSize === 3) {
        ptr = ((valBits << 24) | (buf[pos++] << 16) | (buf[pos++] << 8) | buf[pos++]) + 526336;
      } else {
        ptr =
          ((buf[pos++] << 24) | (buf[pos++] << 16) | (buf[pos++] << 8) | buf[pos++]) >>> 0;
      }
      const target = decodeValue(baseOffset + ptr, baseOffset);
      return { value: target.value, next: pos };
    }

    if (type === 0) {
      type = 7 + buf[pos++];
    }

    let size = ctrl & 0x1f;
    if (size === 29) {
      size = 29 + buf[pos++];
    } else if (size === 30) {
      size = 285 + ((buf[pos++] << 8) | buf[pos++]);
    } else if (size === 31) {
      size = 65821 + ((buf[pos++] << 16) | (buf[pos++] << 8) | buf[pos++]);
    }

    if (type === 2) {
      const str = utf8Decoder.decode(buf.subarray(pos, pos + size));
      return { value: str, next: pos + size };
    }
    if (type === 4) {
      return { value: buf.subarray(pos, pos + size), next: pos + size };
    }
    if (type === 5 || type === 6) {
      let num = 0;
      for (let i = 0; i < size; i += 1) {
        num = num * 256 + buf[pos++];
      }
      return { value: num, next: pos };
    }
    if (type === 7) {
      const obj = {};
      for (let i = 0; i < size; i += 1) {
        const k = decodeValue(pos, baseOffset);
        pos = k.next;
        const v = decodeValue(pos, baseOffset);
        pos = v.next;
        obj[k.value] = v.value;
      }
      return { value: obj, next: pos };
    }
    if (type === 11) {
      const arr = [];
      for (let i = 0; i < size; i += 1) {
        const item = decodeValue(pos, baseOffset);
        pos = item.next;
        arr.push(item.value);
      }
      return { value: arr, next: pos };
    }
    if (type === 14) {
      return { value: Boolean(size), next: pos };
    }
    if (type === 8) {
      // int32
      let val = 0;
      for (let i = 0; i < size; i += 1) val = (val << 8) | buf[pos++];
      return { value: val | 0, next: pos };
    }
    // Skip other numeric/float/uint64/uint128 types cleanly
    return { value: null, next: pos + size };
  }

  const meta = decodeValue(metaStart, metaStart).value;
  const nodeCount = meta.node_count;
  const recordSize = meta.record_size;
  const ipVersion = meta.ip_version;
  const nodeByteSize = (recordSize * 2) / 8;
  const treeSize = nodeCount * nodeByteSize;
  const dataStart = treeSize + 16;

  function readRecord(nodeIdx, bit) {
    const offset = nodeIdx * nodeByteSize;
    if (recordSize === 24) {
      const i = offset + (bit === 0 ? 0 : 3);
      return (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
    }
    if (recordSize === 28) {
      const mid = buf[offset + 3];
      if (bit === 0) {
        return ((mid >> 4) << 24) | (buf[offset] << 16) | (buf[offset + 1] << 8) | buf[offset + 2];
      }
      return ((mid & 0x0f) << 24) | (buf[offset + 4] << 16) | (buf[offset + 5] << 8) | buf[offset + 6];
    }
    if (recordSize === 32) {
      const i = offset + (bit === 0 ? 0 : 4);
      return ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0;
    }
    throw new Error(`Unsupported MMDB record_size: ${recordSize}`);
  }

  // Precompute IPv4 start node (96 zero bits in IPv6 tree)
  let ipv4StartNode = 0;
  if (ipVersion === 6) {
    let node = 0;
    for (let i = 0; i < 96; i += 1) {
      node = readRecord(node, 0);
      if (node >= nodeCount) break;
    }
    ipv4StartNode = node;
  }

  function parseIpBytes(ipStr) {
    const clean = String(ipStr || '').trim();
    if (!clean) return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) {
      const parts = clean.split('.').map(Number);
      if (parts.some((n) => n < 0 || n > 255 || Number.isNaN(n))) return null;
      return { version: 4, bytes: new Uint8Array(parts) };
    }
    if (clean.includes(':')) {
      const halves = clean.split('::');
      if (halves.length > 2) return null;
      const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
      const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];
      const missing = 8 - (left.length + right.length);
      if (missing < 0) return null;
      const groups = [
        ...left,
        ...Array(halves.length === 2 ? missing : 0).fill('0'),
        ...right,
      ];
      if (groups.length !== 8) return null;
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 8; i += 1) {
        const val = parseInt(groups[i], 16);
        if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
        bytes[i * 2] = (val >> 8) & 0xff;
        bytes[i * 2 + 1] = val & 0xff;
      }
      return { version: 6, bytes };
    }
    return null;
  }

  function lookupIsoCode(ipStr) {
    const parsed = parseIpBytes(ipStr);
    if (!parsed) return null;
    if (parsed.version === 6 && ipVersion === 4) return null;

    let node = parsed.version === 4 && ipVersion === 6 ? ipv4StartNode : 0;
    if (node === nodeCount) return null;
    if (node > nodeCount) {
      const dataOffset = node - nodeCount - 16;
      const rec = decodeValue(dataStart + dataOffset, dataStart).value;
      return rec?.country?.iso_code || rec?.registered_country?.iso_code || null;
    }

    const bytes = parsed.bytes;
    const totalBits = bytes.length * 8;
    for (let bitIdx = 0; bitIdx < totalBits; bitIdx += 1) {
      const byte = bytes[bitIdx >> 3];
      const bit = (byte >> (7 - (bitIdx & 7))) & 1;
      node = readRecord(node, bit);
      if (node === nodeCount) return null;
      if (node > nodeCount) {
        const dataOffset = node - nodeCount - 16;
        const rec = decodeValue(dataStart + dataOffset, dataStart).value;
        const iso = rec?.country?.iso_code || rec?.registered_country?.iso_code || null;
        return typeof iso === 'string' && /^[A-Z]{2}$/.test(iso) ? iso : null;
      }
    }
    return null;
  }

  return { meta, lookupIsoCode };
}

async function getMmdbReader() {
  if (!cachedReaderPromise) {
    cachedReaderPromise = (async () => {
      const gzBytes = base64ToUint8Array(DBIP_COUNTRY_LITE_B64_GZ);
      const rawBytes = await gunzipBytes(gzBytes);
      return createMmdbReader(rawBytes);
    })();
  }
  return cachedReaderPromise;
}

/**
 * Looks up ISO-3166 alpha-2 country code for an IP address.
 * Checks `ip_geo` SQLite cache first; consults bundled DB-IP Country Lite MMDB only on cache miss.
 */
export async function lookupIpCountry(ip) {
  const cleanIp = typeof ip === 'string' ? ip.trim() : '';
  if (!cleanIp) return null;

  const cached = await db
    .select({ countryCode: ipGeo.countryCode })
    .from(ipGeo)
    .where(eq(ipGeo.ip, cleanIp))
    .get();

  if (cached) {
    return cached.countryCode || null;
  }

  mmdbLookupCounter += 1;
  const reader = await getMmdbReader();
  const iso = reader.lookupIsoCode(cleanIp);
  const now = Math.floor(Date.now() / 1000);

  await db
    .insert(ipGeo)
    .values({
      ip: cleanIp,
      countryCode: iso || '',
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: ipGeo.ip,
      set: {
        countryCode: iso || '',
        updatedAt: now,
      },
    })
    .run();

  return iso || null;
}
