#!/usr/bin/env node
// Runs one step of the migrate flow standalone, against a run directory, so a
// person or an agent session can drive a migration step by step. flow.ts runs
// the same steps as a Smithers flow.
//
//   node .smithers/flows/migrate/step.mjs toolchain --vibelang <checkout> --out <dir>
//   node .smithers/flows/migrate/step.mjs upgrade-effect --run <dir> --target <repo> --package <dir> --test "<command>" --toolchain <dir>
//   node .smithers/flows/migrate/step.mjs setup --run <dir>
//   node .smithers/flows/migrate/step.mjs plan --run <dir> [--accept <plan.json> | --agent "<command>"]
//   node .smithers/flows/migrate/step.mjs codemod|compile|verify|record --run <dir> [--batch NN]
//   node .smithers/flows/migrate/step.mjs repair --run <dir> [--batch NN] [--agent "<command>" | --done]
//   node .smithers/flows/migrate/step.mjs revert --run <dir> --file <path.vibe> --reason "<text>"
//   node .smithers/flows/migrate/step.mjs next|report --run <dir>
import { parseArgs, many, one } from "./lib/args.mjs"
import { steps, nextStep } from "./lib/steps.mjs"
import { stageToolchain } from "./lib/toolchain.mjs"

const usage = `usage: node .smithers/flows/migrate/step.mjs <step> --run <dir> [options]
steps: toolchain, upgrade-effect, setup, plan, codemod, compile, repair, revert, verify, record, report, next
upgrade-effect options, which setup reads from the run: --target <repo> --package <dir>... --source <dir>... --test "<command>" [--test-cwd <dir>]
               (--toolchain <dir> | --vibelang-version <v>) [--tsconfig <file>] [--dts-tsconfig <file>]
               [--install "<command>"] [--no-wire] [--max-files N] [--max-lines N] [--allow-dirty]
               [--base <revision>] [--bookmark <name>]`

async function main(argv) {
  const { step, options } = parseArgs(argv)
  if (!step || step === "help" || options.help) return console.log(usage)
  if (step === "toolchain") return print(await stageToolchain({ vibelang: one(options, "vibelang"), out: one(options, "out") }))
  const run = one(options, "run")
  if (step === "next") return print(nextStep(run))
  const fn = steps[step]
  if (!fn) throw new Error(`unknown step ${step}\n${usage}`)
  const result = await fn({
    run,
    batch: options.batch,
    target: options.target,
    packages: many(options.package),
    sources: many(options.source),
    test: options.test,
    testCwd: options["test-cwd"],
    testReport: options["test-report"],
    toolchain: options.toolchain,
    vibelangVersion: options["vibelang-version"],
    tsconfig: options.tsconfig,
    dtsTsconfig: options["dts-tsconfig"],
    install: options.install,
    wire: !options["no-wire"],
    maxFiles: options["max-files"],
    maxLines: options["max-lines"],
    allowDirty: Boolean(options["allow-dirty"]),
    accept: options.accept,
    acceptDraft: Boolean(options["accept-draft"]),
    agent: options.agent,
    done: Boolean(options.done),
    notes: options.notes,
    file: options.file,
    reason: options.reason,
    force: options.force,
    noRecord: Boolean(options["no-record"]),
    base: options.base,
    bookmark: options.bookmark
  })
  const next = nextStep(run)
  // stdout is the result; stderr says what to run next, after the result is written.
  await print(result)
  console.error(`next: ${next.step}${next.batch ? ` --batch ${next.batch}` : ""}`)
}

// The step's result as JSON, with long diagnostic lists cut for the terminal; the run directory has them whole.
function print(result) {
  const text = JSON.stringify(result, (key, value) => (Array.isArray(value) && value.length > 40 ? [...value.slice(0, 40), `... ${value.length - 40} more`] : value), 2)
  return new Promise((resolve) => process.stdout.write(text + "\n", resolve))
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`migrate: ${error.message}`)
  process.exit(1)
})
