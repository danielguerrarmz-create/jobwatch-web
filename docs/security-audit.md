# Jobwatch security audit

Date: 2026-07-21
Scope: everything under `src/`, plus `index.html`, `vite.config.ts`, `vitest.config.ts`, `package.json`, and the built `dist/`.
Verdict: **ship**, with the host-level notes in [Residual risk](#residual-risk).

Findings: 0 critical, 0 high, 5 medium, 8 low, 6 informational, 19 in total. Thirteen are fixed
in code. Six are in files owned by the concurrent profile and discovery rewrite and are written
up as concrete fixes to apply (section "Findings in the profile and discovery rewrite"). Three
are host configuration or inherent to the design and are listed under residual risk.

Two appendices answer the questions asked directly: **Appendix A** is the full risk analysis
for storing a resume in localStorage, and **Appendix B** is the ReDoS pattern guidance for the
resume parser.

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

### Findings in the profile and discovery rewrite

These landed after the first pass and are in files owned by the rewrite, so they are written
as concrete fixes to apply rather than applied directly. None is a vulnerability in the
exploitable sense; N1 is the one that matters.

#### N1. "Search by name" broadcasts the typed employer to all six ATS vendors (medium, disclosure)
`src/lib/discover.ts`, `src/components/AddCompany.tsx`

`discoverCompany()` turns a typed name into slug variants and probes every board with them.
The security properties are fine: every probe goes through `fetchSource()`, so
`isValidToken()` and the host allowlist both still apply, and the file's claim that it "adds
no new network surface" is accurate. No new origin is reachable.

What *is* new is what leaves the device. Searching "Mount Sinai" sends
`GET /v1/boards/mountsinai/jobs` to Greenhouse, `/v0/postings/mountsinai` to Lever, and the
same guess to Ashby, and to SmartRecruiters, Workable, and Recruitee if the first three miss.
Five of those six vendors have nothing to do with that employer, and each one learns that some
IP is interested in it. A normal scan only talks to boards the user has chosen to follow;
discovery broadcasts an intent signal to everyone.

Low sensitivity in isolation. It matters because it interacts with the privacy claim: the
onboarding lede now says "the only thing that leaves is the request to each company's own job
board", and with this feature that is no longer precisely true.

Fix, two parts.

1. In `AddCompany`, the "Search by name" hint gains one sentence:
   > Searching checks all six job-board systems, so the name you type is sent to each of them
   > as a lookup. Pasting a link instead only contacts the one board that link points to.
2. The onboarding lede clause becomes:
   > The only thing that leaves is the request to the job boards themselves, the same request
   > your browser would make if you opened those careers pages yourself.

That wording stays true whether the request comes from a scan or from a name search.

#### N2. No ceiling on keyword count (low)
`src/components/TagEditor.tsx`, `src/lib/scoring.ts`

`TagEditor.add()` splits a paste on commas and caps each item at 120 characters, but never
caps how many items exist. `compileProfile()` then builds one `RegExp` per keyword and
`scoreJob()` runs all of them against every posting. `strList()` caps at 400 on *load*, so the
store self-heals on reload, but the in-memory profile drives the scan for the rest of the
session.

The realistic trigger is not an attack, it is someone pasting their resume into the skills
chip box by mistake. That box splits on commas, so a resume becomes hundreds of chips
immediately.

Fix, at the chokepoint that protects the scan no matter how keywords got there. In
`scoring.ts`:

```ts
/** Ceiling on compiled keywords. Matches the cap `strList` applies on load, so an in-memory
 *  profile cannot outrun what the store would have kept anyway. */
const MAX_KEYWORDS = 400;

function compile(keywords: string[]): CompiledKeyword[] {
  // ... unchanged loop ...
    if (out.length >= MAX_KEYWORDS) break;   // add at the end of the loop body
```

Worth also capping in `TagEditor.add()` so the UI does not silently accept chips the matcher
will ignore:

```ts
if (additions.length) {
  onChange([...values, ...additions.map((a) => a.slice(0, 120))].slice(0, 400));
}
```

#### N3. No ceiling on pasted links (low)
`src/components/AddCompany.tsx`

`addLinks()` splits on `/[\n,\s]+/` with no cap, so a large paste can create thousands of
sources. `loadSources()` caps at 1000 on load, so again it self-heals on reload, but until
then every one of them is a request on the next scan.

Fix: `const lines = links.split(/[\n,\s]+/).map((l) => l.trim()).filter(Boolean).slice(0, 200);`
and mention the cap in the note if anything was dropped.

#### N4. A discovery probe pages five times to answer a yes/no question (low)
`src/lib/discover.ts`, `src/lib/ats.ts`

`probe()` calls `fetchSource()`, and the SmartRecruiters adapter loops up to five pages of 100.
Discovery only needs to know whether the board answers with any roles at all. Worst case a
single search issues roughly 40 requests rather than the 24 the concurrency comment implies.

Fix: give the adapter a first-page-only mode for probes, either an optional `limitPages`
argument threaded through `fetchSource`, or have `probe()` stop reading after the first page.
Politeness, not security, but this feature fires at six third parties on a keypress and the
cost should be the one the code claims.

#### N5. The resume is described as opt-in storage, and it is not (informational)
`src/lib/types.ts`

The `resume` field comment says "Storing it is opt-in and clearable on its own." The second
half is true. The first is not: typing or pasting into the textarea updates profile state,
and `App.tsx` persists profile to localStorage on every change, so the resume is written the
moment it is pasted. There is no separate consent step.

This is a comment that will be read as a guarantee by the next person to touch the file.
Either reword to match behavior:

> Pasting it stores it. It is clearable on its own, and excluded from exports unless the user
> ticks the box.

or implement the stronger version, which is the better product answer and is described in
Appendix A: a "use it for this session only" toggle that keeps the resume in React state and
never calls `saveProfile` with it.

#### N6. The export object URL is revoked before the download is guaranteed to start (informational)
`src/components/Settings.tsx`

`download()` calls `URL.revokeObjectURL(url)` on the line after `a.click()`. Chrome tolerates
this for a synchronous click, but it is a known race in other engines and produces a silently
empty or failed download. Fix: `setTimeout(() => URL.revokeObjectURL(url), 30_000);`

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

## Appendix A: storing a resume, and every risk it creates

The resume is the most sensitive thing this app will ever hold: name, contact details, address
in many cases, and a full employment history. It is stored in localStorage in plain text. This
appendix is the complete list of ways that can go wrong, what already handles each one, and
what I want added.

### A1. It raises the cost of any XSS from annoying to severe

Before the resume, script execution in the page leaked which jobs someone had saved. Now it
leaks a complete identity document. Nothing about the sanitizer changed, but its *value*
changed, and that should govern how future edits to it are reviewed. "Let this one tag
through" is now a decision about PII.

Already handled: the sanitizer was verified against 68 payloads in real Chrome (see above).

Worth stating explicitly because it is unusually strong and easy to erode: **the CSP is the
second line, and it specifically blocks exfiltration.** Even granting a hypothetical script
execution, `connect-src` limits `fetch`/`XHR`/`sendBeacon` to the board hosts, `img-src 'self'
data:` blocks the classic tracking-pixel exfil, `form-action 'none'` blocks form POST, and
`default-src 'none'` closes the rest. An attacker who won the XSS would still struggle to get
the resume off the machine. That property is worth more than it looks and it dies the moment
anyone adds a wildcard to `connect-src` or an analytics script.

**Invariant: never widen `connect-src`, never add `unsafe-inline` to `script-src`, never add
analytics.**

### A2. Browser extensions can read it, and nothing in the app can stop that

Any extension with host permissions on the origin reads localStorage directly. Grammar and
writing assistants are the realistic case, because a resume textarea is exactly what they
attach to. This is unmitigable in application code and therefore has to be disclosed rather
than fixed.

Current copy says "anyone with access to this browser profile can read it", which is close.
**Recommend naming extensions**, since that is the likely reader and most people do not think
of an extension as "access to this browser profile":

> Anyone with access to this browser profile can read it, including browser extensions you
> have installed.

### A3. Browser spellcheck would have sent it to a remote service, and the code already prevents that

Both resume textareas set `spellCheck={false}`. This is doing real privacy work, not styling:
Chrome's enhanced spellcheck sends typed text to Google, and several grammar extensions do the
same. Someone will eventually "fix" this to restore red squiggles.

**Invariant: `spellCheck={false}` stays on the resume textareas.** Added to the invariants list
in `docs/deploy.md`. Consider `autoComplete="off"` alongside it.

### A4. Shared, borrowed, and public machines

The resume persists indefinitely with no expiry. Someone who tries the app on a library or
work machine leaves their resume behind unless they know to erase it.

Already handled well: an explicit "Erase resume only" button that keeps the rest of the setup,
plus honest copy warning about browser-profile access.

**This is the one addition I actually want.** A session-only option:

> [ ] Do not store my resume, use it for this session only

Implemented by keeping the resume in React state and having the persistence effect write
`{ ...profile, resume: "" }` when the flag is set. It is a small change and it converts "you
should have known to click Erase" into a decision the user made up front. It also makes the
`types.ts` comment in N5 true instead of aspirational.

### A5. Export files

Handled correctly, and this is the part I would have expected to be wrong. `exportAll()`
defaults `includeResume` to false, blanks the field unless the box is ticked, and records
`resumeIncluded` in the file so the file is self-describing. The reasoning in the code comment
(a backup gets emailed and synced to cloud drives) is exactly right.

One residual: an export *with* the resume is an unencrypted file in the Downloads folder. The
checkbox copy already warns. Acceptable.

### A6. Anything reaching the network

Verified none, three ways. There is one `fetch` call site in the codebase, and its URL is built
from a hardcoded host plus a validated token. There is no `sendBeacon`, `XMLHttpRequest`,
`WebSocket`, `EventSource`, `new Image`, or dynamic `import()`. There is **no `console.*` call
anywhere in `src/`**, so the resume is never even written to a log that a screen recording or a
support request could capture; `extract.ts` states that as a rule and the codebase honors it.
The regression test `sends nothing about the user beyond which company is being read` pins the
exact request shape.

This was independently confirmed in a real browser by the team lead: with a resume stored, a
full scan issued 18 requests, all GET, all to allowed board hosts, no request bodies and no
user data in any query string, and no telemetry requests of any kind.

**Invariant: `src/lib/storage.ts` gains no network write path, and nothing logs profile
fields.**

### A7. Two things people will ask that are not risks

Chrome profile sync does not sync localStorage, so the resume does not silently replicate to
other devices through the browser account. And the resume never reaches the scoring haystack
or any request; only keywords the user explicitly confirmed from the suggestions do, and those
are words like "Figma", not resume text.

### A8. New in this rewrite

Opening the app now auto-scans for a returning user, so simply opening the tab contacts every
followed board without an explicit action. That is correct for a product called "watch" and is
not a defect, but it belongs in the privacy explanation, because "I only opened it" and "I
scanned" are the same event now.

---

## Appendix B: ReDoS, and the pattern classes to ban

`extract.ts` is already clean. I reviewed every regex in it and every loop that drives one, and
found no catastrophic backtracking: all quantifiers are bounded (`{0,29}`, `{1,2}`, `{0,30}`,
`{1,3}`) or single-character optionals, there is no quantifier nested inside a quantified
group, alternations are over literals with no repetition wrapped around them, and no pattern is
ever compiled from resume text. The header comment already commits to these rules. The one real
bug was the loop guard in N/L4, which was a bound on the wrong quantity rather than a regex
problem, and it is fixed.

This is guidance for keeping it that way.

### Ban outright

1. **A quantifier inside a quantified group.** `(a+)+`, `(a*)*`, `(\w+\s*)*`, `(\s*\w+)+`.
   This is the classic, and it is exponential.
2. **Alternation with overlapping branches under a quantifier.** `(a|ab)+`, `(\d|\d\d)+`. The
   engine has to try every split of the same text.
3. **Adjacent unbounded quantifiers over overlapping character classes.** `\s*\s*`, `.*.*`,
   `\d+\d*`, `[a-z]+[a-z0-9]*`. Ambiguity about which one consumes what is the backtracking.
4. **Unbounded `.*` or `[\s\S]*` anywhere in a pattern applied to pasted text**, especially
   between two things that can both match the same characters.
5. **Any regex built from user data without escaping.** If a pattern must be constructed, it
   must go through the escape both `scoring.ts` and `extract.ts` already use:
   `replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`. Compiling raw user text is both ReDoS and a
   correctness bug.
6. **Backreferences and variable-length lookbehind over unbounded spans.** They defeat the
   linear-time optimizations engines apply to simpler patterns.

### Require

1. **Bounded quantifiers.** `{0,40}` rather than `*`, always, on anything scanning pasted text.
   `[^.\n]{0,40}` is the right shape when a match has to span a few words.
2. **Cap the input before the regex, not after.** `MAX_INPUT` is applied by `extractFromResume`
   before anything scans. Keep that ordering; a cap after the scan protects nothing.
3. **In a `while ((m = re.exec(text)) !== null)` loop, count iterations, not results.** This is
   exactly what N/L4 got wrong. Any `continue` before the counter increments makes the guard
   unreachable.
4. **Never let a `/g` pattern match zero characters.** A zero-width match does not advance
   `lastIndex`, so the loop spins forever. Every current pattern is safe because each is built
   around a non-empty literal; a future `\b\w*\b` would hang the tab. If a pattern can match
   empty, advance `lastIndex` manually.
5. **Prefer tokenize-once-then-walk-an-array over one large regex.** `extractTitles()` already
   does this, walking backward through at most two modifier tokens. It is linear, it cannot
   backtrack, and each rejection rule is a readable line instead of a branch buried in a
   pattern. This is the pattern to copy for any new extraction.

### Enforce with a test, not a review

Prose rules decay. `src/lib/security.test.ts` now contains ten adversarial 200k-character
pastes (one long unbroken word, repeated `5+ years` claims, year claims that are all discarded,
ranges, repeated titles, dense vocabulary hits, whitespace and punctuation, title-gap
characters, possessive role nouns, and unicode dashes), each asserting `extractFromResume`
finishes in under two seconds with bounded output. A new pattern from any of the banned classes
will fail these rather than reaching a user as a frozen tab. Add a case whenever a regex is
added.

There is also a test asserting evidence snippets stay short and do not carry a phone number
out of the resume, since suggestions are rendered in the UI and can end up in a screenshot.

---

## Verification

```
npx tsc -b        clean
npx vitest run    220 passed (5 files), of which 101 are the new security suite
npm run build     succeeds, CSP hash re-verified against dist/index.html
npm audit         0 vulnerabilities
gitleaks detect   no leaks
```

Plus, outside the automated suite: 68 XSS payloads through real headless Chrome with zero
executions, and the built app loaded under its own CSP with zero violations.

No existing test was weakened or removed. Two assertions in the new suite were rewritten
during the audit, from string matching to parsed-tree matching, for the reason in I1; that
made them stricter about what matters and stopped them failing on inert output.
