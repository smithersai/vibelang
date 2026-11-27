/**
 * The coding factory that develops smithersai/vibelang
 * (https://smithers.sh/smithersai/vibelang): featured flows, Dispatcher rules,
 * GitHub mirror and trust policy, issue views and transitions, and the
 * personalized repository home for maintainers, contributors, and viewers.
 *
 * Projected into .smithers/factory.json and .smithers/home.json by
 * //.smithers:factory-write and drift-checked by //.smithers:factory-check.
 * Edit this file, never the projected JSON files directly.
 */
import { Smithers as S } from "@smthrs/targets"

export const ci = S.Flow({
  flow: "ci",
  featured: true,
  summary: "Run VibeLang docs, factory drift, Lighthouse audit, E2E, and compiler cases on Smithers Cloud."
})

export const uphill = S.Flow({
  flow: "uphill",
  featured: true,
  summary: "Run Uphill continuous metrics and render the Lighthouse-style backpressure audit report."
})

export const review = S.Flow({
  flow: "checks/review",
  featured: true,
  summary: "Six-lens review covering compiler semantics, tests, Uphill rules, runtime, trust, and docs."
})

export const issueRepro = S.Flow({
  flow: "issue/repro",
  featured: true,
  summary: "Reproduce a bug report as a minimal failing .vibe case or package test."
})

export const issuePoc = S.Flow({
  flow: "issue/poc",
  featured: true,
  summary: "Build a failing-first local proof of concept for a maintainer-accepted issue."
})

export const prTriage = S.Flow({
  flow: "pr-triage",
  featured: true,
  summary: "Triage a pull request from its diff and audit evidence without running untrusted PR code."
})

export const ciHealth = S.Flow({
  flow: "ci-health",
  featured: true,
  summary: "Find slow, regressed, and flaky checks in build results."
})

export const firstBad = S.Flow({
  flow: "first-bad",
  featured: true,
  summary: "Find the first revision that reproduces a failing check."
})

export const wiki = S.Flow({
  flow: "wiki",
  featured: true,
  summary: "Validate and publish the Obsidian-compatible VibeLang Wiki and Mythical History."
})

export const sandboxAuth = S.Flow({
  flow: "sandbox-auth",
  featured: false,
  summary: "Verify the Cloud MCP server and one-time-use sandbox authentication tooling."
})

export const release = S.Flow({
  flow: "release",
  featured: false,
  summary: "Check, build, rehearse, approve, publish, and verify a VibeLang release."
})

export const siteDeploy = S.Flow({
  flow: "site-deploy",
  featured: false,
  summary: "Deploy vibelang.sh whenever main or npm latest changes."
})

export const specReview = S.Flow({
  flow: "spec-review",
  featured: false,
  summary: "Run the four-reviewer specification acceptance gate on one revision."
})

export const fuzzCampaign = S.Flow({
  flow: "fuzz-campaign",
  featured: false,
  summary: "Run a durable Go compiler fuzz campaign and collect crashers."
})

export const docs = S.Flow({
  flow: "docs",
  featured: false,
  summary: "Generate CONTRIBUTING, MAINTAINERS, and AGENTS files from project.ts."
})

export const effectBump = S.Flow({
  flow: "effect-bump",
  featured: false,
  summary: "Upgrade the Effect pin and verify compiler and runtime parity."
})

export const tsBump = S.Flow({
  flow: "ts-bump",
  featured: false,
  summary: "Advance the TypeScript 7 Go fork pin and regenerate Effect rule shims."
})

export const migrate = S.Flow({
  flow: "migrate",
  featured: false,
  summary: "Migrate an Effect TypeScript codebase to idiomatic VibeLang in verified batches."
})

export const factory = S.Factory({
  summary: "VibeLang public coding factory: incremental build graph, Lighthouse backpressure audit, Obsidian wiki, and Cloud MCP.",
  flows: [
    ci,
    uphill,
    review,
    issueRepro,
    issuePoc,
    prTriage,
    ciHealth,
    firstBad,
    wiki,
    sandboxAuth,
    release,
    siteDeploy,
    specReview,
    fuzzCampaign,
    docs,
    effectBump,
    tsBump,
    migrate
  ],
  on: {
    "issue.opened": {
      flow: "issue/repro",
      description: "Reproduce new bug reports with a minimal .vibe test case"
    },
    "issue.labeled:todo": {
      flow: "issue/poc",
      description: "Build a failing-first PoC for every maintainer-accepted TODO"
    },
    "change.opened": {
      flow: ["checks/review", "uphill"],
      description: "Review every Change across VibeLang lenses and run Lighthouse backpressure audit"
    },
    "change.updated": {
      flow: ["checks/review", "uphill"],
      description: "Re-review every updated Change and refresh Lighthouse backpressure scores"
    },
    "github.push:main": {
      flow: ["uphill", "wiki", "site-deploy"],
      description: "Refresh Lighthouse audit scores, sync Obsidian Wiki, and deploy vibelang.sh when main advances"
    },
    "schedule:17 9 * * 1": {
      flow: "ci-health",
      description: "Weekly Monday CI health, flakiness, and target timing audit"
    },
    "schedule:0 6 * * *": {
      flow: "uphill",
      description: "Daily Lighthouse backpressure score check across compiler, runtime, and docs"
    }
  },
  github: S.Github.Policy({
    mirror: "push",
    issues: "two-way",
    changes: "land",
    maintainers: ["roninjin10"],
    protectedPaths: [
      ".smithers",
      ".github",
      ".agents/uphill",
      "PACKAGE.ts",
      "packages/PACKAGE.ts",
      "typescript/PACKAGE.ts",
      "typescript/tsc/PACKAGE.ts",
      "typescript/vibelang/PACKAGE.ts",
      "scripts/release",
      "scripts/ci.sh",
      "typescript/tsc/internal/vibelang/identity.go",
      "docs/design/src",
      "AGENTS.md",
      "MAINTAINERS.md",
      "CONTRIBUTING.md"
    ]
  }),
  machine: {
    vcpus: 4,
    memoryMiB: 8192,
    tools: ["go", "gofmt", "node", "bun", "jj", "pnpm"]
  },
  issueViews: [
    { id: "accepted", title: "Accepted", state: "open", labels: ["accepted"] },
    { id: "needs-repro", title: "Needs repro", state: "open", labels: ["needs-repro"] },
    { id: "good-first-issue", title: "Good first issues", state: "open", labels: ["good first issue"] },
    { id: "bugs", title: "Bugs", state: "open", labels: ["bug"] },
    { id: "in-progress", title: "In progress", state: "open", labels: ["in-progress"] },
    { id: "docs", title: "Documentation", state: "open", labels: ["documentation"] }
  ],
  issueTransitions: [
    { id: "accept", title: "Accept for discussion", to: "accepted", actor: "person" },
    { id: "needs-repro", title: "Request reproduction", to: "needs-repro", actor: "anyone" },
    { id: "start-work", title: "Mark in progress", from: "accepted", to: "in-progress", actor: "anyone" },
    { id: "commit-planned", title: "Commit maintainer plan", to: "commitment: committed", actor: "person" },
    { id: "commit-open", title: "Open for community PR", to: "commitment: open", actor: "person" }
  ]
})

export const homeDefinition = {
  docs: "https://vibelang.sh/llms.txt",
  contributors: "role" as const,
  sections: [
    {
      title: "Today",
      audience: "maintainer",
      blocks: [
        {
          type: "action",
          flow: "branch.new",
          title: "New branch",
          key: "b"
        },
        {
          type: "action",
          flow: "uphill",
          title: "Run Lighthouse audit",
          key: "u"
        },
        {
          type: "action",
          flow: "wiki",
          title: "Refresh Obsidian wiki",
          key: "w"
        },
        {
          type: "issues"
        },
        {
          type: "stack",
          title: "Mythical stack"
        },
        {
          type: "runs",
          title: "Recent runs"
        },
        {
          type: "flows",
          title: "Factory flows"
        },
        {
          type: "links",
          title: "Maintainer controls",
          links: [
            {
              label: "Live Factory",
              url: "https://smithers.sh/smithersai/vibelang/-/factory"
            },
            {
              label: "Wiki and Mythical History",
              url: "https://smithers.sh/smithersai/vibelang/-/wiki"
            },
            {
              label: "Cloud MCP Endpoint",
              url: "https://smithers.sh/smithersai/vibelang/mcp"
            },
            {
              label: "GitHub Mirror and Releases",
              url: "https://github.com/smithersai/vibelang/actions"
            }
          ]
        }
      ]
    },
    {
      title: "Contribute",
      audience: "contributor",
      blocks: [
        {
          type: "code",
          title: "Set up",
          language: "sh",
          code: "sh scripts/setup.sh"
        },
        {
          type: "cards",
          title: "How a change lands",
          cards: [
            {
              title: "Report a reproducible bug",
              text: "Include a minimal reproduction to avoid the needs-repro label."
            },
            {
              title: "Wait for accepted",
              text: "A maintainer opens discussion. Check timeline (weeks/months/unscheduled) and commitment (committed/open/undecided)."
            },
            {
              title: "Try the proof of concept",
              text: "Check out and run the maintainer's linked draft PR: poc: #123 for issue 123."
            },
            {
              title: "Open one focused PR per accepted issue",
              text: "A person merges. Agents never approve or merge."
            }
          ]
        },
        {
          type: "text",
          title: "Untrusted runs and shared cache trust",
          text: "Contributors are encouraged to run local checks, Uphill Lighthouse audits, and untrusted sandbox builds freely with read-only hits from the shared Smithers Cloud object store. Only trusted maintainer runs and controlled sandboxes can publish trunk cache entries or satisfy merge gates."
        },
        {
          type: "code",
          title: "Run Lighthouse backpressure audit locally",
          language: "sh",
          code: "bun scripts/audit/run-audit.ts"
        },
        {
          type: "links",
          title: "Where to ask",
          links: [
            {
              label: "Issues",
              url: "https://github.com/smithersai/vibelang/issues"
            },
            {
              label: "Smithers Factory",
              url: "https://smithers.sh/smithersai/vibelang/-/factory"
            },
            {
              label: "Wiki and Mythical History",
              url: "https://smithers.sh/smithersai/vibelang/-/wiki"
            },
            {
              label: "Docs",
              url: "https://vibelang.sh"
            },
            {
              label: "Connect Agent via MCP",
              url: "https://smithers.sh/smithersai/vibelang/mcp"
            }
          ]
        },
        {
          type: "prompt",
          title: "Ask about the code",
          placeholder: "Ask about VibeLang's compiler…"
        }
      ]
    },
    {
      audience: "everyone",
      blocks: [
        {
          type: "hero",
          title: "VibeLang",
          tagline: "Write Effect programs in TypeScript syntax, with typed errors and services the compiler checks.",
          text: "A simple, readable syntax for Effect that compiles to JavaScript with TypeScript declarations, with first-class access to the TypeScript ecosystem.",
          install: "npm create vibelang@latest my-app",
          actions: [
            {
              label: "Get started",
              url: "https://vibelang.sh/getting-started/004-installation"
            },
            {
              label: "Cheat sheet",
              url: "https://vibelang.sh/vibelang-features/115-cheat-sheet"
            },
            {
              label: "Docs",
              url: "https://vibelang.sh"
            }
          ],
          announcement: {
            label: "v0: the language will change",
            url: "https://vibelang.sh"
          }
        },
        {
          type: "code",
          title: "Bun alternative",
          language: "sh",
          code: "bun create vibelang@latest my-app\ncd my-app\nbun run start"
        },
        {
          type: "code",
          file: "users.vibe",
          language: "vibe",
          code: "error UserNotFound { id: string }\nservice Users {\n  find(id: string): string!UserNotFound\n}\n\nconst UsersLive = Layer.succeed(Users, {\n  effect find(id: string) {\n    if (id !== \"42\") throw new UserNotFound({ id })\n    return \"Ada\"\n  }\n})\n\nexport effect function main() {\n  provide UsersLive {\n    const users = try Users\n    const [name, fallback] = try.all [\n      users.find(\"42\"),\n      effect { return users.find(\"7\") catch () => \"Guest\" }\n    ]\n    try Console.log(name, fallback)\n  }\n}\n\nrunPromise(main())"
        },
        {
          type: "stats",
          stats: [
            {
              value: "MIT · Apache 2.0",
              label: "License"
            },
            {
              value: "Effect 4",
              label: "Runtime"
            },
            {
              value: "4,027+ cases",
              label: "Compiler suite"
            },
            {
              value: "932+ fuzzers",
              label: "Continuous fuzzing"
            },
            {
              value: "5,709 targets",
              label: "Cached build graph"
            },
            {
              value: "v0",
              label: "Breaking changes ahead"
            }
          ]
        },
        {
          type: "cards",
          title: "Why VibeLang",
          cards: [
            {
              title: "Every function is an Effect",
              text: "A call runs where it stands: no generators, no yield*."
            },
            {
              title: "Typed errors",
              text: "error NotFound { id } and User!NotFound in the signature."
            },
            {
              title: "Services and layers",
              text: "service, provide and Layer as language."
            },
            {
              title: "Concurrency",
              text: "try.all, try.race, fork and join."
            },
            {
              title: "Your editor knows it",
              text: "Diagnostics, hovers and completions from the compiler."
            },
            {
              title: "TypeScript interop",
              text: "Checks .vibe and .ts together and emits JavaScript and types."
            }
          ]
        },
        {
          type: "cards",
          title: "Public Smithers Cloud Factory",
          cards: [
            {
              label: "Factory",
              title: "Live Coding Factory",
              text: "Inspect public TODOs, compiler reviews, merge queue, and live flows built on Smithers Cloud.",
              url: "https://smithers.sh/smithersai/vibelang/-/factory"
            },
            {
              label: "Wiki",
              title: "Obsidian Wiki and Mythical History",
              text: "Browse backlinked architecture notes, VIP decisions, and the full mythical history of VibeLang.",
              url: "https://smithers.sh/smithersai/vibelang/-/wiki"
            },
            {
              label: "MCP",
              title: "Bring Your Own Agent",
              text: "Attach Claude Code, Codex, Antigravity, or Cursor over OAuth 2.1 Streamable HTTP MCP.",
              url: "https://smithers.sh/smithersai/vibelang/mcp"
            },
            {
              label: "Backpressure",
              title: "Lighthouse Quality Audit",
              text: "Continuous Uphill gauges across Footprint, Style, Correctness, Testing, Documentation, and Factory & Trust.",
              url: "https://github.com/smithersai/vibelang/actions/workflows/uphill.yml"
            }
          ]
        },
        {
          type: "code",
          title: "Run benchmarks",
          language: "sh",
          code: "# From the repository root:\nsh scripts/setup.sh\n(cd experiments && bun install --frozen-lockfile)\n(cd docs/tools && bun install --frozen-lockfile)\nVIBELANG=\"$PWD/packages/compiler/native/vibelang\" sh scripts/bench/compiler.sh --runs 5 --out .cache/bench\nnode scripts/bench/lsp.mjs packages/compiler/native/vibelang .cache/bench/synth/vibelang"
        },
        {
          type: "cards",
          title: "Ecosystem",
          cards: [
            {
              label: "vibelang",
              title: "Compiler",
              text: "The compiler and language server.",
              url: "https://www.npmjs.com/package/vibelang"
            },
            {
              label: "vibelang-runtime",
              title: "Runtime",
              text: "The continuation kernel generated code runs on.",
              url: "https://www.npmjs.com/package/vibelang-runtime"
            },
            {
              label: "vibelang-vite",
              title: "Vite",
              text: "Compile .vibe modules in Vite and Vitest.",
              url: "https://www.npmjs.com/package/vibelang-vite"
            },
            {
              label: "create-vibelang",
              title: "Starter",
              text: "npm create vibelang@latest my-app",
              url: "https://www.npmjs.com/package/create-vibelang"
            }
          ]
        },
        {
          type: "releases",
          title: "Releases",
          releases: [
            {
              name: "vibelang@0.0.14",
              url: "https://www.npmjs.com/package/vibelang/v/0.0.14",
              date: "2026-11-26",
              summary: "120+ compiler and runtime fixes, SVG user guides, and Smithers Cloud public factory switchover."
            },
            {
              name: "vibelang@0.0.13",
              url: "https://www.npmjs.com/package/vibelang/v/0.0.13",
              date: "2026-11-13",
              summary: "The first alpha release."
            },
            {
              name: "vibelang@0.0.1",
              url: "https://www.npmjs.com/package/vibelang/v/0.0.1",
              date: "2026-10-18",
              summary: "The first release on npm."
            }
          ],
          more: {
            label: "All versions",
            url: "https://www.npmjs.com/package/vibelang?activeTab=versions"
          }
        },
        {
          type: "prompt" as const,
          title: "Questions about VibeLang?",
          placeholder: "Ask about this repository…"
        }
      ]
    }
  ]
} as const
