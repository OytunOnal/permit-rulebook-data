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

export type Criterion =
  | { field: string; op: "eq"; value: string; note?: string }
  | { field: string; op: "in"; values: string[]; note?: string }
  | { field: string; op: "gte"; threshold: ProvenancedAmount; threshold_label?: string; note?: string }
  | { op: "points"; required: ProvenancedNumber; table: PointsTable; note?: string }
  /** Disjunction: the criterion passes when ANY path's criteria all pass (e.g. §20a "Fachkraft ODER Punktzahl"). */
  | { op: "any"; label?: string; paths: { label?: string; criteria: Criterion[] }[]; note?: string };

export interface Route {
  id: string;
  name: string;
  kind: "res-work" | "seek" | "self-employed";
  summary?: string;
  info_url: string;
  criteria: Criterion[];
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
}

export interface FieldDef {
  id: string;
  label: string;
  type: "enum" | "money_band";
  /**
   * attribute (default): a fixed fact (age, citizenship) — never counterfactualed.
   * path: a step one can take (get an offer, a transfer…).
   * improvable: changeable through effort/time (language, funds, recognition,
   * experience). path and improvable are both eligible for "what would this
   * unlock" analysis; useless directions drop out because they open nothing.
   */
  kind?: "attribute" | "path" | "improvable";
  options?: FieldOption[];
  /** Where a user who answered "I don't know" can find out — an official source. */
  learn?: { label: string; url: string };
}

export interface Unlock {
  field: string;
  option: FieldOption;
  routes: RouteResult[];
}

export interface Dataset {
  schema_version: string;
  dataset_version: string;
  fields: FieldDef[];
  countries: Country[];
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
