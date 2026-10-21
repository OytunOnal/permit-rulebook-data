import type { Dataset, Route } from "../src/types.js";

/** The route a dataset holds under an id. Throws where it holds none, so a
 * case never reads a property of nothing. */
export function routeOf(dataset: Dataset, id: string): Route {
  const route = dataset.countries.flatMap((c) => c.routes).find((r) => r.id === id);
  if (!route) throw new Error(`precondition: the dataset holds a route ${id}`);
  return route;
}
