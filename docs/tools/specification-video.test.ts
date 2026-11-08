import { expect, test } from "bun:test"
import fc from "fast-check"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { examples, sha256, cleanOutput } from "../../site/scripts/record-specification.mjs"

const repo = resolve(import.meta.dir, "../..")
const site = resolve(repo, "site")
test("the specification walkthrough records supported source and real output", () => {
  const proof = JSON.parse(readFileSync(resolve(site, "videos/specification/recording.json"), "utf8"))
  expect(proof.schema).toBe(1)
  expect(proof.videoSha256).toBe(sha256(resolve(site, "public/videos/spec-walkthrough.mp4")))
  expect(proof.posterSha256).toBe(sha256(resolve(site, "public/videos/spec-walkthrough.jpg")))
  expect(proof.scenes.length).toBe(examples.length)
  for (const [i, scene] of proof.scenes.entries()) {
    const source = resolve(site, "videos/specification", examples[i].name + ".vibe")
    expect(scene.source).toBe(readFileSync(source, "utf8"))
    expect(scene.sourceSha256).toBe(sha256(source))
    expect(scene.commands.map((c: any) => c.exitCode)).toEqual([0, 0])
    expect(scene.commands[1].output).toBe(examples[i].output)
    expect(scene.source).not.toMatch(/catch\s+["']/)
  }
  expect(JSON.stringify(proof)).not.toMatch(/\/(?:home|Users)\//)
})
test("terminal output removes private project prefixes without changing program output", () => {
  fc.assert(fc.property(fc.stringMatching(/^[a-z]{1,12}$/), fc.stringMatching(/^[a-z ]{1,40}$/), (directory, message) => {
    const prefix = "scratch/" + directory
    expect(cleanOutput("\u001b[31m" + prefix + "/src/main.vibe\u001b[0m\n" + message, prefix)).toBe(("demo/src/main.vibe\n" + message).trim())
  }), { numRuns: 100 })
})
