/** `gh`'s argument list → what it printed on standard output; rejects when `gh` fails. */
export type GhRunner = (args: readonly string[]) => Promise<string>;
