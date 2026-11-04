import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// VIP-40's accepted plain-code rule distinguishes unannotated unknown from
// a written throwing contract; effect code still requires the wrapper.
export const plainForeignClauses = [
  "A call of `readText`, whose throwing is unknown, stays an ordinary call.",
  "effect code requires the wrapper in rule 3",
  "A written `@throws {unknown}` is a known throwing contract",
  "the `try` block of a `try` statement with a `catch` clause in the same function",
  "**`@throws {never}`** lets VibeLang call a body function directly",
];
export function plainForeignContractProblems(text) {
  return plainForeignClauses.filter(clause => !text.includes(clause))
    .map(clause => "VIP-40 missing foreign-call safeguard: " + clause);
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
  return [...plainForeignContractProblems(vip),
    ...directPreludeInitializers(services).map(name => "Unbridged npm initializer in prelude example: " + name)];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../design");
  const violations = checkForeignExamples(root);
  for (const message of violations) console.error(message);
  process.exitCode = violations.length ? 1 : 0;
}
