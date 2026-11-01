import assert from "node:assert/strict"

const releaseVersion = release => release.split("\n")[0].replace(/ \(unreleased\)$/, "")

export function assertReleasePublication(notes, version) {
  const releases = notes.split(/^## /m).slice(1)
  const candidate = releases.findIndex(release => release.split("\n")[0].replace(/ \(unreleased\)$/, "") === version)
  assert.ok(candidate >= 0, "release notes include the compiler candidate")
  const bugs = releases.slice(0, candidate + 1).map(release => {
    const fixes = release.split(/^### Bugs fixed since .+$/m)[1]?.split(/^### /m)[0]
    assert.ok(fixes, "every unpublished section needs a bug list")
    return fixes
  }).join("\n")
  const publicationNotes = releases.slice(0, candidate + 1).flatMap(release =>
    release.match(/^- .*(?:\n(?!\n|[-*] |#{1,6} ).+)*/gm) ?? []
  ).join("\n")
  assert.doesNotMatch(publicationNotes, /failures[- ]spec\s+check|synthetic\s+benchmark\s+imports|native\s+compiler\s+regression\s+suite|deployed[- ]release\s+check|built[- ]site\s+validation|example\s+validation\s+carried\s+an?\s+unused/i)
  assert.doesNotMatch(publicationNotes, /\bfuzz\b|go-vibelangfuzz|pre-merge|post-merge|grammar test engine|editor syntax property tests|test cache/i)
  assert.doesNotMatch(publicationNotes, /merge\s+gate|bounded\s+hang\s+probes|stale\s+hang\s+marker/i)
  assert.doesNotMatch(publicationNotes, /regression checks|migration checks|diagnostic golden|fixtures now verify|grammar tooling now sees/i)
  assert.doesNotMatch(publicationNotes, /scripts\/ci\.sh|differential (?:checks|comparisons)|AST layout regression test|Repository validation|Arrow-body and heartbeat checks|named-region runtime checks/i)
  assert.doesNotMatch(publicationNotes, /Docs checks could use|The docs check read|Specification checks could mistake|A docs check could confuse|Generating documentation could hang|Spec-derived checks could confuse|The documented debugging recipe check|Differential .Exit. checks/i)
  assert.doesNotMatch(publicationNotes, /The release rehearsal stopped at its Vite warning check|A registry rehearsal could inherit/i)
  assert.doesNotMatch(publicationNotes, /site(?:['’]s)?\s+contrast\s+check/i)
  assert.doesNotMatch(publicationNotes, /forms[- ]table\s+check|Go\s+build\s+slot/i)
  assert.doesNotMatch(publicationNotes, /(?:mask|LSP|editor)\s+smoke\s+test|fork\s+startup\s+checks/i)
  assert.doesNotMatch(publicationNotes, /Compiler\s+validation\s+treated\s+an?\s+error\s+name|CI\s+reused\s+an?\s+older/i)
  assert.doesNotMatch(publicationNotes, /editor\s+smoke\s+validation|compiler\s+fuzz\s+validation|schema\s+regression\s+check/i)
  const bullets = bugs.split("\n").filter(line => line.startsWith("- "))
  assert.equal(new Set(bullets).size, bullets.length, "each user-facing fix appears once")
  for (const symptom of ["Editor parsing rejected `for try` `Stream` loops", "A tool that reads a `.vibe` file through the TypeScript mapper", "compiler output with Windows line endings"]) {
    assert.equal(bullets.filter(line => line.includes(symptom)).length, 1, "retain the user fix once: " + symptom)
  }
}

export function assertReleaseContrast(notes, version) {
  const releases = notes.split(/^## /m).slice(1)
  const candidate = releases.findIndex(release => releaseVersion(release) === version)
  assert.ok(candidate >= 0)
  const bullets = releases.slice(0, candidate + 1).flatMap(release =>
    release.match(/^- .*(?:\n(?!\n|[-*] |#{1,6} ).+)*/gm) ?? []
  ).join("\n")
  assert.doesNotMatch(bullets, /site(?:['’]s)?\s+contrast\s+check|contrast\s+(?:audit\s+)?(?:state|diagnostics?|failure)/i)
}

const upgradeHeadings = [/^Upgrade from /, /^Configuration upgrade$/]

export function assertReleaseStructure(notes, version) {
  const release = notes.split(/^## /m).slice(1).find(section => releaseVersion(section) === version)
  assert.ok(release, "release notes include the compiler candidate")
  const body = release.slice(release.indexOf("\n") + 1)
  const intro = body.split(/^### /m)[0]
  assert.doesNotMatch(intro, /^(?:- |\| )/m, "a release row sits before the first heading; move it under its bug list or upgrade table")
  for (const [, heading] of body.matchAll(/^### (.+)$/gm)) {
    if (/upgrade/i.test(heading)) assert.ok(upgradeHeadings.some(allowed => allowed.test(heading)), "an upgrade row belongs in the upgrade table, not under its own heading: " + heading)
  }
}
