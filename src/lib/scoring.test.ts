/**
 * Tests for the fit engine. The promise the UI makes is "here is exactly why this scored
 * what it scored", so the arithmetic and the hit list have to agree, every time.
 */

import { describe, expect, it } from "vitest";
import {
  compileProfile, freshness, locationAllowed, scoreJob, workModeAllowed, workModeOf,
} from "./scoring";
import type { Job, Profile } from "./types";

const baseProfile: Profile = {
  resume: "",
  rememberResume: true,
  headline: "",
  targetTitles: ["product designer", "design technologist"],
  skills: ["figma", "rhino"],
  extraKeywords: [],
  exclude: ["unpaid"],
  locations: [],
  workModes: [],
  minScore: 3,
  seniority: "any",
};

function job(overrides: Partial<Job> = {}): Job {
  const title = overrides.title ?? "Product Designer";
  const body = overrides.haystack ?? "";
  return {
    id: "src:1",
    sourceId: "src",
    company: "Acme",
    title,
    location: "Austin, TX",
    postedAt: "2026-07-20",
    url: "https://example.com/1",
    department: null,
    descHtml: "",
    haystack: `${title}\n${body}`.toLowerCase(),
    ...overrides,
  };
}

const score = (j: Job, p: Profile = baseProfile) =>
  scoreJob(j, compileProfile(p), "2026-07-01T00:00:00Z", false);

describe("scoreJob", () => {
  it("weights a title match at 3 and a description-only match at 1", () => {
    expect(score(job({ title: "Product Designer" })).score).toBe(3);
    expect(score(job({ title: "Widget Wrangler", haystack: "widget wrangler\nproduct designer team" })).score).toBe(1);
  });

  it("weights bonus keywords at 1 in the title and 0.5 in the body", () => {
    expect(score(job({ title: "Figma Specialist" })).score).toBe(1);
    expect(score(job({ title: "Specialist", haystack: "specialist\nwe use figma daily" })).score).toBe(0.5);
  });

  it("counts each keyword once, at its best location", () => {
    const result = score(job({ title: "Product Designer", haystack: "product designer\nproduct designer again" }));
    expect(result.score).toBe(3);
    expect(result.hits.filter((h) => h.keyword === "product designer")).toHaveLength(1);
  });

  it("produces a hit list whose points sum to the score", () => {
    const result = score(job({ title: "Product Designer, Figma Platform", haystack: "we use rhino" }));
    const sum = result.hits.reduce((n, h) => n + h.points, 0);
    expect(sum).toBe(result.score);
  });

  it("matches on whole words only", () => {
    // "designer" must not fire inside "redesigner", and "rhino" must not fire in "rhinoplasty".
    const p: Profile = { ...baseProfile, targetTitles: ["designer"], skills: ["rhino"] };
    expect(score(job({ title: "Redesigner of Things" }), p).score).toBe(0);
    expect(score(job({ title: "Nurse", haystack: "nurse\nrhinoplasty clinic" }), p).score).toBe(0);
    expect(score(job({ title: "Designer" }), p).score).toBe(3);
  });

  it("handles keywords containing regex metacharacters", () => {
    const p: Profile = { ...baseProfile, targetTitles: ["c++", "node.js", "r&d"] };
    expect(score(job({ title: "C++ Engineer" }), p).score).toBe(3);
    expect(score(job({ title: "R&D Lead" }), p).score).toBe(3);
    // "node.js" must be a literal dot, not "any character".
    expect(score(job({ title: "nodexjs developer" }), p).score).toBe(0);
  });

  it("flags an excluded keyword without deleting the job", () => {
    const result = score(job({ title: "Product Designer", haystack: "product designer\nthis is an unpaid role" }));
    expect(result.vetoedBy).toBe("unpaid");
    expect(result.score).toBe(3);
  });

  it("reads seniority from the title", () => {
    expect(score(job({ title: "Senior Product Designer" })).seniority).toBe("senior");
    expect(score(job({ title: "Junior Product Designer" })).seniority).toBe("entry");
    expect(score(job({ title: "Product Designer" })).seniority).toBe("mid");
  });

  it("adjusts for early-career preference only when it is on", () => {
    const on: Profile = { ...baseProfile, seniority: "entry" };
    expect(score(job({ title: "Junior Product Designer" }), on).score).toBe(5);
    expect(score(job({ title: "Senior Product Designer" }), on).score).toBe(0);
    expect(score(job({ title: "Senior Product Designer" })).score).toBe(3);
  });

  it("never returns a negative score", () => {
    const on: Profile = { ...baseProfile, seniority: "entry" };
    expect(score(job({ title: "Senior Widget Lead" }), on).score).toBe(0);
  });

  it("bands relative to the user's own threshold", () => {
    expect(score(job({ title: "Product Designer" })).band).toBe("partial");
    const strict: Profile = { ...baseProfile, minScore: 1 };
    expect(score(job({ title: "Product Designer" }), strict).band).toBe("strong");
  });

  it("scores an empty profile at zero without throwing", () => {
    const blank: Profile = { ...baseProfile, targetTitles: [], skills: [], exclude: [], minScore: 0 };
    const result = score(job(), blank);
    expect(result.score).toBe(0);
    expect(result.hits).toEqual([]);
  });
});

describe("locationAllowed", () => {
  it("allows everything when no filter is set", () => {
    expect(locationAllowed("Berlin, Germany", [])).toBe(true);
  });

  it("matches on substring, case-insensitively", () => {
    expect(locationAllowed("Austin, TX", ["austin"])).toBe(true);
    expect(locationAllowed("Austin, TX", ["berlin"])).toBe(false);
  });

  it("treats remote loosely, because boards spell it a dozen ways", () => {
    for (const loc of ["Remote - US", "Anywhere", "Fully Distributed", "Work From Home"]) {
      expect(locationAllowed(loc, ["remote"])).toBe(true);
    }
  });

  it("does not exclude a posting that simply has no stated location", () => {
    expect(locationAllowed("", ["austin"])).toBe(true);
  });
});

describe("freshness", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  it("buckets by posting age", () => {
    expect(freshness({ postedAt: daysAgo(0) })).toBe("fresh");
    expect(freshness({ postedAt: daysAgo(7) })).toBe("fresh");
    expect(freshness({ postedAt: daysAgo(8) })).toBe("ok");
    expect(freshness({ postedAt: daysAgo(30) })).toBe("ok");
    expect(freshness({ postedAt: daysAgo(31) })).toBe("stale");
    expect(freshness({ postedAt: daysAgo(200) })).toBe("stale");
  });

  it("reports unknown rather than guessing when the board publishes no date", () => {
    expect(freshness({ postedAt: null })).toBe("unknown");
    expect(freshness({ postedAt: "not-a-date" })).toBe("unknown");
  });
});

describe("workMode", () => {
  const j = (location: string, haystack = "") => ({ location, haystack });

  it("reads the arrangement out of the location string", () => {
    expect(workModeOf(j("Remote - US"))).toBe("remote");
    expect(workModeOf(j("Hybrid, Berlin"))).toBe("hybrid");
    expect(workModeOf(j("Austin, TX"))).toBe("onsite");
  });

  it("prefers hybrid over remote when both words appear, since hybrid is the stricter claim", () => {
    expect(workModeOf(j("Hybrid remote, London"))).toBe("hybrid");
  });

  it("falls back to the body only when there is no location at all", () => {
    expect(workModeOf(j("", "this role is fully remote"))).toBe("remote");
    expect(workModeOf(j("", "no hints here"))).toBe("onsite");
  });

  it("allows everything when no preference is set", () => {
    expect(workModeAllowed(j("Austin, TX"), [])).toBe(true);
    expect(workModeAllowed(j("Remote"), [])).toBe(true);
  });

  it("filters to the chosen arrangements", () => {
    expect(workModeAllowed(j("Remote - US"), ["remote"])).toBe(true);
    expect(workModeAllowed(j("Austin, TX"), ["remote"])).toBe(false);
    expect(workModeAllowed(j("Austin, TX"), ["remote", "onsite"])).toBe(true);
  });
});

describe("seniority preference", () => {
  const at = (pref: Profile["seniority"], title: string) =>
    score(job({ title }), { ...baseProfile, seniority: pref });

  it("lifts interns hardest when aiming at an internship", () => {
    expect(at("intern", "Product Designer Intern").score).toBeGreaterThan(
      at("any", "Product Designer Intern").score,
    );
  });

  it("penalizes senior titles for an early-career search but keeps them on the board", () => {
    const result = at("entry", "Senior Product Designer");
    expect(result.score).toBeLessThan(at("any", "Senior Product Designer").score);
    expect(result.vetoedBy).toBeNull();
  });

  it("inverts the tilt for a senior search", () => {
    expect(at("senior", "Senior Product Designer").score).toBeGreaterThan(
      at("senior", "Junior Product Designer").score,
    );
  });

  it("leaves scores untouched at 'any'", () => {
    expect(at("any", "Senior Product Designer").score).toBe(at("any", "Product Designer").score);
  });
});
