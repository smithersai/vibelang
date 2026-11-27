#!/usr/bin/env bun
/**
 * Projects .smithers/FACTORY.ts into .smithers/factory.json and
 * .smithers/home.json and drift-checks both files against their declaration.
 *
 * Usage:
 *   bun .smithers/scripts/project-factory.ts --write
 *   bun .smithers/scripts/project-factory.ts --check
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import * as Factory from "@smthrs/targets/Factory"
import * as FlowCatalog from "@smthrs/targets/FlowCatalog"
import * as Home from "../../docs/tools/home.ts"
import { factory, homeDefinition } from "../FACTORY.ts"

const repoRoot = resolve(import.meta.dir, "../..")
const factoryJsonPath = join(repoRoot, ".smithers/factory.json")
const homeJsonPath = join(repoRoot, ".smithers/home.json")

interface ParsedFrontmatter {
  description: string
  capabilities: string[]
  model: string | null
  modelInvocable: boolean
  budget?: { tokens?: number; milliseconds?: number; usd?: number }
}

function parseYamlFrontmatter(source: string): ParsedFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  if (!match) {
    return { description: "", capabilities: [], model: null, modelInvocable: true }
  }
  const lines = match[1]!.split(/\r?\n/)
  let description = ""
  const capabilities: string[] = []
  let model: string | null = null
  let modelInvocable = true
  const budget: { tokens?: number; milliseconds?: number; usd?: number } = {}
  let section: "" | "capabilities" | "budget" = ""

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    if (/^description:\s*/.test(line)) {
      section = ""
      description = line.replace(/^description:\s*/, "").trim().replace(/^["']|["']$/g, "")
    } else if (/^model:\s*/.test(line)) {
      section = ""
      const val = line.replace(/^model:\s*/, "").trim().replace(/^["']|["']$/g, "")
      model = val === "null" || val === "" ? null : val
    } else if (/^disable-model-invocation:\s*/.test(line)) {
      section = ""
      modelInvocable = line.replace(/^disable-model-invocation:\s*/, "").trim() !== "true"
    } else if (/^capabilities:\s*\[/.test(line)) {
      section = ""
      const arr = JSON.parse(line.replace(/^capabilities:\s*/, "").trim())
      if (Array.isArray(arr)) {
        for (const item of arr) if (typeof item === "string") capabilities.push(item)
      }
    } else if (/^capabilities:\s*$/.test(line)) {
      section = "capabilities"
    } else if (/^budget:\s*$/.test(line)) {
      section = "budget"
    } else if (section === "capabilities" && /^\s*-\s+/.test(line)) {
      capabilities.push(line.replace(/^\s*-\s+/, "").trim().replace(/^["']|["']$/g, ""))
    } else if (section === "budget" && /^\s+\w+:\s*/.test(line)) {
      const m = /^\s+(\w+):\s*(.+)$/.exec(line)
      if (m) {
        const key = m[1]
        const num = Number(m[2]!.trim())
        if (Number.isFinite(num) && (key === "tokens" || key === "milliseconds" || key === "usd")) {
          budget[key] = num
        }
      }
    }
  }
  return {
    description,
    capabilities,
    model,
    modelInvocable,
    ...(Object.keys(budget).length > 0 ? { budget } : {})
  }
}

function parseCodeFlowMetadata(source: string): {
  description: string
  capabilities: string[]
  modelInvocable: boolean
} {
  const descMatch = /description:\s*["'`]([^"'`\n]+)["'`]/.exec(source)
  const capMatch = /capabilities:\s*(\[[^\]]*\])/.exec(source)
  const invMatch = /modelInvocable:\s*(true|false)/.exec(source)
  let capabilities: string[] = []
  if (capMatch) {
    try {
      const parsed = JSON.parse(capMatch[1]!.replace(/'/g, '"'))
      if (Array.isArray(parsed)) capabilities = parsed.filter((x): x is string => typeof x === "string")
    } catch {
      capabilities = []
    }
  }
  return {
    description: descMatch?.[1] ?? "",
    capabilities,
    modelInvocable: invMatch ? invMatch[1] === "true" : true
  }
}

function discoverFlows(): FlowCatalog.DiscoveredFlow[] {
  const flowsRoot = join(repoRoot, ".smithers/flows")
  const workflowsRoot = join(repoRoot, ".smithers/workflows")
  const byId = new Map<string, FlowCatalog.DiscoveredFlow>()

  function walk(dir: string) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir).sort()) {
      if (entry === "node_modules" || entry === "test" || entry.startsWith("fixture")) continue
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) {
        walk(full)
        continue
      }
      if (entry !== "flow.ts" && entry !== "flow.vibe" && entry !== "flow.mdx") continue
      const rel = relative(repoRoot, full).split("\\").join("/")
      const id = relative(flowsRoot, dir).split("\\").join("/")
      const source = readFileSync(full, "utf8")
      if (entry === "flow.mdx") {
        const fm = parseYamlFrontmatter(source)
        byId.set(id, {
          id,
          description: fm.description || `Run ${id}.`,
          kind: "mdx",
          path: rel,
          capabilities: fm.capabilities,
          flows: [],
          model: fm.model,
          modelInvocable: fm.modelInvocable,
          ...(fm.budget ? { budget: fm.budget } : {})
        })
      } else {
        const meta = parseCodeFlowMetadata(source)
        byId.set(id, {
          id,
          description: meta.description || `Run ${id}.`,
          kind: "ts",
          path: rel,
          capabilities: meta.capabilities,
          flows: [],
          model: null,
          modelInvocable: meta.modelInvocable
        })
      }
    }
  }

  walk(flowsRoot)

  if (existsSync(workflowsRoot)) {
    for (const entry of readdirSync(workflowsRoot).sort()) {
      if (!entry.endsWith(".ts") && !entry.endsWith(".vibe")) continue
      const full = join(workflowsRoot, entry)
      if (!statSync(full).isFile()) continue
      const id = entry.replace(/\.(ts|vibe)$/, "")
      const rel = relative(repoRoot, full).split("\\").join("/")
      const source = readFileSync(full, "utf8")
      const meta = parseCodeFlowMetadata(source)
      // Workflows in .smithers/workflows/ take precedence over .smithers/flows/<id>/flow.ts
      byId.set(id, {
        id,
        description: meta.description || `Run ${id}.`,
        kind: "ts",
        path: rel,
        capabilities: meta.capabilities,
        flows: [],
        model: null,
        modelInvocable: meta.modelInvocable
      })
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function renderFactoryJson(): string {
  const discovered = discoverFlows()
  const rows = FlowCatalog.rows(discovered, factory.flows)
  const projected = JSON.parse(Factory.renderProjection(factory, rows)) as {
    flows?: Array<{ path?: string; kind?: string }>
    [key: string]: unknown
  }
  if (Array.isArray(projected.flows)) {
    for (const flow of projected.flows) {
      if (typeof flow.path === "string" && flow.path.endsWith(".vibe")) {
        flow.kind = "vibe"
      }
    }
  }
  return JSON.stringify(projected, null, 2) + "\n"
}

export function renderHomeJson(): string {
  const rendered = JSON.stringify(homeDefinition, null, 2) + "\n"
  const checked = Home.read(rendered)
  if (checked._tag === "Invalid") {
    throw new Error(`homeDefinition failed @smthrs/views Home.read: ${checked.reason} ${JSON.stringify(checked.at ?? {})}`)
  }
  if (checked.skipped.length > 0) {
    throw new Error(`homeDefinition contains skipped blocks: ${JSON.stringify(checked.skipped)}`)
  }
  return rendered
}

function main() {
  const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null
  if (!mode) {
    console.error("Usage: bun .smithers/scripts/project-factory.ts --write | --check")
    process.exit(2)
  }

  const expectedFactory = renderFactoryJson()
  const expectedHome = renderHomeJson()

  if (mode === "write") {
    writeFileSync(factoryJsonPath, expectedFactory, "utf8")
    writeFileSync(homeJsonPath, expectedHome, "utf8")
    console.log("project-factory: wrote .smithers/factory.json and .smithers/home.json")
    return
  }

  const drifted: string[] = []
  if (!existsSync(factoryJsonPath) || readFileSync(factoryJsonPath, "utf8") !== expectedFactory) {
    drifted.push(".smithers/factory.json")
  }
  if (!existsSync(homeJsonPath) || readFileSync(homeJsonPath, "utf8") !== expectedHome) {
    drifted.push(".smithers/home.json")
  }
  if (drifted.length > 0) {
    console.error(`project-factory: drift detected in ${drifted.join(", ")}. Run: bun .smithers/scripts/project-factory.ts --write`)
    process.exit(1)
  }
  console.log("project-factory: .smithers/factory.json and .smithers/home.json match .smithers/FACTORY.ts")
}

if (import.meta.main) {
  main()
}
