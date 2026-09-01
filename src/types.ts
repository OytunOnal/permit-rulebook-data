export interface ProvenancedAmount {
  amount: number;
  currency: "EUR";
  source_url: string;
  quote: string;
  retrieved_at: string; // YYYY-MM-DD
  legal_basis?: string;
  history?: { amount: number; retrieved_at: string; quote?: string; source_url?: string }[];
}

export type Criterion =
  | { field: string; op: "eq"; value: string; note?: string }
  | { field: string; op: "gte"; threshold: ProvenancedAmount; threshold_label?: string; note?: string };

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
  is_unknown?: boolean;
}

export interface FieldDef {
  id: string;
  label: string;
  type: "enum" | "money_band";
  options?: FieldOption[];
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

export interface CriterionResult {
  criterion: Criterion;
  outcome: Outcome;
  /** For a failed gte criterion answered with the band just below: worst-case distance to the threshold. */
  gap_max?: number;
}

export type RouteStatus = "met" | "near" | "hold";

export interface RouteResult {
  route: Route;
  country: string;
  status: RouteStatus;
  criteria: CriterionResult[];
  gap_max?: number;
  unknown_fields: string[];
}

export interface DatasetMeta {
  schema_version: string;
  dataset_version: string;
  newest_retrieved_at: string | null;
}
