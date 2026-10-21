import type { Dataset } from "./types.js";
import { sourceUrls } from "./lang.js";

/**
 * Whose page a source is.
 *
 * The site promises the authority's own sentence, and a link is labelled by
 * whose page it opens: an authority's own, or a consolidated text that someone
 * other than the authority publishes. The kind is read off the host, from two
 * declared lists, and there is deliberately no default: a host on neither list
 * is a page nobody has classified, and `unlistedLinkHostsOf` fails the build
 * rather than letting a mirror ship under the authority's label.
 */
export type HostKind = "authority" | "consolidated-text";

/** Hosts that publish their own rules, or the official text of them. */
export const AUTHORITY_HOSTS: readonly string[] = [
  "anabin.kmk.org",
  "entreprendre.service-public.gouv.fr",
  "eur-lex.europa.eu",
  "europa.eu",
  "ind.nl",
  "kairo.diplo.de",
  "wetten.overheid.nl",
  "www.arbeitsagentur.de",
  "www.bamf.de",
  "www.bmi.bund.de",
  "www.boe.es",
  "www.inclusion.gob.es",
  "www.legifrance.gouv.fr",
  "www.service-public.gouv.fr",
  "www.uwv.nl",
];

/**
 * Hosts that publish a consolidated text of a statute, not the authority. The
 * German statutes are read at buzer.de because the official
 * gesetze-im-internet.de refuses the watch and times out from Türkiye; a
 * person re-checks the mirrored quotes against it quarterly (watchlist notes).
 */
export const CONSOLIDATED_TEXT_HOSTS: readonly string[] = ["www.buzer.de"];

function listedKindOf(host: string): HostKind | undefined {
  if (AUTHORITY_HOSTS.includes(host)) return "authority";
  if (CONSOLIDATED_TEXT_HOSTS.includes(host)) return "consolidated-text";
  return undefined;
}

/** What is wrong with a host on neither list, and where to put it right. */
export function unlistedHostMessageOf(host: string): string {
  return `${host} is on neither the authority hosts nor the consolidated-text hosts (src/hosts.ts) — add it to the list it belongs on`;
}

/** The kind of a source's host. Throws on a host on neither list. */
export function hostKindOf(sourceUrl: string): HostKind {
  const host = new URL(sourceUrl).host;
  const kind = listedKindOf(host);
  if (!kind) throw new Error(unlistedHostMessageOf(host));
  return kind;
}

/** Every address a page links a reader to: the sources, and the learn links. */
function linkedUrls(dataset: Dataset): string[] {
  const learn = [...dataset.fields, ...(dataset.notices ?? [])].flatMap((x) => (x.learn ? [x.learn.url] : []));
  return [...new Set([...sourceUrls(dataset), ...learn])];
}

/** The hosts the dataset links to that are on neither list. */
export function unlistedLinkHostsOf(dataset: Dataset): string[] {
  const hosts = linkedUrls(dataset).map((u) => new URL(u).host);
  return [...new Set(hosts)].filter((h) => listedKindOf(h) === undefined).sort();
}
