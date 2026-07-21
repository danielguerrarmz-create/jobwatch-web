/**
 * The trust boundary.
 *
 * Every job description we render came from a third-party ATS over the network. Some of
 * those boards let the hiring company paste arbitrary HTML into the posting body, so the
 * description must be treated as hostile input, not as markup we control.
 *
 * The rule enforced here: parse into an INERT document, then rebuild the tree from an
 * allowlist. Nothing survives that we did not explicitly permit. We rebuild rather than
 * strip because "remove the bad parts" loses to mutation-XSS; "copy only the known-good
 * parts into a fresh tree" does not.
 *
 * `DOMParser.parseFromString(s, "text/html")` produces a document with no browsing
 * context: scripts never execute, `<img>` never fetches, and event-handler attributes
 * never fire while we walk it. That is what makes inspecting the tree safe at all.
 */

/** Tags we keep, mapped to the tag we actually emit. Headings collapse so a posting cannot
 *  hijack the page's visual hierarchy. */
const ALLOWED_TAGS: Record<string, string> = {
  P: "p",
  BR: "br",
  UL: "ul",
  OL: "ol",
  LI: "li",
  STRONG: "strong",
  B: "strong",
  EM: "em",
  I: "em",
  H1: "h4",
  H2: "h4",
  H3: "h4",
  H4: "h4",
  H5: "h5",
  H6: "h5",
  BLOCKQUOTE: "blockquote",
  CODE: "code",
  PRE: "pre",
  HR: "hr",
  A: "a",
};

/** Dropped with their entire subtree. Everything else unknown is merely unwrapped. */
const NUKE_TAGS = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "APPLET", "FORM", "INPUT",
  "BUTTON", "SELECT", "TEXTAREA", "LINK", "META", "BASE", "SVG", "MATH",
  "TEMPLATE", "NOSCRIPT", "AUDIO", "VIDEO", "SOURCE", "TRACK", "IMG", "CANVAS",
  "PORTAL", "FRAME", "FRAMESET",
]);

/** Guard against a posting nesting a thousand divs to lock up the render. */
const MAX_DEPTH = 20;
const MAX_NODES = 4000;

/** Longest description we will hand to the parser. MAX_NODES bounds the tree we walk, but
 *  parsing happens first and is the expensive half, so the string has to be cut before
 *  DOMParser ever sees it. A posting past half a megabyte is not a posting. */
const MAX_INPUT = 512 * 1024;

/** No real apply link is anywhere near this long. */
const MAX_URL = 4096;

/**
 * Validate a URL for use in `href`. Returns the normalized absolute URL, or null.
 *
 * Uses the URL parser rather than a regex on purpose: the parser normalizes away the
 * tricks (`java\tscript:`, leading control characters, percent-encoding) that defeat
 * string matching. Only http and https are allowed out, so `javascript:`, `data:`, and
 * `blob:` are all rejected by the same check.
 */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_URL) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Some boards (Greenhouse in particular) return the description entity-encoded, so the
 * payload literally contains `&lt;p&gt;`. Decode exactly one layer, and only when the
 * string has no real tags, so we never double-decode an already-live document into
 * markup the author did not write.
 */
function decodeOnce(input: string): string {
  if (input.includes("<")) return input;
  if (!input.includes("&lt;") && !input.includes("&amp;")) return input;
  const doc = new DOMParser().parseFromString(`<body>${input}</body>`, "text/html");
  return doc.body.textContent ?? "";
}

/** Rebuild `node`'s children into `out`, copying only allowlisted structure. */
function rebuild(node: Node, out: Node, doc: Document, depth: number, budget: { n: number }): void {
  if (depth > MAX_DEPTH) return;

  for (const child of Array.from(node.childNodes)) {
    if (budget.n++ > MAX_NODES) return;

    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(doc.createTextNode(child.nodeValue ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue; // comments, PIs, CDATA: gone

    const el = child as Element;
    const tag = el.tagName.toUpperCase();

    if (NUKE_TAGS.has(tag)) continue; // subtree dropped entirely

    const mapped = ALLOWED_TAGS[tag];
    if (!mapped) {
      // Unknown but harmless container (div, span, table...): keep the words, drop the box.
      rebuild(el, out, doc, depth + 1, budget);
      continue;
    }

    const fresh = doc.createElement(mapped);

    // `href` is the ONLY attribute that survives, and only after protocol validation.
    if (mapped === "a") {
      const href = safeUrl(el.getAttribute("href"));
      if (!href) {
        // A link we will not trust becomes plain text rather than a dead or hostile anchor.
        rebuild(el, out, doc, depth + 1, budget);
        continue;
      }
      fresh.setAttribute("href", href);
      fresh.setAttribute("target", "_blank");
      fresh.setAttribute("rel", "noopener noreferrer nofollow");
    }

    rebuild(el, fresh, doc, depth + 1, budget);
    out.appendChild(fresh);
  }
}

/**
 * Turn an untrusted description into an HTML fragment that is safe to inject.
 *
 * The output contains only the tags in ALLOWED_TAGS and, at most, a validated http(s)
 * `href`. No attributes, no event handlers, no styles, no embedded content.
 */
export function sanitizeHtml(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const source = decodeOnce(raw.slice(0, MAX_INPUT));
  const parsed = new DOMParser().parseFromString(`<body>${source}</body>`, "text/html");
  const out = parsed.implementation.createHTMLDocument("out");
  rebuild(parsed.body, out.body, out, 0, { n: 0 });
  return out.body.innerHTML;
}

/** Flatten untrusted markup to plain text. Used for the keyword haystack and for any
 *  field (title, location, company) that we render as text rather than markup. */
export function toText(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  const source = decodeOnce(raw.slice(0, MAX_INPUT));
  const doc = new DOMParser().parseFromString(`<body>${source}</body>`, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Clamp a network-supplied plain string: flattened, trimmed, and length-capped so a
 *  hostile board cannot blow out the layout with a 2MB job title. */
export function safeField(raw: unknown, max = 300): string {
  return toText(raw).slice(0, max);
}
