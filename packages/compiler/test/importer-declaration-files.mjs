export function importerFiles({ route = "relative", generic = false, alias = "Provider", shape = "interface" } = {}) {
  const type = "Ctx" + (generic ? "<string>" : "")
  const parameter = generic ? "<T>" : ""
  const value = generic ? "T" : "string"
  const source = shape === "class"
    ? "export class Ctx" + parameter + " { private brand = 1; constructor(readonly provider: " + value + ") {} }\n"
    : "export interface Ctx" + parameter + " { readonly provider: " + value + " }\n"
  const sidecar = shape === "class"
    ? "export declare class Ctx" + parameter + " { private brand; readonly provider: " + value + "; constructor(provider: " + value + "); }\n"
    : source
  const path = route === "relative" ? "./Provider.vibe" : "lib/Provider"
  return {
    "package.json": '{"type":"module"}',
    "lib/package.json": JSON.stringify({ name: "lib", type: "module", exports: {
      "./Provider": { types: "./src/Provider.d.vibe.ts", default: "./src/Provider.vibe" },
      "./Driver": "./src/Driver.ts",
    } }),
    "lib/src/Provider.vibe": source,
    "lib/src/Provider.d.vibe.ts": sidecar,
    "lib/src/Driver.ts": 'import type * as P from "' + path + '";\nexport interface Driver { readonly remote: (c: P.' + type + ') => string }\n',
    "src/a.ts": 'import * as ' + alias + ' from "lib/Provider";\nimport type { Driver } from "lib/Driver";\n'
      + "export const make = (): Driver => ({ remote: ({ provider }: " + alias + "." + type + ") => provider });\n"
      + "export const remoteOf = (d: Driver) => d.remote;\n"
      + "export const call = (d: Driver, ctx: " + alias + "." + type + ") => d.remote(ctx);\n",
    "tsconfig.json": JSON.stringify({ compilerOptions: {
      strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
      allowArbitraryExtensions: true, allowImportingTsExtensions: true,
      declaration: true, emitDeclarationOnly: true, skipLibCheck: true, types: [],
      rootDir: ".", outDir: "out",
    }, files: ["src/a.ts"] }),
  }
}
