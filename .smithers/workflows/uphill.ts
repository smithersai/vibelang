import { Flow } from "@smthrs/flow"
import { Node } from "@smthrs/plan"
import { CiJob } from "@smthrs/sandbox"
import { Schema } from "effect"

// Smithers Cloud Lighthouse-style backpressure audit workflow.
// Runs Uphill continuous metrics and VibeLang quality gates, renders the
// Lighthouse audit HTML/JSON report, and uploads it as a run artifact when
// running inside a controlled Smithers Cloud sandbox.

const auditJob = CiJob.make("lighthouse-audit", {
  steps: [
    { name: "audit-report", run: "bun scripts/audit/run-audit.ts --ci" }
  ]
})

export default Flow.make("uphill", {
  description: "Run VibeLang Uphill metrics and render the Lighthouse-style backpressure audit report.",
  payload: {
    run: Schema.String,
    repo: Schema.String,
    sha: Schema.String,
    ref: Schema.String,
    event: Schema.String
  },
  success: Schema.Struct({
    audit: CiJob.Result
  }),
  body: (run) =>
    Node.all({
      audit: auditJob.call(run)
    })
})
