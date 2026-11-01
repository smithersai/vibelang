// The plan: an ordered list of small batches, each with a reason. The agent
// writes it; this module drafts a deterministic starting point, renders the
// agent's prompt, and validates what the agent returns before any later step
// reads it.
import { isDeclarationFile } from "./util.mjs"
import { posix } from "node:path"

export const defaultLimits = { maxFiles: 6, maxLines: 900 }

/**
 * A tool's config, which the tool finds by its name and loads with its own
 * TypeScript loader: `graphql.config.ts`, `vitest.config.ts`,
 * `drizzle.config.ts`. Renamed to .vibe, the tool finds no config. The one
 * exception is a Vite config whose package scripts setup wired with
 * `--import=vibelang/register` and `--configLoader native` (nativeConfigs):
 * Vite loads it as .vibe when the codemod names it with `--config`.
 */
export function isToolConfig(path) {
  return /\.config\.(?:ts|mts)$/.test(posix.basename(path))
}

/** The files a migration may move to .vibe: sources that use Effect values, but no tool's config unless setup wired its native loader. Tests stay .ts unless asked. */
export function candidates(inventory, { includeTests = false, nativeConfigs = [] } = {}) {
  return inventory.files.filter((f) => f.effect === "values" && (includeTests || !f.test) && /\.(?:ts|mts)$/.test(f.path) && !isDeclarationFile(f.path) && (!isToolConfig(f.path) || nativeConfigs.includes(f.path)) && !f.namedBy && !f.bundledBy?.length)
}

/** Report the full owned inventory separately from automatic and explicit selections (detail 279). */
export function migrationScope(inventory, plan, options = {}) {
  if (!inventory) return null
  const owned = [...new Map(inventory.files.map(file => [file.path, {
    path: file.path, effect: file.effect, test: Boolean(file.test)
  }])).values()].sort((a, b) => a.path.localeCompare(b.path))
  const automaticCandidates = [...new Set(candidates(inventory, options).map(file => file.path))].sort()
  const planned = [...new Set((plan?.batches ?? []).flatMap(batch => batch.files))].sort()
  const selected = new Set(planned)
  const typeOnly = owned.filter(file => file.effect === "types" && /\.(?:ts|mts|cts|tsx)$/.test(file.path))
  const retainedTypeOnly = typeOnly.filter(file => !selected.has(file.path)).map(file => ({
    path: file.path, reason: "only Effect type imports; retained as TypeScript by the default plan"
  }))
  const explicitTypeOnly = typeOnly.filter(file => selected.has(file.path)).map(file => file.path)
  return {
    owned, automaticCandidates, planned, retainedTypeOnly, explicitTypeOnly,
    counts: {
      owned: owned.length, effectImports: owned.filter(file => file.effect === "values" || file.effect === "types").length,
      automaticCandidates: automaticCandidates.length, planned: planned.length,
      retainedTypeOnly: retainedTypeOnly.length, explicitTypeOnly: explicitTypeOnly.length
    }
  }
}

/**
 * Dependency levels among the candidates: a file that imports no other
 * candidate is level 0 (a leaf), else one more than its deepest candidate
 * import. Files in an import cycle share one level, after everything they
 * import outside the cycle.
 */
export function levels(files) {
  const inScope = new Map(files.map((f) => [f.path, f]))
  const deps = new Map(files.map((f) => [f.path, f.imports.filter((p) => inScope.has(p) && p !== f.path)]))
  const level = new Map()
  let remaining = files.map((f) => f.path)
  let current = 0
  while (remaining.length) {
    const ready = remaining.filter((p) => deps.get(p).every((d) => level.has(d)))
    const next = ready.length ? ready : remaining // a cycle: place what is left together
    for (const p of next) level.set(p, current)
    remaining = remaining.filter((p) => !level.has(p))
    current++
  }
  return level
}

const tested = (f) => f.testedBy.length > 0 || (f.coverage ?? 0) > 0

/** A deterministic draft: leaves first, tested and covered files first within a level, packed into batches by directory. */
export function draftPlan(inventory, limits = defaultLimits, options = {}) {
  const files = candidates(inventory, options)
  const level = levels(files)
  const order = [...files].sort((a, b) =>
    level.get(a.path) - level.get(b.path) ||
    Number(tested(b)) - Number(tested(a)) ||
    posix.dirname(a.path).localeCompare(posix.dirname(b.path)) ||
    (b.coverage ?? -1) - (a.coverage ?? -1) ||
    a.lines - b.lines ||
    a.path.localeCompare(b.path))
  const batches = []
  let batch
  for (const f of order) {
    const fits = batch && batch.level === level.get(f.path) && batch.tested === tested(f) &&
      batch.files.length < limits.maxFiles && batch.lines + f.lines <= limits.maxLines
    if (!fits) {
      batch = { files: [], lines: 0, level: level.get(f.path), tested: tested(f), coverage: [] }
      batches.push(batch)
    }
    batch.files.push(f.path)
    batch.lines += f.lines
    if (f.coverage !== null) batch.coverage.push(f.coverage)
  }
  return {
    version: 1,
    batches: batches.map((b) => ({
      files: b.files,
      reason: [
        b.level === 0 ? "leaves: import no other Effect module in scope" : `level ${b.level}: imports only Effect modules from earlier batches`,
        b.tested ? `tested${b.coverage.length ? `, line coverage ${Math.min(...b.coverage)}-${Math.max(...b.coverage)}%` : ""}` : "no test imports these files: verify relies on dependents' tests",
        `${b.lines} lines`
      ].join("; ")
    })),
    deferred: inventory.files.filter(f => f.bundledBy?.length).map(f => ({file:f.path,reason:f.bundleReason??"test-owned bundle graph stays TypeScript (decided detail 272)"})),
    notes: "Drafted by plan.mjs without a model."
  }
}

/** Problems with a plan the agent returned: errors stop the run, warnings are recorded. */
export function validatePlan(plan, inventory, limits = defaultLimits, { nativeConfigs = [] } = {}) {
  const errors = []
  const warnings = [...(inventory.bundleWarnings ?? [])]
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.batches) || !plan.batches.length) {
    return { errors: ["the plan needs a non-empty batches array"], warnings }
  }
  const byPath = new Map(inventory.files.map((f) => [f.path, f]))
  const batchOf = new Map()
  plan.batches.forEach((batch, index) => {
    const name = `batch ${index + 1}`
    if (!Array.isArray(batch.files) || !batch.files.length) errors.push(`${name}: files must be a non-empty array`)
    if (typeof batch.reason !== "string" || !batch.reason.trim()) errors.push(`${name}: a reason is required`)
    let lines = 0
    for (const path of batch.files ?? []) {
      const f = byPath.get(path)
      if (!f) { errors.push(`${name}: ${path} is not in the inventory`); continue }
      if (batchOf.has(path)) errors.push(`${name}: ${path} is already in batch ${batchOf.get(path) + 1}`)
      batchOf.set(path, index)
      if (!/\.(?:ts|mts)$/.test(path) || isDeclarationFile(path)) errors.push(`${name}: ${path} is not a .ts module or .mts source module; only those files become .vibe`)
      if (f.effect === "none") errors.push(`${name}: ${path} has no Effect code, so it keeps its TypeScript filename`)
      if (f.bundledBy?.length) errors.push(name + ": " + path + " belongs to a test-owned bundle graph and stays TypeScript: " + (f.bundleReason ?? "decided detail 272"))
      if (isToolConfig(path) && !nativeConfigs.includes(path)) errors.push(`${name}: ${path} is a tool's config, which the tool finds by its name, so it keeps its TypeScript filename`)
      else if (f.namedBy) errors.push(`${name}: ${path} is a file ${f.namedBy} finds by its name, so it keeps its TypeScript filename`)
      else if (f.effect === "types") warnings.push(`${name}: ${path} imports only Effect types`)
      lines += f.lines
    }
    if ((batch.files?.length ?? 0) > limits.maxFiles) errors.push(`${name}: ${batch.files.length} files; a batch holds at most ${limits.maxFiles}`)
    // One file is the smallest batch: a file over the limit goes alone, with a warning.
    if (lines > limits.maxLines) (batch.files?.length === 1 ? warnings : errors).push(`${name}: ${lines} lines; a batch holds at most ${limits.maxLines}${batch.files?.length === 1 ? ", but one file cannot be split" : ""}`)
  })
  for (const [path, index] of batchOf) {
    const f = byPath.get(path)
    if (!f) continue
    for (const dep of f.imports) {
      if (batchOf.has(dep) && batchOf.get(dep) > index) warnings.push(`batch ${index + 1}: ${path} imports ${dep}, which a later batch (${batchOf.get(dep) + 1}) migrates`)
    }
    if (index === 0 && !tested(f)) warnings.push(`batch 1: ${path} has no test that imports it and no coverage`)
  }
  for (const d of plan.deferred ?? []) {
    if (!d || typeof d.file !== "string" || typeof d.reason !== "string") errors.push("deferred entries are { file, reason }")
  }
  return { errors, warnings }
}

const row = (cells) => `| ${cells.join(" | ")} |`

/** The planning agent's prompt: the task, the rules, the candidates and the draft. */
export function planPrompt({ inventory, draft, limits = defaultLimits, output, nativeConfigs = [] }) {
  const files = candidates(inventory, { nativeConfigs })
  const level = levels(files)
  const table = [
    row(["File", "Lines", "Tokens", "Effect imports", "Imports (in scope)", "Dependents", "Tests", "Coverage", "Level"]),
    row(["---", "---:", "---:", "---", "---", "---:", "---:", "---:", "---:"]),
    ...files.map((f) => row([
      f.path, String(f.lines), String(f.tokens ?? ""), f.effectImports.join(", "),
      f.imports.filter((p) => level.has(p)).join(", ") || "-",
      String(f.dependents.length), String(f.testedBy.length), f.coverage === null ? "-" : `${f.coverage}%`, String(level.get(f.path))
    ]))
  ]
  return `# Plan an incremental migration to VibeLang

You order the migration of ${inventory.packages.join(", ")} from Effect TypeScript to VibeLang. A later step migrates one batch at a time, mechanically first (rename to .vibe, then vibelang --fix), then with an agent, and gates each batch on the package's tests and its emitted declarations. You plan; you change no file.

## Rules

- Small batches: at most ${limits.maxFiles} files and ${limits.maxLines} lines each, small enough to finish, test and review in one pass.
- Leaves and well-tested modules first: a file whose own Effect imports are already migrated, or stay .ts, and that tests cover. An untested file goes after the files whose tests exercise it.
- Files whose Effect imports are all types stay TypeScript in the default draft; they remain in the owned inventory. Explicit selection is allowed with its existing warning and every compilation, declaration, runtime, tool and protected-test gate. Type-only import spelling alone does not prove the original program is valid.
- Files with no Effect code stay .ts; they are not candidates. Neither is a tool's config, \`graphql.config.ts\`, which the tool finds by its name${nativeConfigs.length ? `, except a Vite config whose scripts setup wired with the native config loader (${nativeConfigs.map((f) => `\`${f}\``).join(", ")}): the codemod names it with \`--config\`` : ""}, or a file whose name the repository writes as a string, such as \`alchemy.run.ts\`. Tests stay .ts unless a test file is itself Effect code (\`it.effect\`); put such a test in its module's batch.
- A module with \`bundledBy\` is reached by an unchanged test-owned bundle. Keep its runtime source graph TypeScript (decided detail 272); an explicit or stale plan cannot override the boundary. The draft names each retaining test and entry.
- Keep a directory's files together when the limits allow, so one review reads one module.
- Defer a file that cannot become idiomatic VibeLang yet (for example, it is mostly a Promise or callback library, or it needs a TypeScript-only construct), with the reason.
- Give each batch one sentence of reason: why it comes at this point in the order.

## Output

Write one JSON object to \`${output}\`, and nothing else:

\`\`\`json
{
  "version": 1,
  "batches": [{ "files": ["${files[0]?.path ?? "packages/x/src/a.ts"}"], "reason": "..." }],
  "deferred": [{ "file": "...", "reason": "..." }],
  "notes": "..."
}
\`\`\`

Every path is relative to the repository root, as in the table. \`node .smithers/flows/migrate/step.mjs plan --run <run> --accept ${output}\` validates it.

## Candidates

${inventory.summary.effectValueFiles} files use Effect values; ${files.length} are candidates. Level is the dependency depth among candidates (0: imports no other candidate).

${table.join("\n")}

## A deterministic draft

Reorder, regroup or defer as the rules say; keep what is right.

\`\`\`json
${JSON.stringify(draft, null, 2)}
\`\`\`
`
}
