/**
 * Resume reader.
 *
 * Deliberately a deterministic matcher, not a model. Three reasons, in order of weight:
 *
 *   1. The resume is the most sensitive thing anyone will ever paste into this app. A
 *      model call means shipping it to someone else's server. Nothing here leaves the tab.
 *   2. The product promise is that the matching logic is readable. Every suggestion below
 *      carries the exact snippet it came from, so the setup screen can say "we suggested
 *      Figma because you wrote this line" and be telling the literal truth.
 *   3. It runs in single-digit milliseconds with no key, no quota, and no offline failure
 *      mode. A resume parser that needs the network is a resume parser that is sometimes
 *      broken.
 *
 * The output is a set of *suggestions* the user confirms or rejects, never a decision.
 * That sets the precision bar: a term is worth including if a human would glance at it and
 * say yes or no in under a second. False positives cost one click. False negatives cost a
 * keyword the user never thinks to add. So the vocabulary leans inclusive, with one hard
 * exception noted at SKILL_VOCABULARY.
 *
 * Safety rules this file follows without exception:
 *   - No network, no dependencies, no `eval`.
 *   - Every regex is a literal or is built from a constant in this file. Nothing is ever
 *     compiled from resume text, so a resume can never inject a pattern.
 *   - No nested or unbounded-inside-bounded quantifiers, so arbitrary pasted text cannot
 *     trigger catastrophic backtracking. Where a scan needs to span words it uses a
 *     bounded negated class like `[^.\n]{0,40}`, never `(\w+\s*)*`.
 *   - Input and output are both capped, so a giant paste truncates instead of freezing.
 *   - The text is never logged, never put in an error, and never leaves the return value.
 */

export interface Suggestion {
  /** Normalized and display ready, e.g. "Product Designer", "Figma". */
  value: string;
  /** How many times the evidence appeared in the resume. */
  count: number;
  /** Short verbatim snippet showing where this came from. Never fabricated. */
  evidence: string;
}

export interface Extraction {
  /** Roles the person has held or is targeting, ranked by frequency. */
  titles: Suggestion[];
  /** Tools, languages, and methods, ranked by frequency. */
  skills: Suggestion[];
  seniority: "intern" | "entry" | "mid" | "senior";
  /** One plain sentence the UI shows under the seniority toggle. */
  seniorityReason: string;
  /** Best guess years of experience, null when the resume never states one. */
  years: number | null;
}

/** Past this the resume is truncated. ~200k characters is around 40k words, which is
 *  twenty times the longest real CV and still parses instantly. */
const MAX_INPUT = 200_000;
/** Per list. The setup screen shows these as checkboxes; past sixty nobody reads them. */
const MAX_SUGGESTIONS = 60;
/** A word never needs more than this to prove it is present, and stopping early keeps a
 *  pathological input (the same word 50k times) from turning into 50k regex steps. */
const MAX_COUNT_PER_TERM = 200;
/** Upper bound on the title scan. 50k words is far past any real resume. */
const MAX_TOKENS = 50_000;
/** Enough "N years" claims to find the largest one, few enough to stay linear. */
const MAX_YEAR_HITS = 200;
const EVIDENCE_MAX = 80;

/**
 * The skill vocabulary, canonical casing preserved. Matching is case insensitive but the
 * output always uses the spelling here, so a resume saying "figma" suggests "Figma".
 *
 * The one hard exclusion: single common English words that happen to be technology names.
 * "Go", "R", and "C" cannot be told apart from the verb, the initial, and the grade by
 * whole-word matching, and a term that fires on every resume is noise rather than signal.
 * "Golang" carries Go, and anything else the user types in by hand.
 */
export const SKILL_VOCABULARY: readonly string[] = [
  // Languages
  "TypeScript", "JavaScript", "Python", "Java", "Kotlin", "Swift", "Golang", "Rust",
  "Ruby", "PHP", "Scala", "Perl", "Haskell", "Elixir", "Erlang", "Lua", "Dart", "MATLAB",
  "C++", "C#", "Objective-C", "F#", "VBA", "Bash", "PowerShell", "Assembly", "COBOL",
  "Fortran", "Groovy", "Clojure", "Julia", "Solidity", "SQL", "PL/SQL", "T-SQL", "HTML",
  "CSS", "Sass", "SCSS", "XML", "YAML", "JSON", "GraphQL", "WebAssembly", "Regex",

  // Frontend and app frameworks
  "React", "React Native", "Next.js", "Vue", "Nuxt", "Angular", "Svelte", "SvelteKit",
  "Remix", "Astro", "jQuery", "Redux", "Zustand", "Tailwind CSS", "Bootstrap",
  "Material UI", "Styled Components", "Vite", "Webpack", "Rollup", "Babel", "ESLint",
  "Storybook", "Three.js", "D3.js", "WebGL", "Framer Motion", "Electron", "Tauri",
  "Expo", "Flutter", "SwiftUI", "UIKit", "Jetpack Compose", "Progressive Web App",

  // Backend and services
  "Node.js", "Express", "NestJS", "Fastify", "Django", "Flask", "FastAPI",
  "Ruby on Rails", "Spring Boot", "Laravel", "ASP.NET", ".NET", "gRPC", "REST API",
  "WebSockets", "OAuth", "JWT", "Microservices", "Serverless", "Kafka", "RabbitMQ",
  "Celery", "Redis", "Elasticsearch", "API design", "Rate limiting", "Caching",

  // Databases and storage
  "PostgreSQL", "Postgres", "MySQL", "SQLite", "MongoDB", "DynamoDB", "Cassandra",
  "Neo4j", "Firebase", "Supabase", "Snowflake", "BigQuery", "Redshift", "Databricks",
  "ClickHouse", "pgvector", "Prisma", "SQLAlchemy", "Database design", "Query optimization",

  // Infrastructure and operations
  "AWS", "Azure", "GCP", "Google Cloud", "Docker", "Kubernetes", "Terraform", "Ansible",
  "Pulumi", "Jenkins", "CircleCI", "GitHub Actions", "GitLab CI", "CI/CD", "Nginx",
  "Linux", "Git", "GitHub", "GitLab", "Bitbucket", "Vercel", "Netlify", "Heroku",
  "Cloudflare", "Datadog", "Grafana", "Prometheus", "Sentry", "Splunk", "OpenTelemetry",
  "Load balancing", "Observability", "Infrastructure as code", "Helm", "Distributed systems",

  // Testing and quality
  "Jest", "Vitest", "Pytest", "Playwright", "Cypress", "Selenium", "JUnit",
  "Testing Library", "Unit testing", "Integration testing", "End-to-end testing", "TDD",
  "Test automation", "Code review", "Debugging", "Performance testing", "Accessibility testing",

  // Data and machine learning
  "Machine learning", "Deep learning", "Neural networks", "NLP",
  "Natural language processing", "Computer vision", "LLM", "Large language models",
  "Transformers", "PyTorch", "TensorFlow", "Keras", "scikit-learn", "Pandas", "NumPy",
  "SciPy", "Matplotlib", "Seaborn", "Plotly", "Jupyter", "Hugging Face", "LangChain",
  "RAG", "Retrieval augmented generation", "Vector database", "Embeddings", "Fine-tuning",
  "Prompt engineering", "MLOps", "Feature engineering", "Regression analysis",
  "Classification", "Clustering", "Time series", "Statistics", "Statistical analysis",
  "Hypothesis testing", "A/B testing", "Experimentation", "Causal inference",
  "Data modeling", "Data pipeline", "ETL", "dbt", "Airflow", "Spark", "PySpark", "Hadoop",
  "Data warehouse", "Data visualization", "Tableau", "Power BI", "Looker", "Metabase",
  "Excel", "Google Sheets", "SPSS", "Stata", "SAS", "Forecasting",

  // Design tools
  "Figma", "Sketch", "Adobe XD", "InVision", "Framer", "Webflow", "Photoshop",
  "Illustrator", "InDesign", "After Effects", "Premiere Pro", "Lightroom",
  "Adobe Creative Suite", "Blender", "Cinema 4D", "Maya", "3ds Max", "ZBrush",
  "Substance Painter", "Unity", "Unreal Engine", "Procreate", "Zeplin", "Miro", "FigJam",

  // Design methods
  "Design systems", "Wireframing", "Prototyping", "User research", "Usability testing",
  "Interaction design", "Visual design", "Interface design", "Information architecture",
  "Journey mapping", "User personas", "Heuristic evaluation", "Accessibility", "WCAG",
  "Typography", "Color theory", "Branding", "Brand identity", "Iconography",
  "Illustration", "Motion design", "Storyboarding", "Art direction", "Style guide",
  "Human centered design", "Design thinking", "Service design", "Rapid prototyping",
  "Design critique", "Responsive design", "Mobile first", "Design tokens",

  // Product and program
  "Product strategy", "Product roadmap", "Roadmapping", "Product discovery",
  "User stories", "Agile", "Scrum", "Kanban", "Sprint planning", "Jira", "Confluence",
  "Asana", "Trello", "Notion", "Stakeholder management", "Cross functional",
  "Requirements gathering", "Competitive analysis", "Market research", "Go to market",
  "OKRs", "KPIs", "Product analytics", "Amplitude", "Mixpanel", "Google Analytics",
  "Customer interviews", "Prioritization", "MVP", "Roadmap planning", "Product operations",

  // Marketing and communications
  "SEO", "SEM", "Content marketing", "Content strategy", "Copywriting", "Email marketing",
  "Marketing automation", "HubSpot", "Mailchimp", "Klaviyo", "Salesforce", "Marketo",
  "Social media marketing", "Paid media", "Paid social", "Google Ads", "Meta Ads",
  "Influencer marketing", "Brand strategy", "Campaign management", "Community management",
  "Public relations", "Media relations", "Newsletter", "Editorial calendar",
  "Conversion rate optimization", "Landing pages", "Lead generation", "Demand generation",
  "Growth marketing", "Attribution", "Retention", "Lifecycle marketing", "Event marketing",

  // Finance, operations, and business
  "Financial modeling", "Financial analysis", "Budgeting", "Variance analysis", "P&L",
  "Cash flow", "Valuation", "DCF", "Due diligence", "Accounting", "GAAP", "QuickBooks",
  "NetSuite", "SAP", "Procurement", "Supply chain", "Inventory management",
  "Vendor management", "Process improvement", "Six Sigma", "Lean", "Business operations",
  "Revenue operations", "Contract negotiation", "Risk management", "Compliance",
  "Reconciliation", "Pricing strategy", "Unit economics", "Fundraising",
  "Investor relations", "Grant writing", "Cost estimation",

  // Architecture, engineering, and construction
  "Revit", "AutoCAD", "Rhino", "Grasshopper", "Dynamo", "Navisworks", "BIM", "Autodesk",
  "SketchUp", "Enscape", "Lumion", "V-Ray", "Twinmotion", "Vectorworks", "ArchiCAD",
  "Bluebeam", "Civil 3D", "Parametric design", "Parametric modeling",
  "Computational design", "Generative design", "Digital fabrication", "CNC",
  "Laser cutting", "3D printing", "Daylight analysis", "Energy modeling", "Ladybug",
  "Honeybee", "EnergyPlus", "Radiance", "Building performance", "Sustainability", "LEED",
  "Passive design", "Construction documents", "Design development", "Schematic design",
  "Construction administration", "Shop drawings", "Zoning analysis", "Site analysis",
  "Space planning", "Adaptive reuse", "Historic preservation", "Urban design",
  "Landscape architecture", "Structural analysis", "Karamba", "Kangaroo", "Rhino.Inside",
  "RhinoCommon", "Speckle", "IFC", "Clash detection", "Point cloud", "Photogrammetry",
  "LiDAR", "GIS", "ArcGIS", "QGIS", "Model coordination", "Physical modeling",
  "Hand drafting", "Rendering", "Digital twin", "Facade design", "Feasibility studies",

  // Cross cutting
  "Project management", "Program management", "Technical writing", "Documentation",
  "Public speaking", "Mentoring", "Team leadership", "Client management",
  "Workshop facilitation", "R&D", "Data entry", "Bilingual", "Spanish", "Mandarin",
  "French", "Portuguese", "Cross cultural communication", "Scripting", "Automation",
];

interface CompiledTerm {
  canonical: string;
  lower: string;
  /** Global so occurrences can be counted; built only from the constant above. */
  re: RegExp;
}

/** Same conditional-boundary trick the fit engine uses: `\b` only means something next to
 *  a word character, so "C++" gets a left boundary and no right one, and "R&D" gets both. */
function termRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const left = /^\w/.test(term) ? "\\b" : "";
  const right = /\w$/.test(term) ? "\\b" : "";
  return new RegExp(`${left}${escaped}${right}`, "gi");
}

const COMPILED_SKILLS: CompiledTerm[] = (() => {
  const seen = new Set<string>();
  const out: CompiledTerm[] = [];
  for (const canonical of SKILL_VOCABULARY) {
    const lower = canonical.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push({ canonical, lower, re: termRegex(canonical) });
  }
  return out;
})();

/** Head nouns that make a phrase a job title. Singular only, on purpose: "engineers" in
 *  "worked with engineers to ship" is a description of coworkers, not a role. */
const ROLE_NOUNS = new Set([
  "designer", "engineer", "developer", "analyst", "manager", "researcher", "scientist",
  "strategist", "architect", "producer", "coordinator", "specialist", "consultant",
  "associate", "director", "intern", "technologist", "programmer", "administrator",
  "technician", "planner", "writer", "editor", "illustrator", "animator", "marketer",
  "accountant", "controller", "recruiter", "assistant", "apprentice", "fellow",
  "drafter", "modeler", "estimator", "surveyor", "supervisor", "officer", "founder",
  "advisor", "auditor", "copywriter", "generalist", "operator", "photographer",
  "videographer", "artist", "trainer", "representative",
]);

/** Role nouns that say a level and nothing about the work. They only become a suggestion
 *  when something qualifies them, so "Design Intern" survives and a bare "Intern" does not. */
const NEEDS_QUALIFIER = new Set([
  "intern", "associate", "assistant", "fellow", "apprentice", "generalist",
]);

/**
 * Words allowed to sit in front of a role noun. An allowlist rather than "any capitalized
 * word" because the alternative invents titles out of company names: "Acme Corp Engineer"
 * is not a role anybody holds.
 */
const MODIFIERS = new Set([
  // level
  "senior", "sr", "junior", "jr", "staff", "principal", "lead", "head", "chief",
  "associate", "assistant", "entry", "executive", "deputy", "global", "regional",
  "managing", "founding", "summer", "graduate", "undergraduate", "student",
  // discipline
  "product", "software", "hardware", "web", "mobile", "frontend", "front-end", "front",
  "backend", "back-end", "back", "full", "stack", "full-stack", "fullstack", "systems",
  "system", "platform", "infrastructure", "cloud", "security", "network", "database",
  "data", "machine", "learning", "ml", "ai", "artificial", "intelligence", "deep",
  "applied", "research", "quantitative", "business", "financial", "finance", "accounting",
  "operations", "operational", "program", "project", "technical", "technology",
  "creative", "visual", "graphic", "brand", "motion", "interaction", "interface",
  "experience", "user", "ux", "ui", "industrial", "interior", "landscape", "urban",
  "architectural", "architecture", "computational", "generative", "parametric",
  "digital", "design", "engineering", "fabrication", "structural", "mechanical",
  "electrical", "civil", "environmental", "construction", "building", "facade",
  "sustainability", "energy", "game", "gameplay", "graphics", "rendering", "audio",
  "video", "media", "content", "social", "community", "marketing", "growth", "demand",
  "performance", "seo", "communications", "public", "editorial", "copy", "documentation",
  "customer", "client", "account", "sales", "revenue", "people", "talent", "human",
  "resources", "recruiting", "legal", "compliance", "risk", "quality", "qa", "test",
  "automation", "reliability", "site", "devops", "release", "build", "tools", "tooling",
  "integration", "solutions", "enterprise", "field", "support", "service",
  "implementation", "delivery", "supply", "chain", "logistics", "manufacturing",
  "process", "clinical", "biomedical", "chemical", "materials", "robotics", "embedded",
  "firmware", "controls", "simulation", "geospatial", "gis", "bi", "analytics",
  "insights", "strategy", "strategic", "corporate", "information", "computer",
]);

/** Dropped from the front of a title so "Senior Product Designer" and "Product Designer"
 *  collapse into one suggestion. Level lives in `seniority`, not in the role name. */
const SENIORITY_PREFIXES = new Set([
  "senior", "sr", "junior", "jr", "staff", "principal", "lead", "head", "chief",
  "executive", "deputy", "entry",
]);

/** Any of these anywhere in a detected title reads as a senior role. */
const SENIOR_MARKERS = new Set([
  "senior", "sr", "staff", "principal", "lead", "head", "chief", "director", "executive",
]);

/** Words Title Case would otherwise mangle into "Ux" or "Bim". */
const ACRONYMS: Record<string, string> = {
  ux: "UX", ui: "UI", qa: "QA", ai: "AI", ml: "ML", bi: "BI", it: "IT", hr: "HR",
  seo: "SEO", bim: "BIM", cad: "CAD", gis: "GIS", api: "API", sre: "SRE", aec: "AEC",
  devops: "DevOps", ios: "iOS", sr: "Sr", jr: "Jr",
};

/** One pass, one bounded quantifier, no alternation. Linear on any input. The class keeps
 *  the punctuation that lives inside real words ("Node.js", "front-end", "designer's") so
 *  those decisions are made later with full context instead of by the splitter. */
const TOKEN_RE = /[A-Za-z][A-Za-z'’.+#&/-]{0,29}/g;

interface Token {
  raw: string;
  lower: string;
  /** Lowercased with trailing punctuation removed, e.g. "designer." to "designer". */
  word: string;
  start: number;
  end: number;
}

const POSSESSIVE_RE = /['’]s$/;
const TRAILING_PUNCT_RE = /[^a-z]+$/;
/** Whitespace or a single hyphen. Anything else (comma, newline, pipe, bullet) means the
 *  two words are not part of the same title. */
const TITLE_GAP_RE = /^[ \t-]{1,3}$/;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const raw = m[0];
    const lower = raw.toLowerCase();
    tokens.push({
      raw,
      lower,
      word: lower.replace(TRAILING_PUNCT_RE, ""),
      start: m.index,
      end: m.index + raw.length,
    });
    if (tokens.length >= MAX_TOKENS) break;
  }
  return tokens;
}

/**
 * A short verbatim snippet centered on a match, clipped to the line it sits on so the
 * quote never stitches two unrelated bullets together. Internal whitespace is collapsed
 * for display; the words themselves are exactly what the user wrote.
 */
function evidenceAt(text: string, index: number, length: number, width = EVIDENCE_MAX): string {
  // Leave room for the two ellipses so the result can never exceed `width`.
  const budget = Math.max(16, width - 2);
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const nextBreak = text.indexOf("\n", index + length);
  const lineEnd = nextBreak < 0 ? text.length : nextBreak;

  // Pull back a little so the match is not flush against the left edge of the quote.
  let start = Math.max(lineStart, index - 24);
  let end = Math.min(lineEnd, start + budget);
  if (end - start < budget) start = Math.max(lineStart, end - budget);

  const body = text.slice(start, end).replace(/[ \t\r\f\v]+/g, " ").trim();
  if (!body) return "";
  const prefix = start > lineStart ? "…" : "";
  const suffix = end < lineEnd ? "…" : "";
  return prefix + body + suffix;
}

function bySuggestionRank(a: Suggestion, b: Suggestion): number {
  return b.count - a.count || a.value.localeCompare(b.value);
}

function extractSkills(text: string, lower: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const term of COMPILED_SKILLS) {
    // Native substring search first, regex second. The prefilter rejects ~95% of the
    // vocabulary for free, which is what keeps 400 patterns off the main thread's back.
    if (!lower.includes(term.lower)) continue;
    term.re.lastIndex = 0;
    let count = 0;
    let first = -1;
    let m: RegExpExecArray | null;
    while ((m = term.re.exec(text)) !== null) {
      if (first < 0) first = m.index;
      count += 1;
      if (count >= MAX_COUNT_PER_TERM) break;
    }
    if (count === 0) continue;
    out.push({
      value: term.canonical,
      count,
      evidence: evidenceAt(text, first, term.canonical.length),
    });
  }
  out.sort(bySuggestionRank);
  return out.slice(0, MAX_SUGGESTIONS);
}

function capitalize(word: string): string {
  const acronym = ACRONYMS[word];
  if (acronym) return acronym;
  return word
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join("-");
}

interface TitleScan {
  suggestions: Suggestion[];
  /** First senior-sounding title found, used by the seniority ladder. */
  seniorMarker: { word: string; evidence: string } | null;
  /** True when an "... Intern" title was held, as opposed to the word appearing in prose. */
  internTitle: boolean;
}

/**
 * Titles are found by walking backward from a role noun through at most two allowed
 * modifiers, rather than by one big regex. Tokenizing once and then reading an array is
 * linear and impossible to backtrack, and it makes each rejection rule (plural,
 * possessive, wrong neighbor) something you can read and argue with on its own line.
 */
function extractTitles(text: string, tokens: Token[]): TitleScan {
  const counts = new Map<string, { count: number; index: number; length: number }>();
  let seniorMarker: TitleScan["seniorMarker"] = null;
  let internTitle = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (!ROLE_NOUNS.has(tok.word)) continue;
    // "the designer's brief" describes a role, it is not a claim to hold one.
    if (POSSESSIVE_RE.test(tok.lower)) continue;

    const mods: string[] = [];
    let j = i - 1;
    while (mods.length < 2 && j >= 0) {
      const prev = tokens[j];
      if (!TITLE_GAP_RE.test(text.slice(prev.end, tokens[j + 1].start))) break;
      if (!MODIFIERS.has(prev.word)) break;
      mods.unshift(prev.word);
      j -= 1;
    }

    // A bare role noun only counts when it is capitalized. Lowercase and unqualified means
    // it is running text ("reviewed the engineer's estimate"), not a heading or a claim.
    if (mods.length === 0 && !/^[A-Z]/.test(tok.raw)) continue;
    if (mods.length === 0 && NEEDS_QUALIFIER.has(tok.word)) continue;

    const words = [...mods, tok.word];
    const marker = words.find((w) => SENIOR_MARKERS.has(w));
    if (marker && !seniorMarker) {
      const from = tokens[j + 1].start;
      seniorMarker = { word: marker, evidence: evidenceAt(text, from, tok.end - from, 48) };
    }
    if (tok.word === "intern") internTitle = true;

    while (words.length > 1 && SENIORITY_PREFIXES.has(words[0])) words.shift();
    const value = words.map(capitalize).join(" ");

    const start = tokens[j + 1].start;
    const existing = counts.get(value);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(value, { count: 1, index: start, length: tok.end - start });
    }
  }

  // Count first, then specificity: at equal frequency "Product Designer" tells the user
  // more than "Designer", so it should be the one they see and check off.
  const ranked = [...counts.entries()].sort(
    (a, b) =>
      b[1].count - a[1].count ||
      b[0].split(" ").length - a[0].split(" ").length ||
      a[0].localeCompare(b[0]),
  );

  // Evidence is cut only for the survivors. Quoting is the expensive half of this
  // function, and a pathological paste can produce thousands of distinct candidates.
  const suggestions = ranked.slice(0, MAX_SUGGESTIONS).map(([value, hit]) => ({
    value,
    count: hit.count,
    evidence: evidenceAt(text, hit.index, hit.length),
  }));

  return { suggestions, seniorMarker, internTitle };
}

/* Years of experience. Three shapes, all bounded, none able to backtrack:
 *   "5-7 years"  (the en dash is there because resumes contain one, not as punctuation)
 *   "5+ years"
 *   "5 years of professional experience"
 * A bare "5 years" is not enough on its own, because "25 years old" and "3 years at the
 * university" are both that shape and neither is a claim about experience. */
const YEARS_RANGE_RE = /\b(\d{1,2})\s?(?:-|–|—|to)\s?(\d{1,2})\s?\+?\s?years?\b/gi;
const YEARS_PLUS_RE = /\b(\d{1,2})\s?\+\s?years?\b/gi;
const YEARS_EXPERIENCE_RE = /\b(\d{1,2})\s?\+?\s?years?[a-z ]{0,30}experience\b/gi;

interface YearsHit {
  years: number;
  quote: string;
}

function parseYears(text: string): YearsHit | null {
  const hits: YearsHit[] = [];
  const rangeSpans: Array<[number, number]> = [];

  // Ranges first, and their spans are then masked off. "5-7 years of experience" contains
  // a perfectly good "7 years of experience" that would otherwise be read as a second,
  // larger claim. A range means the floor, so the tail of it must not count on its own.
  YEARS_RANGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = YEARS_RANGE_RE.exec(text)) !== null) {
    rangeSpans.push([m.index, m.index + m[0].length]);
    const value = Number(m[1]);
    if (value > 0 && value <= 60) {
      hits.push({ years: value, quote: evidenceAt(text, m.index, m[0].length, 48) });
    }
    // Nobody states their experience two hundred times. Stopping here keeps the span
    // masking below from turning into a quadratic scan on adversarial input.
    if (rangeSpans.length >= MAX_YEAR_HITS) break;
  }

  for (const re of [YEARS_PLUS_RE, YEARS_EXPERIENCE_RE]) {
    re.lastIndex = 0;
    // Counts matches, not hits. Bounding on `hits.length` looks equivalent but is not: a
    // paste where every match is discarded below (out-of-range value, or inside a masked
    // range) never grows `hits`, so the guard never fires and the span check below runs
    // once per match across the whole document.
    let examined = 0;
    while ((m = re.exec(text)) !== null) {
      if (++examined > MAX_YEAR_HITS * 2) break;
      const start = m.index;
      if (rangeSpans.some(([from, to]) => start >= from && start < to)) continue;
      const value = Number(m[1]);
      if (!Number.isFinite(value) || value <= 0 || value > 60) continue;
      hits.push({ years: value, quote: evidenceAt(text, start, m[0].length, 48) });
    }
  }

  if (hits.length === 0) return null;
  // Several claims can coexist ("3 years of Python, 8 years of design"). The largest is
  // the one the person would put on an application, so it is the one we suggest.
  return hits.reduce((a, b) => (b.years > a.years ? b : a));
}

/* Seniority signals. Every one is a literal alternation followed at most by a bounded
 * negated class, so none of them can be made to backtrack by pasted text. */
const SEEKING_INTERN_RE =
  /\b(?:seeking|looking for|pursuing|available for|open to|applying for)\b[^.\n]{0,40}\binternships?\b/i;
const SEASON_INTERN_RE = /\b(?:summer|fall|spring|winter)\s?20\d{2}\s?internship\b/i;
const INTERN_RE = /\b(?:intern|interns|internship|internships)\b/i;
const GRAD_PHRASE_RE =
  /\b(?:new grad|new graduate|recent graduate|recent grad|graduating|expected graduation|anticipated graduation|entry[- ]level)\b/i;
const GRAD_YEAR_RE =
  /\b(?:graduation|graduating|graduate|graduated|class of|expected|anticipated)\b[^.\n]{0,40}\b(20\d{2})\b/i;

function quoteMatch(text: string, m: RegExpMatchArray | null): string {
  if (!m || m.index === undefined) return "";
  return evidenceAt(text, m.index, m[0].length, 48);
}

interface SeniorityCall {
  level: Extraction["seniority"];
  reason: string;
}

/**
 * A fixed ladder, most specific signal first. Order is the whole design here: a resume
 * routinely carries three signals that disagree (a graduation date, an internship, and the
 * word "Senior" from a manager's title in a bullet), and picking by precedence is the only
 * way to get an answer you can explain in one sentence.
 *
 * Graduation outranks a senior title on purpose. "Graduating May 2026" is a fact about the
 * person; "Senior" is a word that shows up in other people's titles.
 */
function inferSeniority(
  text: string,
  years: YearsHit | null,
  scan: TitleScan,
): SeniorityCall {
  const seeking = text.match(SEEKING_INTERN_RE) ?? text.match(SEASON_INTERN_RE);
  const gradPhrase = text.match(GRAD_PHRASE_RE);
  const gradYear = text.match(GRAD_YEAR_RE);
  const intern = text.match(INTERN_RE);
  const currentYear = new Date().getFullYear();
  const gradYearValue = gradYear ? Number(gradYear[1]) : null;
  const graduatingSoon = gradYearValue !== null && gradYearValue >= currentYear;
  const stillInSchool = gradYearValue !== null && gradYearValue > currentYear;

  if (seeking) {
    return { level: "intern", reason: `Says "${quoteMatch(text, seeking)}".` };
  }
  if (stillInSchool && (intern || scan.internTitle)) {
    return {
      level: "intern",
      reason: `Graduation is still ahead ("${quoteMatch(text, gradYear)}") and the experience listed is internships.`,
    };
  }
  if (years && years.years >= 8) {
    const conflict = scan.internTitle ? ", which outranks the internship listed further down" : "";
    return { level: "senior", reason: `Says "${years.quote}"${conflict}.` };
  }
  if (gradPhrase || graduatingSoon) {
    const quote = quoteMatch(text, gradPhrase ?? gradYear);
    const conflict = scan.seniorMarker
      ? `, which is more specific than the word "${scan.seniorMarker.word}" in a title`
      : "";
    return { level: "entry", reason: `Mentions "${quote}"${conflict}.` };
  }
  if (scan.seniorMarker) {
    return { level: "senior", reason: `Held a title reading "${scan.seniorMarker.evidence}".` };
  }
  if (years && years.years >= 3) {
    return { level: "mid", reason: `Says "${years.quote}".` };
  }
  if (intern || scan.internTitle) {
    return { level: "intern", reason: `The only role signal is an internship: "${quoteMatch(text, intern)}".` };
  }
  if (years) {
    return { level: "entry", reason: `Says "${years.quote}".` };
  }
  return {
    level: "mid",
    reason: "No seniority signal in the resume, so this defaults to mid. Change it if that is wrong.",
  };
}

function emptyExtraction(): Extraction {
  return {
    titles: [],
    skills: [],
    seniority: "mid",
    seniorityReason:
      "No seniority signal in the resume, so this defaults to mid. Change it if that is wrong.",
    years: null,
  };
}

/**
 * Read a pasted resume and return suggestions for the user to confirm. Never throws and
 * never reports failure through an exception: bad input just produces an empty result,
 * because a setup screen that explodes on a weird paste is worse than one that shrugs.
 */
export function extractFromResume(text: string): Extraction {
  if (typeof text !== "string") return emptyExtraction();
  const trimmed = text.length > MAX_INPUT ? text.slice(0, MAX_INPUT) : text;
  if (!trimmed.trim()) return emptyExtraction();

  try {
    const lower = trimmed.toLowerCase();
    const tokens = tokenize(trimmed);
    const scan = extractTitles(trimmed, tokens);
    const years = parseYears(trimmed);
    const call = inferSeniority(trimmed, years, scan);

    return {
      titles: scan.suggestions,
      skills: extractSkills(trimmed, lower),
      seniority: call.level,
      seniorityReason: call.reason,
      years: years ? years.years : null,
    };
  } catch {
    // Deliberately swallowed with no message. Anything we could say about the failure
    // would be built out of the resume, and the resume does not belong in an error.
    return emptyExtraction();
  }
}
