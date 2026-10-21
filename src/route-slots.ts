import { countryPossessive } from "./countries.js";
import { renderableTexts } from "./prose.js";
import type { Country, Dataset, Route } from "./types.js";

/**
 * A question names a route only through a slot holding the route's id,
 * `{route:<route id>}`. Filled, the slot says whose route it is, its plain
 * name, and what it is ("Germany's Opportunity Card — the permit to come and
 * look for work"), so no question names a route the reader has not been told
 * about. The phrase is there by construction; the gate only forbids a route's
 * plain name typed by hand.
 */
const ROUTE_SLOT = /\{route:([^{}]{1,80})\}/g;

/** The question texts a slot may stand in: the label, the help (the learn
 * link's label) and the subject. Every reader of these fills it. */
const SLOTTED_TEXT = /^\/fields\/\d+\/(?:label|subject|learn\/label)$/;

interface Slotted { country: Country; route: Route }

function slottedRoute(dataset: Dataset, id: string): Slotted | undefined {
  for (const country of dataset.countries)
    for (const route of country.routes) if (route.id === id) return { country, route };
  return undefined;
}

/**
 * A route's name without its bracketed citation: "Opportunity Card
 * (Chancenkarte, § 20a)" is the Opportunity Card. Brackets come off from the
 * inside out, since a citation may hold brackets of its own ("Researcher
 * (Directive (EU) 2016/801)").
 */
function plainNameOf(route: Route): string {
  let name = route.name;
  for (;;) {
    const next = name.replace(/\([^()]*\)/g, " ");
    if (next === name) return name.split(/\s+/).join(" ").trim();
    name = next;
  }
}

/** What stops a slot naming `id` from being filled: a route the dataset does
 * not have, or one that does not say what it is. Nothing where it can be. */
function slotProblemOf(dataset: Dataset, id: string): string | undefined {
  const slotted = slottedRoute(dataset, id);
  if (!slotted) return `a route slot names ${id}, which this dataset does not have`;
  if (!slotted.route.what_it_is) return `a route slot names ${id}, which does not say what it is (what_it_is)`;
  return undefined;
}

function slotPhrase(dataset: Dataset, id: string): string {
  const problem = slotProblemOf(dataset, id);
  if (problem) throw new Error(problem);
  const { country, route } = slottedRoute(dataset, id)!;
  return `${countryPossessive(country.code)} ${plainNameOf(route)} — ${route.what_it_is}`;
}

/** The text with each route slot filled. Throws on a slot naming a route the
 * dataset does not have, or one that does not say what it is. */
export function fillRouteSlots(text: string, dataset: Dataset): string {
  return text.replace(ROUTE_SLOT, (_, id: string) => slotPhrase(dataset, id));
}

export interface RouteSlotError {
  path: string;
  message: string;
  keyword: "routeSlot" | "routeNamedOutsideSlot";
}

/** Where a word starts or ends: no letter or digit runs on across it. */
const wholeWord = (name: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");

interface PlainName { route: Route; plain: string; name: RegExp }

/** Each slot in one of a question's texts that cannot stand: one where nothing
 * fills it, or one naming a route that cannot fill it. */
function slotErrorsIn(dataset: Dataset, path: string, text: string): RouteSlotError[] {
  return [...text.matchAll(ROUTE_SLOT)].flatMap(([, id]) => {
    const message = SLOTTED_TEXT.test(path)
      ? slotProblemOf(dataset, id!)
      : `a route slot ({route:${id}}) stands only in a question's label, help or subject — nothing fills it here`;
    return message ? [{ path, message, keyword: "routeSlot" as const }] : [];
  });
}

/** Each route whose plain name one of a question's texts types outside a slot. */
function typedNameErrorsIn(names: PlainName[], path: string, text: string): RouteSlotError[] {
  const outside = text.replace(ROUTE_SLOT, " ");
  return names.filter(({ name }) => name.test(outside)).map(({ route, plain }) => ({
    path,
    message: `"${plain}" names ${route.id} by hand — write {route:${route.id}}, which says what the route is`,
    keyword: "routeNamedOutsideSlot" as const,
  }));
}

/**
 * The gate over every question's words: a slot stands only where it is
 * filled and names a route that says what it is, and no route's plain name is
 * typed outside a slot.
 */
export function routeSlotErrors(dataset: Dataset): RouteSlotError[] {
  const names: PlainName[] = dataset.countries.flatMap((c) => c.routes).map((route) => {
    const plain = plainNameOf(route);
    return { route, plain, name: wholeWord(plain) };
  });
  return renderableTexts(dataset)
    .filter(({ path }) => path.startsWith("/fields/"))
    .flatMap(({ path, text }) => [...slotErrorsIn(dataset, path, text), ...typedNameErrorsIn(names, path, text)]);
}
