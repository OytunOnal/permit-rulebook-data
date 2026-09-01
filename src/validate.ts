import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../schema/ruleset.schema.json" with { type: "json" };
import type { Dataset } from "./types.js";

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

/**
 * Boundary validation: everything entering the engine passes the JSON Schema
 * first. A value without its quote, source URL or retrieval date is not data —
 * the build must fail naming the missing field.
 */
export function validateDataset(data: unknown): ValidationResult {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateFn = ajv.compile(schema as object);
  const ok = validateFn(data) as boolean;
  const errors: ValidationError[] = (validateFn.errors ?? []).map((e) => ({
    path: e.instancePath || "/",
    message: e.message ?? "invalid",
    keyword: e.keyword,
  }));
  return { ok, errors };
}

export function assertValidDataset(data: unknown): Dataset {
  const result = validateDataset(data);
  if (!result.ok) {
    // With oneOf schemas ajv reports every branch; the deepest instancePath
    // points closest to the actual offending field.
    const deepest = [...result.errors].sort((a, b) => b.path.length - a.path.length)[0];
    throw new Error(
      `dataset invalid: ${deepest.path} ${deepest.message} (${result.errors.length} error(s) total)`,
    );
  }
  return data as Dataset;
}
