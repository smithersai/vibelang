import { Flow } from "@smthrs/flow"
import { Node } from "@smthrs/plan"
import { CiJob } from "@smthrs/sandbox"
import { Schema } from "effect"

// Smithers Cloud native Obsidian Wiki & Mythical History workflow.
// Validates frontmatter and wikilink integrity across docs/wiki/, runs wiki
// unit tests, and builds the Smithers Cloud feed payload inside a controlled
// sandbox.

const wikiJob = CiJob.make("wiki-validate-and-build", {
  steps: [
    { name: "wiki-check", run: "bun .smithers/scripts/wiki.ts --check" },
    { name: "wiki-test", run: "bun test scripts/wiki/wiki.test.mjs" },
    { name: "wiki-write", run: "bun .smithers/scripts/wiki.ts --write .uphill/wiki-feed.json" }
  ]
})

export default Flow.make("wiki", {
  description: "Validate the Obsidian-compatible VibeLang Wiki and Mythical History and build the Smithers Cloud wiki feed.",
  payload: {
    run: Schema.String,
    repo: Schema.String,
    sha: Schema.String,
    ref: Schema.String,
    event: Schema.String
  },
  success: Schema.Struct({
    wiki: CiJob.Result
  }),
  body: (run) =>
    Node.all({
      wiki: wikiJob.call(run)
    })
})
