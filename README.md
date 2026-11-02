# Fingerprint Mirror

**See everything a website can learn about you, without a single cookie.**

Fingerprint Mirror is a zero-dependency web app. It runs the same techniques real tracking scripts use, then shows you the results: every signal your browser leaks, how much each one narrows down who you are, and whether your browser is fighting back. Everything runs locally. There is no server, no analytics and no network request after the page loads.

> Live demo: _add your GitHub Pages / Netlify URL here_
>
> ![Screenshot](docs/screenshot.png) <!-- add a screenshot -->

## Features

- **20 signal collectors** covering user agent and client hints, supported-API probing, hardware, screen geometry, time zone and locale, **canvas**, **WebGL/WebGPU**, **audio** fingerprinting, JS math precision, **font detection** (81 fonts via text measurement), speech-synthesis voices, CSS media preferences, permission states, media-device counts, plugins and ad-blocker detection
- **Stable fingerprint ID**: a 128-bit hash of only the signals that survive restarts and private windows
- **Generative fingerprint art**: the ridge pattern in the hero is drawn from your hash, so every ID gets a unique image
- **Uniqueness estimate**: per-signal entropy in bits, adjusted for how common your values are and corrected for overlap between signals, shown as "1 in N browsers"
- **Randomization detection**: canvas and audio are sampled twice. If the results differ, the browser is adding noise (Brave, Firefox RFP), and those signals stop counting toward uniqueness
- **"Does it follow you?"**: compares against your previous scans (kept in `localStorage`) and lists exactly which signals changed
- **Defense checklist** and guidance (blend in vs. randomize)
- Export the full report as JSON, light/dark themes, responsive down to phone width, respects `prefers-reduced-motion`

## Running it

It's static HTML, CSS and JS with no build step.

```bash
python -m http.server 8080
```

Then open http://localhost:8080. Opening `index.html` directly also works, but some APIs (client hints, media devices, WebGPU) only run in a secure context, so serve it over `localhost` or HTTPS for the full set.

**Deploy:** push to GitHub and enable Pages, or drag the folder into Netlify.

## Project structure

```
index.html          Page layout and copy
css/styles.css      Theme tokens (light/dark), layout, animation
js/hash.js          cyrb128 hash + stable JSON serialization
js/collectors.js    The 20 signal collectors (each isolated, timed out, error-safe)
js/entropy.js       Entropy model → bits → "1 in N"
js/ridges.js        Seeded generative fingerprint drawing (SVG)
js/app.js           Orchestration, history comparison, rendering, export
```

## How the uniqueness estimate works

Commercial fingerprinting services compare each visitor against a database of millions of others. This project deliberately has no backend, so it **estimates** instead:

1. Each signal gets a baseline entropy, taken from published measurements: Eckersley, *How Unique Is Your Web Browser?* (2010); Laperdrix et al., *Beauty and the Beast* / AmIUnique (2016); Gómez-Boix et al., *Hiding in the Crowd* (2018).
2. The baseline is adjusted by the observed value. For example, a 1920×1080 screen or `en-US`-only languages score lower than rare values, and a randomized canvas scores zero.
3. Signals are correlated, so the raw sum is scaled by 0.5.
4. `2^bits` gives the crowd size. Anything above ~5.5 billion (people online) is reported as likely unique.

This is an educational approximation, not a measurement. The 2018 large-scale study found about a third of desktop browsers were unique, and far fewer on mobile.

## Engineering notes

- Each collector runs in parallel and is wrapped in a timeout and `try/catch`, so a blocked API (common in privacy browsers) degrades one card instead of breaking the page.
- Signals are tagged as `stable` or volatile. Window size, battery and network are displayed but excluded from the hash, so the ID stays the same when you resize the window.
- `stableStringify` sorts keys before hashing, so equal data always produces the same ID.
- No permission prompts are triggered. The Permissions API is only *queried*, and `enumerateDevices` is used without requesting access.

## Ideas for extending

- Optional opt-in backend to measure real rarity against other visitors
- Fuzzy matching between scans (similarity score instead of exact ID)
- WebRTC local-IP leak check
- Side-by-side comparison of two exported JSON reports

## License

MIT
