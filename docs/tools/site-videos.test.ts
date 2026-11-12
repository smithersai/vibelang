import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { videoManifestProblems } from "./site-videos.mjs"

const repo = resolve(import.meta.dir, "../..")
const release = JSON.parse(readFileSync(join(repo, "packages/compiler/package.json"), "utf8")).version

function fixture(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "site-videos-"))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}
const page = (name: string) => `<figure><video controls poster="/videos/${name}.jpg"><source src="/videos/${name}.mp4" type="video/mp4" /></video></figure>\n`
const manifest = (videos: Record<string, string | null>) => JSON.stringify({ schema: 1, videos: Object.fromEntries(
  Object.entries(videos).map(([name, version]) => [name + ".mp4", { version, poster: name + ".jpg" }])) })
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

function check(files: Record<string, string>, options: { release?: string } = {}) {
  const dir = fixture(files)
  try { return videoManifestProblems(dir, options) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test("every video the site embeds has a manifest entry, and no unlinked file is served", () => {
  expect(videoManifestProblems(repo)).toEqual([])
})

test("an embedded video without a manifest entry fails", () => {
  const problems = check({
    "site/src/pages/a.mdx": page("demo"),
    "site/public/videos/demo.mp4": "v", "site/public/videos/demo.jpg": "p",
    "site/videos/manifest.json": manifest({})
  })
  expect(problems.join("\n")).toMatch(/demo\.mp4 is embedded by site\/src\/pages\/a\.mdx but has no entry/)
})

test("a missing manifest fails", () => {
  expect(check({ "site/src/pages/a.mdx": page("demo") }).join("\n")).toMatch(/manifest\.json: missing/)
})

test("a served file that no page links fails", () => {
  const problems = check({
    "site/src/pages/a.mdx": page("demo"),
    "site/public/videos/demo.mp4": "v", "site/public/videos/demo.jpg": "p",
    "site/public/videos/old-flag.mp4": "v",
    "site/videos/manifest.json": manifest({ demo: "1.2.3" })
  })
  expect(problems).toEqual(["site/public/videos/old-flag.mp4: no page links it, but the site serves it; delete it"])
})

test("a manifest version must match the recording receipt that binds the same file", () => {
  const problems = check({
    "site/src/pages/a.mdx": page("demo"),
    "site/public/videos/demo.mp4": "v", "site/public/videos/demo.jpg": "p",
    "site/videos/demo/recording.json": JSON.stringify({ compilerVersion: "1.2.2", videoSha256: sha256("v") }),
    "site/videos/manifest.json": manifest({ demo: "1.2.3" })
  })
  expect(problems.join("\n")).toMatch(/demo\.mp4 records 1\.2\.3, but site\/videos\/demo\/recording\.json recorded it with 1\.2\.2/)
})

test("a composition records a version only when every segment records it", () => {
  const files = (overview: string | null) => ({
    "site/src/pages/a.mdx": page("one") + page("two") + page("all"),
    ...Object.fromEntries(["one", "two", "all"].flatMap(name => [["site/public/videos/" + name + ".mp4", name], ["site/public/videos/" + name + ".jpg", "p"]])),
    "site/videos/all.json": JSON.stringify({ kind: "composition", segments: [{ file: "one.mp4" }, { file: "two.mp4" }], videoSha256: sha256("all") }),
    "site/videos/manifest.json": manifest({ one: "1.2.3", two: null, all: overview })
  })
  expect(check(files(null))).toEqual([])
  expect(check(files("1.2.3")).join("\n")).toMatch(/all\.mp4 is composed by site\/videos\/all\.json; its version is null/)
})

test("the release check fails for a video recorded with another version or none", () => {
  const files = {
    "site/src/pages/a.mdx": page("old") + page("unknown") + page("current"),
    ...Object.fromEntries(["old", "unknown", "current"].flatMap(name => [["site/public/videos/" + name + ".mp4", name], ["site/public/videos/" + name + ".jpg", "p"]])),
    "site/videos/manifest.json": manifest({ old: "1.2.2", unknown: null, current: "1.2.3" })
  }
  expect(check(files)).toEqual([])
  expect(check(files, { release: "1.2.3" })).toEqual([
    "site/public/videos/old.mp4: records VibeLang 1.2.2, but the site states 1.2.3; re-record it with 1.2.3 and update site/videos/manifest.json",
    "site/public/videos/unknown.mp4: records no VibeLang version, but the site states 1.2.3; re-record it with 1.2.3 and update site/videos/manifest.json"
  ])
})

const removed = (reason: string) => JSON.stringify({ schema: 1, videos: { "demo.mp4": { version: "1.2.3", poster: "demo.jpg" }, "old.mp4": { removed: reason, poster: "old.jpg" } } })

test("a removed video passes when no page embeds it and its files are gone, also at release", () => {
  const files = {
    "site/src/pages/a.mdx": page("demo"),
    "site/public/videos/demo.mp4": "v", "site/public/videos/demo.jpg": "p",
    "site/videos/manifest.json": removed("teaches retired forms; needs a new script")
  }
  expect(check(files)).toEqual([])
  expect(check(files, { release: "1.2.3" })).toEqual([])
})

test("a removed video that a page still embeds fails", () => {
  const problems = check({
    "site/src/pages/a.mdx": page("demo") + page("old"),
    "site/public/videos/demo.mp4": "v", "site/public/videos/demo.jpg": "p",
    "site/public/videos/old.mp4": "v", "site/public/videos/old.jpg": "p",
    "site/videos/manifest.json": removed("teaches retired forms")
  })
  expect(problems.join("\n")).toMatch(/old\.mp4 was removed \(teaches retired forms\), but site\/src\/pages\/a\.mdx still embeds it/)
})

test("a removed video's file left in the site fails, and the removal needs a reason", () => {
  const problems = check({
    "site/src/pages/a.mdx": page("demo"),
    "site/public/videos/demo.mp4": "v", "site/public/videos/demo.jpg": "p",
    "site/public/videos/old.mp4": "v",
    "site/videos/manifest.json": removed(" ")
  })
  expect(problems).toContain("site/public/videos/old.mp4: no page links it, but the site serves it; delete it")
  expect(problems).toContain(`site/videos/manifest.json: old.mp4 needs "removed": the reason it was taken off the site`)
})

test("the specification walkthrough is off the site until it is re-scripted", () => {
  const manifest = JSON.parse(readFileSync(join(repo, "site/videos/manifest.json"), "utf8"))
  expect(manifest.videos["spec-walkthrough.mp4"].removed).toBe("teaches retired forms; needs a new script")
  expect(readFileSync(join(repo, "docs/design/src/000-intro.md"), "utf8")).not.toContain("/videos/spec-walkthrough")
})

const bound = (version: string | undefined, receiptVersion: string) => ({
  "site/src/pages/a.mdx": page("demo"),
  "site/public/videos/demo.mp4": "v", "site/public/videos/demo.jpg": "p",
  "site/videos/demo/recording.json": JSON.stringify({ compilerVersion: receiptVersion, videoSha256: sha256("v") }),
  "site/videos/manifest.json": JSON.stringify({ schema: 1, videos: { "demo.mp4": version === undefined ? { poster: "demo.jpg" } : { version, poster: "demo.jpg" } } })
})

test("a receipt-bound video takes its version from the receipt, so a re-recording needs no manifest edit", () => {
  expect(check(bound(undefined, "1.2.2"))).toEqual([])
  expect(check(bound(undefined, "1.2.3"))).toEqual([])
  expect(check(bound(undefined, "1.2.3"), { release: "1.2.3" })).toEqual([])
  expect(check(bound(undefined, "1.2.2"), { release: "1.2.3" }).join("\n")).toMatch(/demo\.mp4: records VibeLang 1\.2\.2, but the site states 1\.2\.3/)
})

test("a video with no version and no receipt fails", () => {
  const problems = check({
    "site/src/pages/a.mdx": page("demo"),
    "site/public/videos/demo.mp4": "v", "site/public/videos/demo.jpg": "p",
    "site/videos/manifest.json": JSON.stringify({ schema: 1, videos: { "demo.mp4": { poster: "demo.jpg" } } })
  })
  expect(problems.join("\n")).toMatch(/demo\.mp4 has no "version" and no recording receipt binds/)
})

test("every receipt-bound video leaves its version to the receipt", () => {
  const manifest = JSON.parse(readFileSync(join(repo, "site/videos/manifest.json"), "utf8"))
  expect(manifest.videos["agent-loop.mp4"]).toEqual({ poster: "agent-loop.jpg" })
})
