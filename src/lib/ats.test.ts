/**
 * Tests for the second half of the trust boundary: what we are willing to *request*.
 *
 * `detectSource` turns text a user pastes into a URL the app will fetch, and `isValidToken`
 * guards the interpolation. Between them they are the reason a pasted string cannot aim a
 * request at a host of the attacker's choosing.
 */

import { describe, expect, it } from "vitest";
import { detectSource, isValidToken } from "./ats";

describe("isValidToken", () => {
  it("accepts real board slugs", () => {
    expect(isValidToken("anthropic")).toBe(true);
    expect(isValidToken("peak-design")).toBe(true);
    expect(isValidToken("dbt_labs")).toBe(true);
    expect(isValidToken("acme.co")).toBe(true);
  });

  it("rejects anything that could escape the path segment it is interpolated into", () => {
    expect(isValidToken("../../v1/other")).toBe(false);
    expect(isValidToken("acme/jobs")).toBe(false);
    expect(isValidToken("acme?x=1")).toBe(false);
    expect(isValidToken("acme#frag")).toBe(false);
    expect(isValidToken("acme@evil.test")).toBe(false);
    expect(isValidToken("evil.test:8080")).toBe(false);
    expect(isValidToken("acme%2f..")).toBe(false);
    expect(isValidToken("")).toBe(false);
    expect(isValidToken(".hidden")).toBe(false);
    expect(isValidToken("a".repeat(200))).toBe(false);
  });
});

describe("detectSource", () => {
  it("reads a Greenhouse board from either host shape", () => {
    expect(detectSource("https://boards.greenhouse.io/anthropic")).toEqual({
      kind: "greenhouse", token: "anthropic",
    });
    expect(detectSource("https://job-boards.greenhouse.io/figma/jobs/12345")).toEqual({
      kind: "greenhouse", token: "figma",
    });
    expect(detectSource("https://boards-api.greenhouse.io/v1/boards/stripe/jobs")).toEqual({
      kind: "greenhouse", token: "stripe",
    });
  });

  it("reads Lever, including the EU host", () => {
    expect(detectSource("https://jobs.lever.co/spotify")).toEqual({ kind: "lever", token: "spotify" });
    expect(detectSource("https://jobs.eu.lever.co/acme/some-role")).toEqual({ kind: "lever", token: "acme" });
  });

  it("reads Ashby from both the path form and the subdomain form", () => {
    expect(detectSource("https://jobs.ashbyhq.com/notion")).toEqual({ kind: "ashby", token: "notion" });
    expect(detectSource("https://openai.ashbyhq.com/")).toEqual({ kind: "ashby", token: "openai" });
  });

  it("reads SmartRecruiters, Workable, and Recruitee", () => {
    expect(detectSource("https://jobs.smartrecruiters.com/Canva")).toEqual({
      kind: "smartrecruiters", token: "Canva",
    });
    expect(detectSource("https://apply.workable.com/accounts/hotjar")).toEqual({
      kind: "workable", token: "hotjar",
    });
    expect(detectSource("https://acme.recruitee.com/o/role")).toEqual({
      kind: "recruitee", token: "acme",
    });
  });

  it("tolerates a bare host with no scheme, which is what people actually paste", () => {
    expect(detectSource("jobs.lever.co/spotify")).toEqual({ kind: "lever", token: "spotify" });
    expect(detectSource("  boards.greenhouse.io/figma  ")).toEqual({ kind: "greenhouse", token: "figma" });
  });

  it("refuses hosts that merely look like a supported board", () => {
    // Suffix matching is on a dot boundary, so an attacker-controlled domain that merely
    // ends in the same letters is not accepted.
    expect(detectSource("https://greenhouse.io.evil.test/acme")).toBeNull();
    expect(detectSource("https://notgreenhouse.io/acme")).toBeNull();
    expect(detectSource("https://evil.test/boards.greenhouse.io/acme")).toBeNull();
    expect(detectSource("https://lever.co.attacker.test/acme")).toBeNull();
  });

  it("refuses unsupported boards and junk", () => {
    expect(detectSource("https://careers.google.com/jobs")).toBeNull();
    expect(detectSource("https://www.linkedin.com/jobs/view/123")).toBeNull();
    expect(detectSource("javascript:alert(1)")).toBeNull();
    expect(detectSource("")).toBeNull();
    expect(detectSource("   ")).toBeNull();
    expect(detectSource("not a url at all")).toBeNull();
  });

  it("refuses a supported host with no company in the path", () => {
    expect(detectSource("https://boards.greenhouse.io/")).toBeNull();
    expect(detectSource("https://jobs.lever.co")).toBeNull();
  });
});
