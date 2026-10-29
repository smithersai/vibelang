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

test("contributing makes the maintainer-run PR checks explicit", async () => {
  const output = render(await readSources())["CONTRIBUTING.md"]!
  expect(output).toContain("The repository has no CI or commit statuses.")
  expect(output).toContain("For each pull request, a maintainer runs")
  expect(output).toContain("`sh scripts/e2e.sh` and the compiler case suite, `(cd typescript && sh vibelang/smoke.sh --jobs 8)`")
})

test("maintainer docs describe direct landings, outside reviews, and the four-platform release", async () => {
  const output = render(await readSources())
  for (const path of ["MAINTAINERS.md", "CONTRIBUTING.md"]) {
    expect(output[path]).toContain("Maintainers land their own work directly on `main`.")
    expect(output[path]).toContain("Outside contributions arrive as pull requests that a maintainer reviews and merges.")
    expect(output[path]).not.toContain("A person reviews and merges every change.")
  }
  const maintainers = output["MAINTAINERS.md"]!
  expect(maintainers).toContain("VIBELANG_SKIP=win32")
  expect(maintainers).toContain("four platform binaries")
  expect(maintainers).toContain("nine packages")
  expect(maintainers).not.toContain("six platform binaries")
  expect(maintainers).not.toContain("eleven packages")
})
