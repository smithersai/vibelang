// VIP-27 (2026-11-03): declaration-preserving repairs use API identity.
// This checks normative prose, not fixture byte comparisons or protected inputs.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkDeclarationPreservation(text, file = "<text>") {
  let fenced = false;
  const prose = text.split("\n").map(line => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return ""; }
    return fenced ? "" : line;
  }).join("\n");
  const violations = [];
  const positive = /\bdeclarations?\s+(?:stays?|(?:must\s+)?(?:remains?|be)|is|are)\s+(?:the\s+)?(?:same\s+bytes|byte[- ]identical)\b|\b(?:requires?|requiring|preserves?)\s+byte[- ]identical\s+declarations?\b/i;
  for (const match of prose.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)) {
    const paragraph = match[0].replace(/`/g, "").replace(/\s+/g, " ");
    if (/(?:--fix|codemod|migration|import)/i.test(paragraph) && positive.test(paragraph)) {
      violations.push({ file, line: prose.slice(0, match.index).split("\n").length,
        message: "VIP-27 requires API identity for declaration-preserving repairs; byte identity is not the contract." });
    }
  }
  return violations;
}
export function checkTree(root) {
  return ["src", "vips"].flatMap(dir => readdirSync(resolve(root, dir))
    .filter(name => name.endsWith(".md"))
    .flatMap(name => checkDeclarationPreservation(readFileSync(resolve(root, dir, name), "utf8"), dir + "/" + name)));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../design");
  const violations = checkTree(root);
  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.message}`);
  process.exitCode = violations.length ? 1 : 0;
}
