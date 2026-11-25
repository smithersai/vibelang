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
export const publishedFile = file => /^docs\/tools\/[^/]+\.test\.(?:mjs|ts)$/.test(file) || /^(?:docs\/(?:design|user|research|maintainers)\/|site\/src\/|packages\/compiler\/skills\/)/.test(file) ||
  /(?:^|\/)(?:README|CONTRIBUTING|MAINTAINERS|AGENTS|SECURITY)\.md$/.test(file)
export const buildHostName = /\bnyc-?0\d\b|\bnyc[12]\b|\bcfbox\b/i
export const privateHomePath = /(?:~|\$HOME|\$\{HOME\})\/(?:vibe|migrate|lanes|vl|\.vibe-orch|\.cfbox|\.smithers\/accounts)(?:\/|\b)/
const localCheckout = /(?:~|\$HOME|\$\{HOME\})\/[a-z0-9][\w.-]*/i
const privateInfrastructure = [
  ["a build host name", buildHostName],
  ["a private home path", privateHomePath],
  ["an agent session name", /(?<![\w/.-])(?:claude|codex|effectscript|smithers|kimi|opus|fable)-\d+[a-z]?\b(?![\w.-]*\/)/],
]
const researchOrMaintainerPage = file => /^docs\/(?:research|maintainers)\//.test(file)
const vipPage = file => /^(?:docs\/design\/vips|site\/src\/pages\/vips)\//.test(file)

export function privateInfrastructureProblems(file, text) {
  if (!publishedFile(file)) return []
  const checkoutDocs = researchOrMaintainerPage(file) || vipPage(file)
  return privateInfrastructure.flatMap(([what, pattern]) => {
    const match = pattern.exec(text) ?? (checkoutDocs && pattern === privateHomePath ? localCheckout.exec(text) : null)
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
  const currentSpec = file.startsWith("docs/design/src/") || file.startsWith("site/src/pages/spec/")
  const designHistory = file.startsWith("docs/design/history/")
  const provenance = currentSpec ? publicDecisionAttributions(text) : text
  const specProvenance = (currentSpec || designHistory) && (/\b(?:Codex|Fable|GPT-\d|Will)\b|effectscript-4a|Smithers twin|will-direct-session/.test(provenance) ||
      /review probe R\d|(?:prototype )?finding \d+|VibeLang language lead|review, (?:finding|must-fix) \d/i.test(provenance))
  const researchOrMaintainer = researchOrMaintainerPage(file)
  const vip = vipPage(file)
  const recordedApproval = file === "docs/design/retirement-allowlist.json"
  const internalAuthority = /\bowner['’]s\s+(?:decisions?|rulings?|rules|words)\b|\bwork[ -]stream\s+brief\b/i
  const privateRepository = /\bprivate (?:[\w-]+ )?repositor(?:y|ies)\b[^\n]*github\.com\/[\w.-]+\/[\w.-]+|github\.com\/[\w.-]+\/[\w.-]+`?[, ]+private\b/i
  const privateCitation = /\b(?:will-answers\.md|decide-live-[\w-]+\.md|factory\/rulings\.md|PROC-\d+)\b/i
  const privatePlanning = /\b(?:THESIS|PRINCIPLES) \d+\b|\bGOAL (?:asks|measures)\b|`(?:THESIS|GOAL|PRINCIPLES|PROBLEM|OVERVIEW)\.md`/
  if (specProvenance ||
      ((currentSpec || designHistory || researchOrMaintainer || recordedApproval || vip) && internalAuthority.test(provenance)) ||
      (designHistory && privateRepository.test(text)) ||
      ((vip || researchOrMaintainer) && privateCitation.test(text)) ||
      (vip && privatePlanning.test(text)) ||
      (researchOrMaintainer && /\b[A-Z][a-z]+['’]s\s+\d{4}-\d{2}-\d{2}\b|\bWill must\b|\b(?:owners?\s+`?\w+-[\w-]+|migfix\d*-[\w-]+)\b|\b(?:shared with other agents|other agents were loading)\b/.test(text)) ||
      (recordedApproval && (/\bWill\b/.test(text) || /\b(?:current (?:user )?task|current diag-identity task|lane brief|RED repair task)\b/i.test(text))) ||
      (/^typescript\/tsc\/internal\/vibelang(?:fuzz)?\//.test(file) &&
        /\btwins['’] D-\d+ recipe\b|\bthe owner is the (?:work[ -]stream|lane) or person\b/i.test(text))) {
    problems.push("internal decision or review provenance")
  }
  const history = file.startsWith("docs/research/") || designHistory ||
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
