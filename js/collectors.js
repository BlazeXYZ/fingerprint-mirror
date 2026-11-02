/* Fingerprint Mirror — signal collectors.
 *
 * Each collector reads one family of signals that any website can access with
 * plain JavaScript: no permission prompts, no cookies, no network requests.
 *
 * A collector is { id, category, label, stable, explain, run } where run()
 * resolves to:
 *   rows   – [label, value] pairs shown on the card
 *   raw    – the data that feeds the fingerprint hash (null = unavailable)
 *   extra  – optional visual: { type: 'image' | 'chips', ... }
 *   flags  – optional facts used by the entropy model and protection checks
 * `stable` signals survive restarts and private windows, so they go into the
 * fingerprint. Volatile ones are shown but excluded from the hash. */
(function (FM) {
  'use strict';

  const withTimeout = (promise, ms, fallback) =>
    Promise.race([promise, new Promise(res => setTimeout(() => res(fallback), ms))]);
  FM.withTimeout = withTimeout;

  const yesNo = v => (v ? 'Yes' : 'No');
  const orNA = v => (v === undefined || v === null || v === '' ? 'Not exposed' : String(v));

  /* ---------- Browser & OS ---------- */

  function parseUA(ua) {
    const m = (re) => (ua.match(re) || [])[1];
    let browser = 'Unknown';
    if (/Edg\//.test(ua)) browser = 'Edge ' + m(/Edg\/([\d.]+)/);
    else if (/OPR\//.test(ua)) browser = 'Opera ' + m(/OPR\/([\d.]+)/);
    else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet ' + m(/SamsungBrowser\/([\d.]+)/);
    else if (/Firefox\//.test(ua)) browser = 'Firefox ' + m(/Firefox\/([\d.]+)/);
    else if (/Chrome\//.test(ua)) browser = 'Chrome ' + m(/Chrome\/([\d.]+)/);
    else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari ' + m(/Version\/([\d.]+)/);

    let os = 'Unknown';
    if (/Windows NT 10/.test(ua)) os = 'Windows 10 or 11';
    else if (/Windows NT/.test(ua)) os = 'Windows ' + m(/Windows NT ([\d.]+)/);
    else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS ' + (m(/OS ([\d_]+)/) || '').replace(/_/g, '.');
    else if (/Mac OS X/.test(ua)) os = 'macOS ' + (m(/Mac OS X ([\d_.]+)/) || '').replace(/_/g, '.');
    else if (/Android/.test(ua)) os = 'Android ' + (m(/Android ([\d.]+)/) || '');
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    return { browser, os: os.trim() };
  }

  const userAgent = {
    id: 'userAgent', category: 'browser', label: 'User agent', stable: true,
    explain: 'Sent with every request. Pins down your browser, its exact version and your operating system, which narrows you to a small slice of visitors on its own.',
    async run() {
      const ua = navigator.userAgent;
      const { browser, os } = parseUA(ua);
      return {
        rows: [['Browser', browser], ['Operating system', os], ['Full string', ua]],
        raw: ua,
        flags: { browser, os, isFirefox: /Firefox\//.test(ua), isSafari: /Safari\//.test(ua) && !/Chrome|Chromium|Edg/.test(ua) }
      };
    }
  };

  const clientHints = {
    id: 'clientHints', category: 'browser', label: 'Client hints', stable: true,
    explain: 'Chromium browsers replaced parts of the user agent with “client hints”. The high-entropy ones (OS build, CPU architecture, device model) are handed to any script that asks; no prompt is shown.',
    async run() {
      const d = navigator.userAgentData;
      if (!d) return { rows: [['Status', 'Not supported (typical for Firefox and Safari)']], raw: null };
      let hi = {};
      if (d.getHighEntropyValues) {
        hi = await withTimeout(
          d.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'model', 'fullVersionList', 'wow64']).catch(() => ({})),
          1500, {});
      }
      const brands = (hi.fullVersionList || d.brands || [])
        .filter(b => !/Not.?A.?Brand/i.test(b.brand))
        .map(b => `${b.brand} ${b.version}`).join(', ');
      return {
        rows: [
          ['Brands', orNA(brands)],
          ['Platform', `${orNA(d.platform)} ${hi.platformVersion || ''}`.trim()],
          ['Architecture', [hi.architecture, hi.bitness && hi.bitness + '-bit'].filter(Boolean).join(' ') || 'Not exposed'],
          ['Device model', orNA(hi.model)],
          ['Mobile', yesNo(d.mobile)]
        ],
        raw: { brands, platform: d.platform, platformVersion: hi.platformVersion, architecture: hi.architecture, bitness: hi.bitness, model: hi.model, mobile: d.mobile }
      };
    }
  };

  const FEATURES = {
    'Web Bluetooth': () => 'bluetooth' in navigator,
    'WebUSB': () => 'usb' in navigator,
    'Web Serial': () => 'serial' in navigator,
    'WebHID': () => 'hid' in navigator,
    'WebXR': () => 'xr' in navigator,
    'WebGPU': () => 'gpu' in navigator,
    'Web Share': () => 'share' in navigator,
    'Contact Picker': () => 'contacts' in navigator,
    'Barcode Detector': () => 'BarcodeDetector' in window,
    'EyeDropper': () => 'EyeDropper' in window,
    'File System Access': () => 'showOpenFilePicker' in window,
    'Local Font Access': () => 'queryLocalFonts' in window,
    'Window Management': () => 'getScreenDetails' in window,
    'Idle Detection': () => 'IdleDetector' in window,
    'Web Locks': () => 'locks' in navigator,
    'WebCodecs': () => 'VideoEncoder' in window,
    'WebTransport': () => 'WebTransport' in window,
    'Navigation API': () => 'navigation' in window,
    'View Transitions': () => 'startViewTransition' in document,
    'Popover': () => Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'popover'),
    'Speculation Rules': () => !!(HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')),
    'SharedArrayBuffer': () => typeof SharedArrayBuffer !== 'undefined',
    'CSS :has()': () => CSS.supports('selector(:has(a))'),
    'Container queries': () => CSS.supports('container-type: inline-size'),
    'Anchor positioning': () => CSS.supports('anchor-name: --a'),
    'Scroll-driven animation': () => CSS.supports('animation-timeline: scroll()'),
    'Gamepad': () => 'getGamepads' in navigator,
    'Vibration': () => 'vibrate' in navigator,
    'Battery Status': () => 'getBattery' in navigator,
    'Network Information': () => 'connection' in navigator
  };

  const features = {
    id: 'features', category: 'browser', label: 'Supported web APIs', stable: true,
    explain: 'Which features exist is a reliable way to tell browser engines and versions apart, even when the user agent is faked. Spoofing the user agent while the feature set disagrees makes you more unique, not less.',
    async run() {
      const items = Object.entries(FEATURES).map(([name, test]) => {
        let on = false;
        try { on = !!test(); } catch (e) { on = false; }
        return { name, on };
      });
      const count = items.filter(i => i.on).length;
      return {
        rows: [['Supported', `${count} of ${items.length} probed APIs`]],
        raw: items.map(i => (i.on ? '1' : '0')).join(''),
        extra: { type: 'chips', items: items.map(i => ({ text: i.name, on: i.on })) }
      };
    }
  };

  /* ---------- Hardware & display ---------- */

  const hardware = {
    id: 'hardware', category: 'hardware', label: 'Hardware', stable: true,
    explain: 'CPU core count, approximate RAM and touch support. Each is common on its own, but they multiply with every other signal.',
    async run() {
      const r = {
        cores: navigator.hardwareConcurrency,
        memory: navigator.deviceMemory,
        touchPoints: navigator.maxTouchPoints,
        platform: navigator.platform
      };
      return {
        rows: [
          ['CPU threads', orNA(r.cores)],
          ['Device memory', r.memory ? `≈ ${r.memory} GB (rounded, capped at 8)` : 'Not exposed'],
          ['Touch points', orNA(r.touchPoints)],
          ['navigator.platform', orNA(r.platform)]
        ],
        raw: r,
        flags: r
      };
    }
  };

  const display = {
    id: 'display', category: 'hardware', label: 'Screen', stable: true,
    explain: 'Resolution, pixel density and color depth reveal your monitor or phone model. The gap between the full and the available size even reveals how tall your taskbar or dock is.',
    async run() {
      const s = screen;
      const dpr = window.devicePixelRatio;
      const orientation = (s.orientation && s.orientation.type) || 'Unknown';
      const taskbar = s.height - s.availHeight;
      return {
        rows: [
          ['Resolution', `${s.width} × ${s.height}`],
          ['Available area', `${s.availWidth} × ${s.availHeight} (${taskbar}px reserved by OS)`],
          ['Pixel ratio', String(dpr)],
          ['Color depth', `${s.colorDepth}-bit`],
          ['Orientation', orientation],
          ['Multiple monitors', 'isExtended' in s ? yesNo(s.isExtended) : 'Not exposed']
        ],
        // Browser zoom changes CSS pixels and the pixel ratio together, so hash physical
        // pixels (rounded to absorb fractional ratios); zooming then doesn't change the ID.
        raw: [s.width, s.height, s.availWidth, s.availHeight].map(v => Math.round((v * dpr) / 8) * 8)
          .concat([s.colorDepth, s.isExtended]),
        flags: { width: s.width, height: s.height, dpr, colorDepth: s.colorDepth }
      };
    }
  };

  const windowSize = {
    id: 'window', category: 'live', label: 'Window & position', stable: false,
    explain: 'Changes whenever you resize, so it is left out of the fingerprint. It still links tabs opened in the same session, and the window position can reveal a second monitor.',
    async run() {
      return {
        rows: [
          ['Viewport', `${window.innerWidth} × ${window.innerHeight}`],
          ['Window', `${window.outerWidth} × ${window.outerHeight}`],
          ['Position on screen', `x ${window.screenX}, y ${window.screenY}`]
        ],
        raw: null
      };
    }
  };

  /* ---------- Locale & time ---------- */

  const locale = {
    id: 'locale', category: 'locale', label: 'Time zone & language', stable: true,
    explain: 'Your time zone narrows your location to a region, and your language list (in order) is surprisingly personal. Number and date formatting can show OS regional settings that differ from your language.',
    async run() {
      const ro = Intl.DateTimeFormat().resolvedOptions();
      const tz = ro.timeZone;
      const offset = -new Date().getTimezoneOffset();
      const sign = offset >= 0 ? '+' : '−';
      const off = `UTC${sign}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
      const langs = Array.from(navigator.languages || [navigator.language]);
      const num = new Intl.NumberFormat().format(1234567.891);
      const date = new Date(Date.UTC(2026, 10, 2, 15, 4)).toLocaleString(undefined, { timeZone: 'UTC' });
      const hc = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
      return {
        rows: [
          ['Time zone', `${tz} (${off})`],
          ['Languages', langs.join(', ')],
          ['Locale', ro.locale],
          ['Number format', num],
          ['Date format', date],
          ['Calendar / clock', `${ro.calendar}, ${hc || 'n/a'}`]
        ],
        raw: { tz, langs, locale: ro.locale, num, date, calendar: ro.calendar, hc },
        flags: { tz, langs }
      };
    }
  };

  /* ---------- Rendering ---------- */

  function drawCanvas() {
    const c = document.createElement('canvas');
    c.width = 280; c.height = 70;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f60';
    ctx.fillRect(118, 4, 62, 20);
    ctx.fillStyle = '#069';
    ctx.font = '15px "Times New Roman", serif';
    ctx.fillText('Cwm fjordbank gly 😃 ☃', 4, 22);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.fillText('Fingerprint Mirror ∑ ✓', 6, 52);
    ctx.globalCompositeOperation = 'multiply';
    [['#f2f', 205, 30], ['#2ff', 240, 30], ['#ff2', 222, 48]].forEach(([col, x, y]) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.fill();
    });
    return c.toDataURL();
  }

  const canvas = {
    id: 'canvas', category: 'rendering', label: 'Canvas fingerprint', stable: true,
    explain: 'The page silently draws this image and hashes the pixels. Tiny differences in your GPU, driver, font rendering and anti-aliasing give a result that is consistent for you and different for others. We draw it twice: if the two differ, your browser is adding random noise to defeat this.',
    async run() {
      const a = drawCanvas();
      if (!a) return { rows: [['Status', 'Canvas unavailable']], raw: null };
      const b = drawCanvas();
      const noisy = a !== b;
      const hash = FM.hashHex(a);
      return {
        rows: [
          ['Pixel hash', hash.slice(0, 16)],
          ['Randomization', noisy ? 'Detected: your browser adds noise' : 'None detected: identical on every draw']
        ],
        raw: noisy ? 'randomized' : hash,
        extra: { type: 'image', src: a, alt: 'The hidden test image drawn by this page' },
        flags: { noisy }
      };
    }
  };

  const webgl = {
    id: 'webgl', category: 'rendering', label: 'Graphics card (WebGL / WebGPU)', stable: true,
    explain: 'WebGL will name your exact graphics card and driver for any page that asks. Its limits and supported extensions add more detail. Few signals carry as much information.',
    async run() {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      const rows = [];
      let raw = null, renderer = '', masked = false;
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
        renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        const params = [
          gl.MAX_TEXTURE_SIZE, gl.MAX_RENDERBUFFER_SIZE, gl.MAX_VIEWPORT_DIMS, gl.MAX_VERTEX_ATTRIBS,
          gl.MAX_VERTEX_UNIFORM_VECTORS, gl.MAX_FRAGMENT_UNIFORM_VECTORS, gl.MAX_VARYING_VECTORS,
          gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS, gl.ALIASED_LINE_WIDTH_RANGE, gl.ALIASED_POINT_SIZE_RANGE
        ].map(p => {
          const v = gl.getParameter(p);
          return v && typeof v === 'object' && 'length' in v ? Array.from(v).join('x') : v;
        });
        const exts = gl.getSupportedExtensions() || [];
        masked = !dbg || /^(WebKit WebGL|Mozilla|Generic)/i.test(renderer);
        rows.push(
          ['Vendor', String(vendor)],
          ['Renderer', renderer],
          ['Version', String(gl.getParameter(gl.VERSION))],
          ['Max texture size', String(params[0])],
          ['Extensions', `${exts.length} supported`]
        );
        raw = { vendor, renderer, params, exts };
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } else {
        rows.push(['WebGL', 'Unavailable or blocked']);
      }
      if (navigator.gpu) {
        const adapter = await withTimeout(navigator.gpu.requestAdapter().catch(() => null), 1500, null);
        let info = adapter && adapter.info;
        if (!info && adapter && adapter.requestAdapterInfo) {
          info = await withTimeout(adapter.requestAdapterInfo().catch(() => null), 1000, null);
        }
        if (info) {
          rows.push(['WebGPU adapter', [info.vendor, info.architecture].filter(Boolean).join(' / ') || 'Hidden']);
          if (raw) raw.gpu = [info.vendor, info.architecture];
        }
      }
      return { rows, raw, flags: { renderer, masked } };
    }
  };

  async function audioSample() {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx(1, 5000, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -50;
    comp.knee.value = 40;
    comp.ratio.value = 12;
    comp.attack.value = 0;
    comp.release.value = 0.25;
    osc.connect(comp);
    comp.connect(ctx.destination);
    osc.start(0);
    const buf = await new Promise((res, rej) => {
      const p = ctx.startRendering();
      if (p && p.then) p.then(res, rej);
      else ctx.oncomplete = e => res(e.renderedBuffer);
    });
    const data = buf.getChannelData(0);
    let sum = 0;
    for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]);
    return sum;
  }

  const audio = {
    id: 'audio', category: 'rendering', label: 'Audio fingerprint', stable: true,
    explain: 'A tone is generated and compressed in memory (nothing plays). The exact floating-point result depends on your OS, browser and CPU audio stack. Run twice to check for randomization.',
    async run() {
      const a = await withTimeout(audioSample(), 2500, null);
      if (a === null) return { rows: [['Status', 'Audio processing unavailable or timed out']], raw: null };
      const b = await withTimeout(audioSample(), 2500, null);
      const noisy = b !== null && a !== b;
      return {
        rows: [
          ['Signal sum', String(a)],
          ['Randomization', noisy ? 'Detected: values change between runs' : 'None detected']
        ],
        raw: noisy ? 'randomized' : String(a),
        flags: { noisy }
      };
    }
  };

  const MATH_TESTS = {
    'acos(0.123)': () => Math.acos(0.123),
    'tan(-1e300)': () => Math.tan(-1e300),
    'sinh(1)': () => Math.sinh(1),
    'expm1(1)': () => Math.expm1(1),
    'cbrt(100)': () => Math.cbrt(100),
    'log1p(10)': () => Math.log1p(10),
    'atanh(0.5)': () => Math.atanh(0.5),
    'pow(π, -100)': () => Math.pow(Math.PI, -100)
  };

  const math = {
    id: 'math', category: 'rendering', label: 'Math engine', stable: true,
    explain: 'Trigonometry functions round differently in the last digit depending on the JavaScript engine and CPU. That small difference helps tell platforms apart.',
    async run() {
      const vals = Object.entries(MATH_TESTS).map(([k, f]) => [k, String(f())]);
      return {
        rows: vals.slice(0, 3).concat([['Signature', FM.hashHex(vals.map(v => v[1]).join(',')).slice(0, 16)]]),
        raw: vals.map(v => v[1])
      };
    }
  };

  /* ---------- Fonts & voices ---------- */

  const FONT_LIST = [
    // Windows
    'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Calibri Light', 'Cambria', 'Candara', 'Cascadia Code',
    'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium',
    'Gabriola', 'Gadugi', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic',
    'Microsoft Sans Serif', 'MS Gothic', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI',
    'Sitka Text', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Yu Gothic',
    // macOS / iOS
    'American Typewriter', 'Andale Mono', 'Avenir', 'Avenir Next', 'Baskerville', 'Big Caslon', 'Chalkboard',
    'Didot', 'Futura', 'Geneva', 'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Hoefler Text', 'Lucida Grande',
    'Marker Felt', 'Menlo', 'Monaco', 'Optima', 'Papyrus', 'Skia', 'Zapfino',
    // Linux
    'Cantarell', 'DejaVu Sans', 'DejaVu Serif', 'Droid Sans', 'Liberation Mono', 'Liberation Sans',
    'Noto Sans', 'Noto Serif', 'Ubuntu', 'Ubuntu Mono',
    // Installed by apps (Office, Adobe, developers)
    'Fira Code', 'Fira Sans', 'Inter', 'JetBrains Mono', 'Minion Pro', 'Myriad Pro', 'Open Sans', 'Roboto',
    'Source Code Pro', 'Source Sans Pro', 'Garamond', 'Century Gothic', 'Bookman Old Style', 'Rockwell'
  ];

  const fonts = {
    id: 'fonts', category: 'fonts', label: 'Installed fonts', stable: true,
    explain: 'Text is measured in each font name, falling back to a generic font. If the width changes, the font is installed. Fonts come with your OS, language packs and apps like Office or Adobe, so the list says a lot about you and what you use.',
    async run() {
      const ctx = document.createElement('canvas').getContext('2d');
      const text = 'mmmmmmmmmmlli WwQq@#0O';
      const bases = ['monospace', 'sans-serif', 'serif'];
      const base = {};
      bases.forEach(b => { ctx.font = `72px ${b}`; base[b] = ctx.measureText(text).width; });
      const found = FONT_LIST.filter(f => bases.some(b => {
        ctx.font = `72px "${f}", ${b}`;
        return ctx.measureText(text).width !== base[b];
      }));
      return {
        rows: [['Detected', `${found.length} of ${FONT_LIST.length} probed fonts`]],
        raw: found,
        extra: { type: 'chips', items: FONT_LIST.map(f => ({ text: f, on: found.includes(f) })), onlyOn: true },
        flags: { count: found.length }
      };
    }
  };

  function getVoices() {
    return new Promise(res => {
      const s = window.speechSynthesis;
      if (!s) return res(null);
      const v = s.getVoices();
      if (v.length) return res(v);
      const t = setTimeout(() => res(s.getVoices()), 1200);
      s.addEventListener('voiceschanged', () => { clearTimeout(t); res(s.getVoices()); }, { once: true });
    });
  }

  const voices = {
    id: 'voices', category: 'fonts', label: 'Text-to-speech voices', stable: true,
    explain: 'The list of speech voices shows your OS, its version and which language packs you installed. Few users have the same set.',
    async run() {
      const list = await getVoices();
      if (!list) return { rows: [['Status', 'Speech synthesis unavailable']], raw: null };
      const langs = new Set(list.map(v => v.lang));
      const def = list.find(v => v.default);
      return {
        rows: [
          ['Voices', String(list.length)],
          ['Languages covered', String(langs.size)],
          ['Default voice', def ? `${def.name} (${def.lang})` : 'None']
        ],
        raw: list.map(v => `${v.name}|${v.lang}|${v.localService ? 1 : 0}`),
        extra: { type: 'chips', items: list.slice(0, 24).map(v => ({ text: v.name.replace(/^Microsoft |^Google /, ''), on: true })), more: Math.max(0, list.length - 24) },
        flags: { count: list.length }
      };
    }
  };

  /* ---------- Preferences ---------- */

  const MEDIA = {
    'Color scheme': ['prefers-color-scheme', ['dark', 'light']],
    'Reduced motion': ['prefers-reduced-motion', ['reduce', 'no-preference']],
    'Reduced transparency': ['prefers-reduced-transparency', ['reduce', 'no-preference']],
    'Contrast': ['prefers-contrast', ['more', 'less', 'custom', 'no-preference']],
    'Forced colors': ['forced-colors', ['active', 'none']],
    'Inverted colors': ['inverted-colors', ['inverted', 'none']],
    'Pointer': ['pointer', ['fine', 'coarse', 'none']],
    'Hover': ['hover', ['hover', 'none']],
    'Color gamut': ['color-gamut', ['rec2020', 'p3', 'srgb']],
    'Dynamic range': ['dynamic-range', ['high', 'standard']]
  };

  const prefs = {
    id: 'prefs', category: 'prefs', label: 'Accessibility & display settings', stable: true,
    explain: 'CSS media queries reveal OS settings such as dark mode, reduced motion or high contrast. They also reveal hardware such as an HDR screen or a touch-only device. Accessibility settings in particular are rare, so they stand out.',
    async run() {
      const rows = Object.entries(MEDIA).map(([label, [feature, values]]) => {
        const hit = values.find(v => matchMedia(`(${feature}: ${v})`).matches);
        return [label, hit || 'Not supported'];
      });
      return { rows, raw: rows.map(r => r[1]), flags: { rare: rows.filter(([l, v]) => ['Reduced motion', 'Contrast', 'Forced colors', 'Inverted colors'].includes(l) && !['no-preference', 'none', 'Not supported'].includes(v)).length } };
    }
  };

  /* ---------- Privacy & permissions ---------- */

  const privacy = {
    id: 'privacy', category: 'privacy', label: 'Privacy settings', stable: true,
    explain: 'Ironically, the privacy signals themselves are rare. Few people turn on Do Not Track or Global Privacy Control, so having them on adds to your uniqueness. An ad blocker is detected by planting bait elements it likes to hide.',
    async run() {
      const bait = document.createElement('div');
      bait.className = 'adsbox ad-banner ad-placement pub_300x250 textads banner-ads sponsored-ad';
      bait.setAttribute('aria-hidden', 'true');
      bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;';
      bait.innerHTML = '&nbsp;';
      document.body.appendChild(bait);
      await new Promise(r => setTimeout(r, 150));
      const adblock = !bait.isConnected || bait.offsetHeight === 0 || getComputedStyle(bait).display === 'none';
      bait.remove();

      const dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1';
      const gpc = navigator.globalPrivacyControl === true;
      let idb = false;
      try { idb = !!window.indexedDB; } catch (e) { idb = false; }
      let ls = false;
      try { localStorage.setItem('__fm', '1'); localStorage.removeItem('__fm'); ls = true; } catch (e) { ls = false; }
      const brave = !!(navigator.brave && navigator.brave.isBrave);
      return {
        rows: [
          ['Ad / tracker blocker', adblock ? 'Detected' : 'Not detected'],
          ['Do Not Track', dnt ? 'On' : 'Off'],
          ['Global Privacy Control', gpc ? 'On' : 'Off'],
          ['Cookies enabled', yesNo(navigator.cookieEnabled)],
          ['localStorage / IndexedDB', `${ls ? 'Yes' : 'No'} / ${idb ? 'Yes' : 'No'}`],
          ['Built-in PDF viewer', yesNo(navigator.pdfViewerEnabled)],
          ['Automated browser', navigator.webdriver ? 'Yes (webdriver flag set)' : 'No']
        ],
        raw: { adblock, dnt, gpc, cookies: navigator.cookieEnabled, ls, idb, pdf: navigator.pdfViewerEnabled, webdriver: !!navigator.webdriver },
        flags: { adblock, dnt, gpc, brave, webdriver: !!navigator.webdriver }
      };
    }
  };

  const PERMS = ['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read', 'persistent-storage', 'midi', 'background-sync'];

  const permissions = {
    id: 'permissions', category: 'privacy', label: 'Permission states', stable: true,
    explain: 'Sites can check whether you have already granted or blocked camera, location or notifications, without asking you anything. Your past choices become part of your profile.',
    async run() {
      if (!navigator.permissions || !navigator.permissions.query) {
        return { rows: [['Status', 'Permissions API unavailable']], raw: null };
      }
      const rows = await Promise.all(PERMS.map(async name => {
        try {
          const s = await withTimeout(navigator.permissions.query({ name }), 800, null);
          return [name, s ? s.state : 'unknown'];
        } catch (e) {
          return [name, 'unsupported'];
        }
      }));
      return { rows, raw: rows.map(r => r.join('=')) };
    }
  };

  const mediaDevices = {
    id: 'mediaDevices', category: 'privacy', label: 'Cameras & microphones', stable: true,
    explain: 'Without any permission, a page can count your cameras, microphones and speakers. A webcam plus a headset plus a USB mic is a distinctive combination.',
    async run() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return { rows: [['Status', 'Not available (needs a secure context)']], raw: null };
      }
      const list = await withTimeout(navigator.mediaDevices.enumerateDevices().catch(() => []), 1500, []);
      const count = k => list.filter(d => d.kind === k).length;
      const named = list.some(d => d.label);
      const r = { audioinput: count('audioinput'), videoinput: count('videoinput'), audiooutput: count('audiooutput') };
      return {
        rows: [
          ['Microphones', String(r.audioinput)],
          ['Cameras', String(r.videoinput)],
          ['Speakers / outputs', String(r.audiooutput)],
          ['Device names visible', named ? 'Yes (permission was granted before)' : 'No']
        ],
        raw: r
      };
    }
  };

  const plugins = {
    id: 'plugins', category: 'privacy', label: 'Plugins', stable: true,
    explain: 'Plugins used to be the biggest giveaway, back when people had Flash and Java installed. Modern browsers now report the same fixed list of PDF viewers to everyone.',
    async run() {
      const list = Array.from(navigator.plugins || []).map(p => p.name);
      return {
        rows: [['Plugins reported', list.length ? `${list.length}: ${list.slice(0, 3).join(', ')}${list.length > 3 ? '…' : ''}` : 'None']],
        raw: list
      };
    }
  };

  /* ---------- Live (volatile) signals ---------- */

  const network = {
    id: 'network', category: 'live', label: 'Network', stable: false,
    explain: 'Connection type and measured speed change over time, so they are left out of the fingerprint. They are still enough to link two tabs open at the same moment.',
    async run() {
      const c = navigator.connection;
      if (!c) return { rows: [['Status', 'Network Information API unavailable']], raw: null };
      return {
        rows: [
          ['Effective type', orNA(c.effectiveType)],
          ['Round-trip time', c.rtt != null ? `${c.rtt} ms` : 'Not exposed'],
          ['Downlink', c.downlink != null ? `${c.downlink} Mbps` : 'Not exposed'],
          ['Data saver', yesNo(c.saveData)]
        ],
        raw: null
      };
    }
  };

  const battery = {
    id: 'battery', category: 'live', label: 'Battery', stable: false,
    explain: 'Battery level and charging state change minute to minute, but researchers showed in 2015 that they could link visitors across sites for short periods. Firefox removed the API in response.',
    async run() {
      if (!navigator.getBattery) return { rows: [['Status', 'Battery API unavailable']], raw: null };
      const b = await withTimeout(navigator.getBattery().catch(() => null), 1000, null);
      if (!b) return { rows: [['Status', 'Unavailable']], raw: null };
      const t = s => (s === Infinity || s == null ? '—' : `${Math.round(s / 60)} min`);
      return {
        rows: [
          ['Level', `${Math.round(b.level * 100)}%`],
          ['Charging', yesNo(b.charging)],
          [b.charging ? 'Time to full' : 'Time remaining', t(b.charging ? b.chargingTime : b.dischargingTime)]
        ],
        raw: null
      };
    }
  };

  FM.CATEGORIES = [
    { id: 'browser', label: 'Browser & OS' },
    { id: 'hardware', label: 'Hardware & display' },
    { id: 'locale', label: 'Locale & time' },
    { id: 'rendering', label: 'Rendering' },
    { id: 'fonts', label: 'Fonts & voices' },
    { id: 'prefs', label: 'Preferences' },
    { id: 'privacy', label: 'Privacy & permissions' },
    { id: 'live', label: 'Live signals' }
  ];

  FM.collectors = [
    userAgent, clientHints, features,
    hardware, display,
    locale,
    canvas, webgl, audio, math,
    fonts, voices,
    prefs,
    privacy, permissions, mediaDevices, plugins,
    windowSize, network, battery
  ];
})(window.FM = window.FM || {});
