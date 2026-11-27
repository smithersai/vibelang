import { Flow } from "@smthrs/flow"
import { Node } from "@smthrs/plan"
import { CiJob } from "@smthrs/sandbox"
import { Schema } from "effect"

const verifyJob = CiJob.make("verify-mcp-auth", {
  steps: [
    { name: "verify-cloud-mcp", run: "bun .smithers/scripts/mint-sandbox-auth.ts --mode verify" },
    { name: "auth-unit-tests", run: "bun test scripts/auth/mint-sandbox-auth.test.mjs" }
  ]
})

export default Flow.make("sandbox-auth", {
  description: "Verify the authenticated Smithers Cloud MCP server and one-time-use PKCE/Attach sandbox credential tooling.",
  capabilities: ["fs:read:**", "proc:spawn:bun .smithers/scripts/mint-sandbox-auth.ts *"],
  effects: {
    reads: [".smithers/scripts/mint-sandbox-auth.ts"],
    writes: [],
    mode: "expected",
    onConflict: "serialize"
  },
  modelInvocable: true,
  payload: {
    target: CiJob.Target
  },
  success: Schema.Struct({
    verify: CiJob.Result
  }),
  body: Node.capture({}, ({ target }) =>
    Node.all({
      verify: verifyJob.call(target)
    })
  )
})
