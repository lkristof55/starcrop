// SHA-1, synchronous and dependency-free, so readmeSkeleton() and analyze() run the same in Node and the browser.
// Not used for security: it only fingerprints README skeletons.
export function sha1Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const blocks = ((len + 8) >>> 6) + 1;
  const w = new Uint32Array(blocks * 16);
  for (let i = 0; i < len; i++) w[i >>> 2] |= bytes[i] << (24 - (i & 3) * 8);
  w[len >>> 2] |= 0x80 << (24 - (len & 3) * 8);
  w[blocks * 16 - 1] = (len * 8) >>> 0;
  w[blocks * 16 - 2] = Math.floor((len * 8) / 0x100000000);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const W = new Uint32Array(80);
  for (let off = 0; off < w.length; off += 16) {
    for (let i = 0; i < 16; i++) W[i] = w[off + i];
    for (let i = 16; i < 80; i++) { const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]; W[i] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, '0')).join('');
}
