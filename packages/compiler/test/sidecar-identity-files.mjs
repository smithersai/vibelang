export function filesOf(input) {
  const n = input.name || "Stage"
  const parameter = input.generic ? "T" : "string"
  const parameters = input.generic ? "<T>" : ""
  const application = n + parameters
  const field = input.brand === "hash" ? "#brand" : input.brand + " readonly brand"
  const declared = input.brand === "hash" ? "#brand;" : input.brand + " readonly brand" + (input.brand === "protected" ? ": number" : "") + ";"
  const target = "./src/" + n
  const entry = input.form === "source" ? target + ".vibe" : input.form === "nested"
    ? { import: { types: target + ".d.vibe.ts", default: target + ".vibe" }, default: { types: target + ".d.vibe.ts", default: target + ".vibe" } }
    : { types: target + ".d.vibe.ts", default: target + ".vibe" }
  const prefix = input.generic ? "<T>" : ""
  const files = {
    "lib/package.json": JSON.stringify({ name: "lib", type: "module", exports: { ["./" + n]: entry, "./Use": "./src/Use.ts" } }) + "\n",
    ["lib/src/" + n + ".vibe"]: "export class " + n + parameters + " { " + field + " = 1; constructor(readonly name: " + parameter + ") {} }\n",
    ["lib/src/" + n + ".d.vibe.ts"]: "export declare class " + n + parameters + " { readonly name: " + parameter + "; " + declared + " constructor(name: " + parameter + "); }\n",
    "lib/src/Use.ts": 'import { ' + n + ' } from "./' + n + '.vibe";\nexport const use = ' + prefix + '(s: ' + application + '): ' + parameter + ' => s.name;\n',
    "app/src/a.ts": 'import { ' + n + ' } from "lib/' + n + '";\nimport { use } from "lib/Use";\nexport const run = ' + prefix + '(s: ' + application + ') => use(s);\nexport const both = ' + prefix + '(s: ' + application + ', t: Parameters<typeof use' + (input.generic ? "<T>" : "") + '>[0]) => [s, t] as const;\n',
    "app/tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "nodenext", target: "es2022", declaration: true, emitDeclarationOnly: true, outDir: "out", rootDir: "src", allowArbitraryExtensions: true, types: [] }, include: ["src/**/*.ts"] }) + "\n",
  }
  if (input.mode === "module") files["app/package.json"] = '{"type":"module"}\n'
  return files
}
