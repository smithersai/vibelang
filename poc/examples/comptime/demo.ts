/**
 * General bounded comptime evaluation and type-producing comptime.
 *
 * Run with: bun poc/examples/comptime/demo.ts
 *
 * The frontend interprets a deterministic compiler-owned subset — `let`,
 * loops, mutation of evaluation-owned containers, and a whitelisted stdlib —
 * under hard budgets, then lowers `const Name = comptime(...)` bindings used
 * in type position to a merged const plus same-named literal type alias.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComptimeCompiler, compileComptimeIntrinsics } from "../../src/build/index.ts";

const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-demo-"));
const compiler = new ComptimeCompiler({ root, cacheDirectory: join(root, ".cache"), target: "node" });

const routesSource = [
  `import { comptime, embed } from "vibelang:comptime"`,
  ``,
  `export const routes = comptime(() => {`,
  `  const lines = embed("./routes.txt").split("\\n");`,
  `  const table = [];`,
  `  for (const line of lines) {`,
  `    if (line === "" || line.startsWith("#")) continue;`,
  `    table.push({ path: line, slug: line.toLowerCase().replaceAll("/", "-") });`,
  `  }`,
  `  return table;`,
  `})();`,
].join("\n");
await writeFile(join(root, "routes.vibe"), routesSource);
await writeFile(join(root, "routes.txt"), "# generated\n/Account\n/Settings\n");

const typedSource = [
  `import { comptime } from "vibelang:comptime"`,
  ``,
  `function deriveShape(model: { readonly name: string }) {`,
  `  return { kind: model.name, active: true };`,
  `}`,
  ``,
  `const model = { name: "account" } as const;`,
  `// Used both as a value and as a type: lowering merges the const with a`,
  `// same-named literal type alias.`,
  `const Account = comptime(deriveShape(model));`,
  `export function open(account: Account): Account { return account; }`,
  `export const defaults = Account;`,
].join("\n");

const result = await compileComptimeIntrinsics({
  compiler,
  sources: { "routes.vibe": routesSource, "typed.ts": typedSource },
});

if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
console.log("routes value:", JSON.stringify(result.calls[0]?.value));
console.log("tracked deps:", result.calls[0]?.build.dependencies.map((dependency) => dependency.path));
console.log("\n--- lowered routes.vibe ---\n" + result.loweredSources!["routes.vibe"]);
console.log("\n--- lowered typed.ts ---\n" + result.loweredSources!["typed.ts"]);

// Budgets fail closed deterministically instead of hanging.
const runaway = await compileComptimeIntrinsics({
  compiler,
  sources: {
    "runaway.ts": [
      `import { comptime } from "vibelang:comptime"`,
      `export const value = comptime(() => { let n = 0; while (true) n++; return n; })();`,
    ].join("\n"),
  },
});
console.log(
  "\nrunaway loop:",
  runaway.diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`),
);
