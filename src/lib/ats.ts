/**
 * ATS adapters.
 *
 * Each supported applicant-tracking system publishes its customers' open roles on a
 * public, unauthenticated JSON endpoint that answers with `Access-Control-Allow-Origin: *`.
 * That single fact is what lets Jobwatch be a static page: the browser talks to the job
 * boards directly, so there is no server, no API key, and nothing to pay for.
 *
 * Every adapter's job is to turn one board's payload into `Job[]`. Adapters never trust
 * the payload: every string that reaches the UI goes through sanitize.ts first, and every
 * link is protocol-validated. A board that returns garbage should produce a failed source,
 * never a broken page.
 */

import type { AtsKind, Job, Source } from "./types";
import { safeField, safeUrl, sanitizeHtml, toText } from "./sanitize";

/** Hosts we are willing to talk to. Also mirrored in the CSP `connect-src` in index.html,
 *  so adding one here without adding it there will simply fail closed. */
export const ALLOWED_HOSTS = new Set([
  "boards-api.greenhouse.io",
  "api.lever.co",
  "api.ashbyhq.com",
  "api.smartrecruiters.com",
  "apply.workable.com",
]);

/** Recruitee is per-tenant (`{token}.recruitee.com`), so it needs a suffix rule. */
const ALLOWED_HOST_SUFFIXES = ["recruitee.com"];

/**
 * Does `host` equal `domain`, or is it a subdomain of it?
 *
 * The naive version of this check is `host.endsWith(domain)`, which also accepts
 * `notgreenhouse.io` and `greenhouse.io.attacker.test`. Matching has to happen on a dot
 * boundary or the allowlist is decorative.
 */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function hostAllowed(host: string): boolean {
  return ALLOWED_HOSTS.has(host) || ALLOWED_HOST_SUFFIXES.some((d) => hostMatches(host, d));
}

/** The single question every outbound URL has to answer, whether it is one we built or one a
 *  board redirected us to. */
export function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && hostAllowed(u.hostname);
  } catch {
    return false;
  }
}

export class FetchError extends Error {}

/** Tokens are interpolated into URLs, so they are constrained to a slug alphabet. This is
 *  the check that stops a pasted "token" from redirecting a request somewhere else. */
export function isValidToken(token: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(token);
}

const TIMEOUT_MS = 20_000;
/** Cap on how much of a response we will parse, so one enormous board cannot wedge the tab. */
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Read a body with the cap applied *while* reading.
 *
 * `await res.text()` buffers the entire payload before its size can be measured, which is
 * precisely what the cap exists to prevent: a board answering with a gigabyte would take the
 * tab down before the check ever ran. Streaming lets us hang up the moment it gets absurd.
 */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader?.();
  if (!reader) {
    // No readable stream available. Still bounded by the request timeout, so this is a
    // weaker guarantee rather than none.
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new FetchError("response too large");
    return text;
  }
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new FetchError("response too large");
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const parsed = new URL(url);
  if (!isAllowedUrl(parsed.toString())) {
    throw new FetchError(`blocked host: ${parsed.hostname}`);
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const onOuterAbort = () => ctl.abort();
  signal?.addEventListener("abort", onOuterAbort);

  try {
    const res = await fetch(parsed.toString(), {
      signal: ctl.signal,
      // No cookies, no auth: these are public endpoints and we want no ambient authority.
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`);
    // `redirect: "follow"` means the host we vetted is not necessarily the host that
    // answered. Checking only the URL we sent would let any allowlisted board launder an
    // attacker-chosen origin past the allowlist with a 302.
    if (res.url && !isAllowedUrl(res.url)) throw new FetchError("board redirected off-domain");

    const text = await readCapped(res);
    try {
      return JSON.parse(text);
    } catch {
      throw new FetchError("board did not return JSON");
    }
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if ((err as Error)?.name === "AbortError") throw new FetchError("timed out");
    // A CORS rejection or a DNS failure both land here as an opaque TypeError.
    throw new FetchError("could not reach the board (offline, or the board blocked us)");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

/* ------------------------------------------------------------------ helpers */

/** ISO date (`YYYY-MM-DD`) from anything a board might call a timestamp. */
function isoDate(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number") {
    const d = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Assemble a normalized Job, doing the sanitizing in exactly one place. */
function makeJob(source: Source, raw: {
  remoteId: unknown;
  title: unknown;
  company?: unknown;
  location?: unknown;
  department?: unknown;
  url?: unknown;
  postedAt?: unknown;
  html?: unknown;
}): Job | null {
  const title = safeField(raw.title, 200);
  const remoteId = String(raw.remoteId ?? "").slice(0, 120);
  if (!title || !remoteId) return null;

  const descHtml = sanitizeHtml(raw.html);
  const location = safeField(raw.location, 160);
  const department = safeField(raw.department, 120) || null;

  return {
    id: `${source.id}:${remoteId}`,
    sourceId: source.id,
    company: safeField(raw.company, 120) || source.name,
    title,
    location,
    department,
    postedAt: isoDate(raw.postedAt),
    url: safeUrl(raw.url),
    descHtml,
    // The haystack is plain text so keyword matching can never be fooled by markup
    // splitting a phrase (`<b>design</b> technologist`).
    haystack: `${title}\n${department ?? ""}\n${toText(raw.html)}`.toLowerCase(),
  };
}

/* ----------------------------------------------------------------- adapters */

type Adapter = (source: Source, signal?: AbortSignal) => Promise<Job[]>;

const greenhouse: Adapter = async (source, signal) => {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.token)}/jobs?content=true`;
  const data = rec(await getJson(url, signal));
  return arr(data.jobs)
    .map((j) => {
      const job = rec(j);
      return makeJob(source, {
        remoteId: job.id,
        title: job.title,
        company: job.company_name,
        location: rec(job.location).name,
        department: rec(arr(job.departments)[0]).name,
        url: job.absolute_url,
        postedAt: job.first_published ?? job.updated_at,
        html: job.content,
      });
    })
    .filter((j): j is Job => j !== null);
};

const lever: Adapter = async (source, signal) => {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(source.token)}?mode=json`;
  const data = await getJson(url, signal);
  return arr(data)
    .map((j) => {
      const job = rec(j);
      const cats = rec(job.categories);
      // Lever splits the body across `description` and a `lists` array of bullet blocks.
      const lists = arr(job.lists)
        .map((l) => {
          const li = rec(l);
          return `<h4>${String(li.text ?? "")}</h4>${String(li.content ?? "")}`;
        })
        .join("");
      return makeJob(source, {
        remoteId: job.id,
        title: job.text,
        location: cats.location ?? arr(cats.allLocations).join(", "),
        department: cats.department ?? cats.team,
        url: job.hostedUrl ?? job.applyUrl,
        postedAt: job.createdAt,
        html: `${String(job.description ?? "")}${lists}${String(job.additional ?? "")}`,
      });
    })
    .filter((j): j is Job => j !== null);
};

const ashby: Adapter = async (source, signal) => {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.token)}?includeCompensation=false`;
  const data = rec(await getJson(url, signal));
  return arr(data.jobs)
    .filter((j) => rec(j).isListed !== false)
    .map((j) => {
      const job = rec(j);
      return makeJob(source, {
        remoteId: job.id,
        title: job.title,
        location: job.location,
        department: job.department ?? job.team,
        url: job.jobUrl ?? job.applyUrl,
        postedAt: job.publishedAt,
        html: job.descriptionHtml ?? job.descriptionPlain,
      });
    })
    .filter((j): j is Job => j !== null);
};

const smartrecruiters: Adapter = async (source, signal) => {
  // This board pages, and the list view carries no description, so we score SmartRecruiters
  // roles on title/department/location and pull the body lazily when a card is opened.
  const out: Job[] = [];
  const PAGE = 100;
  for (let offset = 0; offset < 500; offset += PAGE) {
    const url =
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.token)}` +
      `/postings?limit=${PAGE}&offset=${offset}`;
    const data = rec(await getJson(url, signal));
    const page = arr(data.content);
    for (const j of page) {
      const job = rec(j);
      const loc = rec(job.location);
      const built = makeJob(source, {
        remoteId: job.id,
        title: job.name,
        company: rec(job.company).name,
        location: [loc.city, loc.region, loc.country].filter(Boolean).join(", "),
        department: rec(job.department).label,
        url: job.postingUrl ?? job.applyUrl ??
          `https://jobs.smartrecruiters.com/${encodeURIComponent(source.token)}/${encodeURIComponent(String(job.id ?? ""))}`,
        postedAt: job.releasedDate,
        html: "",
      });
      if (built) out.push(built);
    }
    if (page.length < PAGE) break;
  }
  return out;
};

const workable: Adapter = async (source, signal) => {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(source.token)}?details=true`;
  const data = rec(await getJson(url, signal));
  const company = safeField(data.name, 120) || source.name;
  return arr(data.jobs)
    .map((j) => {
      const job = rec(j);
      const loc = rec(job.location);
      return makeJob(source, {
        remoteId: job.shortcode ?? job.id,
        title: job.title,
        company,
        location: [loc.city, loc.region, loc.country].filter(Boolean).join(", ") || job.location,
        department: job.department,
        url: job.url ?? job.application_url,
        postedAt: job.published_on ?? job.created_at,
        html: job.description ?? "",
      });
    })
    .filter((j): j is Job => j !== null);
};

const recruitee: Adapter = async (source, signal) => {
  const url = `https://${encodeURIComponent(source.token)}.recruitee.com/api/offers/`;
  const data = rec(await getJson(url, signal));
  return arr(data.offers)
    .map((j) => {
      const job = rec(j);
      return makeJob(source, {
        remoteId: job.id,
        title: job.title,
        location: [job.city, job.country].filter(Boolean).join(", "),
        department: job.department,
        url: job.careers_url ?? job.careers_apply_url,
        postedAt: job.published_at ?? job.created_at,
        html: `${String(job.description ?? "")}${String(job.requirements ?? "")}`,
      });
    })
    .filter((j): j is Job => j !== null);
};

const ADAPTERS: Record<AtsKind, Adapter> = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workable,
  recruitee,
};

/** Fetch one source. Throws `FetchError` with a human-readable reason on failure. */
export function fetchSource(source: Source, signal?: AbortSignal): Promise<Job[]> {
  if (!isValidToken(source.token)) {
    return Promise.reject(new FetchError("invalid company token"));
  }
  const adapter = ADAPTERS[source.kind];
  if (!adapter) return Promise.reject(new FetchError(`unsupported board: ${source.kind}`));
  return adapter(source, signal);
}

/**
 * Lazily pull a SmartRecruiters description. The list feed omits it, and fetching one per
 * role up front would mean hundreds of extra requests for text nobody has read yet.
 */
export async function fetchDetailHtml(job: Job, source: Source, signal?: AbortSignal): Promise<string> {
  if (source.kind !== "smartrecruiters") return job.descHtml;
  // Second entry point to the network, so it repeats the gate rather than trusting that
  // whoever built this Source went through `fetchSource` first.
  if (!isValidToken(source.token)) throw new FetchError("invalid company token");
  const remoteId = job.id.slice(source.id.length + 1);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(remoteId)) return "";
  const url =
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.token)}` +
    `/postings/${encodeURIComponent(remoteId)}`;
  const data = rec(await getJson(url, signal));
  const sections = rec(rec(data.jobAd).sections);
  return ["companyDescription", "jobDescription", "qualifications", "additionalInformation"]
    .map((k) => sanitizeHtml(rec(sections[k]).text))
    .filter(Boolean)
    .join("");
}

/* ------------------------------------------------------- URL auto-detection */

/**
 * Turn a pasted careers-page URL into a source. This is how a user adds any company we did
 * not ship in the catalog, and it is deliberately the only way to add one: we derive the
 * board and token from a recognized host rather than letting anyone type a raw URL to fetch.
 */
export function detectSource(input: string): { kind: AtsKind; token: string } | null {
  const raw = input.trim();
  if (!raw) return null;

  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const first = parts[0] ?? "";

  const ok = (kind: AtsKind, token: string) =>
    token && isValidToken(token) ? { kind, token } : null;

  // boards.greenhouse.io/acme · job-boards.greenhouse.io/acme/jobs/1 · boards-api…/v1/boards/acme
  if (hostMatches(host, "greenhouse.io")) {
    const idx = parts.indexOf("boards");
    return ok("greenhouse", idx >= 0 ? parts[idx + 1] ?? "" : first);
  }
  // jobs.lever.co/acme · jobs.eu.lever.co/acme
  if (hostMatches(host, "lever.co")) return ok("lever", first);
  // jobs.ashbyhq.com/acme · acme.ashbyhq.com
  if (hostMatches(host, "ashbyhq.com")) {
    if (host !== "ashbyhq.com" && host !== "jobs.ashbyhq.com" && host !== "api.ashbyhq.com") {
      return ok("ashby", host.split(".")[0]);
    }
    return ok("ashby", first);
  }
  // jobs.smartrecruiters.com/acme · careers.smartrecruiters.com/acme
  if (hostMatches(host, "smartrecruiters.com")) return ok("smartrecruiters", first);
  // acme.workable.com · apply.workable.com/acme
  if (hostMatches(host, "workable.com")) {
    if (host === "apply.workable.com" || host === "www.workable.com" || host === "workable.com") {
      const idx = parts.indexOf("accounts");
      return ok("workable", idx >= 0 ? parts[idx + 1] ?? "" : first);
    }
    return ok("workable", host.split(".")[0]);
  }
  // acme.recruitee.com
  if (hostMatches(host, "recruitee.com") && host !== "recruitee.com") {
    return ok("recruitee", host.split(".")[0]);
  }
  return null;
}

/** Human label for a board, used in the source manager. */
export const ATS_LABEL: Record<AtsKind, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
  recruitee: "Recruitee",
};
