import { readFileSync, readdirSync } from "node:fs"
import { basename, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = fileURLToPath(new URL("../../", import.meta.url))
const cached = new Map()

// Service operations belong to the yielded implementation, not its module or
// Context.Service key. Read both sets of actual exports before checking prose.
export function experimentalServiceMethods(repo = root) {
  if (cached.has(repo)) return cached.get(repo)
  const directory = join(repo, "packages/runtime/src/experimental")
  const files = readdirSync(directory).filter(file => file.endsWith(".ts")).map(file => join(directory, file))
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, noEmit: true,
    skipLibCheck: true, types: [], lib: ["lib.esnext.d.ts", "lib.dom.d.ts"]
  })
  const checker = program.getTypeChecker(), services = []
  for (const file of files) {
    const source = program.getSourceFile(file)
    const symbol = source && checker.getSymbolAtLocation(source)
    if (!source || !symbol) continue
    const exports = new Set(checker.getExportsOfModule(symbol).filter(item => {
      const target = item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item
      return target.flags & ts.SymbolFlags.Value
    }).map(item => item.name))
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue
      for (const declaration of statement.declarationList.declarations) {
        const type = declaration.type
        if (!ts.isIdentifier(declaration.name) || !type || !ts.isTypeReferenceNode(type) || type.typeName.getText(source).split(".").at(-1) !== "Service" || type.typeArguments?.length !== 2) continue
        const key = checker.getTypeFromTypeNode(type), shape = checker.getTypeFromTypeNode(type.typeArguments[1])
        if ((key.flags | shape.flags) & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
          throw new Error("Cannot resolve " + relative(repo, file) + "; install docs/tools and packages/runtime dependencies")
        }
        const members = checker.getPropertiesOfType(shape).filter(item => /^[A-Za-z_$][\w$]*$/.test(item.name))
        const memberType = item => checker.getTypeOfSymbolAtLocation(item, declaration)
        const methods = members.filter(item => memberType(item).getCallSignatures().length).map(item => item.name)
        const effectValues = members.filter(item => {
          const value = memberType(item)
          return value.getCallSignatures().length === 0 &&
            (value.symbol?.name === "Effect" || value.aliasSymbol?.name === "Effect")
        }).map(item => item.name)
        const properties = new Set(checker.getPropertiesOfType(key).map(item => item.name))
        services.push({
          module: basename(file, ".ts"), key: declaration.name.text,
          effectValues,
          namespaceMethods: methods.filter(name => !exports.has(name)),
          keyMethods: methods.filter(name => !properties.has(name))
        })
      }
    }
  }
  cached.set(repo, services)
  return services
}

export function experimentalServiceCallProblems(text, file, services = experimentalServiceMethods()) {
  const byModule = new Map(), problems = []
  for (const service of services) {
    const list = byModule.get(service.module) ?? []
    list.push(service)
    byModule.set(service.module, list)
  }
  const references = /\bExperimental\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g
  for (const match of text.matchAll(references)) {
    const moduleServices = byModule.get(match[1])
    if (!moduleServices) continue
    const method = match[3] ?? match[2]
    const offending = match[3]
      ? moduleServices.find(service => match[2] === service.key && service.keyMethods.includes(method))
      : moduleServices.find(service => service.namespaceMethods.includes(method))
    if (offending) {
      const line = text.slice(0, match.index).split("\n").length
      problems.push(file + ":" + line + ": look up Experimental." + offending.module + "." + offending.key + " before calling " + method)
    }
  }
  // An Effect-valued member is already a program; running it needs no call.
  const valueCalls = /\(\s*try\s+Experimental\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\)\s*\.\s*([A-Za-z_$][\w$]*)\s*(?=\()/g
  for (const match of text.matchAll(valueCalls)) {
    const moduleServices = byModule.get(match[1])
    const service = moduleServices?.find(item => match[2] === item.key && item.effectValues.includes(match[3]))
    if (!service) continue
    const line = text.slice(0, match.index).split("\n").length
    problems.push(file + ":" + line + ": " + match[3] + " is an Effect value; run the member with try instead of calling it")
  }
  return problems
}

export function documentedExperimentalServiceCallProblems(repo = root) {
  const pages = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pages(join(directory, entry.name)) : entry.name.endsWith(".md") ? [join(directory, entry.name)] : [])
  const files = [...pages(join(repo, "docs/user/src")), ...[
    "README.md", "packages/compiler/skills/vibelang/SKILL.md",
    ".smithers/flows/migrate/rules.md", ".smithers/flows/migrate/context.md"
  ].map(file => join(repo, file))]
  const services = experimentalServiceMethods(repo)
  return files.flatMap(file => experimentalServiceCallProblems(readFileSync(file, "utf8"), relative(repo, file), services))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = documentedExperimentalServiceCallProblems()
  for (const problem of problems) console.error(problem)
  console.log("experimental service calls: " + problems.length + " failures")
  process.exitCode = problems.length ? 1 : 0
}
