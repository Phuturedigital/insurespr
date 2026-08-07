# InsureSPR Health — website concept

A design concept for **InsureSPR Health**, a bone and muscle health practice at
7 Malibongwe Drive, EmedCentre, Randburg. Built by
[Phuture Digital](https://www.phuturedigital.co.za) to show what a finished site
could look like before anyone commits to building one.

**Live:** https://insurespr-concept.phuturedigital.co.za

> ⚠️ **InsureSPR Health is a real practice.** This is not their official site and
> it is not affiliated with them. Every page carries a concept banner, every
> `<title>` says "concept by Phuture Digital", and the footer copyright is
> Phuture Digital's with attribution back to the practice. **That framing is
> load-bearing — do not remove it.** The same rule applies here as to the
> Africrest concept: a redesign aimed at a real company must never read as that
> company's own site.

The real practice site is <https://insuresprhealth.co.za>. It is the source for
every factual claim here; see `CONTENT-NOTES.md`.

## The organising idea

The practice's own site is written in clinical language — *"DXA bone density and
body composition analysis"*, *"Breatheez (Diaphragmatic gateway)"*. Its audience
skews 50+ and is deciding whether a scan is worth booking.

This concept keeps **every one of those service names exactly as the practice
writes them** and pairs each with two added lines:

1. what it actually is, in plain English
2. what you get out of it

The palette carries the same idea: **blue** is the clinical side — measurement,
the scan, science. **Gold** is the human side — plain English, outcome, you. The
`.plainly` card in `styles.css` plays that arc in miniature: cyan service name,
translated meaning, gold outcome.

Type is set large and the measure kept short throughout. For this audience
legibility is a functional requirement, not a stylistic preference.

`brand.html` documents all of this — palette, type scale, live component kit and
the design process — and is linked from the footer of every page.

## Brand assets

The practice supplied genuine vector logos (rare: the other concept sites in
this network all received broken exports). `tools/optimise-logo.mjs` turns them
into web-weight assets and is the source of the authoritative brand colours:

| | Value | |
|---|---|---|
| Gradient start | `#00AEEF` | Pantone Process Cyan |
| Gradient end | `#2E3192` | |
| Wordmark | `#004AAD` | |

⚠️ **Dark-ground variants are required, not optional.** The wordmark is a
hardcoded `#004AAD` and the gradient's deep end is `#2E3192`; both sit close
enough to `--ink` that the logo half-disappears on it. Use `mark-light.svg` /
`lockup-light.svg` on dark surfaces.

⚠️ The practice's real tagline is **"Precision Healthcare"** — it is in the
lockup. An earlier pass invented "Bone & muscle health"; do not reintroduce it.

## Type

**Bricolage Grotesque** (display) + **Plus Jakarta Sans** (body), both variable.
Bricolage's `opsz` axis is tracked to the rendered size so large cuts tighten
rather than looking like blown-up text. This replaced a Fraunces/Inter pairing
that read as dry.

## Stack

Zero-build static site. Flat HTML + one `styles.css` + one `site.js`, deployed
to Vercel with `cleanUrls`. No framework, no bundler, nothing to install to work
on it — open a page in a browser.

| Path | What it is |
|---|---|
| `*.html` | 8 pages: index, scan, services, about, learn, book, contact, **brand** |
| `styles.css` | Every style. Tokens at the top, components below. |
| `site.js` | Nav, scroll-reveal, form UI. No dependencies. |
| `assets/` | Shipped imagery + the redrawn logo mark and favicon |
| `pd-concepts/` | Thumbnails for the cross-site concept network block |
| `tools/` | Research + audit scripts. **Never deployed** — see `.vercelignore`. |

### Motion

Scroll-reveal is stamped `.js` on `<html>` from an **inline `<head>` script**, before
first paint. A deferred script cannot do this without a flash: the stylesheet
blocks rendering and the script does not. Under `prefers-reduced-motion` the CSS
forces full opacity — if you change the reveal rules, verify reduced-motion
still renders content, or the page goes blank.

## Working on it

```bash
# Serve locally (any static server works)
npx serve .

# Find what overflows at a given width — measure, don't guess from a screenshot
node tools/overflow.mjs contact.html 320

# Re-shoot the responsive audit (7 widths x 7 pages)
node tools/shoot.mjs
```

Playwright is borrowed from a sibling repo via `createRequire`, so nothing
installs here. `tools/shots|sheets|previews` are gitignored — ~77MB of
regenerable output.

**Always sweep 7 widths, not 2.** A previous concept site in this network passed
a desktop+mobile check while overflowing by 46px at 320px.

## Deploy

Pushes to `main` auto-deploy via the GitHub integration. `vercel.json` sets
`cleanUrls`, `noindex` and the security headers; `robots.txt` reinforces the
noindex. Neither is optional — this must not compete with the real practice site
in search results.

⚠️ Never share a raw `insurespr-<hash>.vercel.app` deployment URL. Deployment
Protection puts a Vercel login wall on per-deployment URLs. Share the custom
domain.
