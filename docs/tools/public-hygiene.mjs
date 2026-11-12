// Structural public-repository checks, shared with the tracked-file leak gate.
const retiredService = ["converter", "worker"].join("-")
const scratchRoots = ["review-codex", "review-fable", "agent-a", "abstract-services"].map(name => "scratch-" + name)
const removedPaths = ["docs/" + "reviews/", ...scratchRoots.map(name => "experiments/" + name + "/"),
  "artifacts/" + "effeck-" + "design-space.html"] // brand-gate: allow

// Public decision records identify their author and remain explicitly revisable.
// Only those attribution spans are excluded from the provenance check; rule text,
// other sections and all private-data checks retain their ordinary treatment.
function publicDecisionAttributions(text) {
  let decisionLevel = 0
  let fence = null
  return text.split("\n").map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (fence === null) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
      return line
    }
    if (fence !== null) return line
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (heading) {
      if (heading[2] === "Claude's decisions") decisionLevel = heading[1].length
      else if (heading[1].length <= decisionLevel) decisionLevel = 0
      return line
    }
    if (!decisionLevel || !/Will may overturn (?:it|this decision)\./.test(line)) return line
    const author = /^(- \*\*(?:Amended|Clarified) \d{4}-\d{2}-\d{2}:[^*\n]+\*\* )(Codex (?:Sol|Astra|Terra)|Claude (?:Fable|Opus)|GPT-\d[\w.-]*)(, lane `[a-z][a-z0-9-]*`,)/.exec(line)
    if (!author) return line
    return line.replace(author[0], author[1] + "the recorded author" + author[3])
      .replace(/Will may overturn (it|this decision)\./g, "The decision remains revisable.")
  }).join("\n")
}

// Pages readers get: the site's sources, the docs, the spec and VIPs, the skill
// and every README. Private patterns otherwise come only from the environment, so
// a build host, a home-relative scratch path or an agent session name passed the
// gate whenever VIBELANG_LEAK_PATTERNS was unset.
export const publishedFile = file => /^(?:docs\/(?:design|user|research|maintainers)\/|site\/src\/|packages\/compiler\/skills\/)/.test(file) ||
  /(?:^|\/)(?:README|CONTRIBUTING|MAINTAINERS|AGENTS|SECURITY)\.md$/.test(file)
export const buildHostName = /\bnyc-?0\d\b|\bnyc[12]\b|\bcfbox\b/
export const privateHomePath = /(?:~|\$HOME|\$\{HOME\})\/(?:vibe|migrate|lanes|vl|\.vibe-orch|\.cfbox|\.smithers\/accounts)(?:\/|\b)/
const privateInfrastructure = [
  ["a build host name", buildHostName],
  ["a private home path", privateHomePath],
  ["an agent session name", /(?<![\w/.-])(?:claude|codex|effectscript|smithers|kimi|opus|fable)-\d+[a-z]?\b(?![\w.-]*\/)/],
]
// The VIP-38 context sentence keeps its report location until its own change lands with the
// evidence the spec rule check asks for. Only this exact phrase in these two files is exempt.
export const pendingPrivateLocations = {
  "docs/design/vips/0038-effect-lint-built-in.md": "(2026-10-29, `" + "~" + "/migrate/TOOL-RISK.md` on " + "nyc" + "-02)",
  "site/src/pages/vips/0038-effect-lint-built-in.mdx": "(2026-10-29, `" + "~" + "/migrate/TOOL-RISK.md` on " + "nyc" + "-02)",
}
export function privateInfrastructureProblems(file, text) {
  if (!publishedFile(file)) return []
  if (pendingPrivateLocations[file]) text = text.split(pendingPrivateLocations[file]).join("")
  return privateInfrastructure.flatMap(([what, pattern]) => {
    const match = pattern.exec(text)
    return match ? [what + ": " + JSON.stringify(match[0])] : []
  })
}

export function publicHygiene(file, text) {
  const problems = privateInfrastructureProblems(file, text)
  if (file.includes(retiredService) || text.includes(retiredService)) {
    problems.push("a removed hosted compile service")
  }
  if (removedPaths.some(path => file.startsWith(path) || text.includes(path)) ||
      scratchRoots.some(name => text.includes(name + "/"))) {
    problems.push("a removed review artifact or scratch path")
  }
  const spec = file.startsWith("docs/design/src/") || file.startsWith("docs/design/history/") ||
    file.startsWith("site/src/pages/spec/")
  const provenance = file.startsWith("docs/design/src/") || file.startsWith("site/src/pages/spec/")
    ? publicDecisionAttributions(text) : text
  if (spec && (/\b(?:Codex|Fable|GPT-\d|Will)\b|effectscript-4a|Smithers twin|will-direct-session|owner.s decisions/.test(provenance) ||
      /review probe R\d|(?:prototype )?finding \d+|VibeLang language lead|review, (?:finding|must-fix) \d/i.test(provenance))) {
    problems.push("internal decision or review provenance")
  }
  const history = file.startsWith("docs/research/") || file.startsWith("docs/design/history/") ||
    /(?:^|\/)(?:CHANGELOG|KERNEL-CHANGES)\.md$/.test(file)
  if (!history && /(?:~|\$HOME|\$\{HOME\})\/effectscript\//i.test(text)) {
    problems.push("a private checkout default")
  }
  if (file === "scripts/setup.sh" && /(?:runtime|editor) lane/.test(text)) {
    problems.push("an internal setup instruction")
  }
  if (file === "typescript/VIBELANG.md" &&
      /A match subject is evaluated once, including a getter|No VibeLang pass is superlinear|arguments. inside a region's closure is the closure's|serverInfo. still says/.test(text)) {
    problems.push("a stale compiler limitation or unmeasured complexity claim")
  }
  return problems
}
