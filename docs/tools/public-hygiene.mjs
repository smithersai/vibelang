// Structural public-repository checks, shared with the tracked-file leak gate.
const retiredService = ["converter", "worker"].join("-")

export function publicHygiene(file, text) {
  const problems = []
  if (file.includes(retiredService) || text.includes(retiredService)) {
    problems.push("a removed hosted compile service")
  }
  const scratchRoots = ["review-codex", "review-fable", "agent-a", "abstract-services"].map(name => "scratch-" + name)
  const removedPaths = ["docs/" + "reviews/", ...scratchRoots.map(name => "experiments/" + name + "/"),
    "artifacts/" + "effeck-" + "design-space.html"] // brand-gate: allow
  if (removedPaths.some(path => file.startsWith(path) || text.includes(path)) ||
      scratchRoots.some(name => text.includes(name + "/"))) {
    problems.push("a removed review artifact or scratch path")
  }
  const spec = file.startsWith("docs/design/src/") || file.startsWith("docs/design/history/") ||
    file.startsWith("site/src/pages/spec/")
  if (spec && (/\b(?:Codex|Fable|GPT-\d|Will)\b|effectscript-4a|Smithers twin|will-direct-session|owner.s decisions/.test(text) ||
      /review probe R\d|(?:prototype )?finding \d+|VibeLang language lead|review, (?:finding|must-fix) \d/i.test(text))) {
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
