import { Flow } from "@smthrs/flow"
import { Node } from "@smthrs/plan"
import { CiJob } from "@smthrs/sandbox"
import { Schema } from "effect"

// Smithers Cloud native CI workflow for smithersai/vibelang.
// Planned inside the QuickJS realm using only the four sandboxed SDK modules
// (@smthrs/flow, @smthrs/plan, @smthrs/sandbox, effect). Each job runs on an
// isolated Smithers Cloud machine at the exact commit SHA with registry-only
// egress and zero repository secrets on untrusted fork PRs.

const prepare = "sh scripts/ci.sh --prepare-only"

const docsAndFactory = CiJob.make("docs-and-factory", {
  steps: [
    { name: "prepare", run: prepare },
    { name: "docs-check", run: "cd .smithers && bun run docs:check" },
    { name: "factory-check", run: ".smithers/node_modules/.bin/smthrs ci //.smithers:factory-check --ui plain" },
    { name: "smithers-content", run: "bun docs/tools/check-smithers-content.ts" },
    { name: "repo-content", run: "node --test docs/tools/repo-content.test.mjs" }
  ]
})

const backpressureAudit = CiJob.make("backpressure-audit", {
  steps: [
    { name: "prepare", run: prepare },
    { name: "uphill-and-lighthouse", run: "bun scripts/audit/run-audit.ts --ci" }
  ]
})

const e2eAndCases = CiJob.make("e2e-and-cases", {
  needs: ["docs-and-factory"],
  steps: [
    { name: "prepare", run: prepare },
    { name: "pr-check", run: "bun .smithers/flows/pr-check/run.ts" }
  ]
})

export default Flow.make("ci", {
  description: "Run VibeLang docs, factory drift, Lighthouse backpressure audit, E2E, and compiler acceptance cases on Smithers Cloud.",
  payload: {
    run: Schema.String,
    repo: Schema.String,
    sha: Schema.String,
    ref: Schema.String,
    event: Schema.String
  },
  success: Schema.Struct({
    docsAndFactory: CiJob.Result,
    backpressureAudit: CiJob.Result,
    e2eAndCases: CiJob.Result
  }),
  body: (run) =>
    Node.all({
      docsAndFactory: docsAndFactory.call(run),
      backpressureAudit: backpressureAudit.call(run),
      e2eAndCases: e2eAndCases.call(run)
    })
})
