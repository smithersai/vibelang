import { Smithers as S } from "@smthrs/targets"

// Factory projection, Obsidian Wiki, Lighthouse Backpressure Audit, and
// one-time-use Cloud MCP auth targets for smithersai/vibelang.
// Edit .smithers/FACTORY.ts, run `smthrs run //.smithers:factory-write`, and
// keep `//.smithers:factory-check` green in CI so factory.json and home.json
// never drift from their declaration.

const bun = S.Host.bin("bun")

const factorySources = S.Filegroup({
  srcs: [
    S.file("FACTORY.ts"),
    S.file("WORKSPACE.ts"),
    S.file("factory.json"),
    S.file("home.json"),
    S.file("merge.json"),
    S.file("scripts/project-factory.ts"),
    S.file("//docs/tools/home.ts"),
    S.glob("flows/**", { exclude: ["**/node_modules/**", "**/fixture*/**"] }),
    S.glob("workflows/**"),
    S.glob("instructions/**")
  ]
})

const wikiSources = S.Filegroup({
  srcs: [
    S.file("scripts/wiki.ts"),
    S.file("//scripts/wiki/wiki.test.mjs"),
    S.file("//docs/wiki/Overview.md"),
    S.file("//docs/wiki/Mythical-History.md"),
    S.file("//docs/wiki/Architecture/Compiler-Pipeline.md"),
    S.file("//docs/wiki/Architecture/Continuation-Kernel.md"),
    S.file("//docs/wiki/Architecture/Build-Graph-and-Cache.md"),
    S.file("//docs/wiki/Factory/Smithers-Cloud-Setup.md"),
    S.file("//docs/wiki/Factory/Trust-and-Cache-Model.md"),
    S.file("//docs/wiki/Factory/Backpressure-and-Uphill.md"),
    S.file("//docs/wiki/Factory/Agent-Workflow-Guide.md"),
    S.file("//docs/wiki/Process/VIP-and-Decision-Log.md"),
    S.file("//docs/wiki/Process/Release-and-Security.md")
  ]
})

const auditSources = S.Filegroup({
  srcs: [
    S.file("//scripts/audit/render-lighthouse-report.ts"),
    S.file("//scripts/audit/run-audit.ts"),
    S.file("//scripts/audit/render-lighthouse-report.test.mjs")
  ]
})

const authSources = S.Filegroup({
  srcs: [
    S.file("scripts/mint-sandbox-auth.ts"),
    S.file("//scripts/auth/mint-sandbox-auth.test.mjs")
  ]
})

const factoryCheck = S.Shell.Test({
  summary: "Verify .smithers/factory.json and .smithers/home.json match .smithers/FACTORY.ts without drift.",
  shell: "bun .smithers/scripts/project-factory.ts --check",
  data: [factorySources],
  tools: [bun],
  sandbox: "none",
  timeout: "1m"
})

const wikiCheck = S.Shell.Test({
  summary: "Validate Obsidian Wiki and Mythical History frontmatter and zero broken wikilinks.",
  shell: "bun .smithers/scripts/wiki.ts --check",
  data: [wikiSources],
  tools: [bun],
  timeout: "1m"
})

const wikiTest = S.Shell.Test({
  summary: "Run unit tests for the Obsidian Wiki builder and Smithers Cloud feed publisher.",
  shell: "bun test scripts/wiki/wiki.test.mjs",
  data: [wikiSources],
  tools: [bun],
  timeout: "1m"
})

const auditTest = S.Shell.Test({
  summary: "Run unit tests for the Lighthouse-style backpressure audit report renderer and trust classifier.",
  shell: "bun test scripts/audit/render-lighthouse-report.test.mjs",
  data: [auditSources],
  tools: [bun],
  timeout: "1m"
})

const authTest = S.Shell.Test({
  summary: "Run unit tests for one-time-use PKCE S256 and sandbox MCP authentication.",
  shell: "bun test scripts/auth/mint-sandbox-auth.test.mjs",
  data: [authSources],
  tools: [bun],
  timeout: "1m"
})

export const Package = S.Package({
  targets: {
    "factory-sources": factorySources,
    "wiki-sources": wikiSources,
    "audit-sources": auditSources,
    "auth-sources": authSources,
    "factory-write": S.Shell.Run({
      summary: "Project .smithers/FACTORY.ts into .smithers/factory.json and .smithers/home.json.",
      shell: "bun .smithers/scripts/project-factory.ts --write",
      data: [factorySources],
      tools: [bun],
      sandbox: "none"
    }),
    "factory-check": factoryCheck,
    "wiki-check": wikiCheck,
    "wiki-test": wikiTest,
    "audit-test": auditTest,
    "auth-test": authTest,
    "factory-suite": S.Suite({
      summary: "Verify Smithers Cloud factory projection, Obsidian Wiki, Lighthouse audit, and one-time-use auth.",
      tests: [factoryCheck, wikiCheck, wikiTest, auditTest, authTest]
    })
  }
})
