import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { emit, ROOT } from "./_lib.ts"

// 1. Factory projection parity (.smithers/FACTORY.ts -> factory.json + home.json)
const factoryCheck = spawnSync("bun", [".smithers/scripts/project-factory.ts", "--check"], {
  cwd: ROOT,
  encoding: "utf8"
})
emit("factory-projection", factoryCheck.status === 0 ? "pass" : "fail", {
  note: factoryCheck.status === 0 ? undefined : (factoryCheck.stderr || factoryCheck.stdout).trim().slice(0, 180)
})

// 2. Shared Smithers Cloud object store & split read/write cache trust boundary
const workspaceSource = readFileSync(join(ROOT, ".smithers/WORKSPACE.ts"), "utf8")
const hasBuildSmithers = workspaceSource.includes("https://build.smithers.sh")
const hasReadSecret = workspaceSource.includes('S.Secret("SMITHERS_CACHE_READ_TOKEN")')
const hasWriteSecret = workspaceSource.includes('S.Secret("SMITHERS_CACHE_WRITE_TOKEN")')
const cacheTrustOk = hasBuildSmithers && hasReadSecret && hasWriteSecret
emit("cache-trust", cacheTrustOk ? "pass" : "fail", {
  note: cacheTrustOk
    ? undefined
    : "WORKSPACE.ts must declare https://build.smithers.sh with split SMITHERS_CACHE_READ_TOKEN and SMITHERS_CACHE_WRITE_TOKEN secrets"
})

// 3. GitHub Actions workflow trust: forbid pull_request_target and keep write token out of PR workflows
const wfDir = join(ROOT, ".github/workflows")
let wfViolation: string | undefined
if (existsSync(wfDir)) {
  for (const name of readdirSync(wfDir).sort()) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue
    const text = readFileSync(join(wfDir, name), "utf8")
    if (/\bpull_request_target\b/.test(text)) {
      wfViolation = `.github/workflows/${name} uses forbidden pull_request_target trigger`
      break
    }
    if (name !== "cache-publish.yml" && /\bpull_request\b/.test(text) && text.includes("SMITHERS_CACHE_WRITE_TOKEN")) {
      wfViolation = `.github/workflows/${name} references SMITHERS_CACHE_WRITE_TOKEN in a pull_request workflow`
      break
    }
  }
}
emit("workflow-trust", wfViolation ? "fail" : "pass", { note: wfViolation })

// 4. Protected paths and maintainer policy in .smithers/factory.json
let policyNote: string | undefined
try {
  const manifest = JSON.parse(readFileSync(join(ROOT, ".smithers/factory.json"), "utf8")) as {
    github?: { maintainers?: string[]; protectedPaths?: string[]; issues?: string }
  }
  const gh = manifest.github
  if (!gh?.maintainers?.length) policyNote = "factory.json github.maintainers is empty"
  else if (!gh.protectedPaths || gh.protectedPaths.length < 5) policyNote = "factory.json github.protectedPaths is incomplete"
  else if (gh.issues !== "two-way") policyNote = `factory.json github.issues is ${gh.issues ?? "unset"}, expected two-way`
} catch (err) {
  policyNote = `factory.json unreadable: ${err instanceof Error ? err.message : String(err)}`
}
emit("factory-policy", policyNote ? "fail" : "pass", { note: policyNote })

// 5. Obsidian Wiki and Mythical History link integrity
const wikiCheck = spawnSync("bun", [".smithers/scripts/wiki.ts", "--check"], {
  cwd: ROOT,
  encoding: "utf8"
})
emit("wiki-links", wikiCheck.status === 0 ? "pass" : "fail", {
  note: wikiCheck.status === 0 ? undefined : (wikiCheck.stderr || wikiCheck.stdout).trim().slice(0, 180)
})
