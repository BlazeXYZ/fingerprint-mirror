/* Fingerprint Mirror — draws a fingerprint-style ridge pattern from a hash, so
 * every fingerprint ID gets its own picture. Same hash → same picture. */
(function (FM) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const TAU = Math.PI * 2;

  FM.renderPrint = function (svg, hex) {
    const rnd = mulberry32((parseInt(hex.slice(0, 8), 16) ^ parseInt(hex.slice(8, 16), 16)) >>> 0);
    const cx = 100 + (rnd() - 0.5) * 16;
    const cy = 128 + (rnd() - 0.5) * 22;
    const coreDx = (rnd() - 0.5) * 22;
    const coreDy = (rnd() - 0.5) * 28;
    const tilt = (rnd() - 0.5) * 0.6;
    const harmonics = [2, 3, 5].map(k => ({ k, a: 0.02 + rnd() * 0.06, p: rnd() * TAU }));
    const rings = 24;
    const steps = 120;
    let paths = '';

    for (let i = 0; i < rings; i++) {
      const t = i / (rings - 1);
      const rx = 5 + i * 4.4;
      const ry = rx * 1.28;
      const ox = cx + coreDx * (1 - t);
      const oy = cy + coreDy * (1 - t);
      const gaps = [];
      const gapCount = Math.floor(rnd() * 3);
      for (let g = 0; g < gapCount; g++) {
        const start = rnd() * TAU;
        gaps.push([start, 0.12 + rnd() * 0.35]);
      }
      const inGap = th => gaps.some(([s, len]) => (((th - s) % TAU) + TAU) % TAU < len);

      let d = '';
      let pen = false;
      for (let j = 0; j <= steps; j++) {
        const th = (j / steps) * TAU;
        if (inGap(th)) { pen = false; continue; }
        let f = 1;
        harmonics.forEach(h => { f += h.a * Math.sin(h.k * th + h.p + i * 0.18) * (0.4 + t); });
        const x0 = Math.cos(th) * rx * f;
        const y0 = Math.sin(th) * ry * f;
        const x = ox + x0 * Math.cos(tilt) - y0 * Math.sin(tilt);
        const y = oy + x0 * Math.sin(tilt) + y0 * Math.cos(tilt);
        d += (pen ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        pen = true;
      }
      paths += `<path d="${d}" pathLength="1" style="--i:${i}"/>`;
    }

    svg.innerHTML =
      '<defs><clipPath id="fp-clip"><ellipse cx="100" cy="122" rx="82" ry="106"/></clipPath></defs>' +
      `<g clip-path="url(#fp-clip)" class="ridges">${paths}</g>`;
  };
})(window.FM = window.FM || {});
