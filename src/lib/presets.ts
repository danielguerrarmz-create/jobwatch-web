/**
 * Keyword presets, one per career track.
 *
 * A preset is a starting point you are expected to edit, not a category you get sorted
 * into. The whole point of a transparent matcher is that when a job scores badly you can
 * see which keyword missed and add it. Presets just save you the blank page.
 *
 * How the halves are weighted once compiled:
 *   `targetTitles`  the roles you want, the strongest signal (title match = +3)
 *   `skills`        what you can do, corroboration that breaks ties (title match = +1)
 *   `exclude`       hard vetoes, usually a seniority or wrong-industry collision
 */

import type { Profile } from "./types";

export interface Preset {
  id: string;
  label: string;
  blurb: string;
  /** Packs pre-selected when this preset is chosen. */
  packs: string[];
  profile: Profile;
}

/** Vetoes almost everyone wants: roles that will never look at an early-career applicant. */
const COMMON_EXCLUDE = ["vice president", "vp of", "head of", "chief", "director of", "principal"];

export const PRESETS: Preset[] = [
  {
    id: "software",
    label: "Software Engineering",
    blurb: "Backend, frontend, full-stack, and infrastructure roles.",
    packs: ["software", "ai", "data"],
    profile: {
      targetTitles: [
        "software engineer", "software developer", "backend engineer", "frontend engineer",
        "full stack engineer", "fullstack engineer", "web developer", "platform engineer",
        "infrastructure engineer", "systems engineer", "mobile engineer", "ios engineer",
        "android engineer", "site reliability", "devops engineer", "engineer, new grad",
        "developer", "programmer",
      ],
      skills: [
        "typescript", "javascript", "react", "python", "go", "rust", "kubernetes", "aws",
        "distributed systems", "api", "postgres", "graphql", "node", "docker", "ci/cd",
      ],
      exclude: [...COMMON_EXCLUDE, "sales", "recruiter", "account executive"],
      extraKeywords: [],
      locations: [],
      workModes: [],
      minScore: 3,
      seniority: "entry",
      resume: "",
      rememberResume: true,
      headline: "",
    },
  },
  {
    id: "design",
    label: "Product & UX Design",
    blurb: "Product design, UX, UI, research, and design systems.",
    packs: ["design", "software", "media"],
    profile: {
      targetTitles: [
        "product designer", "ux designer", "ui designer", "visual designer", "interaction designer",
        "design systems", "ux researcher", "design researcher", "brand designer",
        "graphic designer", "experience designer", "product design", "motion designer",
        "communication designer", "designer",
      ],
      skills: [
        "figma", "prototyping", "wireframe", "user research", "accessibility", "design system",
        "usability", "typography", "information architecture", "portfolio",
      ],
      exclude: [...COMMON_EXCLUDE, "sales", "designer relations", "recruiter"],
      extraKeywords: [],
      locations: [],
      workModes: [],
      minScore: 3,
      seniority: "entry",
      resume: "",
      rememberResume: true,
      headline: "",
    },
  },
  {
    id: "data",
    label: "Data & Analytics",
    blurb: "Analytics, data science, data engineering, and ML.",
    packs: ["data", "ai", "software"],
    profile: {
      targetTitles: [
        "data analyst", "data scientist", "data engineer", "analytics engineer",
        "business intelligence", "machine learning engineer", "ml engineer",
        "research scientist", "quantitative analyst", "analytics", "data science",
      ],
      skills: [
        "sql", "python", "dbt", "snowflake", "tableau", "looker", "spark", "airflow",
        "statistics", "experimentation", "a/b testing", "pandas", "pytorch",
      ],
      exclude: [...COMMON_EXCLUDE, "sales", "recruiter"],
      extraKeywords: [],
      locations: [],
      workModes: [],
      minScore: 3,
      seniority: "entry",
      resume: "",
      rememberResume: true,
      headline: "",
    },
  },
  {
    id: "product",
    label: "Product Management",
    blurb: "Product management, product ops, and technical program management.",
    packs: ["software", "ai", "finance"],
    profile: {
      targetTitles: [
        "product manager", "associate product manager", "product owner", "product operations",
        "technical program manager", "program manager", "product analyst", "product management",
      ],
      skills: [
        "roadmap", "discovery", "stakeholder", "user research", "prioritization", "go to market",
        "cross functional", "metrics", "experimentation",
      ],
      exclude: [...COMMON_EXCLUDE, "sales", "recruiter", "product marketing manager"],
      extraKeywords: [],
      locations: [],
      workModes: [],
      minScore: 3,
      seniority: "entry",
      resume: "",
      rememberResume: true,
      headline: "",
    },
  },
  {
    id: "marketing",
    label: "Marketing & Communications",
    blurb: "Growth, content, brand, social, and communications.",
    packs: ["marketing", "media", "software"],
    profile: {
      targetTitles: [
        "marketing", "growth marketing", "content marketing", "brand marketing",
        "social media", "communications", "copywriter", "content strategist",
        "product marketing", "demand generation", "lifecycle marketing", "seo",
        "community manager", "public relations",
      ],
      skills: [
        "campaign", "email marketing", "editorial", "storytelling", "analytics", "hubspot",
        "paid social", "content calendar", "brand voice", "newsletter",
      ],
      exclude: [...COMMON_EXCLUDE, "sales development", "account executive"],
      extraKeywords: [],
      locations: [],
      workModes: [],
      minScore: 3,
      seniority: "entry",
      resume: "",
      rememberResume: true,
      headline: "",
    },
  },
  {
    id: "operations",
    label: "Operations & Strategy",
    blurb: "Business operations, strategy, finance, and program roles.",
    packs: ["software", "finance", "health"],
    profile: {
      targetTitles: [
        "business operations", "operations manager", "strategy", "chief of staff",
        "business analyst", "operations analyst", "revenue operations", "strategic finance",
        "financial analyst", "program manager", "project manager", "operations associate",
      ],
      skills: [
        "excel", "sql", "forecasting", "process improvement", "cross functional",
        "vendor", "reporting", "planning", "modeling",
      ],
      exclude: [...COMMON_EXCLUDE],
      extraKeywords: [],
      locations: [],
      workModes: [],
      minScore: 3,
      seniority: "entry",
      resume: "",
      rememberResume: true,
      headline: "",
    },
  },
  {
    id: "aec",
    label: "Architecture & Design Technology",
    blurb: "Computational design, design technology, and construction tech.",
    packs: ["aec", "hardware", "design"],
    profile: {
      // Titles only. The tools (Grasshopper, Revit, and so on) belong in skills: a posting
      // titled "Revit Specialist" is rare, but a posting that mentions Revit in the body is
      // everywhere, and weighting a tool like a job title floods the board with near misses.
      targetTitles: [
        "computational designer", "computational design", "design technologist",
        "design technology", "architectural designer", "design engineer",
        "building performance", "facade engineer", "digital practice", "architect",
      ],
      skills: [
        "grasshopper", "rhino", "revit", "dynamo", "bim", "parametric", "generative design",
        "digital fabrication", "geometry", "simulation", "automation", "python", "c#",
        "autodesk", "construction", "fabrication", "daylight", "energy modeling", "cad",
      ],
      // "architect" collides hard with software titles, so the software senses are vetoed.
      exclude: [
        ...COMMON_EXCLUDE, "solutions architect", "cloud architect", "software architect",
        "enterprise architect", "data architect", "security architect", "sales",
      ],
      extraKeywords: [],
      locations: [],
      workModes: [],
      minScore: 3,
      seniority: "entry",
      resume: "",
      rememberResume: true,
      headline: "",
    },
  },
  {
    id: "blank",
    label: "Start from scratch",
    blurb: "No keywords. Add your own and pick your own companies.",
    packs: [],
    profile: {
      targetTitles: [],
      skills: [],
      exclude: [],
      extraKeywords: [],
      locations: [],
      workModes: [],
      minScore: 0,
      seniority: "any",
      resume: "",
      rememberResume: true,
      headline: "",
    },
  },
];

/** The shape a profile falls back to before any preset is chosen. */
export const EMPTY_PROFILE: Profile = {
  resume: "",
  rememberResume: true,
  headline: "",
  skills: [],
  seniority: "entry",
  targetTitles: [],
  extraKeywords: [],
  exclude: [],
  locations: [],
  workModes: [],
  minScore: 3,
};

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1];
}
