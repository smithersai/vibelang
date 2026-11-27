// The docs generator: reads the inputs, renders them with the docs flow via
// the shared host (`../host.ts`), and writes the outputs and .smithers/generated.json.
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Exit } from "effect";
import { digestSync } from "@smthrs/crypto";
import { execute, parseHostFlags, type HostOptions } from "../host.ts";
import docs, { layer } from "./flow.ts";
import { flowPath, readmeFooter, sourcePaths, type Sources } from "./render.ts";

export const smithers = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const repository = join(smithers, "..");
/** The generator's own files, relative to .smithers/. The lockfile pins every package version. */
export const generatorInputs = ["flows/docs/project.ts", "flows/docs/render.ts", "flows/docs/flow.ts", "flows/docs/generate.ts", "flows/in-process.ts", "package.json", "bun.lock"];

export async function readSources(): Promise<Sources> {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, await readFile(join(repository, path), "utf8")]))) as Sources;
}

export async function identity(sources: Sources) {
  const files = [
    ...await Promise.all(generatorInputs.map(async path => ({ path: `.smithers/${path}`, sha256: digestSync(await readFile(join(smithers, path), "utf8")) }))),
    // The README is an input without its footer, which is an output.
    ...sourcePaths.map(path => ({ path, sha256: digestSync(path === "README.md" ? sources[path].replace(readmeFooter, "").trimEnd() : sources[path]) }))
  ];
  return { files, digest: digestSync(JSON.stringify(files)) };
}

export async function generate(options: HostOptions = { memory: true }) {
  const sources = await readSources();
  const id = await identity(sources);
  const exit = await execute(docs, layer, { sources }, { executionId: `docs-${id.digest}`, ...options });
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  const outputs = exit.value;
  const manifest = JSON.stringify({
    version: 2, flow: "docs", source: flowPath, digest: id.digest, inputs: id.files,
    outputs: Object.fromEntries(Object.entries(outputs).map(([path, text]) => [path, { sha256: digestSync(text) }]))
  }, null, 2) + "\n";
  return { outputs, manifest };
}

if (import.meta.main) {
  const { options: hostOptions } = parseHostFlags(process.argv.slice(2));
  execFileSync("node", [join(repository, "scripts/generate-diagnostic-registry.mjs")], { stdio: "inherit" });
  execFileSync("node", [join(repository, "scripts/generate-grammar-admission.mjs")], { stdio: "inherit" });
  const { outputs, manifest } = await generate({ memory: true, ...hostOptions });
  for (const [path, content] of Object.entries(outputs)) {
    const target = join(repository, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await writeFile(join(smithers, "generated.json"), manifest);
  console.log(`docs: ${Object.keys(outputs).length} files`);
}
