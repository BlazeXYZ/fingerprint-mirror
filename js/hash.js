/* Fingerprint Mirror — hashing helpers.
 * cyrb128 is a fast, non-cryptographic 128-bit string hash. It is only used to
 * turn collected signals into short, comparable identifiers — never for security. */
(function (FM) {
  'use strict';

  function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  }

  /** 32-char hex digest of any string. */
  FM.hashHex = function (str) {
    return cyrb128(String(str)).map(n => n.toString(16).padStart(8, '0')).join('');
  };

  /** JSON.stringify with sorted object keys, so equal data always hashes equally. */
  FM.stableStringify = function stableStringify(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort()
      .map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  };
})(window.FM = window.FM || {});
