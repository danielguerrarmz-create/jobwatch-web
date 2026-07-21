/**
 * Adversarial tests. These are written from the attacker's side, not the feature's.
 *
 * The three questions they exist to answer:
 *   1. Can a hiring company's job description run script in the reader's tab?
 *   2. Can anything make the app send a request to an origin we did not choose?
 *   3. Can anything the user stores, or imports, corrupt the app or leak off the device?
 *
 * A note on the environment. These run under happy-dom, whose HTML parser is not Blink and
 * does not reproduce every foreign-content and raw-text quirk that mutation XSS depends on.
 * The XSS corpus below was therefore *also* run through real headless Chrome against a
 * bundled copy of sanitize.ts, injected with `innerHTML` into a live document, with every
 * payload calling a global that records execution: 68 payloads, zero executions, zero
 * disallowed tags, zero disallowed attributes. Treat the cases here as the regression net
 * and `docs/security-audit.md` as the record of the browser run.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { safeUrl, sanitizeHtml, toText } from "./sanitize";
import { FetchError, fetchDetailHtml, fetchSource, isAllowedUrl, isValidToken } from "./ats";
import { importAll, loadSeen, loadSources } from "./storage";
import type { Job, Source } from "./types";

/* ------------------------------------------------------------------ helpers */

const ALLOWED_TAGS = new Set([
  "P", "BR", "UL", "OL", "LI", "STRONG", "EM", "H4", "H5", "BLOCKQUOTE", "CODE", "PRE", "HR", "A",
]);
const ALLOWED_ATTRS = new Set(["href", "target", "rel"]);

/** Re-parse sanitizer output the way the browser will when React injects it, then report
 *  anything present that the allowlist does not permit. Checking the string with a regex
 *  would miss exactly the class of bug that matters: markup that only appears once the
 *  serialized output is parsed a second time. */
function violations(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const found: string[] = [];
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const tag = el.tagName.toUpperCase();
    if (!ALLOWED_TAGS.has(tag)) found.push(`tag:${tag}`);
    for (const attr of Array.from(el.attributes)) {
      if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) found.push(`attr:${tag}[${attr.name}]`);
    }
    if (tag === "A") {
      const href = el.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) found.push(`href:${href}`);
    }
  }
  return found;
}

function source(over: Partial<Source> = {}): Source {
  return {
    id: "greenhouse:acme",
    kind: "greenhouse",
    token: "acme",
    name: "Acme",
    pack: "custom",
    enabled: true,
    ...over,
  };
}

/** A stub shaped like the parts of `Response` that ats.ts touches. */
function response(body: string, over: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
    text: () => Promise.resolve(body),
    body: null,
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

/* --------------------------------------------------------- 1. hostile markup */

describe("sanitizeHtml against payloads that beat naive sanitizers", () => {
  // Every entry is a real published bypass shape. The `xss(n)` calls are inert markers: if
  // one ever survives into the output, the assertion below catches the element, not the call.
  const payloads: Array<[string, string]> = [
    ["svg style img", '<svg><style><img src=x onerror=xss(1)></style></svg>'],
    ["svg p style a", '<svg></p><style><a id="</style><img src=1 onerror=xss(2)>">'],
    ["math mtext mglyph", '<math><mtext><table><mglyph><style><!--</style><img src=x onerror=xss(3)>'],
    ["form math mglyph", '<form><math><mtext></form><form><mglyph><style></math><img src onerror=xss(4)>'],
    ["svg foreignObject", '<svg><foreignObject><p><script>xss(5)</script></p></foreignObject></svg>'],
    ["svg desc cdata", '<svg><desc><![CDATA[</desc><img src=x onerror=xss(6)>]]></desc></svg>'],
    ["annotation-xml", '<math><annotation-xml encoding="text/html"><p><img src=x onerror=xss(7)></p></annotation-xml></math>'],
    ["svg image href", '<table><td><svg><image href=x onerror=xss(8)></svg>'],
    ["svg animate href", '<svg><a><animate attributeName=href values=javascript:xss(9) /><text>go</text></a></svg>'],
    ["noscript title", '<noscript><p title="</noscript><img src=x onerror=xss(10)>">'],
    ["template script", '<template><script>xss(11)</script></template>'],
    ["template unclosed", '<template><p title="</template><img src=x onerror=xss(12)>">'],
    ["xmp breakout", '<xmp><p title="</xmp><img src=x onerror=xss(13)>">'],
    ["listing", '<listing><img src=x onerror=xss(14)></listing>'],
    ["plaintext", '<plaintext><img src=x onerror=xss(15)>'],
    ["title rcdata", '<title><img src=x onerror=xss(16)></title>'],
    ["textarea", '<textarea><img src=x onerror=xss(17)></textarea>'],
    ["iframe breakout", '<iframe><p title="</iframe><img src=x onerror=xss(18)>">'],
    ["noembed", '<noembed><img src=x onerror=xss(19)></noembed>'],
    ["noframes", '<noframes><img src=x onerror=xss(20)></noframes>'],
    ["script inside pre", '<pre><script>xss(21)</script></pre>'],
    ["slash instead of space", '<p/onclick=xss(22)>x</p>'],
    ["conditional comment", '<!--[if IE]><script>xss(23)</script><![endif]-->'],
    ["cdata", '<p><![CDATA[<img src=x onerror=xss(24)>]]></p>'],
    ["font face breakout", '<font face="<img src=x onerror=xss(25)>">x</font>'],
    ["unclosed quoted attr", '<p title="x><img src=x onerror=xss(26)>'],
    ["marquee onstart", '<marquee onstart=xss(27)>x</marquee>'],
    ["base then relative href", '<base href="javascript:"><a href="xss(28)">x</a>'],
    ["form action", '<form action="javascript:xss(29)"><button>go</button></form>'],
    ["custom element handler", '<x-evil onclick=xss(30)>hi</x-evil>'],
    ["entity encoded svg", "&lt;svg onload=xss(31)&gt;"],
    ["entity encoded img", "&lt;img src=x onerror=xss(32)&gt;"],
    ["double entity encoded", "&amp;lt;img src=x onerror=xss(33)&amp;gt;"],
    ["entity encoded js anchor", "&lt;a href=&quot;javascript:xss(34)&quot;&gt;x&lt;/a&gt;"],
    ["numeric entity", "&#60;img src=x onerror=xss(35)&#62;"],
    ["hex entity", "&#x3C;img src=x onerror=xss(36)&#x3E;"],
    ["live markup plus entities", "<p>&lt;script&gt;xss(37)&lt;/script&gt;</p>"],
  ];

  it.each(payloads)("emits nothing outside the allowlist: %s", (_name, payload) => {
    expect(violations(sanitizeHtml(payload))).toEqual([]);
  });

  it("never emits a live event handler or a script-bearing scheme", () => {
    // Asserted against the parsed tree, not the string. A double-entity-encoded payload
    // legitimately comes back as the *escaped text* `&lt;img ... onerror=...&gt;`, which
    // contains the characters "onerror=" while being nothing but words on a page. The
    // question that matters is whether an element ever carries the handler.
    for (const [, payload] of payloads) {
      const out = sanitizeHtml(payload);
      const doc = new DOMParser().parseFromString(`<body>${out}</body>`, "text/html");
      for (const el of Array.from(doc.body.querySelectorAll("*"))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name.toLowerCase()).not.toMatch(/^on/);
          expect(attr.value.toLowerCase()).not.toContain("javascript:");
        }
      }
      expect(doc.querySelector("script")).toBeNull();
      expect(out.toLowerCase()).not.toContain("<script");
    }
  });

  it("only ever removes on a second pass, never resurrects", () => {
    // Re-sanitizing is not something the app does, but if the output of one pass could
    // become live markup in the next, the fragment was not inert to begin with.
    for (const [, payload] of payloads) {
      const once = sanitizeHtml(payload);
      expect(violations(sanitizeHtml(once))).toEqual([]);
    }
  });

  it("caps how much markup it will parse at all", () => {
    // The node and depth budgets bound the walk, but parsing happens first, so an
    // unbounded string would be an unbounded parse before any budget applied.
    const huge = `<p>${"a".repeat(3_000_000)}</p>`;
    const started = Date.now();
    const out = sanitizeHtml(huge);
    expect(out.length).toBeLessThan(600_000);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("bounds a deeply nested posting instead of blowing the stack", () => {
    const deep = "<div>".repeat(50_000) + "core" + "</div>".repeat(50_000);
    expect(() => sanitizeHtml(deep)).not.toThrow();
  });

  it("produces inert text fields, which is the only way the app uses them", () => {
    // `toText` strips live markup, but a double-encoded payload decodes into a string that
    // *reads* like a tag while being text. That is safe here only because every consumer
    // renders it in a React text position, which escapes it. This test pins that property
    // rather than the weaker "contains no angle bracket", so it still fails loudly if
    // someone ever routes a text field into markup.
    for (const [, payload] of payloads) {
      const host = document.createElement("div");
      host.textContent = toText(payload);
      expect(host.querySelectorAll("*")).toHaveLength(0);
    }
    expect(toText("<script>steal()</script><b>Designer</b>")).toBe("steal()Designer");
    expect(toText("<img src=x onerror=steal()>Designer")).toBe("Designer");
  });
});

describe("safeUrl protocol bypasses", () => {
  const blocked = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "JAVASCRIPT:alert(1)",
    "java\nscript:alert(1)",
    "java\tscript:alert(1)",
    "java\rscript:alert(1)",
    "java script:alert(1)",
    "  javascript:alert(1)",
    "javascript:alert(1)",
    "jav​ascript:alert(1)",
    "ｊavascript:alert(1)",
    "%6Aavascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "blob:https://example.com/uuid",
    "file:///etc/passwd",
    "about:blank",
    "chrome://settings",
    "intent://x#Intent;scheme=http;end",
    "//evil.test/",
    "\\\\evil.test\\share",
  ];

  it.each(blocked)("rejects %s", (raw) => {
    expect(safeUrl(raw)).toBeNull();
  });

  it("refuses an absurdly long href rather than parsing it", () => {
    expect(safeUrl(`https://ok.test/${"a".repeat(50_000)}`)).toBeNull();
  });

  it("normalizes quotes and angle brackets out of the URLs it does accept", () => {
    // If either survived into the attribute, the serialize-then-reparse step is where an
    // href would grow a second attribute.
    const out = safeUrl('https://ok.test/a"><img src=x>');
    expect(out).not.toBeNull();
    expect(out).not.toContain('"');
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
  });
});

/* -------------------------------------------------------- 2. outbound requests */

describe("the outbound allowlist", () => {
  it("matches hosts on a dot boundary, not a suffix", () => {
    expect(isAllowedUrl("https://boards-api.greenhouse.io/x")).toBe(true);
    expect(isAllowedUrl("https://acme.recruitee.com/api/offers/")).toBe(true);
    expect(isAllowedUrl("https://recruitee.com/api/offers/")).toBe(true);

    expect(isAllowedUrl("https://evilrecruitee.com/x")).toBe(false);
    expect(isAllowedUrl("https://recruitee.com.evil.test/x")).toBe(false);
    expect(isAllowedUrl("https://notgreenhouse.io/x")).toBe(false);
    expect(isAllowedUrl("https://boards-api.greenhouse.io.evil.test/x")).toBe(false);
  });

  it("refuses plaintext http and credential-prefixed hosts", () => {
    expect(isAllowedUrl("http://boards-api.greenhouse.io/x")).toBe(false);
    expect(isAllowedUrl("https://boards-api.greenhouse.io@evil.test/x")).toBe(false);
    expect(isAllowedUrl("https://evil.test/#boards-api.greenhouse.io")).toBe(false);
    expect(isAllowedUrl("not a url")).toBe(false);
  });

  it("rejects tokens that could escape the path segment they land in", () => {
    // The alphabet permits dots, so the thing that actually closes traversal is the
    // requirement that the first character be alphanumeric: `..` and `.` cannot be spelled.
    expect(isValidToken("..")).toBe(false);
    expect(isValidToken(".")).toBe(false);
    expect(isValidToken("../..")).toBe(false);
    expect(isValidToken("./x")).toBe(false);
    expect(isValidToken("a/../../v1/other")).toBe(false);
    expect(isValidToken("a%2f..")).toBe(false);
    expect(isValidToken("a@evil.test")).toBe(false);
    expect(isValidToken("a:8080")).toBe(false);
    expect(isValidToken("a?x=1")).toBe(false);
    expect(isValidToken("a\\..")).toBe(false);
    expect(isValidToken("a\nb")).toBe(false);
  });

  it("cannot leave the tenant domain even with a dotted token", () => {
    // Recruitee tokens are interpolated into the *host*, and dots are legal in the alphabet,
    // so this is the case where a token most plausibly escapes.
    expect(isValidToken("evil.test")).toBe(true);
    expect(isAllowedUrl("https://evil.test.recruitee.com/api/offers/")).toBe(true);
    expect(isAllowedUrl("https://evil.test/api/offers/")).toBe(false);
  });

  it("never calls fetch for a source whose token was tampered with", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSource(source({ token: "../../evil" }))).rejects.toBeInstanceOf(FetchError);
    await expect(
      fetchDetailHtml({ id: "x", descHtml: "" } as Job, source({ kind: "smartrecruiters", token: "a b" })),
    ).rejects.toBeInstanceOf(FetchError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a board that redirects the request off-domain", async () => {
    // CORS plus the CSP would both have to fail for this to matter, but the app-layer
    // allowlist is worthless if it only inspects the URL we sent and not the one that answered.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response("[]", { url: "https://evil.test/collected" }))),
    );
    await expect(fetchSource(source())).rejects.toThrow(/redirected off-domain/);
  });

  it("accepts a redirect that stays inside the allowlist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(response('{"jobs":[]}', { url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs" })),
      ),
    );
    await expect(fetchSource(source())).resolves.toEqual([]);
  });

  it("hangs up on an oversized body instead of buffering it first", async () => {
    // A 12MB cap applied after `await res.text()` is not a cap, it is a post-mortem.
    const chunk = new TextEncoder().encode("x".repeat(1024 * 1024));
    let sent = 0;
    const cancel = vi.fn(() => Promise.resolve());
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          response("", {
            body: {
              getReader: () => ({
                read: () => Promise.resolve(sent++ < 64 ? { done: false, value: chunk } : { done: true }),
                cancel,
              }),
            },
          }),
        ),
      ),
    );

    await expect(fetchSource(source())).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalled();
    // Stopped at the cap rather than reading all 64MB the board was willing to send.
    expect(sent).toBeLessThanOrEqual(13);
  });

  it("sends nothing about the user beyond which company is being read", async () => {
    // The product's whole claim. If a keyword, a saved id, or a cookie ever rides along on
    // one of these requests, that claim is false and this test is how we find out.
    const fetchMock = vi.fn(() => Promise.resolve(response('{"jobs":[]}')));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSource(source());

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true");
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.body).toBeUndefined();
    expect(Object.keys(init.headers as object)).toEqual(["Accept"]);
  });
});

/* ---------------------------------------------- 3. hostile payloads and stores */

describe("hostile board payloads", () => {
  it("does not let a board reach Object.prototype", async () => {
    const hostile = JSON.stringify({
      jobs: [
        {
          id: 1,
          title: "Designer",
          __proto__: { polluted: "yes" },
          constructor: { prototype: { polluted: "yes" } },
          location: { name: "Austin", __proto__: { polluted: "yes" } },
          departments: [{ name: "Design" }],
          content: "<p>ok</p>",
        },
      ],
      __proto__: { polluted: "yes" },
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response(hostile))));

    const jobs = await fetchSource(source());

    expect(jobs).toHaveLength(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("drops a script-bearing apply link rather than rendering it", async () => {
    const hostile = JSON.stringify({
      jobs: [
        {
          id: 2,
          title: "<img src=x onerror=xss(1)>Designer",
          absolute_url: "javascript:steal()",
          content: '<p onclick="steal()">Body</p><script>steal()</script>',
          location: { name: "<b>Austin</b>" },
        },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response(hostile))));

    const [job] = await fetchSource(source());

    expect(job.url).toBeNull();
    expect(job.title).not.toContain("<");
    expect(job.location).toBe("Austin");
    expect(violations(job.descHtml)).toEqual([]);
    expect(job.descHtml).not.toContain("onclick");
  });

  it("survives a board that answers with the wrong shapes entirely", async () => {
    for (const payload of ['{"jobs":"not an array"}', "[]", "null", '{"jobs":[null,1,"x",[]]}', '{"jobs":[{}]}']) {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response(payload))));
      await expect(fetchSource(source())).resolves.toBeInstanceOf(Array);
    }
  });

  it("reports a non-JSON body as a failed source rather than throwing something raw", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response("<html>maintenance</html>"))));
    await expect(fetchSource(source())).rejects.toBeInstanceOf(FetchError);
  });
});

describe("localStorage as untrusted input", () => {
  it("keeps a __proto__ key in the seen ledger out of Object.prototype", () => {
    localStorage.setItem(
      "jobwatch.v1.seen",
      '{"__proto__":"2026-01-01","constructor":"2026-01-01","greenhouse:acme:1":"2026-01-01"}',
    );
    const seen = loadSeen();

    expect(({} as Record<string, unknown>).length).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)["2026-01-01"]).toBeUndefined();
    expect(Object.getPrototypeOf(seen)).toBeNull();
    expect(seen["greenhouse:acme:1"]).toBe("2026-01-01");
  });

  it("refuses a hand-edited source that would aim a fetch somewhere else", () => {
    localStorage.setItem(
      "jobwatch.v1.sources",
      JSON.stringify([
        { kind: "greenhouse", token: "../../../evil", name: "x", pack: "custom", enabled: true },
        { kind: "greenhouse", token: "acme@evil.test", name: "x", pack: "custom", enabled: true },
        { kind: "wormhole", token: "acme", name: "x", pack: "custom", enabled: true },
        { kind: "recruitee", token: "legit", name: "Legit", pack: "custom", enabled: true },
      ]),
    );
    const sources = loadSources();

    expect(sources?.map((s) => s.token)).toEqual(["legit"]);
  });

  it("bounds the seen ledger on read, not only on write", () => {
    // `saveSeen` caps what this app writes, but a restored backup or a hand-edited store
    // has never been through `saveSeen`. This is read on every page load.
    const huge: Record<string, string> = {};
    for (let i = 0; i < 60_000; i += 1) huge[`greenhouse:acme:${i}`] = "2026-01-01";
    localStorage.setItem("jobwatch.v1.seen", JSON.stringify(huge));

    expect(Object.keys(loadSeen()).length).toBeLessThanOrEqual(40_000);
  });

  it("does not throw on any malformed store, because a throw here is an unrecoverable page", () => {
    // There is no server-side reset. If a bad blob can make the load path throw, the only
    // fix left to a non-technical user is clearing site data by hand.
    for (const junk of ["not json", "[]", "null", "0", '"a string"', '{"a":{"b":1}}']) {
      localStorage.setItem("jobwatch.v1.seen", junk);
      localStorage.setItem("jobwatch.v1.sources", junk);
      expect(() => loadSeen()).not.toThrow();
      expect(() => loadSources()).not.toThrow();
    }
  });
});

describe("importing a backup someone else wrote", () => {
  it("refuses a file that is not a Jobwatch backup instead of reloading into nothing", () => {
    expect(importAll("not json")).toBe(false);
    expect(importAll("[]")).toBe(false);
    expect(importAll("null")).toBe(false);
    expect(importAll('"a string"')).toBe(false);
    expect(importAll("{}")).toBe(false);
    expect(importAll('{"somethingElse":1}')).toBe(false);
  });

  it("refuses a file too large to be anyone's job search", () => {
    expect(importAll(`{"seen":{"a":"${"x".repeat(20 * 1024 * 1024)}"}}`)).toBe(false);
  });

  it("does not store a seen ledger big enough to hang the next load", () => {
    // Import writes and then reloads, so an unbounded blob here would be re-read on every
    // visit from then on, with the settings screen that could undo it behind that same load.
    const huge: Record<string, string> = {};
    for (let i = 0; i < 60_000; i += 1) huge[`greenhouse:acme:${i}`] = "2026-01-01";

    expect(importAll(JSON.stringify({ seen: huge }))).toBe(true);
    expect(Object.keys(loadSeen()).length).toBeLessThanOrEqual(40_000);
  });

  it("does not let an imported file put a wrong-typed blob into the store", () => {
    expect(
      importAll(JSON.stringify({ profile: "hijacked", sources: "hijacked", saved: { a: 1 }, meta: [] })),
    ).toBe(false);
    expect(localStorage.getItem("jobwatch.v1.profile")).toBeNull();
    expect(localStorage.getItem("jobwatch.v1.sources")).toBeNull();
    expect(localStorage.getItem("jobwatch.v1.saved")).toBeNull();
    expect(localStorage.getItem("jobwatch.v1.meta")).toBeNull();
  });

  it("still cannot smuggle a fetchable token in through a backup", () => {
    expect(
      importAll(
        JSON.stringify({
          sources: [{ kind: "greenhouse", token: "../../evil", name: "x", pack: "custom", enabled: true }],
        }),
      ),
    ).toBe(true);
    expect(loadSources()).toEqual([]);
  });

  it("keeps an imported __proto__ key off Object.prototype", () => {
    expect(importAll('{"seen":{"__proto__":"2026-01-01"}}')).toBe(true);
    const seen = loadSeen();
    expect(Object.getPrototypeOf(seen)).toBeNull();
    expect(({} as Record<string, unknown>)["2026-01-01"]).toBeUndefined();
  });
});
