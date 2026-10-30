/**
 * The source of CONTRIBUTING.md, MAINTAINERS.md, AGENTS.md and templates/app/AGENTS.md.
 * Edit this file, then run `bun run docs:generate` in .smithers/. `{{name}}` inserts a fact below.
 */
export interface Section { readonly heading: string; readonly body: string }
export interface Document { readonly title: string; readonly intro: string; readonly sections: readonly Section[] }

const repo = "https://github.com/smithersai/vibelang";

export const facts = {
  name: "VibeLang",
  issues: `${repo}/issues`,
  newIssue: `${repo}/issues/new/choose`,
  newBug: `${repo}/issues/new?template=bug.yml`,
  newIdea: `${repo}/issues/new?template=idea.yml`,
  newQuestion: `${repo}/issues/new?template=question.yml`,
  // The starter's docs index complements the packaged skill.
  languageRules: "https://vibelang.sh/llms.txt",
  skill: "packages/compiler/skills/vibelang/SKILL.md",
  setup: "sh scripts/setup.sh",
  e2e: "sh scripts/e2e.sh",
  merge: "Maintainers land their own work directly on `main`. Outside contributions arrive as pull requests that a maintainer reviews and merges. Agents never approve or merge.",
  generated: "CONTRIBUTING.md, MAINTAINERS.md and both AGENTS.md files come from `.smithers/flows/docs/project.ts`, except the starter's Essentials, which come from `docs/user/llms-essentials.md`. Edit the source, then run `bun run docs:generate` in `.smithers/`",
  style: "Follow the surrounding code and each package's configuration. Format Go with gofmt. Keep TypeScript and VibeLang examples consistent with nearby files, and don't reformat unrelated code.",
  secrets: "Never put credentials or private user content in fixtures, logs or issues."
} as const;

export const layout: readonly (readonly [path: string, responsibility: string])[] = [
  ["`typescript/tsc/`", "The compiler: a fork of the TypeScript 7 Go compiler with VibeLang's checker, lowering and language server"],
  ["`typescript/vibelang/cases/`", "Compiler acceptance cases, run by `typescript/vibelang/smoke.sh`"],
  ["`packages/compiler/`", "The `vibelang` npm package: launcher, editor extension and packaging"],
  ["`packages/runtime/`", "`vibelang-runtime`: the continuation kernel and generated-code helpers"],
  ["`packages/create-vibelang/`, `templates/app/`", "The starter generator and the starter app"],
  ["`packages/vite/`, `packages/unplugin/`", "Vite, webpack, Rspack and other bundler integrations"],
  ["`packages/ts-mapper/`", "TypeScript mapping utilities"],
  ["`editors/`", "VS Code and Cursor extension, Neovim and Zed setup, tree-sitter grammar"],
  ["`examples/`", "Runnable example projects"],
  ["`docs/user/`, `docs/design/`", "User guides, the specification and the decision log"],
  ["`docs/tools/`, `site/`", "Docs checks and the vibelang.sh site"],
  ["`scripts/`", "Setup, end-to-end checks and release scripts"],
  ["`experiments/`, `prototype/`", "The continuation kernel's law suite and earlier compilers"],
  ["`.smithers/`", "The docs flow, the README's token comparison, the converter's prompt and test cases, and the repository home page with its chat instructions"]
];

export const tests: readonly (readonly [change: string, command: string])[] = [
  ["Install, compiler, runtime or starter", "`{{e2e}}`"],
  ["Compiler semantics", "`(cd packages/runtime && bun install) && (cd typescript && sh vibelang/smoke.sh --jobs 8)`"],
  ["Compiler package", "`(cd packages/compiler && node --test test/*.test.mjs)`"],
  ["Doc code blocks", "`bun docs/tools/check-snippets.ts`"],
  ["Examples", "`sh scripts/check-examples.sh`"],
  ["Continuation kernel", "`(cd experiments && bun test)`"],
  ["These docs", "`(cd .smithers && bun install && bun run docs:check)`"]
];

export const labels: readonly (readonly [label: string, meaning: string])[] = [
  ["`bug`", "A bug report, from the bug form"],
  ["`enhancement`", "An idea, from the idea form"],
  ["`question`", "A question, from the question form"],
  ["`documentation`", "Guide, reference or example work"],
  ["`needs-repro`", "The report has no reproduction that shows the bug on the latest version"],
  ["`accepted`", "Accepted for discussion; a maintainer links its proof of concept"],
  ["`timeline: weeks`", "A maintainer expects it to land within weeks"],
  ["`timeline: months`", "A maintainer expects it to land within months"],
  ["`timeline: unscheduled`", "No estimate yet"],
  ["`commitment: committed`", "Maintainers plan to build it"],
  ["`commitment: open`", "Maintainers would merge a good implementation but don't plan to build it"],
  ["`commitment: undecided`", "Under discussion; it may be declined"],
  ["`good first issue`", "A bounded task with a clear result and test"],
  ["`in-progress`", "Someone is working on it"],
  ["`duplicate`, `invalid`, `wontfix`", "Closing reasons; say why and link what replaces it"]
];

export const releaseSteps: readonly string[] = [
  "**Align versions.** Every package version must equal the compiler's, in `typescript/tsc/internal/vibelang/identity.go`; `make-packages.mjs` refuses a mismatch. Review breaking changes.",
  "**Check.** Run setup, `{{e2e}}`, the compiler cases, affected package tests, editor tests and `bun docs/tools/check-snippets.ts`. Record commands, toolchain versions and results. A skipped platform is untested.",
  "**Build.** `sh scripts/release/build-binaries.sh` cross-compiles the candidate platform binaries. `node scripts/release/make-packages.mjs` assembles the candidate packages and their tarballs in `dist-npm/`. Check manifests, the bundled extension, licenses and notices.",
  "**Rehearse.** `sh scripts/release/rehearse.sh` publishes the tarballs to a throwaway registry, then scaffolds, builds, starts and tests an app with npm and with Bun. It runs on one host, so it can't prove the other platforms' binaries work.",
  "**Publish.** A person runs `sh scripts/release/publish.sh --dry-run`, then `sh scripts/release/publish.sh --otp <one-time-password>`. It publishes the platform packages first and skips versions already published, so a rerun resumes. Keep credentials out of recordings and logs.",
  "**Verify.** `sh scripts/release/verify-published.sh <version>` scaffolds, installs, builds, starts and tests an app from the public registry. Publish release notes with exact versions, breaking changes and known limitations."
];

export const contributing: Document = {
  title: "Contributing to {{name}}",
  intro: "Bug reports with a minimal reproduction, ideas, docs fixes and focused pull requests are welcome. {{name}} is v0, so the language still changes in breaking ways.",
  sections: [
    {
      heading: "How work moves",
      body: `1. **Open an issue.** A [bug report]({{newBug}}) needs a minimal reproduction: the smallest program and command that show the bug on the latest version. An [idea]({{newIdea}}) starts as an issue too, before any code.
2. **A maintainer accepts it for discussion.** The \`accepted\` label opens the design discussion. A \`timeline:\` label gives the maintainer's estimate of when it could land, and a \`commitment:\` label says whether maintainers plan to build it. See [the labels](MAINTAINERS.md#labels).
3. **Accepted issues get a proof of concept.** When a maintainer accepts an issue, they link a proof of concept as a draft pull request titled \`poc: #<n>\` that you can check out and run. Everyone can try it before the design is settled. It is a starting point, not a merge candidate.
4. **Open a pull request** that links the accepted issue. A typo fix needs no issue.`
    },
    {
      heading: "Set up",
      body: `From a checkout, with Go, Bun and Node on your \`PATH\`:

\`\`\`sh
{{setup}}
\`\`\`

The tested toolchain is Go 1.26 (setup downloads the Go 1.27 the compiler requires), Bun 1.4.1 and Node 22.22.3 (22.x) or Node 24.11.1 or later. The optional Smithers build graph retains its dependency's Node 26.4 runtime declaration; published packages and the starter require Node 22.22.3. Setup builds the native compiler into \`packages/compiler/native/vibelang\`, packs the runtime, builds the editor extension, and installs a local starter in \`~/.bun-create/vibelang\`. Apps you then create with \`bun create vibelang my-app\` depend on this checkout. After you change the compiler or runtime, rerun setup, then run \`bun update vibelang-runtime vibelang vibelang-vite\` in those apps. Remove \`~/.bun-create/vibelang\` to scaffold from npm again.

The compiler cases and the doc snippet check also need the pinned packages in \`experiments/\` and \`docs/tools/\`. Install them once:

\`\`\`sh
(cd experiments && bun install)
(cd docs/tools && bun install)
\`\`\``
    },
    { heading: "Find your way around", body: "{{layout}}" },
    {
      heading: "Test your change",
      body: `{{tests}}

The Go suites run from \`typescript/tsc/\`. Install Effect with \`(cd experiments && bun install)\` (or set \`EFFECT_NODE_MODULES\` to its \`node_modules\` directory), and install the stock compiler that \`packages/ts-mapper/package.json\` pins in \`devDependencies\` with \`v=$(node -p 'require("./packages/ts-mapper/package.json").devDependencies.typescript') && npm install --prefix packages/ts-mapper/test/.cache/typescript-$v --no-audit --no-fund typescript@$v\` from the repository root. Mapper tests build their own compiler and runtime scope. Root discovery supports Go's \`-trimpath\`; when running a moved test binary outside the checkout, set \`TYPESCRIPT_REPO_ROOT\` to the absolute \`typescript/tsc/\` directory. Upstream parser, formatter and tsoptions fixture checks additionally use \`typescript/tsc/testdata/fixtures/\` (including \`compiler/\` and \`typescript/tests/baselines/reference/config/commandLineParsing/\`) and \`typescript/tsc/testdata/baselines/reference/\`, which this checkout omits; restore the matching upstream testdata checkout to run them. A test missing these optional fixtures or dependencies skips with the exact missing path and setup instruction.

\`packages/ts-mapper/\` is \`vibelang-ts-mapper\`, an experimental, unpublished TypeScript 7.1 content mapper through which stock \`tsc\` and TypeScript's language server check \`.vibe\` files. \`bash packages/ts-mapper/test/e2e.sh\` builds it, installs the TypeScript its \`package.json\` pins, and checks, emits and runs projects with it; \`KEEP=1\` keeps the projects. A project enables it with a top-level \`"contentMappers": [{ "package": "vibelang-ts-mapper", "extensions": [".vibe"] }]\` in \`tsconfig.json\`. TypeScript runs a mapper only when allowed: \`tsc --runExternalCode\`, \`runExternalCode: true\` in a language server's initialization options, or, in VS Code, a trusted workspace with \`js/ts.contentMappers.enabled\` on. Stock \`tsc\` writes declarations for \`.vibe\` files (\`greet.d.vibe.ts\`) but no JavaScript. When \`vibelang\` or \`vibelang-mapper --emit\` writes that JavaScript, add \`"outputExtensions": { ".vibe": ".js" }\` to the entry and set \`rewriteRelativeImportExtensions\`, as \`packages/ts-mapper/test/emit-fixture\` does: \`tsc\` then imports \`./greet.js\` and writes \`greet.d.ts\`. \`TS_CONTENT_MAPPER_DEBUG=1\` makes \`tsc\` log the protocol and the mapper's stderr.

The repository has no CI or commit statuses. For each pull request, a maintainer runs \`sh scripts/e2e.sh\` and the compiler case suite, \`(cd typescript && sh vibelang/smoke.sh --jobs 8)\`, and records the results in the pull request.

The end-to-end check runs setup, then scaffolds, installs, builds, runs and tests a temporary app, and stops at the first failing step. A compiler case is a directory under \`typescript/vibelang/cases/\`; \`typescript/vibelang/harness.mjs\` describes the format. A passing check doesn't prove every language feature works, so list the checks you ran, the ones that failed and the ones you couldn't run.`
    },
    {
      heading: "Pull requests",
      body: `1. Link the accepted issue: \`Closes #123\`.
2. Change one thing. Add a test that fails without the change, and update the examples and diagnostics it affects. Every fix commit must add one line to the top release-notes section's \`Bugs fixed since <last published version>\` list and update every doc page its change affects, in the same commit. If the bug is listed under \`Known bugs\`, remove that line and add its \`Bugs fixed\` line in the same commit.
3. Describe the behavior before and after, any syntax or API break, and the commands you ran with their results.
4. Open a draft for early feedback. {{merge}}

After publishing, start a \`## <next version> (unreleased)\` section in [the release notes](docs/user/src/setup/release-notes.md), with a \`### Bugs fixed since <last published version>\` heading. Keep install pins and other version-derived text on the compiler manifest's published version until the next release version bump.`
    },
    {
      heading: "Style",
      body: `{{style}} Tests assert behavior, including rejected programs and their diagnostics. {{secrets}}

{{generated}}.`
    },
    {
      heading: "First contributions",
      body: `Start with [good first issues]({{issues}}?q=is%3Aopen+label%3A%22good+first+issue%22) or [documentation]({{issues}}?q=is%3Aopen+label%3Adocumentation). A reduced reproduction of a reported bug or a correction to a guide is a full contribution. Ask on the issue before you start a large change.`
    },
    {
      heading: "Questions and security",
      body: `Ask with the [question form]({{newQuestion}}). Report a vulnerability privately, never in an issue: see [SECURITY.md](.github/SECURITY.md).`
    }
  ]
};

export const maintainers: Document = {
  title: "Maintaining {{name}}",
  intro: "Maintainers triage issues, accept work for discussion, review pull requests and ship releases.",
  sections: [
    {
      heading: "Maintainers",
      body: `| Maintainer | Areas |
| --- | --- |
| Will Cory, [@roninjin10](https://github.com/roninjin10) | Everything: language, compiler, runtime, editors, docs, releases and security reports |

Add a maintainer here, with their areas and a backup, when they agree to review those areas. Commit history doesn't make someone an owner.`
    },
    {
      heading: "Triage",
      body: `Give every new issue one outcome:

- **Needs a reproduction.** If a bug report's reproduction is missing or doesn't show the bug on the latest version, add \`needs-repro\` and say what is missing.
- **Accepted.** Add \`accepted\`, one \`timeline:\` label and one \`commitment:\` label. Then open a proof of concept as a draft pull request titled \`poc: #<n>\`, where \`<n>\` is the issue number, and link it on the issue. It shows one way the change could work and stays a draft; the real change comes in its own pull request.
- **Closed.** Use \`duplicate\`, \`invalid\` or \`wontfix\`, with a reason and a link.

Classify a reproduced bug as a compiler crash, a wrong emitted program, a wrong diagnostic or a docs error. An install failure or a wrong emitted program blocks the next release until a maintainer assesses it.

Timeline and commitment labels state a maintainer's current belief, not a promise. When the belief changes, change the label and say why on the issue.`
    },
    { heading: "Labels", body: "{{labels}}" },
    {
      heading: "Review and merge",
      body: `Keep each change focused on one accepted issue, with a test that fails without the change, the checks it affects, and updated docs. Syntax, emitted declarations, runtime semantics and diagnostics need a compatibility review. {{generated}}.

{{merge}} Never rewrite \`main\`'s history or republish a package version.`
    },
    {
      heading: "Release process",
      body: `The release contains six platform binaries (macOS, Linux and Windows on arm64 and x64) and eleven packages. Include both Windows packages, \`@vibelang/cli-win32-x64\` and \`@vibelang/cli-win32-arm64\`, in rehearsal and publication.

{{releaseSteps}}

Never call a cross-compiled binary tested on an operating system it didn't run on. If a release is broken, say so in its release notes and ship a fixed version through the same steps.`
    },
    {
      heading: "Security reports",
      body: "Reports arrive through GitHub's private vulnerability reporting; see [SECURITY.md](.github/SECURITY.md). If exploit details appear in a public issue, hide them and continue in a private advisory. A maintainer coordinates the fix, the advisory and the release."
    },
    {
      heading: "Benchmark claims",
      body: "Publish a performance or token claim only with a public, reproducible method: pinned versions, inputs, units, results and limits. The README's [token comparison](.smithers/token-compare/README.md) is the model. Keep held-out tasks, hidden tests and transcripts private; a private benchmark is not public evidence."
    }
  ]
};

/** The root AGENTS.md, for agents working on this repository. Every line costs tokens on every turn. */
export const agents: Document = {
  title: "{{name}} repository",
  intro: `Before writing or reviewing a \`.vibe\` file, read {{skill}} ({{skillTokens}} tokens): every form beside the Effect code it replaces, the rules with their EK codes, and the idiomatic choice for each job. The full docs are https://vibelang.sh/llms.txt.

Specification: \`docs/design/src/\`. Process: CONTRIBUTING.md.

- Work on one accepted issue. Add a test that fails without your change; compiler semantics get a case in \`typescript/vibelang/cases/\`.
- Run \`{{e2e}}\` for install, compiler, runtime or starter changes. Report exact results, including failures and checks you couldn't run.
- A file that says it is generated changes only through its source.
- Match nearby code, format Go with gofmt, and don't reformat unrelated code.
- {{secrets}}
- Agents never approve or merge.`,
  sections: []
};

/** templates/app/AGENTS.md, copied into every new app. It carries docs/user/llms-essentials.md verbatim and stays under 2 KB. */
export const starterAgents = {
  title: "{{name}} project",
  intro: "`bun run build`; `bun run test`. {{languageRules}}\n\nRead `node_modules/vibelang/skills/vibelang/SKILL.md` before .vibe edits."
} as const;
