# Jobwatch — brand identity

## Positioning

**One-line:** Jobwatch reads job postings straight from the source, and tells you exactly what's new.

**What this is** (repo README intro / app About panel):

> Jobwatch fetches live postings directly from the applicant-tracking systems
> companies actually use, no job-board reposts, no expired listings pretending
> to be open. Every match is scored against your own keywords with plain,
> visible logic, so you can see exactly why something ranked where it did.
> Everything, your profile, your saved jobs, your history, stays in your
> browser. Nothing is uploaded anywhere.

**The wedge:** general job boards are adversarial by construction, SEO
farming, reposted listings, ghost jobs kept up for lead generation. Jobwatch
skips the boards and goes to the one place a posting can't be faked: the
company's own ATS. It then diffs what it sees against last time and surfaces
only what changed. Calm, first-hand, auditable. Not another feed to doomscroll
at 11pm.

## Voice and tone

Jobwatch talks like a tool a tired person can trust at midnight: plain,
specific, unhurried. It never performs enthusiasm and never manufactures
urgency. It states facts (counts, dates, sources) and lets the user draw
conclusions. No emoji, no exclamation points, no "AI-powered" framing, since
the entire pitch is that the logic is visible and boring on purpose.

| Don't | Do |
|---|---|
| "🎉 Awesome! 12 new jobs just for you!" | "12 new since your last check." |
| "AI-Powered Smart Job Matching Engine" | "Matched on your keywords. Here's why." |
| "Don't miss out, apply now before it's too late!" | "Posted 2 days ago, via Greenhouse." |

Errors and gaps get the same register as good news: stated plainly, not
alarmed. A source that failed to fetch is "1 source unreachable," never a red
banner: see `--c-warn` in the token file, which is amber-brown, not red.
Red (`--c-error`) is reserved for something actually broken, not for routine
noise like a flaky endpoint.

## Naming the UI concepts

Plain language over jargon, since the audience is stressed and reading fast.

| Concept | Name | Why |
|---|---|---|
| The keyword-match score (0 to 10, or a band) | **Match** | Not "AI score," not "relevance." Match says plainly what it measures: overlap with your own words. |
| The four match bands | **Strong · Good · Partial · Stretch** | Reads like a person sizing up their odds, not a grading rubric. "Stretch" replaces the harsher "long shot" or a bare "low" without pretending the odds are better than they are. |
| The badge marking postings that appeared since the last check | **New** | No "unread," no "unseen." One word, obvious. |
| The three-step posting-age indicator | **Fresh · Recent · Stale** | Describes the posting's age, not the user's match to it, so it's never confused with Match. |
| The user's saved search terms | **Keywords** | Not "profile," not "preferences." It's the literal list of words the matcher checks against, so the name should say that. |
| The panel showing why a posting scored what it did | **Why this matched** | Names the actual question the user has when they click in. |

## Color system

Restrained neutrals carry the interface. **Signal Blue is the only saturated
accent and it is functional only**, links, focus rings, the one primary
button. It never appears as a decorative dot, rule, or bullet ahead of text.
Match and Freshness get their own small, desaturated tint scales so they read
as information, not decoration, each band pairs a light tint background with
a darker, saturated foreground so text is never color-only and never fails
contrast even at small badge sizes.

All ratios below are computed from the WCAG relative-luminance formula
against the actual token hex values in `tokens.css`, not estimated.

### Light theme

| Pair | Contrast | Target | Result |
|---|---|---|---|
| `--c-text` on `--c-surface` | 16.99:1 | 4.5:1 | pass |
| `--c-text-muted` on `--c-surface` | 7.42:1 | 4.5:1 | pass |
| `--c-accent` (as link text) on `--c-surface` | 6.43:1 | 4.5:1 | pass |
| `--c-accent-fg` on `--c-accent` (filled button) | 6.70:1 | 4.5:1 | pass |
| `--c-fit-strong-fg` on `--c-fit-strong-bg` | 6.49:1 | 4.5:1 | pass |
| `--c-fit-good-fg` on `--c-fit-good-bg` | 6.73:1 | 4.5:1 | pass |
| `--c-fit-partial-fg` on `--c-fit-partial-bg` | 6.37:1 | 4.5:1 | pass |
| `--c-fit-stretch-fg` on `--c-fit-stretch-bg` | 8.62:1 | 4.5:1 | pass |
| `--c-fresh-fg` on `--c-fresh-bg` | 7.30:1 | 4.5:1 | pass |
| `--c-recent-fg` on `--c-recent-bg` | 9.45:1 | 4.5:1 | pass |
| `--c-stale-fg` on `--c-stale-bg` | 8.07:1 | 4.5:1 | pass |

### Dark theme

| Pair | Contrast | Target | Result |
|---|---|---|---|
| `--c-text` on `--c-surface` | 17.35:1 | 4.5:1 | pass |
| `--c-text-muted` on `--c-surface` | 7.94:1 | 4.5:1 | pass |
| `--c-accent` (as link text) on `--c-surface` | 7.19:1 | 4.5:1 | pass |
| `--c-accent-fg` on `--c-accent` (filled button) | 7.19:1 | 4.5:1 | pass |
| `--c-fit-strong-fg` on `--c-fit-strong-bg` | 10.93:1 | 4.5:1 | pass |
| `--c-fit-good-fg` on `--c-fit-good-bg` | 10.31:1 | 4.5:1 | pass |
| `--c-fit-partial-fg` on `--c-fit-partial-bg` | 11.32:1 | 4.5:1 | pass |
| `--c-fit-stretch-fg` on `--c-fit-stretch-bg` | 9.85:1 | 4.5:1 | pass |
| `--c-fresh-fg` on `--c-fresh-bg` | 10.91:1 | 4.5:1 | pass |
| `--c-recent-fg` on `--c-recent-bg` | 6.79:1 | 4.5:1 | pass |
| `--c-stale-fg` on `--c-stale-bg` | 8.87:1 | 4.5:1 | pass |

**One pair needed adjustment to clear AA with real margin.** The first light-mode
accent blue I tried, `#2563EB`, measured 4.955:1 as link text on
`--c-surface`, technically over 4.5 but with almost no room for rendering or
sub-pixel rounding to eat the margin. I moved to `#1D4ED8` (6.43:1) instead,
same hue family, one step darker, and used it consistently for both the link
role and the filled-button role rather than keeping two near-identical blues.

## Type system

No Google Fonts, no CDN, no font files to host. A strict CSP that blocks
external hosts should never even notice this app has a type system: every
face resolves to whatever the OS already has installed.

```css
--font-sans: system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, "SF Mono", Menlo, monospace;
```

Convention: prose (titles, company names, body copy) is sans. Anything
numeric or tabular, Match score, dates, counts, percentages, source names,
is set in mono with `font-variant-numeric: tabular-nums` so digits align in a
column and don't jitter as values update live.

Modular scale (see `--text-*` in `tokens.css`): 12 / 13 / 15 / 17 / 20 / 28 / 36px,
tight enough steps that headings don't tower over body copy, this is a tool,
not a landing page.

## Spacing, radius, shadow

4px base unit up to 64px (`--space-1` through `--space-8`). Radii are small
and consistent (4 / 8 / 12px, plus a pill for badges), nothing rounds past
"software," nothing looks like a phone-app bubble. Shadow is reserved for
things that actually float above the page, the detail panel, dropdowns,
modals. Job cards are separated by a hairline border, never a shadow: a flat
list of real postings shouldn't look like a stack of cards competing for
attention.

## Logo

**Concept: the notch.** A ring (the aperture: a fixed point of observation,
the thing being watched) left deliberately open at one point along its rim, a
single clean gap where the circle admits the outside world instead of
closing on itself. The gap sits at the bottom of the ring with flat, cut ends,
so it reads as a machined opening (a retaining ring, a lens aperture blade)
rather than a soft break. It carries the same idea the first version of this
mark was reaching for, watching, plus one clean point of entry, without a
line projecting outward from the ring.

Nothing in the mark points outward from its own center. That constraint is
deliberate: it is what keeps the shape from being read as an arrow, a compass
needle, or any of the small set of glyphs a circle-plus-radial-line can
accidentally become (see rejected version below). At 16px the single stroke
survives because there is exactly one element and nothing fine to lose. The
favicon variant widens the gap and thickens the stroke rather than shipping a
scaled-down copy of the larger mark, since a narrow opening at low resolution
optically closes back into a solid ring.

**Rejected first version, do not reintroduce.** The original mark was a ring
with a single straight leader line breaking off its rim at the upper-right,
45 degrees from center. Read in isolation that is exactly the Mars/male
symbol (♂), a circle with a diagonal stroke leaving it at that specific
bearing. It was invisible to me while designing it and immediate on
render, the first thing anyone sees at any size. Any future revision that
puts a straight line projecting outward from a fixed point on the ring,
especially anywhere near the upper-right diagonal, needs to be checked
against this exact failure before it goes near the app.

Files: `logo-mark.svg` (mark alone, square), `logo-lockup.svg` (mark plus the
`Jobwatch` wordmark, horizontal), `favicon.svg` (re-proportioned for 16 to
32px). All three use `currentColor`, so dropping them into a light or dark
context, a `<img>` with a CSS `color` set on a wrapping element via `filter`,
or an inline `<svg>` all work without a separate light/dark asset.

**Wordmark casing: `Jobwatch`, capitalized, everywhere.** The app UI and
README already render it that way; this doc and the lockup now match rather
than asking those surfaces to change. Use lowercase only when referring to a
literal file or package name (`jobwatch-web`, `tokens.css`), never for the
product name in prose or in the lockup.
