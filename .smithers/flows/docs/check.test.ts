import { spawnSync } from "node:child_process";
import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { digestSync } from "@smthrs/crypto";
import { generate, readSources, repository, smithers } from "./run.ts";
import { countTokens, header, render, resolve, tokenizer } from "./render.ts";
import { facts } from "./project.ts";

test("the docs flow is deterministic, and every output and the manifest are current", async () => {
  const first = await generate();
  const second = await generate();
  expect(second).toEqual(first);
  expect(first.outputs).toEqual(render(await readSources()));
  for (const [path, content] of Object.entries(first.outputs)) {
    expect({ path, current: await readFile(join(repository, path), "utf8") === content }).toEqual({ path, current: true });
    expect(content).not.toContain("{{");
  }
  expect(await readFile(join(smithers, "generated.json"), "utf8")).toBe(first.manifest);
  const manifest = JSON.parse(first.manifest);
  expect(manifest.source).toBe(".smithers/flows/docs/flow.ts");
  for (const [path, content] of Object.entries(first.outputs)) expect(manifest.outputs[path].sha256).toBe(digestSync(content));
});

test("each footer states the file's own exact token count and the installed tokenizer", async () => {
  const installed = JSON.parse(await readFile(join(smithers, "node_modules/js-tiktoken/package.json"), "utf8"));
  expect(installed.version).toBe(tokenizer.version);
  for (const [path, content] of Object.entries(render(await readSources()))) {
    const stated = /([\d,]+) tokens \(o200k_base, js-tiktoken 1\.0\.21\)/.exec(content);
    expect({ path, stated: stated && Number(stated[1]!.replaceAll(",", "")) }).toEqual({ path, stated: countTokens(content) });
  }
});

test("generated files say so and link their flow", () => {
  const outputs = render({ "README.md": "# R\n", "docs/user/llms-essentials.md": "## Essentials\n", "packages/compiler/skills/vibelang/SKILL.md": "# Skill\n" });
  for (const path of ["CONTRIBUTING.md", "MAINTAINERS.md", "AGENTS.md"]) {
    expect(outputs[path]!.startsWith(header(path))).toBe(true);
    expect(outputs[path]).toContain("](.smithers/flows/docs/flow.ts)");
  }
  expect(outputs["templates/app/AGENTS.md"]).toContain("Generated: smithersai/vibelang .smithers/flows/docs/flow.ts");
  expect(outputs["README.md"]!.startsWith("# R\n\n<sub>")).toBe(true);
});

test("the starter's AGENTS.md carries the docs' Essentials verbatim and stays under 2 KB", async () => {
  const sources = await readSources();
  const starter = render(sources)["templates/app/AGENTS.md"]!;
  expect(starter).toContain(sources["docs/user/llms-essentials.md"]);
  expect(starter).toContain("`bun run build`");
  expect(starter).toContain("`bun run test`");
  expect(Buffer.byteLength(starter)).toBeLessThan(2048);
});

test("facts resolve strictly and the merge rule reaches the agents", () => {
  expect(() => resolve("{{missingFact}}")).toThrow("Unknown project fact");
  const outputs = render({ "README.md": "# R\n", "docs/user/llms-essentials.md": "## Essentials\n", "packages/compiler/skills/vibelang/SKILL.md": "# Skill\n" });
  expect(outputs["AGENTS.md"]).toContain("Agents never approve or merge.");
  expect(outputs["CONTRIBUTING.md"]).toContain("Agents never approve or merge.");
});

test("the root AGENTS.md points to the skill with its exact token count", async () => {
  const sources = await readSources();
  const tokens = countTokens(sources[facts.skill]).toLocaleString("en-US");
  expect(render(sources)["AGENTS.md"]).toContain(`read ${facts.skill} (${tokens} tokens)`);
});

test("the shipped skill teaches current declarations and wraps a call that may throw", async () => {
  const skill = (await readSources())[facts.skill];
  expect(skill).not.toContain("Until your compiler accepts a form, write its long form");
  // A function that may throw is wrapped with Effect's own Effect.try before Effect code runs it (VIP-4).
  expect(skill).toContain("try Effect.try(() => parse(s))");
  expect(skill).not.toContain("trusted");
});

test("the shipped skill numbers each language rule once and in order", async () => {
  const skill = (await readSources())[facts.skill];
  const rules = skill.split("\n## Rules\n")[1]!.split("\n## ")[0]!;
  const numbers = [...rules.matchAll(/^(\d+)\. /gm)].map(match => Number(match[1]));
  expect(numbers).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
});

test("contributing describes actual CI entrypoints and maintainer-run PR checks", async () => {
  const output = render(await readSources())["CONTRIBUTING.md"]!
  const workflow = await readFile(join(repository, ".github/workflows/mq-pregate.yml"), "utf8")
  const event = /^\s+types: \[([^\]]+)\]/m.exec(workflow)![1]!
  expect(workflow).toContain("repository_dispatch:")
  expect(await readFile(join(repository, "scripts/ci.sh"), "utf8")).toContain("smthrs")
  expect(output).toContain("`sh scripts/ci.sh`")
  expect(output).toContain("`.github/workflows/mq-pregate.yml`")
  expect(output).toContain("`" + event + "`")
  expect(output).toContain("[the build graph](docs/maintainers/build.md)")
  expect(output).not.toContain("The repository has no CI or commit statuses.")
  expect(output).toContain("For each pull request, a maintainer runs")
  expect(output).toContain("`sh scripts/e2e.sh` and the compiler case suite, `(cd typescript && sh vibelang/smoke.sh --jobs 8)`")
})

test("maintainer docs describe staged landings, outside reviews, and every release platform", async () => {
  const output = render(await readSources())
  for (const path of ["MAINTAINERS.md", "CONTRIBUTING.md"]) {
    expect(output[path]).toContain("Maintainers land their own work on `vibe`.")
    expect(output[path]).toContain("`main` advances only to a commit on `vibe` whose post-merge checks passed, with no failing commit below it.")
    expect(output[path]).not.toContain("directly on `main`")
    expect(output[path]).toContain("Outside contributions arrive as pull requests that a maintainer reviews and merges.")
    expect(output[path]).not.toContain("A person reviews and merges every change.")
  }
  const maintainers = output["MAINTAINERS.md"]!
  expect(maintainers).toContain("Never rewrite `main`'s history or republish a package version.")
  expect(maintainers).toContain("Agents never approve or merge.")
  // The counts come from the table that builds the release, so a platform change fails here instead of a stale pin.
  const script = await readFile(join(repository, "scripts/release/make-packages.mjs"), "utf8")
  const table = /const platforms = \{([^}]*)\}/.exec(script)![1]!
  const platforms = [...table.matchAll(/"([a-z0-9]+-[a-z0-9]+)":/g)].map((match) => match[1]!)
  const packages = platforms.length + 5 // vibelang, runtime, vite, unplugin and create-vibelang
  const word = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]
  expect(maintainers).toContain(`${word[platforms.length]} platform binaries`)
  expect(maintainers).toContain(`${word[packages]} packages`)
  for (const platform of platforms.filter((name) => name.startsWith("win32-"))) expect(maintainers).toContain(`@smthrs/cli-${platform}`)
  expect(maintainers).not.toContain("VIBELANG_SKIP=win32")
  expect(maintainers).toContain("publish.sh --otp <one-time-password>")
})


test("compiler diagnostic categories match Appendix B", () => {
  const result = spawnSync("node", [join(repository, "scripts/generate-diagnostic-registry.mjs"), "--check"], { encoding: "utf8" });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
});


test("grammar admission projections match their source", () => {
  const result = spawnSync("node", [join(repository, "scripts/generate-grammar-admission.mjs"), "--check"], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
});

test("Go-only mapper setup installs dependencies where execution tests resolve them", async () => {
  const helper = await readFile(join(repository, "typescript/tsc/internal/vibelangmapper/data_methods_test.go"), "utf8")
  const runtime = /effect := filepath.Join\(root, "([^"]+)\/node_modules\/effect"\)/.exec(helper)?.[1]
  expect(runtime, "derive the install directory from the real runtime test helper").toBeDefined()
  const manifest = JSON.parse(await readFile(join(repository, runtime!, "package.json"), "utf8"))
  expect(manifest.devDependencies.effect).toBe(manifest.peerDependencies.effect)
  const contributing = render(await readSources())["CONTRIBUTING.md"]!
  const setup = contributing.split("The Go suites run from")[1]!.split("\n\n")[0]!
  expect(setup).toContain("`(cd " + runtime + " && bun install)`")
  expect(setup).toContain("`(cd experiments && bun install)`")
  expect(setup).toContain("`packages/ts-mapper/package.json`")
})

test("contributor release-note guidance runs the strict guard before submission", async () => {
  const contributing = render(await readSources())["CONTRIBUTING.md"]!
  const pullRequests = contributing.split("\n## Pull requests\n")[1]!.split("\n## ")[0]!
  const command = /\x60(VIBELANG_RELEASE_NOTES_FINAL=1 node --test docs\/tools\/release-docs\.test\.mjs)\x60/.exec(pullRequests)?.[1]
  expect(command, "per-change guidance includes the strict offline command").toBeDefined()
  expect(pullRequests).toContain("Before submitting")
  expect(pullRequests).toContain("plain words")
  expect(pullRequests).toContain("once")
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const fixture = await mkdtemp(join(tmpdir(), "release-note-guidance-"))
  try {
    for (const name of ["release-docs.test.mjs", "release-docs.mjs", "release-publication-checks.mjs", "release-history.mjs"]) {
      await mkdir(join(fixture, "docs/tools"), { recursive: true })
      await writeFile(join(fixture, "docs/tools", name), await readFile(join(repository, "docs/tools", name)))
    }
    await mkdir(join(fixture, "packages/compiler"), { recursive: true })
    await mkdir(join(fixture, "docs/user/src/setup"), { recursive: true })
    const notes = await readFile(join(repository, "docs/user/src/setup/release-notes.md"), "utf8")
    const candidate = /^## (\S+) \(unreleased\)$/m.exec(notes)?.[1]
    expect(candidate, "exercise the explicit override on an unreleased candidate").toBeDefined()
    await writeFile(join(fixture, "packages/compiler/package.json"), JSON.stringify({ version: candidate }))
    const heading = /^### Bugs fixed since .+$/m.exec(notes)![0]
    const bullet = /^- .+$/m.exec(notes)![0]
    const [setting, executable, ...args] = command!.split(" ")
    const [key, value] = setting!.split("=")
    const env = { ...process.env, [key!]: value!, VIBELANG_LAST_PUBLISHED_VERSION: undefined }
    args.splice(1, 0, "--test-name-pattern=^current release notes describe user fixes without internal CI or fuzz bookkeeping$")
    for (const [label, text, status] of [
      ["valid", notes, 0],
      ["duplicate", notes.replace(heading, heading + "\n" + bullet), 1],
      ["internal", notes.replace(heading, heading + "\n- Added fuzz regression checks."), 1],
    ] as const) {
      await writeFile(join(fixture, "docs/user/src/setup/release-notes.md"), text)
      const result = spawnSync(executable!, args, { cwd: fixture, env, encoding: "utf8", timeout: 60_000 })
      expect({ label, status: result.status, signal: result.signal, error: result.error?.message },
        result.stdout + result.stderr).toEqual({ label, status, signal: null, error: undefined })
      expect(result.stdout).toContain(status === 0 ? "pass 1" : "fail 1")
      expect(result.stdout).toContain("skipped 0")
    }
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
