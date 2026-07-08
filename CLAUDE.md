# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Two distinct things live side by side here, and most tasks concern only one of them:

1. **The reveal.js framework itself** (v6, upstream project by Hakim El Hattab) — the
   TypeScript/SCSS sources, plugins, build system and tests. Everything under `js/`, `css/`,
   `plugin/`, `test/`, `examples/`, plus `demo.html`.
2. **The author's personal slide decks** — the other `*.html` files at the repo root
   (`csc-53439-ep_*.html`, `inf581_optimization.html`, `optimization_cem*.html`), with their
   media (images, videos, PDFs) in `assets/<deck-name>/`, chapter files (for split decks) in
   `decks/<deck-name>/`, and shared styling/behavior in `jdhp.css` / `jdhp.js` at the repo
   root. These are the reason this clone exists; the
   framework is the tool. `index.html` at the repo root is neither of these — it's a plain
   static landing page (not a reveal.js deck) listing links to the personal decks.

### Purpose of the personal decks

The author (Jérémie Decock) teaches algorithmic courses and tutorials (mathematical
optimization, machine learning, reinforcement learning). reveal.js was chosen over
PowerPoint-like tools because it allows highly interactive, code-driven slides — the target
style is close to a 3Blue1Brown video: very technical *and* very visual/intuitive. Typical
patterns these decks rely on:

- An algorithm listing (e.g. CEM) on the left half of the screen, stepped through fragment by
  fragment with the current line highlighted, while the right half shows a synchronized visual
  of the algorithm's state (e.g. the points CEM sampled at that step on the objective
  function) — so readers see concretely what each instruction does.
- Embedded d3.js animations (via a `reveald3` plugin) and zoom/pan on diagrams — e.g. display
  a neural network and zoom into part of it to reveal the gradient-backpropagation
  computations.

When editing these decks, preserving and extending this interactivity (fragments, per-line
code highlighting, synchronized visuals) matters more than static layout polish.

### Current state of the personal decks

The decks were originally authored for a different site layout (reveal.js loaded from a
`revealjs/` CDN-style prefix) and have been ported to this repo's layout: they now load
`dist/*` and `dist/plugin/<name>.js` exactly like `demo.html`, plus `jdhp.css`/`jdhp.js` from
the repo root (`section.draft` highlighting and speaker-notes language filtering — each deck
carries its notes in both French and English as `.fr-notes`/`.en-notes`, and `jdhp.js` hides
one language). All decks initialize and render correctly; keep any new asset references
consistent with this layout.

**Scaling rules (mandatory for every personal deck)** — the author regularly presents on 4K
screens; see `FORMATS-ECRAN.md` at the repo root for the full rationale and per-screen test
results:

- Always set `maxScale: 4.0` in `Reveal.initialize()` so slides fill 4K displays (harmless on
  smaller screens). Apply it to any new deck and restore it if it goes missing.
- Never set `width`/`height` in `Reveal.initialize()`: all deck content is calibrated for the
  default 960×700 canvas, and reveal.js's scaling adapts it to every screen size from there.
  Overriding them (e.g. 1920×1080) shrinks the rendered content to half size.
- Inside slides, keep sizes relative (`%`, `em`) and prefer SVG over PNG for figures so they
  stay sharp at the ~3× scale a 4K screen produces.

**d3.js-generated figures** — `optimization_cem_v2.html` is a rewrite of `optimization_cem.html`
(kept untouched as reference) where static PNG figures are progressively replaced by figures
drawn on the fly with d3.js. See `D3-FIGURES.md` at the repo root for the full architecture
and decision history. The established pattern, to reuse for every converted figure:

- One figure = one TypeScript file `assets/<deck-name>/<figure-name>.ts` (named after the
  image it replaces), NOT inline in the HTML — the author wants the deck HTML kept light.
  It does `import * as d3 from 'd3'` (npm devDependency, with `@types/d3`); figures are
  covered by the root `tsconfig.json` (`assets/**/*.ts` is in its include).
- In the slide: a `<div class="r-stretch">` wrapping an `<svg>` with an `id`, a `viewBox`
  (~760×420) and `preserveAspectRatio="xMidYMid meet"`, followed by
  `<script type="module" src="assets/<deck-name>/<figure-name>.ts"></script>` inside the
  same `<section>` — each figure stays self-contained. The Vite dev server transpiles the
  `.ts` on the fly, so the dev cycle stays "edit + reload", no build.
- The `reveald3` plugin is not needed (it embeds external d3 pages in iframes); use plain
  drawing code, and `Reveal.on('fragmentshown', ...)` if a figure must animate with
  fragments.

**Chapter includes (split decks)** — long decks are split into one file per chapter: the
master `.html` at the root keeps the head/`Reveal.initialize` shell and pulls each chapter
with a full-line directive `<!-- @include decks/<deck-name>/NN-<chapter>.html -->` (path
relative to the including file; directives can nest). Expansion is server-side, by the same
function in both paths — in dev via the `deckIncludes()` Vite plugin
(`scripts/deck-includes.mjs`, wired into `vite.config.ts`; editing a chapter file
auto-reloads the browser), at publish time in `scripts/build-decks.mjs` — so the browser
always sees a single assembled page (reveal.js/MathJax/fragments behave identically, the
published HTML stays fully static, `decks/` itself is not published). `inf581_optimization.html`
is split this way (17 chapters in `decks/inf581_optimization/`, cut exactly at the
`<!-- #region -->`…`<!-- endregion -->` markers, which stay inside the chapter files). To
edit a slide of a split deck, edit the chapter file, not the master; to add a chapter, create
the file and add its `@include` line.

**Publishing the decks (GitHub Pages)** — `npm run build:decks` type-checks, assembles the
static site into `_site/` (gitignored) and compiles each figure `.ts` to a standalone `.js`
bundle (`scripts/build-decks.mjs` + `vite.config.decks.ts`; the committed `dist/` is copied
as-is, never rebuilt at publish time). `.github/workflows/deploy-slides.yml` runs this on
every push to *any* branch (and on branch deletion) and deploys the combined result to
GitHub Pages: `master` at the site root, every other branch under `<branch>/` — so Claude
Code Web work branches are previewable online before merging. Each run rebuilds all
existing branches, so deleted branches drop out of the published site automatically.
One-time repo settings: Settings → Pages → Source: "GitHub Actions", and Settings →
Environments → `github-pages` → Deployment branches and tags: "No restriction".

## Commands

- `npm start` — Vite dev server on `http://localhost:8000`, serving the repo root (any root
  `*.html` is reachable by its path). Override the port with `npm start --port=8001`.
- `npm run build` — full build of core + all plugins + styles into `dist/`.
  `npm run build:styles` is the faster CSS/theme-only variant.
- `npm run build:decks` — builds the publishable static site of the personal decks into
  `_site/` (used by the GitHub Pages workflow; see `D3-FIGURES.md`).
- `npm test` — runs every QUnit suite in `test/*.html` headlessly (Puppeteer), each suite
  loaded through a temporary Vite server on port 8009. There is no single-test CLI filter; to
  run one suite, start `npm start` and open `http://localhost:8000/test/<file>.html` in a
  browser (QUnit reports in-page).

**Rebuild rule**: all root HTML pages (demo, examples, personal decks) load the *prebuilt*
`dist/` files, which Vite serves as static assets. Edits to `js/`, `css/` or `plugin/` sources
are invisible until `npm run build` (or `build:styles`). Edits to a deck's HTML only need a
page reload.

To launch the server as a background task and visually verify slides (navigation by URL hash,
arrow keys, `Reveal` API calls, screenshots) through the project-scoped `playwright` MCP
server, follow the `run` skill (`.claude/skills/run/SKILL.md`).

## Framework architecture (big picture)

- `js/reveal.js` is the core class; nearly all behavior is delegated to feature controllers in
  `js/controllers/` (keyboard, fragments, controls, scrollview, printview, autoanimate,
  overlay, location/hash routing, etc.), instantiated and wired together in the core. Shared
  defaults live in `js/config.ts`, entry point in `js/index.ts`.
- Plugins are self-contained under `plugin/<name>/` (source `plugin.js` + `index.ts` + own
  `vite.config.ts`) and are built to `dist/plugin/<name>.js` / `.mjs`. Note the layout change
  from reveal.js ≤5: consumers load `dist/plugin/zoom.js`, not `plugin/zoom/zoom.js`.
- Styles: `css/reveal.scss` (core) and `css/theme/source/*.scss` (themes) compile to
  `dist/reveal.css` and `dist/theme/*.css` via `vite.config.styles.ts`. To add a theme, add a
  source SCSS file there and rebuild.
- `vite.config.ts` builds the library (`dist/reveal.js`/`.mjs` + `.d.ts` via vite-plugin-dts)
  and defines dev-server aliases (`reveal.js` → `/js`) — the aliases matter for tests and
  ES-module consumers, not for the root HTML pages, which use `dist/`.
- `react/` is a separate npm workspace with its own scripts (`npm run react:build`,
  `react:test`, `react:demo`).
