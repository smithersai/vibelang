// issues.jsonl: what a run teaches the next one. The repair agent appends one
// JSON object per line; the report groups them; the README says where each
// kind goes next (a line of rules.md or a VibeLang issue).
import { readJsonl } from "./util.mjs"

export const kinds = {
  // A rewrite the agent made by hand that a mechanical rule could make.
  "codemod-gap": ["batch", "pattern", "before", "after"],
  // A VibeLang bug or missing feature, with a minimal reproduction.
  issue: ["batch", "title", "repro", "actual"],
  // A lesson about idiomatic VibeLang the context did not teach.
  idiom: ["batch", "lesson"]
}

/** Problems with one entry; an empty list when it is well formed. */
export function validateIssue(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return ["an entry is a JSON object"]
  const required = kinds[entry.kind]
  if (!required) return [`kind must be one of ${Object.keys(kinds).join(", ")}`]
  const problems = []
  for (const key of required) if (typeof entry[key] !== "string" || !entry[key].trim()) problems.push(`${entry.kind}: ${key} is required`)
  if (entry.files !== undefined && (!Array.isArray(entry.files) || entry.files.some((f) => typeof f !== "string"))) problems.push(`${entry.kind}: files is a list of paths`)
  return problems
}

/** Every entry of a run's issues.jsonl, each with its problems. */
export function readIssues(path) {
  return readJsonl(path).map((entry, index) => ({ line: index + 1, entry, problems: validateIssue(entry) }))
}

/** The entries of one kind, optionally of one batch. */
export const ofKind = (issues, kind, batch) => issues.filter((i) => i.entry.kind === kind && (batch === undefined || i.entry.batch === batch)).map((i) => i.entry)
