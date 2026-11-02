/* Fingerprint Mirror — uniqueness estimate.
 *
 * Without a server-side database of other visitors we can't measure how rare
 * your exact values are. Instead each signal gets an entropy estimate (in bits)
 * informed by published measurements (Eckersley 2010 / Panopticlick, Laperdrix
 * et al. 2016 / AmIUnique, Gómez-Boix et al. 2018), adjusted for how common the
 * observed value is. Signals overlap heavily (your GPU predicts your OS, your OS
 * predicts your fonts), so the raw sum is scaled down by CORRELATION.
 * One bit halves the crowd you hide in; ~33 bits is enough to single out one
 * person on Earth. */
(function (FM) {
  'use strict';

  const CORRELATION = 0.5;
  const INTERNET_USERS = 5.5e9;

  const COMMON_TZ = ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London',
    'Europe/Berlin', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'America/Sao_Paulo'];
  const COMMON_RES = ['1920x1080', '1536x864', '1366x768', '2560x1440', '1440x900', '1280x720',
    '390x844', '393x873', '414x896', '375x812', '412x915', '1280x800', '1680x1050'];

  const rules = {
    userAgent: () => 10,
    clientHints: (r) => (r.raw ? 3 : 0),
    features: () => 2,
    hardware: (r) => {
      const f = r.flags || {};
      let b = [4, 8].includes(f.cores) ? 1.2 : 2.6;
      b += f.memory === 8 ? 0.6 : f.memory ? 1.4 : 0;
      b += f.touchPoints ? 0.8 : 0.3;
      return b;
    },
    display: (r) => {
      const f = r.flags || {};
      const common = COMMON_RES.includes(`${f.width}x${f.height}`);
      return (common ? 2.8 : 6) + (f.dpr === 1 || f.dpr === 2 ? 0.4 : 1.5) + (f.colorDepth === 24 ? 0.2 : 1.2);
    },
    locale: (r) => {
      const f = r.flags || {};
      const langs = f.langs || [];
      const tzBits = COMMON_TZ.includes(f.tz) ? 2.5 : 5;
      const langBits = langs.length <= 1 && /^en-US$/i.test(langs[0] || '') ? 1.5 : Math.min(7, 3.5 + langs.length);
      return tzBits + langBits;
    },
    canvas: (r) => (r.flags && r.flags.noisy ? 0 : 8.5),
    webgl: (r) => (!r.raw ? 0 : r.flags && r.flags.masked ? 2.5 : 7.5),
    audio: (r) => (!r.raw || (r.flags && r.flags.noisy) ? 0 : 5.4),
    math: () => 1.2,
    fonts: (r) => {
      const n = (r.flags && r.flags.count) || 0;
      return Math.min(13, 2 + n * 0.22);
    },
    voices: (r) => {
      const n = (r.flags && r.flags.count) || 0;
      return n === 0 ? 0.5 : Math.min(6, 2 + Math.log2(n));
    },
    prefs: (r) => 1.6 + ((r.flags && r.flags.rare) || 0) * 2,
    privacy: (r) => {
      const f = r.flags || {};
      return 0.6 + (f.adblock ? 0.8 : 0) + (f.dnt ? 1 : 0) + (f.gpc ? 1.5 : 0);
    },
    permissions: () => 1.2,
    mediaDevices: (r) => (r.raw ? 2 : 0),
    plugins: (r) => (r.raw && r.raw.length ? 0.6 : 0.3)
  };

  /** Mutates results: sets r.bits on each. Returns summary numbers. */
  FM.scoreEntropy = function (results) {
    let rawSum = 0;
    results.forEach(r => {
      const rule = rules[r.id];
      r.bits = r.stable && rule && r.raw != null ? Math.max(0, rule(r)) : 0;
      rawSum += r.bits;
    });
    const bits = rawSum * CORRELATION;
    const crowd = Math.pow(2, bits);
    return { rawSum, bits, crowd, unique: crowd >= INTERNET_USERS, population: INTERNET_USERS };
  };

  FM.formatCrowd = function (n) {
    if (!isFinite(n)) return '∞';
    const units = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
    for (const [v, w] of units) {
      if (n >= v) return `${(n / v).toFixed(n / v >= 100 ? 0 : 1)} ${w}`;
    }
    return String(Math.round(n));
  };
})(window.FM = window.FM || {});
