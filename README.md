<div align="center">

# Fingerprint Mirror

**See everything a website can learn about your browser without a single cookie, and how unique that makes you.**

![runs in: the browser](https://img.shields.io/badge/runs%20in-the%20browser-blue)
![dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen)
![network calls: none](https://img.shields.io/badge/network%20calls-none-brightgreen)
![license: MIT](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

---

## Table of contents

1. [The problem](#the-problem)
2. [What Fingerprint Mirror does](#what-fingerprint-mirror-does)
3. [Quick start](#quick-start)
4. [Demo: three browsers, three stories](#demo-three-browsers-three-stories)
5. [Signal specification](#signal-specification)
6. [Uniqueness model](#uniqueness-model)
7. [Architecture](#architecture)
8. [Key design decisions](#key-design-decisions)
9. [Security and privacy of the tool itself](#security-and-privacy-of-the-tool-itself)
10. [Testing and CI](#testing-and-ci)
11. [Limitations and roadmap](#limitations-and-roadmap)
12. [References](#references)
13. [Legal and ethical use](#legal-and-ethical-use)

---

## The problem

Most people think tracking means cookies, so they clear cookies, open a private window or turn on a VPN. None of that changes what the browser itself reports: fonts, GPU, screen, time zone, how it draws a canvas. Combined, those details form a **fingerprint** that can recognize the same browser across sites, after cookies are cleared and in a private window. It's invisible, and there's no prompt to refuse.

## What Fingerprint Mirror does

A zero-dependency web page that runs the same techniques real tracking scripts use, then shows you the results:

1. **Every signal your browser leaks**, read by 20 collectors using ordinary JavaScript.
2. **How much each one narrows down who you are**, in bits, and a combined "1 in N browsers" estimate.
3. **Whether your browser is fighting back**: randomized canvas and audio are detected and stop counting.
4. **Whether it follows you**: a stable fingerprint ID compared against your previous scans.

Everything runs locally. There is no server, no analytics and no network request after the page loads.

## Quick start

It's static HTML, CSS and JS with no build step.

```bash
python -m http.server 8080
```

Then open http://localhost:8080. Opening `index.html` directly also works, but some APIs (client hints, media devices, WebGPU) only run in a secure context, so serve it over `localhost` or HTTPS for the full set.

**Deploy:** push to GitHub and enable Pages, or drag the folder into Netlify.

## Demo: three browsers, three stories

### 1. A stock Chrome or Edge → **likely unique**

Installed fonts, the user agent, the canvas and the WebGL renderer each contribute several bits. The total usually passes the ~33 bits needed to single out one person on Earth.

### 2. The same browser in a private window → **same ID**

Cookies and history are gone, but the fingerprint ID on the page is the same. That is the point the page is built to make.

### 3. Brave, or Firefox with `privacy.resistFingerprinting` → **randomized**

Canvas and audio come back different on the second sample, so the page reports them as noise and drops them from the uniqueness estimate.

## Signal specification

| Family | What is read |
| --- | --- |
| Identity | User agent and client hints |
| Capabilities | Supported Web APIs, plugins, ad-blocker detection |
| Hardware | CPU cores, memory, screen geometry, media-device counts |
| Locale | Time zone and languages |
| Rendering | **Canvas 2D**, **WebGL / WebGPU** renderer and parameters |
| Audio | An **audio fingerprint** from an offline audio context |
| Fonts | **81 fonts** detected by text measurement |
| Engine | JS math precision |
| Preferences | CSS media queries (colour scheme, reduced motion, contrast…), permission states, speech-synthesis voices |

Signals are tagged **stable** or **volatile**. Window size, battery and network speed are shown but excluded from the fingerprint ID.

## Uniqueness model

Commercial fingerprinting services compare each visitor against a database of millions of others. This project deliberately has no backend, so it **estimates** instead:

1. Each signal gets a baseline entropy, taken from published measurements (see [References](#references)).
2. The baseline is adjusted by the observed value. A 1920×1080 screen or `en-US`-only languages score lower than rare values, and a randomized canvas scores zero.
3. Signals are correlated (your GPU predicts your OS, your OS predicts your fonts), so the raw sum is scaled by 0.5.
4. `2^bits` gives the crowd size. Anything above ~5.5 billion (people online) is reported as likely unique.

This is an educational approximation, not a measurement. The 2018 large-scale study found about a third of desktop browsers were unique, and far fewer on mobile.

## Architecture

```
index.html          Page layout and copy
bz-theme.css        Shared look with blazexyz.com
css/styles.css      Page tokens (mapped onto bz-theme.css), layout, animation
js/hash.js          cyrb128 hash + stable JSON serialization
js/collectors.js    The 20 signal collectors (each isolated, timed out, error-safe)
js/entropy.js       Entropy model → bits → "1 in N"
js/ridges.js        Seeded generative fingerprint drawing (SVG)
js/app.js           Orchestration, history comparison, rendering, export
```

The ridge pattern in the hero is drawn from your hash, so every ID gets its own image.

## Key design decisions

### 1. Isolate every collector

Each collector runs in parallel inside a timeout and `try/catch`. A blocked API (common in privacy browsers) degrades one card instead of breaking the page.

### 2. Hash only what's stable

Volatile signals are displayed but excluded from the hash, so the ID stays the same when you resize the window. `stableStringify` sorts keys before hashing, so equal data always produces the same ID.

### 3. Sample twice to detect noise

Canvas and audio are rendered twice. If the two results differ, the browser is adding noise, and counting those signals would overstate uniqueness.

### 4. Estimate rather than collect

A real rarity measurement needs a database of other visitors. Using published entropy figures keeps the page honest about being an estimate and keeps it server-free.

## Security and privacy of the tool itself

- **No network requests after load**, no analytics and no cookies. You can confirm it in the browser's network tab.
- **No permission prompts.** The Permissions API is only *queried*, and `enumerateDevices` is used without requesting access, so only device counts are read.
- **Local history only.** Your last ten fingerprint IDs are kept in this browser's `localStorage`, only so you can see what changed between visits.

## Testing and CI

There is no automated test suite yet. The raw data for every run can be inspected in the "View the raw data collected" panel or exported as JSON, which makes it easy to compare what each browser reports. Unit tests for the deterministic parts (`hash.js`, `entropy.js`, `ridges.js`) are on the roadmap.

## Limitations and roadmap

**Known limitations:**

- The uniqueness figure is an estimate from published entropy values, not a measurement against real visitors.
- The ID is an exact hash, so any change to a stable signal (a new font, a browser update) produces a new ID.

**Roadmap:**

- Optional opt-in backend to measure real rarity against other visitors.
- Fuzzy matching between scans (a similarity score instead of an exact ID).
- WebRTC local-IP leak check.
- Side-by-side comparison of two exported JSON reports.
- Unit tests for the hash, entropy model and ridge generator.

## References

- P. Eckersley, *How Unique Is Your Web Browser?*, PETS 2010.
- P. Laperdrix, W. Rudametkin, B. Baudry, *Beauty and the Beast: Diverting modern web browsers to build unique browser fingerprints* (AmIUnique), IEEE S&P 2016.
- A. Gómez-Boix, P. Laperdrix, B. Baudry, *Hiding in the Crowd: an Analysis of the Effectiveness of Browser Fingerprinting at Large Scale*, WWW 2018.

## Legal and ethical use

Fingerprint Mirror only reads the browser it runs in and sends nothing anywhere. It is a demonstration of how tracking works, built to help people defend against it. Don't adapt the collectors to track people without their knowledge and consent.

---

<div align="center">

MIT License · Built by <b>BlazeXYZ</b> · Part of <a href="https://blazexyz.com">blazexyz.com</a>

</div>
