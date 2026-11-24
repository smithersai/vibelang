import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// A finalized release stays guarded when the queue runs ordinary docs checks.
export function finalPublication(root = new URL("../../", import.meta.url), env = process.env) {
  if (env.VIBELANG_RELEASE_NOTES_FINAL) return true
  const version = JSON.parse(readFileSync(new URL("packages/compiler/package.json", root), "utf8")).version
  const notes = readFileSync(new URL("docs/user/src/setup/release-notes.md", root), "utf8")
  return notes.split(/^## /m).slice(1).some(release => release.split("\n")[0] === version)
}

const releaseVersion = release => release.split("\n")[0].replace(/ \(unreleased\)$/, "")

function assertEntriesExclude(entries, pattern) {
  const match = pattern.exec(entries)
  if (!match) return
  const start = entries.lastIndexOf("\n- ", match.index)
  const end = entries.indexOf("\n- ", match.index + match[0].length)
  const entry = entries.slice(start < 0 ? 0 : start + 1, end < 0 ? undefined : end)
  assert.doesNotMatch(entry, pattern, "Release note contains internal bookkeeping:\n" + entry)
}

// `Experimental.Fuzz` and `Experimental.FuzzSimulation` are public runtime modules. A code span naming them, or a
// member such as `Fuzz.observe(label)`, is a user-facing API, not fuzz bookkeeping; prose and every other code span,
// such as `go-vibelangfuzz` or `fuzz`, stay checked.
const withoutFuzzApi = text => text.replace(/`(?:Experimental\.)?Fuzz(?:Simulation)?(?:\.[A-Za-z_$][\w$]*)*(?:\([^`]*\))?`/g, "`API`")

export function assertReleasePublication(notes, version) {
  const releases = notes.split(/^## /m).slice(1)
  const candidate = releases.findIndex(release => release.split("\n")[0].replace(/ \(unreleased\)$/, "") === version)
  assert.ok(candidate >= 0, "release notes include the compiler candidate")
  const bugs = releases.slice(0, candidate + 1).map(release => {
    const fixes = release.split(/^### Bugs fixed since .+$/m)[1]?.split(/^### /m)[0]
    assert.ok(fixes, "every unpublished section needs a bug list")
    return fixes
  })
  const publicationNotes = releases.slice(0, candidate + 1).flatMap(release =>
    release.match(/^- .*(?:\n(?!\n|[-*] |#{1,6} ).+)*/gm) ?? []
  ).join("\n")
  assertEntriesExclude(publicationNotes, /failures[- ]spec\s+check|synthetic\s+benchmark\s+imports|native\s+compiler\s+regression\s+suite|deployed[- ]release\s+check|built[- ]site\s+validation|example\s+validation\s+carried\s+an?\s+unused/i)
  assertEntriesExclude(withoutFuzzApi(publicationNotes), /\bfuzz\b|go-vibelangfuzz|pre-merge|post-merge|grammar test engine|editor syntax property tests|test cache/i)
  assertEntriesExclude(publicationNotes, /merge\s+gate|bounded\s+hang\s+probes|stale\s+hang\s+marker/i)
  assertEntriesExclude(publicationNotes, /regression checks|migration checks|diagnostic golden|fixtures now verify|grammar tooling now sees/i)
  assertEntriesExclude(publicationNotes, /scripts\/ci\.sh|differential (?:checks|comparisons)|AST layout regression test|Repository validation|Arrow-body and heartbeat checks|named-region runtime checks/i)
  assertEntriesExclude(publicationNotes, /Docs checks could use|The docs check read|Specification checks could mistake|A docs check could confuse|Generating documentation could hang|Spec-derived checks could confuse|The documented debugging recipe check|Differential .Exit. checks/i)
  assertEntriesExclude(publicationNotes, /The release rehearsal stopped at its Vite warning check|A registry rehearsal could inherit/i)
  assertEntriesExclude(publicationNotes, /site(?:['’]s)?\s+contrast\s+check/i)
  assertEntriesExclude(publicationNotes, /forms[- ]table\s+check|Go\s+build\s+slot/i)
  assertEntriesExclude(publicationNotes, /(?:mask|LSP|editor)\s+smoke\s+test|fork\s+startup\s+checks/i)
  assertEntriesExclude(publicationNotes, /Compiler\s+validation\s+treated\s+an?\s+error\s+name|CI\s+reused\s+an?\s+older/i)
  assertEntriesExclude(publicationNotes, /editor\s+smoke\s+validation|compiler\s+fuzz\s+validation|schema\s+regression\s+check/i)
  assertEntriesExclude(publicationNotes, /migration\s+oracle\s+regression\s+tests|(?:compiler|pin)\s+regression\s+suite|compiler[\u0027\u2019]s\s+keyword\s+coverage\s+check|CI[- ]health\s+reports|declaration[- ]oracle\s+tests|snippet\s+tools[\u0027\u2019]\s+pending[- ]output\s+test\s+fixtures|narrow\s+hosted\s+CI\s+checks/i)
  assertEntriesExclude(publicationNotes, /contributor\s+(?:checks|queue)|contribution\s+guide|publication\s+checks|release\s+rehearsals|release-history\s+checks|documentation\s+check|reference\s+check|Appendix\s+diagnostic\s+replay|fixtures\s+now\s+(?:load|initialize)/i)
  const entries = text => (text.match(/^- .*(?:\n[ \t]+\S.*)*/gm) ?? [])
    .map(entry => entry.slice(2).replaceAll("`", "").replace(/\s+/g, " ").trim().toLowerCase())
  const historical = releases.slice(candidate + 1).flatMap(release =>
    entries(release.split(/^### Bugs fixed since .+$/m)[1]?.split(/^### /m)[0] ?? ""))
  const seen = new Set(historical)
  for (const entry of bugs.flatMap(entries)) {
    assert.ok(!seen.has(entry), "each user-facing fix appears once: " + entry)
    seen.add(entry)
  }
}

export function assertReleaseContrast(notes, version) {
  const releases = notes.split(/^## /m).slice(1)
  const candidate = releases.findIndex(release => releaseVersion(release) === version)
  assert.ok(candidate >= 0)
  const bullets = releases.slice(0, candidate + 1).flatMap(release =>
    release.match(/^- .*(?:\n(?!\n|[-*] |#{1,6} ).+)*/gm) ?? []
  ).join("\n")
  assertEntriesExclude(bullets, /site(?:['’]s)?\s+contrast\s+check|contrast\s+(?:audit\s+)?(?:state|diagnostics?|failure)/i)
}

const upgradeHeadings = [/^Upgrade from /, /^Configuration upgrade$/]

export function assertReleaseStructure(notes, version) {
  const release = notes.split(/^## /m).slice(1).find(section => releaseVersion(section) === version)
  assert.ok(release, "release notes include the compiler candidate")
  const body = release.slice(release.indexOf("\n") + 1)
  const intro = body.split(/^### /m)[0]
  assert.doesNotMatch(intro, /^(?:- |\| )/m, "a release row sits before the first heading; move it under its bug list or upgrade table")
  const seen = new Set()
  for (const [, heading] of body.matchAll(/^### (.+)$/gm)) {
    assert.ok(!seen.has(heading), "duplicate release section: " + heading)
    seen.add(heading)
    if (/upgrade/i.test(heading)) assert.ok(upgradeHeadings.some(allowed => allowed.test(heading)), "an upgrade row belongs in the upgrade table, not under its own heading: " + heading)
  }
}
