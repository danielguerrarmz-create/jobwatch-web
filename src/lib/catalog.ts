/**
 * The shipped company catalog.
 *
 * Every row here was verified against the live board before it was written down: the probe
 * hit the endpoint, confirmed it answered, and confirmed it returned real postings. A few
 * plausible-looking slugs (icon, method, sila, mosaic) turned out to belong to a different
 * company with the same word for a name, so they were dropped rather than shipped wrong.
 *
 * This list is a starting point, not the product. The real coverage story is the "add any
 * company" box: paste a Greenhouse, Lever, Ashby, SmartRecruiters, Workable, or Recruitee
 * careers URL and Jobwatch works out the rest. Roughly half of all companies run one of
 * these six boards, and none of them require a key.
 */

import type { AtsKind, Source } from "./types";

export interface PackDef {
  id: string;
  label: string;
  blurb: string;
}

/** Groupings the picker offers. A company belongs to exactly one, purely for browsing. */
export const PACKS: PackDef[] = [
  { id: "software", label: "Software & Product", blurb: "Product companies hiring engineers, PMs, and designers." },
  { id: "ai", label: "AI & ML", blurb: "Labs and applied-AI companies." },
  { id: "data", label: "Data & Infrastructure", blurb: "Data platforms, observability, developer infrastructure." },
  { id: "design", label: "Design", blurb: "Design tools and studios that post to a public board." },
  { id: "finance", label: "Fintech", blurb: "Payments, banking, and financial infrastructure." },
  { id: "health", label: "Health & Bio", blurb: "Digital health, care delivery, and biotech." },
  { id: "climate", label: "Climate & Energy", blurb: "Energy, materials, and decarbonization." },
  { id: "hardware", label: "Hardware & Robotics", blurb: "Physical products, robotics, aerospace, and vehicles." },
  { id: "aec", label: "Architecture & Construction", blurb: "Construction tech, building robotics, and design software." },
  { id: "marketing", label: "Marketing & Growth", blurb: "Marketing platforms and growth-heavy teams." },
  { id: "media", label: "Media & Creator", blurb: "Publishers, streaming, and creator platforms." },
  { id: "nonprofit", label: "Nonprofit & Civic", blurb: "Mission-driven organizations and public-interest tech." },
];

interface CatalogRow {
  kind: AtsKind;
  token: string;
  name: string;
  pack: string;
}

const CATALOG: CatalogRow[] = [

  // aec (4)
  { kind: "greenhouse", token: "fictiv", name: "Fictiv", pack: "aec" },
  { kind: "ashby", token: "higharc", name: "Higharc", pack: "aec" },
  { kind: "ashby", token: "monumental", name: "Monumental", pack: "aec" },
  { kind: "greenhouse", token: "openspace", name: "OpenSpace", pack: "aec" },

  // ai (13)
  { kind: "ashby", token: "abridge", name: "Abridge", pack: "ai" },
  { kind: "greenhouse", token: "anthropic", name: "Anthropic", pack: "ai" },
  { kind: "ashby", token: "cohere", name: "Cohere", pack: "ai" },
  { kind: "ashby", token: "elevenlabs", name: "ElevenLabs", pack: "ai" },
  { kind: "greenhouse", token: "gleanwork", name: "Glean", pack: "ai" },
  { kind: "ashby", token: "harvey", name: "Harvey", pack: "ai" },
  { kind: "ashby", token: "langchain", name: "LangChain", pack: "ai" },
  { kind: "ashby", token: "openai", name: "OpenAI", pack: "ai" },
  { kind: "ashby", token: "perplexity", name: "Perplexity", pack: "ai" },
  { kind: "ashby", token: "runway", name: "Runway", pack: "ai" },
  { kind: "greenhouse", token: "scaleai", name: "Scale AI", pack: "ai" },
  { kind: "ashby", token: "sierra", name: "Sierra", pack: "ai" },
  { kind: "greenhouse", token: "togetherai", name: "Together AI", pack: "ai" },

  // climate (6)
  { kind: "lever", token: "arcadia", name: "Arcadia", pack: "climate" },
  { kind: "ashby", token: "aurorasolar", name: "Aurora Solar", pack: "climate" },
  { kind: "ashby", token: "formenergy", name: "Form Energy", pack: "climate" },
  { kind: "greenhouse", token: "redwoodmaterials", name: "Redwood Materials", pack: "climate" },
  { kind: "greenhouse", token: "silananotechnologies", name: "Sila", pack: "climate" },
  { kind: "ashby", token: "watershed", name: "Watershed", pack: "climate" },

  // data (11)
  { kind: "greenhouse", token: "airtable", name: "Airtable", pack: "data" },
  { kind: "greenhouse", token: "amplitude", name: "Amplitude", pack: "data" },
  { kind: "ashby", token: "confluent", name: "Confluent", pack: "data" },
  { kind: "greenhouse", token: "databricks", name: "Databricks", pack: "data" },
  { kind: "greenhouse", token: "datadog", name: "Datadog", pack: "data" },
  { kind: "greenhouse", token: "elastic", name: "Elastic", pack: "data" },
  { kind: "greenhouse", token: "fivetran", name: "Fivetran", pack: "data" },
  { kind: "greenhouse", token: "grafanalabs", name: "Grafana Labs", pack: "data" },
  { kind: "greenhouse", token: "mongodb", name: "MongoDB", pack: "data" },
  { kind: "greenhouse", token: "sigmacomputing", name: "Sigma Computing", pack: "data" },
  { kind: "ashby", token: "snowflake", name: "Snowflake", pack: "data" },

  // design (4)
  { kind: "smartrecruiters", token: "canva", name: "Canva", pack: "design" },
  { kind: "greenhouse", token: "ideo", name: "IDEO", pack: "design" },
  { kind: "lever", token: "instrument", name: "Instrument", pack: "design" },
  { kind: "ashby", token: "miro", name: "Miro", pack: "design" },

  // finance (7)
  { kind: "greenhouse", token: "alloy", name: "Alloy", pack: "finance" },
  { kind: "greenhouse", token: "betterment", name: "Betterment", pack: "finance" },
  { kind: "greenhouse", token: "carta", name: "Carta", pack: "finance" },
  { kind: "greenhouse", token: "marqeta", name: "Marqeta", pack: "finance" },
  { kind: "greenhouse", token: "mercury", name: "Mercury", pack: "finance" },
  { kind: "ashby", token: "moderntreasury", name: "Modern Treasury", pack: "finance" },
  { kind: "ashby", token: "unit", name: "Unit", pack: "finance" },

  // hardware (8)
  { kind: "greenhouse", token: "formlabs", name: "Formlabs", pack: "hardware" },
  { kind: "greenhouse", token: "lucidmotors", name: "Lucid Motors", pack: "hardware" },
  { kind: "greenhouse", token: "nuro", name: "Nuro", pack: "hardware" },
  { kind: "greenhouse", token: "oura", name: "Oura", pack: "hardware" },
  { kind: "greenhouse", token: "peakdesign", name: "Peak Design", pack: "hardware" },
  { kind: "greenhouse", token: "spacex", name: "SpaceX", pack: "hardware" },
  { kind: "greenhouse", token: "waymo", name: "Waymo", pack: "hardware" },
  { kind: "ashby", token: "whoop", name: "Whoop", pack: "hardware" },

  // health (7)
  { kind: "ashby", token: "cedar", name: "Cedar", pack: "health" },
  { kind: "greenhouse", token: "ginkgobioworks", name: "Ginkgo Bioworks", pack: "health" },
  { kind: "ashby", token: "headway", name: "Headway", pack: "health" },
  { kind: "lever", token: "includedhealth", name: "Included Health", pack: "health" },
  { kind: "greenhouse", token: "komodohealth", name: "Komodo Health", pack: "health" },
  { kind: "greenhouse", token: "recursionpharmaceuticals", name: "Recursion", pack: "health" },
  { kind: "lever", token: "ro", name: "Ro", pack: "health" },

  // marketing (6)
  { kind: "greenhouse", token: "braze", name: "Braze", pack: "marketing" },
  { kind: "ashby", token: "buffer", name: "Buffer", pack: "marketing" },
  { kind: "greenhouse", token: "contentful", name: "Contentful", pack: "marketing" },
  { kind: "greenhouse", token: "klaviyo", name: "Klaviyo", pack: "marketing" },
  { kind: "greenhouse", token: "later", name: "Later", pack: "marketing" },
  { kind: "greenhouse", token: "sproutsocial", name: "Sprout Social", pack: "marketing" },

  // media (4)
  { kind: "ashby", token: "patreon", name: "Patreon", pack: "media" },
  { kind: "lever", token: "skydance", name: "Skydance", pack: "media" },
  { kind: "ashby", token: "substack", name: "Substack", pack: "media" },
  { kind: "greenhouse", token: "voxmedia", name: "Vox Media", pack: "media" },

  // nonprofit (7)
  { kind: "greenhouse", token: "chanzuckerberginitiative", name: "Chan Zuckerberg Initiative", pack: "nonprofit" },
  { kind: "lever", token: "charitywater", name: "Charity Water", pack: "nonprofit" },
  { kind: "greenhouse", token: "codeforamerica", name: "Code for America", pack: "nonprofit" },
  { kind: "greenhouse", token: "donorschoose", name: "DonorsChoose", pack: "nonprofit" },
  { kind: "greenhouse", token: "khanacademy", name: "Khan Academy", pack: "nonprofit" },
  { kind: "greenhouse", token: "mozilla", name: "Mozilla", pack: "nonprofit" },
  { kind: "greenhouse", token: "wikimedia", name: "Wikimedia Foundation", pack: "nonprofit" },

  // software (39)
  { kind: "greenhouse", token: "affirm", name: "Affirm", pack: "software" },
  { kind: "greenhouse", token: "airbnb", name: "Airbnb", pack: "software" },
  { kind: "greenhouse", token: "asana", name: "Asana", pack: "software" },
  { kind: "ashby", token: "benchling", name: "Benchling", pack: "software" },
  { kind: "greenhouse", token: "brex", name: "Brex", pack: "software" },
  { kind: "greenhouse", token: "chime", name: "Chime", pack: "software" },
  { kind: "greenhouse", token: "cloudflare", name: "Cloudflare", pack: "software" },
  { kind: "greenhouse", token: "coinbase", name: "Coinbase", pack: "software" },
  { kind: "greenhouse", token: "discord", name: "Discord", pack: "software" },
  { kind: "greenhouse", token: "dropbox", name: "Dropbox", pack: "software" },
  { kind: "greenhouse", token: "duolingo", name: "Duolingo", pack: "software" },
  { kind: "greenhouse", token: "epicgames", name: "Epic Games", pack: "software" },
  { kind: "greenhouse", token: "figma", name: "Figma", pack: "software" },
  { kind: "greenhouse", token: "gitlab", name: "GitLab", pack: "software" },
  { kind: "greenhouse", token: "gusto", name: "Gusto", pack: "software" },
  { kind: "greenhouse", token: "instacart", name: "Instacart", pack: "software" },
  { kind: "ashby", token: "linear", name: "Linear", pack: "software" },
  { kind: "greenhouse", token: "lyft", name: "Lyft", pack: "software" },
  { kind: "greenhouse", token: "monzo", name: "Monzo", pack: "software" },
  { kind: "greenhouse", token: "netlify", name: "Netlify", pack: "software" },
  { kind: "ashby", token: "notion", name: "Notion", pack: "software" },
  { kind: "greenhouse", token: "peloton", name: "Peloton", pack: "software" },
  { kind: "greenhouse", token: "pinterest", name: "Pinterest", pack: "software" },
  { kind: "ashby", token: "plaid", name: "Plaid", pack: "software" },
  { kind: "ashby", token: "ramp", name: "Ramp", pack: "software" },
  { kind: "greenhouse", token: "reddit", name: "Reddit", pack: "software" },
  { kind: "greenhouse", token: "riotgames", name: "Riot Games", pack: "software" },
  { kind: "greenhouse", token: "robinhood", name: "Robinhood", pack: "software" },
  { kind: "greenhouse", token: "roblox", name: "Roblox", pack: "software" },
  { kind: "greenhouse", token: "samsara", name: "Samsara", pack: "software" },
  { kind: "ashby", token: "sentry", name: "Sentry", pack: "software" },
  { kind: "lever", token: "spotify", name: "Spotify", pack: "software" },
  { kind: "greenhouse", token: "squarespace", name: "Squarespace", pack: "software" },
  { kind: "greenhouse", token: "stripe", name: "Stripe", pack: "software" },
  { kind: "greenhouse", token: "twilio", name: "Twilio", pack: "software" },
  { kind: "greenhouse", token: "vercel", name: "Vercel", pack: "software" },
  { kind: "lever", token: "wealthfront", name: "Wealthfront", pack: "software" },
  { kind: "greenhouse", token: "webflow", name: "Webflow", pack: "software" },
  { kind: "ashby", token: "zapier", name: "Zapier", pack: "software" },
];

/** Materialize the catalog as `Source` records. Nothing is enabled until the user picks a
 *  pack, so a first run never fires 116 requests at once. */
export function catalogSources(): Source[] {
  return CATALOG.map((row) => ({
    id: `${row.kind}:${row.token}`,
    kind: row.kind,
    token: row.token,
    name: row.name,
    pack: row.pack,
    enabled: false,
  }));
}

export function packLabel(id: string): string {
  return PACKS.find((p) => p.id === id)?.label ?? "Custom";
}
