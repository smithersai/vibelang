import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const assets = [
  ["poc/src/agent/deno-runner.js", "poc/dist/agent/deno-runner.js"],
  ["poc/src/build/loader-runner.js", "poc/dist/build/loader-runner.js"],
];

for (const [source, destination] of assets) {
  const output = resolve(root, destination);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(resolve(root, source), output);
}
