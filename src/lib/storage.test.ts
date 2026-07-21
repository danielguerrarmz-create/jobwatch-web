/**
 * Tests for the one privacy control that has to be airtight: opting out of resume storage.
 *
 * The guarantee is enforced in `saveProfile` rather than at the call sites, so the thing
 * worth proving is that no caller can route around it. These tests write through the real
 * function and then read the raw localStorage value, because checking the returned object
 * would only prove the function is polite, not that nothing landed on disk.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { loadProfile, saveProfile } from "./storage";
import { EMPTY_PROFILE } from "./presets";
import type { Profile } from "./types";

const KEY = "jobwatch.v1.profile";
const RESUME = "DANIEL GUERRA\nAustin, TX\nArchitectural designer, graduating May 2026.";

const withResume = (over: Partial<Profile> = {}): Profile => ({
  ...EMPTY_PROFILE,
  resume: RESUME,
  skills: ["Rhino", "Grasshopper"],
  targetTitles: ["Design Technologist"],
  ...over,
});

const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "{}");

describe("resume storage opt-out", () => {
  beforeEach(() => localStorage.clear());

  it("writes the resume when the user has left storage on", () => {
    saveProfile(withResume({ rememberResume: true }));
    expect(stored().resume).toBe(RESUME);
  });

  it("writes no resume text at all when the user opted out", () => {
    saveProfile(withResume({ rememberResume: false }));
    expect(stored().resume).toBe("");
    // The whole serialized blob must not contain it, not merely the field we thought to clear.
    expect(localStorage.getItem(KEY)).not.toContain("GUERRA");
    expect(localStorage.getItem(KEY)).not.toContain("Austin");
  });

  it("keeps everything derived from the resume when the text is withheld", () => {
    saveProfile(withResume({ rememberResume: false }));
    const back = stored();
    expect(back.skills).toEqual(["Rhino", "Grasshopper"]);
    expect(back.targetTitles).toEqual(["Design Technologist"]);
    expect(back.rememberResume).toBe(false);
  });

  it("does not mutate the caller's profile object", () => {
    // The in-memory copy has to keep working for this session; only the write is stripped.
    const live = withResume({ rememberResume: false });
    saveProfile(live);
    expect(live.resume).toBe(RESUME);
  });

  it("survives a round trip and stays opted out", () => {
    saveProfile(withResume({ rememberResume: false }));
    const back = loadProfile(EMPTY_PROFILE);
    expect(back.resume).toBe("");
    expect(back.rememberResume).toBe(false);
  });

  it("defaults to remembering when an older stored profile predates the flag", () => {
    // Absent means an install from before this option existed, which was remembering.
    localStorage.setItem(KEY, JSON.stringify({ resume: RESUME, skills: [] }));
    expect(loadProfile(EMPTY_PROFILE).rememberResume).toBe(true);
    expect(loadProfile(EMPTY_PROFILE).resume).toBe(RESUME);
  });
});
