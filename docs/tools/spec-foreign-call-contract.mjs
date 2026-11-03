import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// VIP-4 (2026-11-02), chapter 003: unannotated foreign signatures throw
// unknown, which is included in the plain-code EK0401 check.
export function unknownCallExemptions(text) {
  return [...text.matchAll(/[^.\n]*\b(?:throwing|throws?)\s+(?:is\s+)?`?unknown`?[^.\n]*\b(?:stays|remains)\s+an?\s+ordinary\s+call[^.\n]*/gi)].map(m => m[0]);
}
// A deliberately bounded check of the implicit-prelude examples, where these
// names resolve to npm exports. It does not guess contracts of arbitrary names.
export function directPreludeInitializers(markdown) {
  const bad = [];
  for (const fence of markdown.matchAll(/```vibe[^\n]*\n([\s\S]*?)\n```/g)) {
    if (!fence[1].includes("pending VIP-14")) continue;
    for (const m of fence[1].matchAll(/\b(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*(pipe|Effect\s*\.\s*Array\s*\.\s*head|Option\s*\.\s*some)\s*\(/g)) bad.push(m[1]);
  }
  return bad;
}
export function checkForeignExamples(root) {
  const vip = readFileSync(resolve(root, "vips/0040-module-declarations.md"), "utf8");
  const services = readFileSync(resolve(root, "src/005-services.md"), "utf8");
  return [...unknownCallExemptions(vip).map(text => "VIP-40 exempts unknown foreign throws: " + text),
    ...directPreludeInitializers(services).map(name => "Unbridged npm initializer in prelude example: " + name)];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../design");
  const violations = checkForeignExamples(root);
  for (const message of violations) console.error(message);
  process.exitCode = violations.length ? 1 : 0;
}
