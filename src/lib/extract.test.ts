/**
 * Tests for the resume reader. Two things have to hold at once here: the suggestions have
 * to be good enough that a real resume produces a usable profile, and the parser has to
 * survive whatever someone pastes into it, including 100k characters of nothing.
 */

import { describe, expect, it } from "vitest";
import { extractFromResume, SKILL_VOCABULARY } from "./extract";
import type { Suggestion } from "./extract";

const values = (list: Suggestion[]) => list.map((s) => s.value);
const countOf = (list: Suggestion[], value: string) =>
  list.find((s) => s.value === value)?.count ?? 0;

const THIS_YEAR = new Date().getFullYear();

const SOFTWARE_RESUME = `JORDAN MARSH
Senior Software Engineer

SUMMARY
Backend engineer with 7 years of experience building distributed systems.

EXPERIENCE
Senior Software Engineer, Northwind (2021 to present)
Led migration of a Ruby on Rails monolith to Node.js microservices on Kubernetes.
Owned the CI/CD pipeline with GitHub Actions, Docker, and Terraform.
Partnered with product managers and designers on API design.

Software Engineer, Bitwise Labs (2019 to 2021)
Built REST API endpoints in Python and Django against PostgreSQL.
Wrote unit testing and integration testing suites with Pytest and Playwright.

SKILLS
TypeScript, Python, Kubernetes, Terraform, Redis, GraphQL`;

const DESIGN_RESUME = `ALEX RIVERA
Product Designer

Product designer with 4 years of experience shipping consumer mobile apps.

EXPERIENCE
Product Designer, Lumen Health (2023 to present)
Owned the design systems work in Figma and cut component drift across three squads.
Ran user research and usability testing with forty participants.
Partnered with engineers on accessibility and WCAG compliance.

UX Designer, Kettle (2022 to 2023)
Built wireframing and prototyping flows, and shipped a Webflow marketing site.

SKILLS
Figma, Sketch, After Effects, interaction design, information architecture`;

const AEC_RESUME = `MARISOL GUERRA
Computational Design Intern

EDUCATION
Bachelor of Architecture, University of Texas at Austin, graduating May ${THIS_YEAR}

EXPERIENCE
Computational Design Intern, Forsite Studio
Wrote Grasshopper definitions and Python scripts to automate Revit sheet setup.
Built a parametric facade study in Rhino and ran daylight analysis with Ladybug.

Architectural Designer, studio elective
Produced construction documents and schematic design packages.

SKILLS
Rhino, Grasshopper, Revit, Dynamo, BIM, parametric modeling, generative design`;

describe("titles", () => {
  it("ranks the software engineer's own title first and collapses the seniority prefix", () => {
    const { titles } = extractFromResume(SOFTWARE_RESUME);
    expect(titles[0].value).toBe("Software Engineer");
    // Header, senior role, and prior role all collapse onto one suggestion.
    expect(titles[0].count).toBe(3);
    expect(values(titles)).toContain("Backend Engineer");
    expect(values(titles)).not.toContain("Senior Software Engineer");
  });

  it("reads the designer's roles including the acronym form", () => {
    const { titles } = extractFromResume(DESIGN_RESUME);
    expect(titles[0].value).toBe("Product Designer");
    expect(titles[0].count).toBe(3);
    expect(values(titles)).toContain("UX Designer");
  });

  it("reads a computational design resume", () => {
    const { titles } = extractFromResume(AEC_RESUME);
    expect(values(titles)).toContain("Computational Design Intern");
    expect(values(titles)).toContain("Architectural Designer");
    expect(countOf(titles, "Computational Design Intern")).toBe(2);
  });

  it("takes at most two modifiers in front of the role noun", () => {
    const { titles } = extractFromResume("Senior Staff Machine Learning Engineer");
    expect(values(titles)).toEqual(["Machine Learning Engineer"]);
  });

  it("ignores a generic plural, a possessive, and an uppercased-nothing", () => {
    const noise = [
      "Worked with engineers to ship the release.",
      "Reviewed the designer's mockups before handoff.",
      "Several developers joined mid sprint.",
      "as a designer i kept the scope tight",
    ].join("\n");
    expect(extractFromResume(noise).titles).toEqual([]);
  });

  it("requires a qualifier before a level-only role noun", () => {
    expect(values(extractFromResume("Intern").titles)).toEqual([]);
    expect(values(extractFromResume("Design Intern").titles)).toEqual(["Design Intern"]);
  });

  it("does not stitch a title across a comma or a line break", () => {
    const { titles } = extractFromResume("Marketing, Designer\nProduct\nManager");
    expect(values(titles)).toEqual(["Designer", "Manager"]);
  });

  it("keeps a bare capitalized role noun but drops the lowercase one", () => {
    expect(values(extractFromResume("Designer").titles)).toEqual(["Designer"]);
    expect(values(extractFromResume("i am a designer").titles)).toEqual([]);
  });
});

describe("skills", () => {
  it("finds the software stack and preserves canonical casing", () => {
    const { skills } = extractFromResume(SOFTWARE_RESUME);
    const found = values(skills);
    for (const expected of [
      "TypeScript", "Python", "Kubernetes", "Terraform", "Docker", "GitHub Actions",
      "CI/CD", "Node.js", "Ruby on Rails", "PostgreSQL", "Django", "REST API",
      "Pytest", "Playwright", "Unit testing", "Integration testing", "Distributed systems",
    ]) {
      expect(found).toContain(expected);
    }
  });

  it("normalizes lowercase input to the vocabulary spelling", () => {
    const { skills } = extractFromResume("i use figma, typescript, and postgresql daily");
    expect(values(skills)).toEqual(expect.arrayContaining(["Figma", "TypeScript", "PostgreSQL"]));
  });

  it("finds design tools and methods", () => {
    const found = values(extractFromResume(DESIGN_RESUME).skills);
    for (const expected of [
      "Figma", "Sketch", "After Effects", "Webflow", "Design systems", "User research",
      "Usability testing", "Accessibility", "WCAG", "Wireframing", "Prototyping",
      "Interaction design", "Information architecture",
    ]) {
      expect(found).toContain(expected);
    }
  });

  it("finds architecture and computational design tools", () => {
    const found = values(extractFromResume(AEC_RESUME).skills);
    for (const expected of [
      "Rhino", "Grasshopper", "Revit", "Dynamo", "BIM", "Python", "Ladybug",
      "Parametric modeling", "Generative design", "Daylight analysis",
      "Construction documents", "Schematic design",
    ]) {
      expect(found).toContain(expected);
    }
  });

  it("handles terms made of regex metacharacters", () => {
    const text = "Built services in C++, C#, and .NET alongside Node.js. Ran R&D on CI/CD and A/B testing.";
    const found = values(extractFromResume(text).skills);
    for (const expected of ["C++", "C#", ".NET", "Node.js", "R&D", "CI/CD", "A/B testing"]) {
      expect(found).toContain(expected);
    }
  });

  it("matches on word boundaries, so no term hides inside a longer word", () => {
    const found = values(extractFromResume("Shipped JavaScript through GitHub.").skills);
    expect(found).toContain("JavaScript");
    expect(found).toContain("GitHub");
    // "Java" and "Git" are both real vocabulary terms, and neither is present here.
    expect(found).not.toContain("Java");
    expect(found).not.toContain("Git");
    expect(values(extractFromResume("Wrote Java and used Git.").skills)).toEqual(
      expect.arrayContaining(["Java", "Git"]),
    );
  });

  it("counts repeats and ranks by frequency", () => {
    const { skills } = extractFromResume("Figma. Figma. Figma. Sketch.");
    expect(skills[0]).toMatchObject({ value: "Figma", count: 3 });
    expect(countOf(skills, "Sketch")).toBe(1);
  });

  it("deliberately omits single common English words that double as languages", () => {
    // "Go" fires on every resume ever written, so it is excluded and Golang carries it.
    const lowered = SKILL_VOCABULARY.map((t) => t.toLowerCase());
    expect(lowered).not.toContain("go");
    expect(lowered).not.toContain("r");
    expect(lowered).not.toContain("c");
    expect(lowered).toContain("golang");
  });

  it("ships a vocabulary large enough to cover the tracks, with no duplicates", () => {
    expect(SKILL_VOCABULARY.length).toBeGreaterThanOrEqual(300);
    const lowered = SKILL_VOCABULARY.map((t) => t.toLowerCase());
    expect(new Set(lowered).size).toBe(SKILL_VOCABULARY.length);
  });
});

describe("evidence", () => {
  it("quotes the resume verbatim and stays short", () => {
    const { skills, titles } = extractFromResume(DESIGN_RESUME);
    for (const s of [...skills, ...titles]) {
      expect(s.evidence.length).toBeLessThanOrEqual(80);
      // Strip the truncation marks; what is left has to be text the user actually wrote.
      const quoted = s.evidence.replace(/^…/, "").replace(/…$/, "");
      expect(DESIGN_RESUME).toContain(quoted);
    }
  });

  it("clips the quote to the line the match sits on", () => {
    const text = "line one is unrelated\nOwned the roadmap in Figma end to end\nline three";
    const figma = extractFromResume(text).skills.find((s) => s.value === "Figma");
    expect(figma?.evidence).toBe("Owned the roadmap in Figma end to end");
  });

  it("truncates a long line around the match instead of quoting the whole thing", () => {
    const filler = "context words that go on and on ".repeat(6);
    const evidence = extractFromResume(`${filler}Figma ${filler}`).skills[0].evidence;
    expect(evidence.length).toBeLessThanOrEqual(80);
    expect(evidence).toContain("Figma");
    expect(evidence.startsWith("…")).toBe(true);
    expect(evidence.endsWith("…")).toBe(true);
  });
});

describe("seniority", () => {
  it("calls a titled engineer with seven years senior", () => {
    const { seniority, seniorityReason } = extractFromResume(SOFTWARE_RESUME);
    expect(seniority).toBe("senior");
    expect(seniorityReason).toContain("Senior Software Engineer");
  });

  it("calls a decade of stated experience senior even without a title", () => {
    const { seniority, seniorityReason, years } = extractFromResume(
      "Design lead with 12 years of experience across consumer and enterprise.",
    );
    expect(seniority).toBe("senior");
    expect(years).toBe(12);
    expect(seniorityReason).toContain("12 years of experience");
  });

  it("calls four stated years mid", () => {
    const { seniority, seniorityReason } = extractFromResume(DESIGN_RESUME);
    expect(seniority).toBe("mid");
    expect(seniorityReason).toContain("4 years of experience");
  });

  it("calls a graduating student entry and quotes the signal", () => {
    const { seniority, seniorityReason } = extractFromResume(AEC_RESUME);
    expect(seniority).toBe("entry");
    expect(seniorityReason).toContain("graduating");
  });

  it("calls a stated new grad entry", () => {
    const { seniority } = extractFromResume("Recent graduate looking for an analyst role.");
    expect(seniority).toBe("entry");
  });

  it("calls someone seeking an internship an intern", () => {
    const { seniority, seniorityReason } = extractFromResume(
      "Seeking a summer internship in product design.",
    );
    expect(seniority).toBe("intern");
    expect(seniorityReason).toContain("internship");
  });

  it("calls a student with a future graduation date and internship experience an intern", () => {
    const { seniority } = extractFromResume(
      `Expected graduation May ${THIS_YEAR + 1}\nDesign Intern, Forsite Studio`,
    );
    expect(seniority).toBe("intern");
  });

  it("prefers the graduation date over the word senior in a title", () => {
    const { seniority, seniorityReason } = extractFromResume(
      `Graduating ${THIS_YEAR}\nReported to the Senior Designer on the platform team.`,
    );
    expect(seniority).toBe("entry");
    expect(seniorityReason).toContain("more specific");
  });

  it("prefers a long experience claim over an internship mentioned further down", () => {
    const { seniority, seniorityReason } = extractFromResume(
      "10 years of experience leading teams.\nStarted as a Design Intern in 2012.",
    );
    expect(seniority).toBe("senior");
    expect(seniorityReason).toContain("outranks");
  });

  it("defaults to mid and says so when the resume states nothing", () => {
    const { seniority, seniorityReason } = extractFromResume("Figma. Sketch. Blender.");
    expect(seniority).toBe("mid");
    expect(seniorityReason).toContain("defaults to mid");
  });
});

describe("years", () => {
  it("parses a plus form", () => {
    expect(extractFromResume("5+ years shipping web apps").years).toBe(5);
  });

  it("parses a range as its floor", () => {
    expect(extractFromResume("5-7 years of experience").years).toBe(5);
    expect(extractFromResume("5 to 7 years of experience").years).toBe(5);
    expect(extractFromResume("5–7 years of experience").years).toBe(5);
  });

  it("parses a written-out lead in", () => {
    expect(extractFromResume("Over 8 years of professional experience in analytics").years).toBe(8);
  });

  it("takes the largest stated claim", () => {
    expect(extractFromResume("3 years of Python experience and 9 years of design experience").years).toBe(9);
  });

  it("returns null rather than guessing", () => {
    expect(extractFromResume(DESIGN_RESUME.replace("4 years of experience", "experience")).years).toBeNull();
    expect(extractFromResume("Worked at Northwind from 2019 to 2024.").years).toBeNull();
    expect(extractFromResume("I am 25 years old and I like Figma.").years).toBeNull();
    expect(extractFromResume("Studied here for 4 years").years).toBeNull();
  });
});

describe("degenerate input", () => {
  const empties = [
    ["empty string", ""],
    ["whitespace only", "   \n\t\r\n  "],
    ["emoji only", "🎉🎉🎉 🚀"],
    ["punctuation only", "-- ... /// ***"],
  ] as const;

  for (const [label, input] of empties) {
    it(`returns an empty extraction for ${label}`, () => {
      const result = extractFromResume(input);
      expect(result.titles).toEqual([]);
      expect(result.skills).toEqual([]);
      expect(result.years).toBeNull();
      expect(result.seniority).toBe("mid");
      expect(result.seniorityReason.length).toBeGreaterThan(0);
    });
  }

  it("never throws on non-string input", () => {
    const bad = [null, undefined, 42, {}, [], true] as unknown as string[];
    for (const input of bad) {
      expect(() => extractFromResume(input)).not.toThrow();
      expect(extractFromResume(input).skills).toEqual([]);
    }
  });

  it("handles a single word", () => {
    expect(extractFromResume("Figma").skills[0]).toMatchObject({ value: "Figma", count: 1 });
    expect(extractFromResume("hello").skills).toEqual([]);
  });
});

describe("bounds", () => {
  it("caps each suggestion list at sixty", () => {
    const mods = ["Product", "Software", "Data", "Visual", "Brand", "Cloud", "Security", "Mobile", "Motion"];
    const roles = ["Designer", "Engineer", "Developer", "Analyst", "Manager", "Researcher", "Scientist", "Strategist", "Architect"];
    const titleBlock = mods.flatMap((m) => roles.map((r) => `${m} ${r}`)).join("\n");
    const skillBlock = SKILL_VOCABULARY.slice(0, 120).join("\n");

    const result = extractFromResume(`${titleBlock}\n${skillBlock}`);
    expect(result.titles).toHaveLength(60);
    expect(result.skills).toHaveLength(60);
  });

  it("truncates a giant paste instead of throwing", () => {
    const giant = `${"filler ".repeat(40_000)}Grasshopper`;
    expect(giant.length).toBeGreaterThan(200_000);
    const result = extractFromResume(giant);
    // The term sits past the 200k cap, so it is correctly not reported.
    expect(values(result.skills)).not.toContain("Grasshopper");
    expect(result.seniority).toBe("mid");
  });
});

describe("adversarial input", () => {
  /** Shapes chosen to poke every scanner in the file: the tokenizer, the skill prefilter,
   *  the title walk, the years patterns, and the bounded graduation scan. */
  const attacks: Array<[string, string]> = [
    ["pure whitespace", " ".repeat(100_000)],
    ["word boundaries", "a ".repeat(50_000)],
    ["tabs and newlines", " \t\n".repeat(33_000)],
    ["repeated role nouns", "engineer ".repeat(12_000)],
    ["repeated capitalized titles", "Senior Product Designer ".repeat(5_000)],
    ["years bait", "5-7 years of ".repeat(8_000)],
    ["graduation bait", "graduating graduating ".repeat(5_000)],
    ["skill prefix bait", "Nodeeeee.jsssss ".repeat(6_000)],
    ["single long token", "x".repeat(100_000)],
    ["punctuation storm", "-/&+#.'".repeat(15_000)],
  ];

  for (const [label, input] of attacks) {
    it(`survives ${label} in well under half a second`, () => {
      const started = performance.now();
      const result = extractFromResume(input);
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(500);
      expect(result.titles.length).toBeLessThanOrEqual(60);
      expect(result.skills.length).toBeLessThanOrEqual(60);
    });
  }

  it("stays fast on the whole adversarial set at once", () => {
    const started = performance.now();
    for (const [, input] of attacks) extractFromResume(input);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
