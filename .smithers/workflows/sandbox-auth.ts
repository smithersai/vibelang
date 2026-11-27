import { Flow } from "@smthrs/flow"
import { Node } from "@smthrs/plan"
import { CiJob } from "@smthrs/sandbox"
import { Schema } from "effect"

// Smithers Cloud workflow for verifying one-time-use PKCE S256 / Attach-to-Conversation
// sandbox authentication helpers and live Cloud MCP OAuth 2.1 metadata discovery.

const authJob = CiJob.make("sandbox-auth-verify", {
  steps: [
    { name: "auth-unit-tests", run: "bun test scripts/auth/mint-sandbox-auth.test.mjs" },
    { name: "mcp-discovery-verify", run: "bun .smithers/scripts/mint-sandbox-auth.ts --mode verify" }
  ]
})

export default Flow.make("sandbox-auth", {
  description: "Verify the authenticated Smithers Cloud MCP server and one-time-use PKCE/Attach sandbox credential tooling.",
  payload: {
    run: Schema.String,
    repo: Schema.String,
    sha: Schema.String,
    ref: Schema.String,
    event: Schema.String
  },
  success: Schema.Struct({
    auth: CiJob.Result
  }),
  body: (run) =>
    Node.all({
      auth: authJob.call(run)
    })
})
