---
name: review-deck
description: Use when the user asks to proofread, review, or check a personal slide deck (relire un deck, chercher des erreurs/coquilles/imprécisions/incohérences) — e.g. "/review-deck optimization_cem.html". Systematic review procedure covering scientific correctness, notation consistency, spelling/grammar, broken links, visual rendering of every slide and fragment, and improvement suggestions ranked by importance.
---

# Reviewing a personal slide deck (proofreading procedure)

Goal: produce a review report on one deck — author misunderstandings, factual errors,
imprecisions, notation inconsistencies, typos, badly worded sentences, layout problems —
plus improvement suggestions **ranked by importance**. This is a *review*, not an edit
pass: report findings, do NOT modify the deck unless the user asks for fixes.

The deck to review is given as argument (`$ARGUMENTS`): a root `*.html` file name or a
`http://localhost:8000/<deck>.html` URL. If no argument is given, ask which deck.

## Step 1 — Collect the deck's sources

1. The master file is `<deck>.html` at the repo root. Read it entirely (head comments,
   `Reveal.initialize` options, title slide).
2. Split decks pull chapters via full-line `<!-- @include decks/<deck>/NN-*.html -->`
   directives: `grep -n "@include" <deck>.html`, then read **every** included chapter
   file (they can nest — grep them for `@include` too).
3. Also read the speaker notes (`.fr-notes`/`.en-notes`) — they are part of the review
   (empty notes are a finding; notes contradicting the slide are an important finding).
4. Note any TypeScript figure files referenced by the slides
   (`assets/<deck>/*.ts`): skim them only when a slide's meaning depends on what the
   figure computes (e.g. checking a formula against the figure's implementation).

## Step 2 — Textual review (source-level)

Read every slide looking for, in decreasing order of importance:

1. **Scientific/factual errors** — wrong formulas, wrong claims, misunderstanding of the
   algorithm/concept, wrong reference metadata (authors, year, journal, pages,
   diacritics in names). Verify formulas independently; don't assume the author is right.
2. **Notation inconsistencies across slides** — the same object written several ways
   (e.g. $P_\theta$ vs $\mathbb{P}(\theta)$ vs $\mathbb{P}_\theta$; bold vs non-bold
   vectors; subscript vs superscript sample indices), the same word used for two
   different objects (family vs distribution; samples vs solutions; algorithm
   parameters vs meta parameters; stop criteria vs termination criteria), or the same
   symbol reused for two different objects (e.g. $x_1, x_2$ as the coordinates of the
   search space on one slide and as sampled solutions on another).
3. **Imprecisions / pedagogical gaps** — undefined symbols, vague statements ("good
   convergence"), missing intuition the deck's own style calls for (see CLAUDE.md:
   3Blue1Brown-like), a title concept never explained (e.g. why "cross-entropy"?).
4. **English/French language errors** — subject-verb agreement, garbled noun groups,
   French typography leaking into English text (space before `:`), singular/plural.
   The decks are written in English; notes exist in both languages.
5. **Coquilles / stale metadata** — dates, stale HTML comments (e.g. a comment naming
   another file), placeholder notes (`...`), commented-out leftovers worth deleting.
6. **HTML validity issues that matter** — e.g. `<ul>`/`<div>` inside `<p>` (browsers
   auto-close the `<p>`, styles may not apply as intended).
7. **House-rule compliance** (CLAUDE.md): `maxScale: 4.0` present, no `width`/`height`
   in `Reveal.initialize`, relative sizes, figure `.ts` files not inlined, `@preview`
   line present in chapter files.

## Step 3 — Visual review (browser-level)

Follow the `run` skill: start the dev server, open the deck through the playwright MCP
server. Then:

1. Check the console after load (`browser_console_messages`) — 404s, JS errors.
2. Get the slide count (`Reveal.getTotalSlides()`), then visit **every** slide
   (`Reveal.slide(h)` / `Reveal.slide(h, v)`) and screenshot it. Read each screenshot —
   look for overflow, overlap, unreadable sizes, MathJax failures (raw `$...$`),
   missing images/figures.
3. On slides with fragments, step through **at least the key fragments** (first, one
   mid-sequence, last) with `Reveal.next()` and verify the synchronization between
   highlighted text and figure state — that synchronization is the point of these decks.
   Wait (sleep ~2.5 s) after triggering fragments that run animations before
   screenshotting.
4. Check every external `href` in the deck sources with
   `curl -s -o /dev/null -w "%{http_code}" -L --max-time 15 -A "Mozilla/5.0" <url>` —
   report non-200s (note: some publishers return 403 to curl but work in a browser;
   flag those as "to verify by hand").
5. Close the browser when done (`browser_close`) — mandatory, see the `run` skill
   (WebGL slides keep rendering at 60 fps otherwise).

## Step 4 — The report

Deliver a single report in the conversation (same language as the user's request):

- Group findings by severity: (1) erreurs de fond, (2) incohérences de notation,
  (3) formulations/grammaire/coquilles, (4) rendu/technique, (5) suggestions
  d'amélioration pédagogiques.
- Within each group, order by importance. Number every finding so the user can say
  "corrige 1, 3 et 7".
- For each finding: the slide (number + title), the file and line
  (`decks/<deck>/<file>.html:NN`, clickable), what is wrong, and the suggested fix
  (exact replacement wording where possible).
- Be explicit about what was checked and found OK (rendering, links, console) — absence
  of findings is information too.
- Do not pad: a maladresse is only worth reporting if a concrete better wording exists.

## Scope notes

- Review only the deck's own content. Framework bugs (js/, css/, plugin/) are out of
  scope — mention them only if the deck triggers one.
- For a chapter shared by several masters (see `@preview` line), review it once but
  flag findings that could read differently in the other master's context.
- If the deck is long (e.g. inf581_optimization.html, ~100 slides), still cover every
  slide textually; for the visual pass, screenshot every slide but step fragments only
  on the slides whose source shows fragment/figure synchronization.
