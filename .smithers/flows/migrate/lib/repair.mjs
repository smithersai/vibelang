// The repair agent's prompt: the generated idiom context (context.md) as its
// system part, then this batch: what the codemod did, what the compiler still
// reports, what verify will check, and how to record what it learns.

const diagnosticLines = (diagnostics) => diagnostics.map((d) =>
  `- ${d.file}:${d.line}:${d.column} ${d.category} ${d.code}: ${d.message}${d.notes.length ? "\n" + d.notes.map((n) => `  ${n}`).join("\n") : ""}`)

export function repairPrompt({ context, run, batch, target, packages, test, files, codemod, compile, step }) {
  const rewrites = Object.entries(codemod.fix.byFile).map(([file, kinds]) =>
    `- ${file}: ${Object.entries(kinds).map(([k, n]) => `${k} ×${n}`).join(", ")}`)
  const refused = codemod.fix.refused.map((r) => `- ${r.file}:${r.line} ${r.code} not fixed: the fixed program would report ${r.error}`)
  const batchDiagnostics = compile.diagnostics.filter((d) => files.includes(d.file))
  const elsewhere = compile.newErrors.filter((d) => !files.includes(d.file))
  return `${context.trimEnd()}

---

# Repair batch ${batch}

You finish the migration of one batch of ${packages.join(", ")} in \`${target}\` from Effect TypeScript to VibeLang. The codemod already renamed each file to .vibe, rewrote its imports and ran \`vibelang --fix\` until it found nothing more. You fix what is left and make the files idiomatic, as the context above teaches; correct is not enough.

## The batch

${files.map((f) => `- \`${f}\``).join("\n")}

## What the codemod did

Rewrites \`vibelang --fix\` applied:

${rewrites.length ? rewrites.join("\n") : "- none"}

${refused.length ? `Fixes it refused:\n\n${refused.join("\n")}\n` : "It refused no fix."}

## What the compiler reports

${batchDiagnostics.length ? diagnosticLines(batchDiagnostics).join("\n") : "No diagnostic in the batch's files."}
${elsewhere.length ? `\nNew errors outside the batch, in files that import it:\n\n${diagnosticLines(elsewhere).join("\n")}\n` : ""}
## Done means (verify checks each)

1. \`${test}\` passes: no test fails that passed before, and none is gone.
2. The package's emitted declarations are identical to the baseline's: the public API does not change.
3. The batch's files report no error, no TypeScript-style Effect form (EK48xx, except a Struct constant --fix leaves and a Context.Service class with no quick fix) and no platform global (EK4402), and no file reports an error it did not before.
4. Every batch file is idiomatic VibeLang, or stays .ts with a recorded reason.

Check as you go: \`${step} compile --run ${run} --batch ${batch}\` and \`${step} verify --run ${run} --batch ${batch}\`.

## Record what you learn

Append one JSON object per line to \`${run}/issues.jsonl\`:

- Each rewrite you made by hand that a mechanical rule could make: \`{"kind":"codemod-gap","batch":"${batch}","file":"...","pattern":"what to match","before":"the code --fix left","after":"what you wrote","count":1}\`. One entry per pattern, with its count.
- Each VibeLang bug or missing feature: \`{"kind":"issue","batch":"${batch}","title":"...","repro":"the smallest .vibe source that shows it","expected":"...","actual":"the diagnostic or behavior","files":["the files it blocks"]}\`.
- Each lesson about idiomatic VibeLang that the context above did not teach: \`{"kind":"idiom","batch":"${batch}","lesson":"one rule, imperative","before":"...","after":"..."}\`.

Never work around a VibeLang bug: no cast, \`any\`, hatch or \`module\` block to get past the compiler where the language should accept idiomatic code. Record the issue, then return the file to TypeScript with \`${step} revert --run ${run} --file <path.vibe> --reason "<issue title>"\` and go on with the rest.

When the batch passes verify, or every file that cannot pass is reverted with a recorded issue, finish with \`${step} repair --run ${run} --batch ${batch} --done\`.
`
}
