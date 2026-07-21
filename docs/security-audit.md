# Jobwatch security audit

Date: 2026-07-21
Scope: everything under `src/`, plus `index.html`, `vite.config.ts`, `vitest.config.ts`, `package.json`, and the built `dist/`.
Verdict: **ship**, with the host-level notes in [Residual risk](#residual-risk).

Findings: 0 critical, 0 high, 4 medium, 5 low, 4 informational. All 13 are fixed in code
except three that are host configuration or inherent to the design, and those are called out
as residual.

---

## Threat model

Jobwatch is a static single-page app with no backend, no accounts, and no secrets. That
removes most of the usual attack surface and concentrates what is left into four places.

**1. The reader's browser is where all the value sits.** After the resume feature, local
storage holds the user's full resume text, their keywords, the companies they follow, the
roles they saved, and the history behind the New badge. There is no server copy, so there is
nothing to breach remotely; equally, anything that runs script in the page gets all of it at
once. Script execution in this app is not a nuisance, it is total compromise of one person's
job search and their resume. That single fact sets the priority order below.

**2. Job descriptions are attacker-influenced input.** The bodies come from six ATS APIs, and
on several of those boards the hiring company can paste arbitrary HTML into a posting. That
HTML is rebuilt by `src/lib/sanitize.ts` and injected with `dangerouslySetInnerHTML` in
`src/components/JobDetail.tsx`. The realistic attacker is not the ATS vendor, it is whoever
can get a posting published on any board any Jobwatch user follows, which is a low bar.

**3. Pasted URLs choose request targets.** `detectSource()` turns a careers URL into an ATS
kind plus a company token, and that token is interpolated into a request URL. Anything that
makes the app request an attacker-chosen origin defeats the point of the allowlist.

**4. Local storage is untrusted input.** It can be hand-edited, restored from a backup a
friend sent, or left behind by an older version. Every read path has to survive it, because
there is no server-side reset and the in-app reset button is behind the same page load that
the bad data would break.

Explicitly out of scope: an attacker with local access to the machine (localStorage is not
encrypted and is not claimed to be), and a compromise of an ATS vendor's own infrastructure
beyond what it lets them serve as posting content.

---

## The number one risk, tested properly

The brief was to try hard to break the sanitizer. The result: **it holds**, and the reason is
architectural rather than a matter of having a long enough blocklist.

`sanitize.ts` parses into an inert document and then **rebuilds** the output tree from an
allowlist, using `doc.createElement()` on a fixed set of tag names. An element the allowlist
does not name is never constructed at all. That closes the entire mutation-XSS family by
construction, because mutation XSS depends on a dangerous element or attribute *surviving* a
transformation, and here nothing survives, things are recreated. `href` is the only attribute
that is ever set, and only after `new URL()` has confirmed the protocol is http or https.

### Verification method, and why the unit tests alone were not enough

The project tests run under happy-dom, whose HTML parser is not Blink and does not reproduce
the foreign-content, raw-text, and template-nesting quirks that mutation XSS relies on. A
clean happy-dom run is therefore weak evidence about a real browser. During this audit
happy-dom also proved it is not inert: it attempted a real network load for an `<iframe>`
that came out of a test payload (see L5).

So the corpus was additionally run through **real headless Chrome**:

1. `esbuild` bundles the actual `src/lib/sanitize.ts`, not a copy.
2. A harness page runs 68 payloads through `sanitizeHtml()`, injects each result into a live
   document with `innerHTML` (the exact operation React performs), and then inspects the
   resulting DOM.
3. Every payload calls a global `xss(n)` marker, and `alert`/`print` are overridden, so any
   execution at all is recorded rather than inferred.
4. The harness asserts, per payload: no tag outside the allowlist, no attribute outside
   `href`/`target`/`rel`, no anchor whose resolved protocol is not http(s), no clobbering of
   `document.body` or `document.documentElement`, and no execution after a 2 second settle.

Payload classes covered: SVG and MathML namespace confusion (`<svg><style>`,
`<math><mtext><mglyph>`, the `<form>`/`mglyph` mXSS, `foreignObject`, `annotation-xml`,
`<svg><desc><![CDATA[`, `animate` with a `javascript:` value), raw-text and RCDATA element
breakout (`noscript`, `template` closed and unclosed, `xmp`, `listing`, `plaintext`, `title`,
`textarea`, `iframe`, `noembed`, `noframes`, `style`), entity handling (single, double,
numeric, and hex encoding, plus live markup mixed with entities), parser oddities (`/` in
place of a space before an attribute, conditional comments, CDATA, `<font face=` breakout,
unterminated quoted attributes, `<base>`, `<form action>`, custom elements), and twenty
`href` protocol bypasses (control characters, leading whitespace, zero-width space,
fullwidth characters, percent-encoding, entity-encoded scheme letters, `data:`, `vbscript:`,
protocol-relative, UNC).

**Result: 68 payloads, zero executions, zero disallowed tags, zero disallowed attributes,
zero non-http(s) protocols, no clobbering.**

Re-running the harness is a one-liner and is worth doing after any change to `sanitize.ts`:

```
npx esbuild src/lib/sanitize.ts --bundle --format=iife --global-name=SAN --outfile=<dir>/sanitize.js
chrome --headless --disable-gpu --virtual-time-budget=8000 --dump-dom file:///<dir>/harness.html
```

The same corpus is now a permanent regression net in `src/lib/security.test.ts`, asserted
against the parsed tree rather than against the output string, for the reason in I1.

### On replacing the hand-rolled sanitizer

Not warranted. The rebuild-from-allowlist design is the same one DOMPurify converged on, the
implementation is 160 lines that can be read in full, and it survived a real-browser corpus
that targets exactly its design. Adding a dependency here would trade an auditable file for a
supply-chain surface, on a project whose zero-dependency posture is deliberate.

---

## Findings

### Medium

#### M1. The response size cap ran after the whole body was already in memory
`src/lib/ats.ts`

`getJson()` did `const text = await res.text()` and *then* compared `text.length` to the 12MB
cap. A cap applied after buffering is not a cap, it is a post-mortem: a board answering with a
gigabyte would exhaust the tab before the check ever ran. The bound was also measured in
UTF-16 code units rather than bytes.

Exploitable in practice: yes, by any of the six boards, or by anyone who can get a redirect or
a compromised endpoint in front of one. No attacker sophistication required, only a large
response.

Fix: `readCapped()` streams the body through `res.body.getReader()`, counts real bytes, and
cancels the reader the moment the cap is passed. Falls back to `res.text()` only where no
stream is available, where the request timeout is still a bound.

Test: `hangs up on an oversized body instead of buffering it first` asserts the reader was
cancelled and that reading stopped at the cap instead of consuming everything on offer.

#### M2. A redirect could take the request off the allowlist
`src/lib/ats.ts`

The host allowlist was checked against the URL the app *sent*. With `redirect: "follow"`, the
host that *answers* can be different. Any allowlisted board, or anyone who could induce a 302
from one, could therefore point the request at an origin of their choosing while the
application-layer allowlist reported success.

Exploitable in practice: partially. The browser also applies `connect-src` to redirect
targets, so the CSP would have blocked the load. But that made the application-layer control
decorative on the redirect path, and a control that only works because a second control
exists is not a control.

Fix: after the response arrives, `res.url` is re-checked with the new exported `isAllowedUrl()`,
which is now the single question every outbound URL answers, whether we built it or a board
redirected us to it.

Test: `rejects a board that redirects the request off-domain`, plus a companion asserting an
in-allowlist redirect still works.

#### M3. A tampered or imported store could brick the app with no way back
`src/lib/storage.ts`

Two halves of one problem. `loadSeen()` capped nothing on read; `MAX_SEEN` was enforced only
in `saveSeen()`, so a ledger that never went through `saveSeen()` (hand-edited, or restored
from a backup) was read in full on **every page load**. And `importAll()` wrote whatever it
was given straight into localStorage with no shape or size check, on the theory that the read
path validates.

The reason that theory fails is the reload. Import writes and then calls `location.reload()`,
so anything that lands in the store is re-read on every subsequent visit, and the settings
screen holding the Erase button is behind that same load. A large enough imported seen map is
a self-persisting denial of service against one user with no in-app recovery, only "clear site
data by hand", which is not something a non-technical friend will work out.

Exploitable in practice: yes, and the delivery is realistic. "Here is my Jobwatch backup" is a
file people will send each other.

Fix: `coerceSeen()` applies `MAX_SEEN` on read as well as write. `importAll()` now rejects
files over 16MB, rejects non-objects, type-checks each key before writing (record for
profile/seen/meta, array for sources and the id lists), caps the arrays, runs the seen map
through `coerceSeen()` before it is stored, and returns `false` when nothing recognizable was
found so the user is told the file is not a backup instead of reloading into an unchanged app.

Tests: six cases under `importing a backup someone else wrote`, plus `bounds the seen ledger on
read, not only on write`.

#### M4. The privacy claim was literally false
`index.html`, `src/components/Onboarding.tsx`

The copy said "nothing leaves your browser". For an app whose entire function is fetching from
six third-party APIs, that is not true, and it is the one claim the product is really making.
What *is* true, and is now what it says: the resume, the keywords, and everything saved stay
local, and the only thing that leaves is the request to each company's own job board, exactly
as if the user had opened that careers page themselves.

This matters more than a wording nit. An overstated privacy claim on a tool that holds a
resume is the kind of thing that gets a project publicly torn apart by someone who opens
devtools, sees six outbound requests, and posts a screenshot.

Fix applied to the meta description and the onboarding lede. The Settings copy was already
accurate and was left alone. The `<noscript>` text was also left alone: with JavaScript off,
nothing is in fact sent.

Verification that the underlying claim now holds: `sends nothing about the user beyond which
company is being read` pins the exact request URL, asserts `credentials: "omit"`,
`referrerPolicy: "no-referrer"`, no request body, and that `Accept` is the only header. A
codebase-wide search confirms one `fetch` call site and no `sendBeacon`, `XMLHttpRequest`,
`WebSocket`, `EventSource`, `new Image`, or dynamic `import()`. No remote CSS, no web fonts,
no analytics.

### Low

#### L1. A second network entry point had no token gate
`src/lib/ats.ts`

`fetchSource()` validates `source.token` before building a URL. `fetchDetailHtml()`, which is
the other function that reaches the network, did not, and interpolated `source.token` into the
SmartRecruiters URL directly. Not exploitable today, because every `Source` that can reach it
has already been through `loadSources()`, `detectSource()`, or the static catalog, all of which
validate. Fixed anyway: a gate that depends on every caller having done the right thing is a
gate waiting for a new caller.

#### L2. A very large board response could overflow the stack
`src/lib/runner.ts`

`collected.push(...jobs)` passes every element as a function argument, which throws a
`RangeError` past roughly 65k arguments. The 12MB body cap allows job counts in that range. It
would have surfaced as a caught "unexpected error" rather than a crash, but the run would
silently lose that source. Now appended in a loop, with a new `MAX_JOBS` ceiling of 20,000 per
run so one misbehaving board cannot decide how much memory the tab uses.

#### L3. The sanitizer parsed unbounded input before any budget applied
`src/lib/sanitize.ts`

`MAX_DEPTH` and `MAX_NODES` bound the tree walk, but `DOMParser` ran on the entire string
first, and parsing is the expensive half. `safeUrl()` had no length bound either. Added
`MAX_INPUT` (512KB) applied before parsing in both `sanitizeHtml()` and `toText()`, and
`MAX_URL` (4096) in `safeUrl()`. Test asserts a 3MB posting is cut and returns promptly.

#### L4. A loop guard bounded the wrong quantity
`src/lib/extract.ts`

In `parseYears()`, the second scan broke on `hits.length >= MAX_YEAR_HITS * 2`. Every `continue`
path (value out of range, or inside a masked range span) skips the push, so on input where
every match is discarded, `hits` never grows, the guard never fires, and the per-match
`rangeSpans.some()` check runs across the whole document. Bounded by the 200-span cap so it is
not catastrophic, but the guard did not do what its comment claimed. Now counts matches
examined rather than hits kept.

Worth recording that the rest of `extract.ts` is the most defensively written file in the
project: no network, no regex ever compiled from resume text, no nested quantifiers, and caps
on input, tokens, per-term counts, and output. The resume path was reviewed specifically for
ReDoS and is clean.

#### L5. The test suite was not inert and made real network requests
`vitest.config.ts`

Running `npx vitest run` produced `getaddrinfo ENOTFOUND evil.test`: happy-dom's parser
genuinely tried to load an `<iframe>` out of an XSS test payload. Two problems. The suite
depended on network state, and more importantly it demonstrated that the environment the
sanitizer is tested in does **not** model the browser inertness the sanitizer's design
argument rests on. That is the finding that motivated the Chrome verification above.

Fixed by disabling JavaScript file loading, JavaScript evaluation, and CSS file loading in the
happy-dom environment options. Iframe page loading is deliberately left enabled: blocking it
only converts the attempt into pages of uncaught-error noise that would bury a real failure,
and the corpus points iframes at `.test`, a reserved TLD guaranteed never to resolve.

### Informational

#### I1. Double-encoded markup appears as literal text that reads like a tag
Input `&amp;lt;img src=x onerror=...&amp;gt;` decodes once to `&lt;img ...&gt;`, parses to a
text node, and re-serializes to `&lt;img src=x onerror=...&gt;`. The output string therefore
contains the characters `onerror=` while being nothing but words on a page. Confirmed inert in
Chrome: zero elements created, zero execution.

Recorded for two reasons. It will make any naive string-matching assertion look like a
failure, which is exactly what happened while writing these tests, and the security tests are
now written against the parsed tree specifically to avoid enshrining the wrong check. It also
means a posting can display text that looks like markup, which is a content-presentation
quirk, not a vulnerability.

#### I2. Clickjacking is not mitigated, and cannot be from a meta CSP
`frame-ancestors` is ignored in a `<meta>` policy and requires a real response header, which
GitHub Pages cannot send. Impact is genuinely small: there is no authenticated state to
abuse, no cross-site request to forge, and the one destructive action is behind a native
`confirm()` dialog that cannot be clickjacked. Left unfixed deliberately rather than adding a
frame-buster that would misbehave for anyone with a legitimate reason to embed the page. See
`docs/deploy.md` for the header to set if the app ever moves to a host that supports headers.

#### I3. `style-src 'unsafe-inline'` is required and is an accepted residual
React sets inline style attributes, so the directive cannot be dropped without restyling the
app. The exposure it would normally create, injected CSS, requires HTML injection first, and
the sanitizer strips every attribute including `style`. Accepted.

#### I4. Following a company discloses it to that company
Inherent to a serverless design: each ATS sees the user's IP and which board was requested,
the same as visiting that careers page. Minimized with `credentials: "omit"` (no cookies, no
ambient authority), `referrerPolicy: "no-referrer"`, and a page-level
`<meta name="referrer" content="no-referrer">`. Now stated accurately in the copy per M4
rather than papered over.

---

## What was checked and found already correct

Worth recording so the next audit does not redo it.

- **Host allowlist dot-boundary.** The `endsWith` fix is complete and consistent.
  `hostMatches()` is used by both `hostAllowed()` and every branch of `detectSource()`.
  `evilrecruitee.com`, `recruitee.com.evil.test`, `notgreenhouse.io`, and
  `boards-api.greenhouse.io.evil.test` are all rejected. Pinned by tests.
- **Path traversal via the company token is closed**, but by a subtle interaction worth
  naming: the token alphabet permits dots, so what actually prevents a `..` path segment is the
  requirement that the first character be alphanumeric, which makes `..` and `.` unspellable.
  `encodeURIComponent` is identity over the permitted alphabet, so it is not doing the work.
  Now pinned by explicit tests, because a future relaxation of the first-character rule would
  silently reopen traversal.
- **Recruitee's token lands in the hostname**, which is the most plausible escape in the
  codebase. A dotted token yields `evil.test.recruitee.com`, still inside the tenant domain.
  Pinned.
- **Prototype pollution.** No exploitable path. `JSON.parse` creates `__proto__` as an own
  property rather than invoking the setter, `rec()`/`arr()` never walk `__proto__`, the dedupe
  and lookup structures are `Map`s, and `loadSeen()` uses a null-prototype object. Verified
  with a hostile board payload and a hostile store; `Object.prototype` stays clean in both.
- **ReDoS.** `keywordRegex()` in `scoring.ts` and `termRegex()` in `extract.ts` both escape
  metacharacters, so no user-supplied string is ever compiled as a pattern. No nested
  quantifiers anywhere. The `while (re.exec())` loops cannot spin, because every pattern is
  built around a non-empty literal and so can never produce a zero-width match.
- **CSP is real, not decorative.** The build-injected policy has no `unsafe-inline` in
  `script-src` and no `unsafe-eval` anywhere. The `sha256-MZxvE1l3...` hash was independently
  recomputed from the built `dist/index.html` and matches the one inline script. The built app
  was then loaded in headless Chrome over HTTP and rendered fully with **zero CSP violations**,
  and the inline theme script ran (proving the hash is correct rather than the script merely
  being absent). The hash is re-derived at build time, so the policy cannot drift away from
  what is on the page.
- **Supply chain.** `npm audit`: 0 vulnerabilities. Two runtime dependencies, `react` and
  `react-dom`. `gitleaks detect --no-git`: no leaks.
- **No data egress.** One `fetch` call site. No beacons, sockets, remote CSS, web fonts, or
  analytics.

---

## Residual risk

**Set these at the host if it supports response headers.** GitHub Pages does not, so on GitHub
Pages the meta CSP is doing the work and the first item is simply unavailable. The full list
and the exact values are in `docs/deploy.md`.

1. `Content-Security-Policy: frame-ancestors 'none'` (I2). Not expressible in meta.
2. `Strict-Transport-Security` (relevant only on a custom domain; GitHub Pages sets its own).
3. `X-Content-Type-Options: nosniff`.
4. `Referrer-Policy: no-referrer` as a header, backing up the existing meta tag.
5. `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin`.
6. `Permissions-Policy` denying camera, microphone, geolocation, and interest-cohort.

**Accepted risks, not defects.**

- localStorage is not encrypted. Anyone with access to the machine and the browser profile can
  read the stored resume. This is inherent to a no-account, no-server design, and the app
  provides the right mitigations: resume storage is opt-in, `Erase resume only` removes just
  that field, and backup export excludes the resume unless the box is ticked. It should stay
  that way.
- The six ATS vendors learn which boards a user reads (I4).
- `style-src 'unsafe-inline'` (I3).
- The sanitizer is verified against Blink. Firefox and WebKit have their own parser
  differences. The design does not depend on parser specifics, since nothing survives the
  rebuild, but the empirical verification is Chrome-only. Re-running the harness under another
  engine would close that gap cheaply.

---

## Verification

```
npx tsc -b        clean
npx vitest run    208 passed (5 files), of which 87 are the new security suite
npm run build     succeeds, CSP hash re-verified against dist/index.html
npm audit         0 vulnerabilities
gitleaks detect   no leaks
```

Plus, outside the automated suite: 68 XSS payloads through real headless Chrome with zero
executions, and the built app loaded under its own CSP with zero violations.

No existing test was weakened or removed. Two assertions in the new suite were rewritten
during the audit, from string matching to parsed-tree matching, for the reason in I1; that
made them stricter about what matters and stopped them failing on inert output.
