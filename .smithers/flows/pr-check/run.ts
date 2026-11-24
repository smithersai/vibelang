import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import * as CheckSuite from "@smthrs/patterns/CheckSuite"
import { Effect } from "effect"

const check = (label: string) => () => Effect.sync(() => {
  console.log(`::group::smthrs ci ${label}`)
  const result = spawnSync(".smithers/node_modules/.bin/smthrs", [
    "ci", label, "--jobs", String(availableParallelism()), "--ui", "plain"
  ], { stdio: "inherit" })
  if (result.error) console.error(result.error.message)
  console.log("::endgroup::")
  return { passed: result.status === 0 }
})

const result = await Effect.runPromise(CheckSuite.run(undefined, {
  checks: {
    "//:e2e": check("//:e2e"),
    "//typescript/vibelang/...": check("//typescript/vibelang/...")
  },
  // Setup in the end-to-end check writes the same compiler the cases use.
  concurrency: 1,
  continueOnFail: true,
  strategy: "all-pass"
}))
const summary = [
  ...result.passed.map(label => `- Passed \`${label}\``),
  ...result.failed.map(label => `- Failed \`${label}\``)
].join("\n") + "\n"
console.log(summary.trimEnd())
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
process.exitCode = result.verdict ? 0 : 1
