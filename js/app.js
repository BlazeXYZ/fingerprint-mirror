/* Fingerprint Mirror — orchestration and rendering. */
(function (FM) {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const HISTORY_KEY = 'fm-history';
  const PLACEHOLDER = '9e3779b97f4a7c15f39cc0605cedc834';

  const state = { results: [], id: null, summary: null, filter: 'all', scanning: false };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: history just won't persist */ }
    }
  };

  /* ---------- Scan ---------- */

  function setProgress(done, total, label) {
    $('#progress-bar').style.width = `${(done / total) * 100}%`;
    $('#progress-text').textContent = done < total ? `Reading ${label}… (${done}/${total})` : `Read ${total} signal groups`;
  }

  async function scan() {
    if (state.scanning) return;
    state.scanning = true;
    document.body.classList.add('is-scanning');
    $('#print').classList.add('scanning');
    $('#fp-id').textContent = 'scanning…';
    ['#btn-copy', '#btn-export', '#btn-rescan'].forEach(s => { $(s).disabled = true; });
    FM.renderPrint($('#print'), PLACEHOLDER);

    const list = FM.collectors;
    let done = 0;
    setProgress(0, list.length, list[0].label);
    const started = performance.now();

    const results = await Promise.all(list.map(async c => {
      const t0 = performance.now();
      let out;
      try {
        out = await FM.withTimeout(c.run(), 5000, { rows: [['Status', 'Timed out']], raw: null });
      } catch (e) {
        out = { rows: [['Status', `Blocked (${e && e.name ? e.name : 'error'})`]], raw: null };
      }
      done++;
      setProgress(done, list.length, c.label);
      return Object.assign({}, c, out, { ms: performance.now() - t0 });
    }));

    // Let the scan animation breathe a little on fast machines.
    const elapsed = performance.now() - started;
    if (elapsed < 900) await new Promise(r => setTimeout(r, 900 - elapsed));

    results.forEach(r => {
      r.hash = r.raw == null ? null : FM.hashHex(FM.stableStringify(r.raw)).slice(0, 8);
    });
    const stable = results.filter(r => r.stable && r.raw != null);
    state.id = FM.hashHex(stable.map(r => `${r.id}:${FM.stableStringify(r.raw)}`).join('|'));
    state.summary = FM.scoreEntropy(results);
    state.results = results;

    const comparison = recordHistory(state.id, results);

    renderHero();
    renderStability(comparison);
    renderProtections();
    renderBars();
    renderFilters();
    renderCards();
    $('#raw-json').textContent = JSON.stringify(exportData(), null, 2);

    document.body.classList.remove('is-scanning');
    $('#print').classList.remove('scanning');
    ['#btn-copy', '#btn-export', '#btn-rescan'].forEach(s => { $(s).disabled = false; });
    state.scanning = false;
  }

  /* ---------- History / stability ---------- */

  function recordHistory(id, results) {
    const parts = {};
    results.forEach(r => { if (r.stable && r.hash) parts[r.id] = r.hash; });
    const history = store.get(HISTORY_KEY, []);
    const previous = Array.isArray(history) && history[0] && history[0].parts ? history[0] : null;
    const entry = { id, at: Date.now(), parts };
    const next = [entry].concat(history).slice(0, 10);
    store.set(HISTORY_KEY, next);
    if (!previous) return { first: true, history: next };
    const changed = Object.keys(Object.assign({}, previous.parts, parts))
      .filter(k => previous.parts[k] !== parts[k]);
    return { first: false, same: previous.id === id, previous, changed, history: next };
  }

  function timeAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.round(h / 24);
    return `${d} days ago`;
  }

  const labelFor = id => (FM.collectors.find(c => c.id === id) || { label: id }).label;

  function renderStability(cmp) {
    const body = $('#stability-body');
    if (cmp.first) {
      body.innerHTML = `
        <p class="status neutral"><span class="dot"></span>First scan in this browser</p>
        <p class="muted">Come back later, restart the browser or clear your cookies. This page will show you whether the fingerprint stayed the same.</p>`;
      return;
    }
    const when = timeAgo(cmp.previous.at);
    const distinct = new Set(cmp.history.map(h => h.id)).size;
    if (cmp.same) {
      body.innerHTML = `
        <p class="status bad"><span class="dot"></span>Recognized: identical to your scan ${esc(when)}</p>
        <p class="muted">${cmp.history.length} scans recorded, ${distinct} distinct ID${distinct === 1 ? '' : 's'}. A tracker would link all of these visits together.</p>`;
    } else {
      body.innerHTML = `
        <p class="status good"><span class="dot"></span>Changed since your scan ${esc(when)}</p>
        <p class="muted">These signals changed: ${cmp.changed.map(k => `<span class="mini-chip">${esc(labelFor(k))}</span>`).join(' ')}</p>
        <p class="muted">A small change rarely breaks tracking: real trackers match fingerprints approximately, not exactly.</p>`;
    }
  }

  /* ---------- Hero ---------- */

  function renderHero() {
    const { bits, crowd, unique } = state.summary;
    $('#fp-id').textContent = state.id.match(/.{1,8}/g).join(' ');
    $('#stat-bits').innerHTML = `${bits.toFixed(1)} <small>bits</small>`;
    $('#stat-crowd').innerHTML = unique
      ? `Likely <em>just you</em>`
      : `1 in ${esc(FM.formatCrowd(crowd))}`;
    $('#stat-crowd').title = unique
      ? `2^${bits.toFixed(1)} ≈ ${FM.formatCrowd(crowd)}, which is more than the ~5.5 billion people online`
      : '';
    const read = state.results.filter(r => r.raw != null || !r.stable).reduce((n, r) => n + r.rows.length, 0);
    $('#stat-signals').textContent = String(read);
    FM.renderPrint($('#print'), state.id);
  }

  /* ---------- Protections ---------- */

  function renderProtections() {
    const get = id => state.results.find(r => r.id === id) || {};
    const f = id => get(id).flags || {};
    const ua = f('userAgent');
    const tz = (f('locale').tz || '');
    const checks = [
      { on: f('canvas').noisy, good: 'Canvas output is randomized', bad: 'Canvas readable and stable' },
      { on: f('audio').noisy, good: 'Audio output is randomized', bad: 'Audio readable and stable' },
      { on: f('webgl').masked, good: 'Graphics card name hidden', bad: 'Graphics card model exposed' },
      { on: f('privacy').adblock, good: 'Content blocker active', bad: 'No content blocker detected' },
      { on: f('privacy').gpc, good: 'Global Privacy Control sent', bad: 'Global Privacy Control off' },
      { on: ua.isFirefox && /^(UTC|Etc\/UTC|Atlantic\/Reykjavik)$/.test(tz), good: 'Firefox fingerprint resistance likely on', hide: !ua.isFirefox },
      { on: f('privacy').brave, good: 'Brave browser (randomizes fingerprints)', hide: !f('privacy').brave },
      { on: false, bad: 'Automated browser detected (webdriver)', hide: !f('privacy').webdriver }
    ].filter(c => !c.hide);
    $('#protections-list').innerHTML = checks.map(c => `
      <li class="${c.on ? 'ok' : 'warn'}">
        <span class="mark" aria-hidden="true">${c.on ? '✓' : '!'}</span>
        <span>${esc(c.on ? c.good : c.bad)}</span>
      </li>`).join('');
  }

  /* ---------- Breakdown ---------- */

  function renderBars() {
    const scored = state.results.filter(r => r.bits > 0).sort((a, b) => b.bits - a.bits);
    const max = scored.length ? scored[0].bits : 1;
    $('#bars').innerHTML = scored.map(r => `
      <div class="bar-row">
        <span class="bar-label">${esc(r.label)}</span>
        <span class="bar-track"><span class="bar-fill" style="--w:${((r.bits / max) * 100).toFixed(1)}%"></span></span>
        <span class="bar-value">${r.bits.toFixed(1)}</span>
      </div>`).join('');
    const { rawSum, bits } = state.summary;
    $('#bars-note').textContent =
      `Raw total: ${rawSum.toFixed(1)} bits. Signals overlap (your GPU predicts your OS, your OS predicts your fonts), so the total is halved to ≈ ${bits.toFixed(1)} bits. About 33 bits is enough to pick one person out of everyone on Earth.`;
  }

  /* ---------- Cards ---------- */

  function renderFilters() {
    const present = new Set(state.results.map(r => r.category));
    const cats = [{ id: 'all', label: 'All' }].concat(FM.CATEGORIES.filter(c => present.has(c.id)));
    $('#filters').innerHTML = cats.map(c => `
      <button type="button" class="filter${state.filter === c.id ? ' active' : ''}" data-cat="${c.id}" aria-pressed="${state.filter === c.id}">${esc(c.label)}</button>`).join('');
  }

  function renderExtra(x) {
    if (!x) return '';
    if (x.type === 'image') {
      return `<figure class="canvas-shot"><img src="${x.src}" alt="${esc(x.alt)}" width="280" height="70"><figcaption>${esc(x.alt)}</figcaption></figure>`;
    }
    if (x.type === 'chips') {
      const items = x.onlyOn ? x.items.filter(i => i.on) : x.items;
      if (!items.length) return '';
      return `<div class="chips">${items.map(i => `<span class="chip${i.on ? ' on' : ''}">${esc(i.text)}</span>`).join('')}${x.more ? `<span class="chip">+${x.more} more</span>` : ''}</div>`;
    }
    return '';
  }

  function renderCards() {
    const order = FM.CATEGORIES.map(c => c.id);
    const items = state.results
      .slice()
      .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
      .filter(r => state.filter === 'all' || r.category === state.filter);
    $('#cards').innerHTML = items.map(r => {
      const pill = !r.stable
        ? '<span class="pill volatile" title="Changes often, so it is left out of the fingerprint">volatile</span>'
        : r.raw == null
          ? '<span class="pill off">unavailable</span>'
          : `<span class="pill bits" title="Estimated bits of identifying information">${r.bits.toFixed(1)} bits</span>`;
      return `
      <article class="card${r.extra && r.extra.type === 'chips' ? ' wide' : ''}" data-cat="${r.category}">
        <header><h3>${esc(r.label)}</h3>${pill}</header>
        <dl class="rows">${r.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        ${renderExtra(r.extra)}
        <p class="explain">${esc(r.explain)}</p>
        <footer><span class="hash">${r.hash ? '#' + r.hash : 'not hashed'}</span><span>${Math.round(r.ms)} ms</span></footer>
      </article>`;
    }).join('');
  }

  /* ---------- Export / copy ---------- */

  function exportData() {
    const components = {};
    state.results.forEach(r => {
      components[r.id] = {
        label: r.label, category: r.category, stable: r.stable,
        bits: Number(r.bits.toFixed(2)), hash: r.hash,
        values: Object.fromEntries(r.rows), raw: r.raw
      };
    });
    return {
      tool: 'Fingerprint Mirror',
      generatedAt: new Date().toISOString(),
      fingerprint: state.id,
      estimatedBits: Number(state.summary.bits.toFixed(2)),
      components
    };
  }

  function flash(btn, text) {
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 1400);
  }

  async function copyId() {
    const btn = $('#btn-copy');
    try {
      await navigator.clipboard.writeText(state.id);
      flash(btn, 'Copied');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = state.id;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      flash(btn, ok ? 'Copied' : 'Copy failed');
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fingerprint-mirror-${state.id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Init ---------- */

  function init() {
    $('#btn-rescan').addEventListener('click', scan);
    $('#btn-copy').addEventListener('click', copyId);
    $('#btn-export').addEventListener('click', exportJson);
    $('#filters').addEventListener('click', e => {
      const btn = e.target.closest('.filter');
      if (!btn) return;
      state.filter = btn.dataset.cat;
      renderFilters();
      renderCards();
    });
    scan();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.FM = window.FM || {});
