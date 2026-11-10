import type { Dataset, FieldDef } from "./types.js";

/**
 * An answer a reader can reach by acting (`is_attainable`) is what a step may
 * offer on a question the reader can improve: full or partial recognition, a
 * higher language level, more years of experience. This gate reads every
 * question's own answers, and refuses: an improvable question none of whose
 * answers is marked, since its steps would offer nothing or anything; and
 * "I don't know" marked, which no one reaches by acting. A money question's
 * answers are bands the engine derives from the thresholds, so it carries no
 * answers of its own to mark.
 */

export interface AttainableAnswerError {
  path: string;
  message: string;
  keyword: "improvableMarksAttainable" | "unknownNeverAttainable";
}

/** Whether a question is improvable, has answers of its own, and marks none of them. */
const isUnmarkedImprovable = (f: FieldDef): boolean =>
  f.kind === "improvable" && (f.options ?? []).length > 0 && !(f.options ?? []).some((o) => o.is_attainable);

/** Each improvable question with answers of its own, none of them marked. */
function unmarkedImprovableErrors(dataset: Dataset): AttainableAnswerError[] {
  return dataset.fields
    .filter(isUnmarkedImprovable)
    .map((f) => ({
      path: `/fields/${f.id}`,
      message: `${f.id} is a question a reader can improve, and none of its answers is marked is_attainable — mark the answers a reader can reach by acting`,
      keyword: "improvableMarksAttainable" as const,
    }));
}

/** Each "I don't know" answer marked as one a reader can reach. */
function attainableUnknownErrors(dataset: Dataset): AttainableAnswerError[] {
  return dataset.fields.flatMap((f) => (f.options ?? [])
    .filter((o) => o.is_unknown && o.is_attainable)
    .map((o) => ({
      path: `/fields/${f.id}`,
      message: `${f.id} = "${o.value}" is "I don't know" and is marked is_attainable — no one reaches not knowing by acting`,
      keyword: "unknownNeverAttainable" as const,
    })));
}

/** The gate over every question's answers a reader can reach by acting. */
export function attainableAnswerErrors(dataset: Dataset): AttainableAnswerError[] {
  return [...unmarkedImprovableErrors(dataset), ...attainableUnknownErrors(dataset)];
}
