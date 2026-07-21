<div align="center">
  <img src="brand/logo-lockup.svg" alt="Jobwatch" width="220">
  <p><strong>Job postings read straight from the source. Your resume and keywords never leave your machine.</strong></p>
</div>

---

Jobwatch fetches live postings directly from the applicant tracking systems companies
actually use. No job-board reposts, no expired listings pretending to be open. Every match
is scored against your own keywords with plain, visible logic, so you can always see exactly
why something ranked where it did. Your profile, your resume, your saved jobs, and your
history all stay in your browser. The only thing that leaves is the request to each
company's own job board, exactly as if you had opened their careers page yourself.

## Why this exists

General job boards are adversarial by construction: SEO farming, reposted listings, and
ghost jobs kept up to collect leads. Jobwatch skips the boards and reads the one place a
posting cannot be faked, the company's own hiring system. Then it diffs what it sees against
last time and tells you what actually changed.

## What makes it unusual

**There is no server.** Jobwatch is a static page. The six applicant tracking systems it
reads all publish their customers' open roles on public endpoints that permit cross-origin
requests, so your browser talks to them directly. That is the whole architecture, and it is
why there is no account to make, no API key to get, no bill, and no company in the middle
holding your job search.

**The matching is not a model.** Every point a role scores traces to a specific keyword in a
specific place, and the app shows you the list. When something ranks wrong you can read why
and fix it in one click. A relevance score you cannot interrogate is worse than none,
because you stop trusting it and go back to scrolling.

**Your resume never moves.** Paste it in and Jobwatch reads it locally to suggest which
titles and skills to match on. It is stored in your browser only, can be erased on its own,
and is left out of backup exports unless you tick a box.

## Try it

**[danielguerrarmz-create.github.io/jobwatch-web](https://danielguerrarmz-create.github.io/jobwatch-web/)**

Or run it yourself:

```bash
npm install
npm run dev          # http://localhost:5173
```

Setup is four steps, all of them skippable and all of them editable afterwards in Settings:
pick a track, paste your resume, confirm the keywords, choose which companies to watch.
Then scan.

## Supported job boards

| Board | Coverage |
|---|---|
| Greenhouse | Very common at US startups and scaleups |
| Lever | Common at mid-size tech |
| Ashby | Common at newer, fast-growing startups |
| SmartRecruiters | Common at larger enterprises |
| Workable | Common in Europe and at SMBs |
| Recruitee | Common in Europe |

The catalog that ships is a starting point, not the boundary. **Type any employer name and
Jobwatch goes looking for their job board** across all six systems, then shows you the
company name and a few real openings so you can confirm it found the right one before adding
it. If you already have the careers page open, paste the link instead. Either way it works
for any industry, not just the ones in the catalog.

Companies on Workday, Taleo, iCIMS, or a bespoke careers page cannot be read, because those
do not expose a public cross-origin endpoint. There is no workaround that keeps the app
serverless, so they are simply out of scope rather than half-supported.

## Deploying your own copy

```bash
npm run build        # writes dist/
```

`dist/` is a plain static folder. Host it anywhere: GitHub Pages, Netlify, Cloudflare Pages,
or a local file. The build injects a strict Content Security Policy that pins network access
to the six job boards and nothing else. See [`docs/deploy.md`](docs/deploy.md) for the
response headers to set at the host, and [`docs/security-audit.md`](docs/security-audit.md)
for the threat model and audit.

## Project layout

```
brand/            identity, tokens, and logo (tokens.css is imported by the app)
src/lib/
  ats.ts          the six board adapters, host allowlist, careers-URL detection
  sanitize.ts     the trust boundary: untrusted posting HTML in, safe fragment out
  scoring.ts      the keyword matcher and the fit bands
  extract.ts      offline resume parsing
  catalog.ts      the verified company list
  storage.ts      localStorage persistence and validation
  runner.ts       the scan: fetch, dedupe, score, diff against what was seen before
src/components/   the UI
docs/             deployment and security
```

## Tests

```bash
npm test
```

The suite concentrates on the two places where being wrong is expensive: the HTML sanitizer
that renders third-party posting bodies, and the URL handling that decides what the app is
willing to request.

## License

MIT.
