// Only reviewed targets with a complete dependency plan may omit Chromium.
// New targets, planner failures and broad selections retain browser setup.
import { spawnSync } from "node:child_process"
import { resolve, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const tests = new Set([
  "//:release", "//:tokens", "//:spec-tests", "//:forms", "//:snippets",
  "//:docs-tools", "//:docs-check", "//:site-spec-links",
  "//packages:compiler-test", "//packages:migrate-test", "//packages:runtime-test",
  "//packages:compiler-tools-test", "//packages:vite-test", "//packages:unplugin-test",
])
const builds = new Set([
  "//typescript:compiler", "//typescript:forms-generator",
  "//packages:compiler-native", "//packages:runtime-dist",
])
const selectorsOf = targets => typeof targets === "string" ? [...new Set(targets.trim().split(/\s+/).filter(Boolean))] : []
const known = selectors => selectors.length > 0 && selectors.every(label => tests.has(label) || builds.has(label))

export function classifyPlan(targets, plan) {
  const selectors = selectorsOf(targets)
  if (!known(selectors) || !plan || !Array.isArray(plan.targets) || !Array.isArray(plan.roots) ||
    !Array.isArray(plan.warnings) || plan.warnings.length > 0 ||
    plan.roots.length !== selectors.length || selectors.some(label => !plan.roots.includes(label))) return true
  const nodes = new Map()
  for (const node of plan.targets) {
    if (!node || typeof node.label !== "string" || nodes.has(node.label) || !Array.isArray(node.dependencies) ||
      node.dependencies.some(label => typeof label !== "string")) return true
    nodes.set(node.label, node)
    if (node.target === "Filegroup") continue
    if (node.target === "Shell.Test" && tests.has(node.label)) continue
    if (node.target === "Shell.Build" && builds.has(node.label)) continue
    return true
  }
  const visited = new Set(), active = new Set()
  const complete = label => {
    if (active.has(label)) return false
    if (visited.has(label)) return true
    const node = nodes.get(label)
    if (!node) return false
    active.add(label)
    if (!node.dependencies.every(complete)) return false
    active.delete(label)
    visited.add(label)
    return true
  }
  return !selectors.every(complete)
}

export function browserPrerequisites(targets, workspace = root) {
  const selectors = selectorsOf(targets)
  if (!known(selectors)) return { needed: true, reason: "broad or unfamiliar selection" }
  const result = spawnSync(process.execPath, [join(root, ".smithers/node_modules/.bin/smthrs"), "ci", ...selectors,
    "--plan", "--format", "json", "--workspace", workspace], {
    cwd: workspace, encoding: "utf8", timeout: 45_000, maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status !== 0 || result.error) return { needed: true, reason: "dependency plan unavailable" }
  try {
    const needed = classifyPlan(targets, JSON.parse(result.stdout))
    return { needed, reason: needed ? "browser or unfamiliar dependency plan" : "verified non-browser dependency plan" }
  } catch {
    return { needed: true, reason: "dependency plan unreadable" }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = browserPrerequisites(process.env.PRE_TARGETS ?? "")
  console.error("browser prerequisites: " + result.reason)
  console.log("needed=" + result.needed)
}
