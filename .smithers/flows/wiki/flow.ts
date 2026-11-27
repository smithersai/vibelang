import { Flow } from "@smthrs/flow"
import { Node } from "@smthrs/plan"
import { CiJob } from "@smthrs/sandbox"
import { Schema } from "effect"

const wikiJob = CiJob.make("wiki", {
  steps: [
    { name: "wiki-check", run: "bun .smithers/scripts/wiki.ts --check" }
  ]
})

export default Flow.make("wiki", {
  description: "Validate the Obsidian-compatible VibeLang Wiki and Mythical History and build the Smithers Cloud wiki feed.",
  capabilities: ["fs:read:**", "proc:spawn:bun .smithers/scripts/wiki.ts *"],
  effects: {
    reads: ["docs/wiki/**"],
    writes: [],
    mode: "expected",
    onConflict: "serialize"
  },
  modelInvocable: true,
  payload: {
    target: CiJob.Target
  },
  success: Schema.Struct({
    wiki: CiJob.Result
  }),
  body: Node.capture({}, ({ target }) =>
    Node.all({
      wiki: wikiJob.call(target)
    })
  )
})
