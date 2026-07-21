# Deploying Jobwatch

`npm run build` produces `dist/`, a plain static folder with no server-side component. Any
static host works, and so does opening `dist/index.html` from disk, because the build uses
relative asset paths.

## GitHub Pages

The fastest way to hand friends a link.

```bash
npm run build
npx gh-pages -d dist        # or commit dist/ to a gh-pages branch by hand
```

Then enable Pages for the repository, serving from the `gh-pages` branch. Because `base` is
`./`, the app works from a project subpath (`user.github.io/jobwatch/`) with no config
change.

## Response headers

The build injects a Content Security Policy as a `<meta>` tag, which covers script, style,
image, and connection sources. Three protections cannot be expressed in a meta tag and have
to be set as real response headers at the host. On GitHub Pages you cannot set headers, so
these are simply unavailable there. On Netlify, Cloudflare Pages, or Vercel, set them.

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()
Content-Security-Policy: frame-ancestors 'none'
```

`frame-ancestors 'none'` is the one that matters most: it stops the page being embedded in
someone else's site, which is the only clickjacking surface here. `X-Frame-Options: DENY` is
the older equivalent if the host does not accept a CSP header.

### Netlify

`public/_headers`, copied into `dist/` at build time:

```
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: frame-ancestors 'none'
  Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()
```

### Cloudflare Pages

Same `_headers` file format as Netlify.

## What the CSP allows, and why

`connect-src` is pinned to exactly six hosts, the job boards the app reads:

```
https://boards-api.greenhouse.io
https://api.lever.co
https://api.ashbyhq.com
https://api.smartrecruiters.com
https://apply.workable.com
https://*.recruitee.com
```

This is the deployment-level backstop for the product's central privacy claim. Application
code is checked at two layers already (a host allowlist in `src/lib/ats.ts` and token
validation before any URL is built), but code can have a bug. The CSP cannot: if anything in
the page ever tried to send data to an origin that is not one of those six, the browser
refuses the request outright. That includes the pasted resume.

Adding a seventh job board therefore means editing two places, `ALLOWED_HOSTS` in
`src/lib/ats.ts` and `CONNECT_SRC` in `vite.config.ts`. Editing only the first fails closed,
which is the correct direction to fail.

`default-src 'none'` means everything not named is denied, including `object-src`,
`frame-src`, and `form-action`. `script-src` is `'self'` plus a hash of the single inline
script that sets the theme before first paint. That hash is recomputed at build time from
the actual script body, so it cannot drift out of sync with what is on the page.

## Verifying a build

```bash
npm run build
npx vite preview
```

Then confirm in the browser devtools:

- **Network**: during a scan, every request goes to one of the six board hosts. There are no
  analytics, font, or telemetry requests, because there are none in the app.
- **Console**: no CSP violation reports.
- **Application, Local Storage**: the only keys are `jobwatch.v1.*`.

## Invariants that must not be broken

These are load-bearing. Changing one without a matching change elsewhere breaks a security
property rather than a feature. The reasoning behind each is in `docs/security-audit.md`.

- **Job description HTML reaches the DOM only through `sanitizeHtml()`.** That function is the
  only thing whose output should ever be passed to `dangerouslySetInnerHTML`. Its safety comes
  from rebuilding the tree from an allowlist, not from stripping bad parts, so "just let this
  one tag through" is a larger change than it looks.
- **`ALLOWED_HOSTS` and `CONNECT_SRC` stay in sync**, as described above.
- **`isValidToken()` keeps requiring an alphanumeric first character.** That, not
  `encodeURIComponent`, is what makes a `..` path segment unspellable: the alphabet permits
  dots, and `encodeURIComponent` is identity over every character the alphabet allows.
  Relaxing the first-character rule silently reopens path traversal.
- **Every outbound URL goes through `isAllowedUrl()`,** including the one a board redirects us
  to. Checking only the URL we sent leaves the redirect path unguarded.
- **`src/lib/storage.ts` gains no network write path.** There is none today, and the privacy
  claim depends on there continuing to be none.
- **Read paths never throw on malformed stored data.** There is no server-side reset, and the
  in-app Erase button sits behind the same page load that bad data would break.

## Updating the company catalog

`src/lib/catalog.ts` was generated by probing every candidate slug against the live board and
keeping only the ones that answered with real postings. If you add companies, verify them the
same way rather than guessing a slug, since a plausible-looking slug frequently belongs to a
different company with the same name.
