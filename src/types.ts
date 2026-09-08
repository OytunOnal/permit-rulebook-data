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
 * `short_reason`: what this criterion asks for, as a noun phrase a person
 * would say ("an age of 30 or older"). It overrides the phrasing derived from
 * the named options, for criteria whose option list reads badly in a sentence.
 * A verdict line is built from these, never from the field id (s5d).
 */
/**
 * What every criterion may carry beside the condition itself.
 *
 * `source`: the authority's own words for the condition this criterion checks —
 * the same provenance a threshold carries, for a condition that is not a
 * number. Until s5e only `gte` and `points` could be sourced, so the evidence
 * behind an `eq` lived in `note`, a bare string 39 of whose 45 instances quoted
 * an authority with no URL and no read date, watched by nothing and rendered
 * nowhere. A criterion's source joins the card's source list and the
 * quote-fidelity gate like any other value.
 *
 * There is deliberately no `note` here any more. It was the one slot whose
 * text resolved to no declared kind — neither the authority's words nor
 * declared ours — and that ambiguity is where "Recognised by the state where
 * it was acquired — German recognition not required (§ 6 BeschV)" sat: a claim
 * about the law, citing a statute, carrying no source, and passing every gate
 * because it happened to contain no quotation mark (review 2026-09-07). Its
 * two honest homes both exist: `source` for the authority's ground, and
 * `Route.readings` for our own reading, which the card shows as ours.
 * Maintainer prose that is neither belongs in `data/exclusions.md`.
 */
interface CriterionExtras {
  source?: ProvenancedText;
  short_reason?: string;
}

export type Criterion =
  | ({ field: string; op: "eq"; value: string } & CriterionExtras)
  | ({ field: string; op: "in"; values: string[] } & CriterionExtras)
  | ({ field: string; op: "gte"; threshold: ProvenancedAmount; threshold_label?: string } & CriterionExtras)
  | ({ op: "points"; required: ProvenancedNumber; table: PointsTable } & CriterionExtras)
  /** Disjunction: the criterion passes when ANY path's criteria all pass (e.g. §20a "Fachkraft ODER Punktzahl"). */
  | ({ op: "any"; label?: string; paths: { label?: string; criteria: Criterion[] }[] } & CriterionExtras);

/**
 * What a source says about one route that no criterion can compute.
 *
 * A precondition is our plain language and carries no provenance; a threshold
 * carries provenance but has to be a number. Between them sat statements the
 * source makes in words — a precondition the interview cannot ask about, or a
 * qualification the source puts on its own answer — and the dataset had
 * nowhere to put them, so they were written as our own editorial `note` or,
 * worse, invented as a criterion (the orientation year's "you have no offer",
 * removed 2026-09-07). This is the place: our words in `text`, the source's
 * in `source.quote`, watched and quote-checked like any other value.
 */
export interface RouteStatement {
  id: string;
  /** precondition: something the applicant must satisfy that the interview
   * never asks. It renders into the same list under the same heading as
   * `route.preconditions`, so it IS a Precondition — one that carries its
   * quote. `condition` was a coined synonym for a term the glossary fixes
   * (review 2026-09-07). caveat: a qualification the source puts on its own
   * answer; it sits beside the verdict and fails nobody. */
  kind: "precondition" | "caveat";
  /** Our plain English — what the reader sees. */
  text: string;
  /** The source's own words. Absent only where they could not be found: then
   * `unsourced` says why, and the card says so too. Borrowing a neighbouring
   * quote that does not cover the sentence would be inventing provenance. */
  source?: ProvenancedText;
  /** Why this statement carries no quote — required when `source` is absent,
   * forbidden when it is present. */
  unsourced?: UnsourcedReason;
}

/**
 * OUR reading of a route — what we modelled, what we did not, and where a
 * number came from a page no machine re-reads.
 *
 * It shipped as a third `RouteStatement` kind (`modelling`) until this review.
 * The glossary defines a Route statement as "something a source says about one
 * route … in the source's own words"; a reading is by definition not something
 * a source says, so it was an undeclared second exception to Provenance living
 * inside the construct built for the authority's words, and it needed the kind
 * enum checked at nine sites across two repos to be told apart from one. Its
 * own array says in the type system what the glossary says: statements are the
 * source's, readings are ours.
 *
 * A reading carries no `source` and no `unsourced` — not because the rule is
 * relaxed for it, but because there is no authority to cite and no absence to
 * explain. Being in this array IS the attribution, and the card renders it
 * under "Our reading, not the authority's words".
 */
export interface RouteReading {
  id: string;
  /** Our own words, shown to the reader as ours. */
  text: string;
}

/**
 * Why one statement has no quote: the single exception to the rule that a
 * value carries a source URL, a verbatim quote and a retrieval date TO EXIST.
 *
 * It shipped as a text box with a minimum length, which made the provenance
 * gate optional by prose — eleven characters of anything passed, and the
 * Spanish shortage-occupation line's own "(checked 2026-09-07)" sat inside
 * free text where nothing could read it (review 2026-09-07). The exception is
 * an attributable decision now: a reason from a fixed set a gate can read, and
 * a date in the shape `retrieved_at` takes, so it ages the same way. Prose is
 * welcome in `note` — in addition to both, never in place of either.
 */
/**
 * The fixed set of reasons, as words. Exported as a value because the same
 * words are needed at runtime and by tests, and because the watch says one of
 * them too: a PDF the decoder finds no text in is `scanned-image`, the very
 * word a statement uses for a source published only as a picture. It had a
 * second spelling there ("no text layer") and one fact with two names is two
 * facts to the next reader (review 2026-09-07).
 *
 * scanned-image: published only as a scan whose text cannot be extracted.
 * not-published-in-words: stated as a list, table or form, never in a sentence
 * there is anything to quote. unreachable: no fetch from here reaches the
 * source at all.
 *
 * Grow this list only when a case genuinely occurs — an enumeration nobody can
 * extend by writing prose is the whole point. The JSON schema carries the same
 * three; `tests/blockers.test.ts` holds them to each other.
 */
export const UNSOURCED_REASONS = ["scanned-image", "not-published-in-words", "unreachable"] as const;

export type UnsourcedReasonWord = (typeof UNSOURCED_REASONS)[number];

export interface UnsourcedReason {
  reason: UnsourcedReasonWord;
  /** The day we last went looking and did not find it. */
  checked_at: string;
  /** Which document, which page, what was tried — what the reason cannot say. */
  note?: string;
}

/**
 * A route's Scope statement: how much of it the interview actually decides,
 * said in plain words, plus the limbs it does not ask.
 *
 * The value a stranger reads on the route page and on the results card. It is a
 * declared fact per route, authored by a person and never derived by a test:
 * the curator writes it from `data/exclusions.md` and the route's own readings,
 * and the schema refuses a route without it — absence would render as silence,
 * and silence on this question reads as "we asked everything".
 *
 * It is called `scope`, not `coverage`: "coverage" already names the watch's
 * both-way check over the watchlist, and it sits on the avoid-list of Prose
 * provenance in the glossary (Standards review, 2026-09-07).
 *
 * The words are deliberately not ours. "Fully modelled" shipped on the first
 * route-page mock and the isolated critique took it apart: pipeline vocabulary
 * a stranger cannot parse, worn as a badge in the criteria-met green, retracted
 * by its own next sentence (B3, 2026-09-07).
 */
export const SCOPE_VALUES = [
  /** Every rule this route turns on is a question the interview asks. */
  "every-deciding-rule-asked",
  /** The page states conditions — the authority's, or our own reading — that
   * decide the case and the interview does not ask about. It names which. */
  "some-conditions-stated-not-asked",
  /** The route's rules are quoted and shown; nothing on it is asked. */
  "rules-quoted-nothing-asked",
] as const;

export type ScopeValue = (typeof SCOPE_VALUES)[number];

export interface RouteScope {
  value: ScopeValue;
  /**
   * The limbs this route names to the reader and never asks about — statement
   * ids and reading ids, exactly as the page prints them.
   *
   * It exists because the prose reason alone cannot be checked against
   * anything: the first cut of the invariant read `named in exclusions.md OR
   * states something unasked`, whose right side is true of every route the
   * dataset ships, so nothing was ever compared to `data/exclusions.md`
   * (Standards review, 2026-09-07). With the limbs named as ids, the file's own
   * machine-readable twin and the page can be held to each other in both
   * directions.
   */
  not_asked: string[];
  /**
   * The curator's one line beside the value: what is asked here and what is
   * not. Our own words about our own interview — declared ours in
   * `renderableTexts`, like a Route reading, because being here IS the
   * attribution. It never states what the law requires: the conditions it
   * points at carry their own quotes on the same page.
   */
  reason: string;
}

export interface Route {
  id: string;
  name: string;
  kind: "res-work" | "seek" | "self-employed";
  summary?: string;
  info_url: string;
  /** What the interview asks of this route, declared. Required: a route with
   * no scope statement fails validation (s6 decision 3). */
  scope: RouteScope;
  criteria: Criterion[];
  /** Plain-language conditions the authority applies that the interview does
   * NOT ask — stated on the card so "criteria met" never overpromises. */
  preconditions?: string[];
  /** Provenanced statements the source makes that no criterion can compute. */
  statements?: RouteStatement[];
  /** Our own readings of this route — declared ours, never an authority's. */
  readings?: RouteReading[];
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
  /**
   * What choosing this answer MEANS here, in our words, where the label alone
   * leaves two answers hard to tell apart.
   *
   * A reader whose employer is moving them to a branch abroad read "I have (or
   * am about to get) a job offer there" as their situation, took the
   * highly-skilled-migrant route as open to them, and only the authority's own
   * page says otherwise (human walk, 2026-09-08). The distinction is about what
   * THIS interview means by the answer, so it is ours and it lives beside the
   * option rather than in a renderer.
   *
   * It may carry the token `{place}`, which the reader's declared destination
   * fills in — nothing here names a country.
   */
  means?: string;
  /** Names a person may type that are not the label — former or English names
   * ("Turkey", "Holland"). Search keys only; never displayed. */
  aliases?: string[];
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
  /**
   * How the fact is named in the answer ledger — a plain noun ("Passport",
   * "Monthly salary"). It exists so no consumer ever needs a field-id-to-label
   * map of its own: the page had one, and every field it had not heard of fell
   * through to the raw id, which is how "Not met: situation" shipped
   * (product-critique v0.7, B3).
   */
  short_label: string;

  /**
   * What the answer that is not an amount is called on a money question — the
   * door for a reader the question does not fit. Optional: the question layer
   * has a plain default, and only a field whose own wording needs something
   * more particular has to say so.
   */
  unknown_label?: string;
  /**
   * The fact as a noun phrase inside a sentence: "whether Germany recognises
   * your qualification". A verdict says this, never the field id.
   */
  subject: string;
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

/**
 * Two answers a person cannot honestly give at once.
 *
 * The engine takes the more specific answer and evaluates on — that is not
 * wrong. What was wrong was the silence: a reader who said she had no
 * qualification and then that she had graduated was handed a met verdict with
 * both answers in her sidebar and nothing pointing at the pair (isolated
 * v1-gate critique, 2026-09-08, F7).
 *
 * It lives in the dataset because it is a fact about these questions, in the
 * words a reader is shown, and because a pair someone adds later must not need
 * a release of the site to say it.
 */
export interface Contradiction {
  id: string;
  /** Each side: the field, and the answers on that side of the pair. */
  when: { field: string; in: string[] }[];
  /** What the screen says, in full sentences, naming no field id. */
  say: string;
}

export interface Dataset {
  schema_version: string;
  dataset_version: string;
  fields: FieldDef[];
  countries: Country[];
  notices?: Notice[];
  contradictions?: Contradiction[];
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

/**
 * The path of a disjunction that decided the outcome: the one that passed or,
 * where none did, the nearest reachable one the gap was measured against.
 * A route whose salary criterion is an `any` used to render whichever
 * threshold was written first, so a graduate met through the €3,122 path was
 * shown "criteria met" beside a rail labelled €4,357 with his declared band
 * under the line — a verdict and a picture of the same man failing, on one
 * card (human catch 2026-09-07).
 */
export interface DecidedPath {
  /** Position in the criterion's own `paths` array. */
  index: number;
  label?: string;
  criteria: CriterionResult[];
}

export interface CriterionResult {
  criterion: Criterion;
  outcome: Outcome;
  /** For a failed gte criterion answered with the band just below: worst-case distance to the threshold. */
  gap_max?: number;
  /** For a fully answered points criterion that fell short: points still missing. */
  gap_points?: number;
  points?: PointsBreakdown;
  /** `any` only, and only once something has decided it. */
  path?: DecidedPath;
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
