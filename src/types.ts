export interface ProvenancedAmount {
  amount: number;
  currency: "EUR";
  source_url: string;
  quote: string;
  retrieved_at: string; // YYYY-MM-DD
  legal_basis?: string;
  history?: { amount: number; retrieved_at: string; quote?: string; source_url?: string }[];
}

/** A provenanced non-monetary number (points required, durations…). */
export interface ProvenancedNumber {
  value: number;
  unit: "points";
  source_url: string;
  quote: string;
  retrieved_at: string; // YYYY-MM-DD
  legal_basis?: string;
  history?: { value: number; retrieved_at: string; quote?: string; source_url?: string }[];
}

/** The provenance every non-numeric statement carries: the same shape as a
 * provenanced amount, minus the amount itself. */
export interface ProvenancedText {
  source_url: string;
  quote: string;
  retrieved_at: string; // YYYY-MM-DD
  legal_basis?: string;
  history?: { retrieved_at: string; quote?: string; source_url?: string }[];
}

/**
 * A dataset-level statement that answers a profile no route can answer: some
 * people need no permit at all, and "0 routes look open" would be a lie. It
 * matches on one declared field and carries provenance like any other value.
 */
export interface Notice {
  id: string;
  when: { field: string; op: "eq" | "in"; value?: string; values?: string[] };
  /** no-permit-needed replaces the results (nothing to compare); extra-rights
   * sits BESIDE them and never suppresses a verdict the rules computed. */
  kind: "no-permit-needed" | "extra-rights";
  title: string;
  body: string;
  source: ProvenancedText;
}

/** One scoring item of a points system: answer value → points awarded. */
export interface PointsItem {
  field: string;
  points: Record<string, number>;
}

export interface PointsTable {
  source_url: string;
  quote: string;
  retrieved_at: string;
  legal_basis?: string;
  items: PointsItem[];
}

/**
 * `short_reason`: how this criterion reads in a verdict line ("for 30 or
 * older") — the field name alone ("age") states a verdict on the person.
 */
export type Criterion =
  | { field: string; op: "eq"; value: string; note?: string; short_reason?: string }
  | { field: string; op: "in"; values: string[]; note?: string; short_reason?: string }
  | { field: string; op: "gte"; threshold: ProvenancedAmount; threshold_label?: string; note?: string; short_reason?: string }
  | { op: "points"; required: ProvenancedNumber; table: PointsTable; note?: string; short_reason?: string }
  /** Disjunction: the criterion passes when ANY path's criteria all pass (e.g. §20a "Fachkraft ODER Punktzahl"). */
  | { op: "any"; label?: string; paths: { label?: string; criteria: Criterion[] }[]; note?: string; short_reason?: string };

export interface Route {
  id: string;
  name: string;
  kind: "res-work" | "seek" | "self-employed";
  summary?: string;
  info_url: string;
  criteria: Criterion[];
  /** Plain-language conditions the authority applies that the interview does
   * NOT ask — stated on the card so "criteria met" never overpromises. */
  preconditions?: string[];
}

export interface Country {
  code: string;
  name: string;
  routes: Route[];
}

export interface FieldOption {
  value: string;
  label: string;
  /** Noun-phrase form for prose ("a job offer in Germany"). */
  short?: string;
  is_unknown?: boolean;
  /** "None of these"-style absence answers — never a counterfactual target. */
  is_fallback?: boolean;
  /** Values this answer ALSO satisfies: a country implies its class, so
   * `citizenship eq third_country` keeps passing on an answer of "TR". One
   * predicate serves criteria and notices alike, so a country can never
   * satisfy a route but miss a notice. */
  implies?: string[];
}

export interface FieldDef {
  id: string;
  label: string;
  type: "enum" | "money_band";
  /** money_band only: the period the amount is stated per, so a headline
   * number can never read as annual when it is monthly. */
  period?: "month" | "year";
  /**
   * attribute (default): a fixed fact (age, citizenship) — never counterfactualed.
   * path: a step one can take (get an offer, a transfer…).
   * improvable: changeable through effort/time (language, funds, recognition,
   * experience). path and improvable are both eligible for "what would this
   * unlock" analysis; useless directions drop out because they open nothing.
   */
  kind?: "attribute" | "path" | "improvable";
  options?: FieldOption[];
  /** Options that live in their own file instead of inline: the engine expands
   * the field into one option per country at derive time, so dataset.json
   * stays readable and the list can grow without touching a rule. */
  options_from?: "countries";
  /** Where a user who answered "I don't know" can find out — an official source. */
  learn?: { label: string; url: string };
  /** Pinned to the front of the interview regardless of elimination power
   * (the destination question frames every "there" that follows). */
  ask_first?: boolean;
  /** Eligible to qualify a path-step unlock row ("a job offer — in Germany").
   * Only fields whose answer is part of the same real-world decision as the
   * step itself belong here; anything else produces nonsense advice. */
  is_qualifier?: boolean;
}

export interface Unlock {
  field: string;
  option: FieldOption;
  /**
   * Set when the step only proves out together with one unanswered attribute
   * (e.g. "a job offer — in Germany" for a destination=all explorer, where
   * localization hinges on the never-asked situation_country). The row states
   * both assumptions; the routes are fully evaluated under both.
   */
  qualifier?: { field: string; option: FieldOption };
  routes: RouteResult[];
}

export interface Dataset {
  schema_version: string;
  dataset_version: string;
  fields: FieldDef[];
  countries: Country[];
  notices?: Notice[];
}

/** Answers keyed by field id. money_band fields hold a band id (see deriveBands). */
export type Profile = Record<string, string>;

export interface Band {
  id: string;
  /** inclusive lower bound; undefined = open below */
  min?: number;
  /** exclusive upper bound; undefined = open above */
  max?: number;
  label: string;
}

export interface Question {
  field: string;
  label: string;
  options: FieldOption[];
}

export type Outcome = "pass" | "fail" | "unknown";

export interface PointsBreakdown {
  scored: number;
  required: number;
  /** Only answered items that scored > 0. */
  items: { field: string; points: number }[];
}

export interface CriterionResult {
  criterion: Criterion;
  outcome: Outcome;
  /** For a failed gte criterion answered with the band just below: worst-case distance to the threshold. */
  gap_max?: number;
  /** For a fully answered points criterion that fell short: points still missing. */
  gap_points?: number;
  points?: PointsBreakdown;
}

export type RouteStatus = "met" | "near" | "hold";

export interface RouteResult {
  route: Route;
  country: string;
  status: RouteStatus;
  /** Failed on something no open unknown can rescue (see isRouteAlive). */
  hard_fail: boolean;
  criteria: CriterionResult[];
  gap_max?: number;
  gap_points?: number;
  points?: PointsBreakdown;
  unknown_fields: string[];
}

export interface DatasetMeta {
  schema_version: string;
  dataset_version: string;
  newest_retrieved_at: string | null;
}
