let table: Uint32Array | null = null;

function getTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

// ponytail: assumes ASCII customerId (charCodeAt vs backend's UTF-8 Buffer) — switch to
// TextEncoder byte-wise CRC if customer IDs ever contain non-ASCII characters.
/** CRC-32 (IEEE 802.3) — same algorithm as Node's zlib.crc32, used by the backend's shard router. */
export function crc32(input: string): number {
  const t = getTable();
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) {
    crc = (t[(crc ^ input.charCodeAt(i)) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function getShardIndex(customerId: string, shardCount: number): number {
  return crc32(customerId) % shardCount;
}
