import ts from "typescript"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { SourceAnalysis, scalarNativeThrows } from "./throws-source.mjs"

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
export const artifactPath = "docs/design/inventory/throws.json"
const libDir = resolve(root, "typescript/tsc/internal/bundled/libs")
const effectDir = resolve(root, "docs/tools/node_modules/effect")
const read = path => readFileSync(path, "utf8")
const hash = text => createHash("sha256").update(text).digest("hex")
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const clean = text => text.replace(/\s+/g, " ").trim()
const union = values => values.includes("unknown") ? "unknown" : [...new Set(values.filter(v => v !== "never"))].sort(compare).join(" | ") || "never"
const rethrowMethods = new Set(["map", "forEach", "filter", "reduce", "reduceRight", "find", "findIndex", "findLast", "findLastIndex", "some", "every", "sort", "toSorted", "flatMap"])
const typedArrayOwner = /^(?:Int|Uint|Float|BigInt|BigUint)\d+(?:Clamped)?Array$/
const safeTypedMethods = new Set("of at copyWithin entries every fill filter find findIndex findLast findLastIndex forEach includes indexOf join keys lastIndexOf map reverse slice some sort subarray toReversed toSorted toString valueOf values [Symbol.iterator]".split(" "))
const safeMethods = {
  Array: "isArray of at concat copyWithin entries every fill filter find findIndex findLast findLastIndex flat flatMap forEach includes indexOf join keys lastIndexOf map pop push reverse shift slice some sort splice toReversed toSorted toSpliced toString unshift valueOf values [Symbol.iterator]",
  RegExp: "escape exec test toString [Symbol.match] [Symbol.matchAll] [Symbol.replace] [Symbol.search] [Symbol.split]",
  Promise: "all allSettled any race reject resolve then catch finally try withResolvers",
  Date: "now parse UTC getDate getDay getFullYear getHours getMilliseconds getMinutes getMonth getSeconds getTime getTimezoneOffset getUTCDate getUTCDay getUTCFullYear getUTCHours getUTCMilliseconds getUTCMinutes getUTCMonth getUTCSeconds toISOString valueOf toString toDateString toTimeString toUTCString toJSON setDate setFullYear setHours setMilliseconds setMinutes setMonth setSeconds setTime setUTCDate setUTCFullYear setUTCHours setUTCMilliseconds setUTCMinutes setUTCMonth setUTCSeconds",
  Boolean: "valueOf toString",
  Number: "isFinite isInteger isNaN isSafeInteger parseFloat parseInt valueOf",
  String: "at charAt charCodeAt codePointAt concat endsWith includes indexOf lastIndexOf match padEnd padStart repeat replace search slice split startsWith substring substr toLowerCase toUpperCase trim trimStart trimEnd trimLeft trimRight valueOf toString fromCharCode",
  Object: "keys values entries fromEntries is isExtensible isFrozen isSealed getPrototypeOf getOwnPropertyNames getOwnPropertySymbols getOwnPropertyDescriptor getOwnPropertyDescriptors hasOwn assign freeze seal preventExtensions create valueOf toString toLocaleString hasOwnProperty isPrototypeOf propertyIsEnumerable",
  Map: "get has set delete clear entries keys values forEach",
  ReadonlyMap: "get has entries keys values forEach",
  Set: "has add delete clear entries keys values forEach",
  ReadonlySet: "has entries keys values forEach",
  Symbol: "for valueOf toString",
}
for (const owner in safeMethods) safeMethods[owner] = new Set(safeMethods[owner].split(" "))
safeMethods.ReadonlyArray = safeMethods.Array
const errors = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "URIError", "EvalError", "ReferenceError", "AggregateError"])
function files(dir, suffix) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name)).flatMap(entry =>
    entry.isDirectory() ? files(resolve(dir, entry.name), suffix) : entry.name.endsWith(suffix) ? [resolve(dir, entry.name)] : [])
}
function nativeContract(name, kind, sig) {
  const [rawOwner, ...parts] = name.split(".")
  const method = parts.length ? parts.join(".") : undefined
  const owner = rawOwner.replace(/Constructor$/, "")
  const scalar = scalarNativeThrows(owner + (method ? "." + method : ""), kind)
  if (scalar !== undefined) return scalar
  const parameters = sig.getParameters()
  const parameterTypes = parameters.flatMap(p => p.declarations ?? []).map(d => d.type?.getText() ?? "")
  const typedArray = typedArrayOwner.test(owner)
  if (owner === "Array" && method === "fromAsync") return "never" // iterator and mapper throws reject
  // Iteration itself is an implicit protocol hook (detail 202 extends 81).
  if (owner === "Array" && method === "from" || ["Map", "Set"].includes(owner) && !method) return "never"
  if (owner !== "Promise" && parameterTypes.some(t => /\b(?:Iterable|AsyncIterable)\b/.test(t)) ||
      typedArray && method === "from" || typedArray && !method && parameterTypes.some(t => /\bArrayLike\b|\[\]/.test(t)))
    return "unknown" // synchronous iterator calls can throw independently of coercion hooks
  if ((["Map", "Set", "WeakMap", "WeakSet"].includes(owner) && !method ||
       owner === "Array" && method === "from" || owner === "AggregateError" && !method ||
       owner === "Object" && method === "fromEntries") && sig.getParameters().length)
    return "unknown" // iterable arguments can invoke a throwing next(), separately from coercion hooks
  if (name === "JSON.parse") return "SyntaxError"
  if (name === "JSON.stringify") return "TypeError"
  if (name === "BigInt" || name === "BigIntConstructor") return "RangeError | SyntaxError" // the pinned union excludes null, symbols and objects
  if (owner === "RegExp") return !method || method === "compile" ? "SyntaxError" : safeMethods.RegExp.has(method) ? "never" : "unknown"
  if (/^decodeURI(?:Component)?$/.test(name) || /^encodeURI(?:Component)?$/.test(name)) return "URIError"
  if (name === "atob" || name === "btoa" || name === "structuredClone") return "DOMException"
  if (owner === "String" && method === "normalize") {
    const form = parameters[0]?.declarations?.[0]?.type
    const forms = form && (ts.isUnionTypeNode(form) ? form.types : [form])
    const validForms = new Set(["NFC", "NFD", "NFKC", "NFKD"])
    if (forms?.length && forms.every(t => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) && validForms.has(t.literal.text)))
      return "never" // detail 205: this declared overload admits only valid forms
  }
  if (owner === "String" && ["repeat", "normalize"].includes(method)) return "RangeError"
  if (owner === "Number" && ["toFixed", "toPrecision", "toExponential", "toString"].includes(method)) return "RangeError"
  if (owner === "BigInt" && method === "toString") return "RangeError"
  if (owner === "Array" && !method) return "RangeError"
  if (name === "ArrayBuffer" || name === "SharedArrayBuffer" || /^(?:ArrayBuffer|SharedArrayBuffer)Constructor$/.test(name)) return "RangeError"
  if (name === "DataView" || name === "DataViewConstructor") return "RangeError"
  if (owner === "DataView" && /^(?:get|set)/.test(method ?? "")) return "RangeError"
  if (typedArray) {
    if (!method || method === "set" || method === "with") return "RangeError"
    if (method === "toLocaleString") return "RangeError | TypeError"
    if (["reduce", "reduceRight"].includes(method)) return sig?.getParameters().some(p => p.name === "initialValue") ? "never" : "TypeError"
    if (owner === "Uint8Array" && ["fromBase64", "fromHex", "setFromBase64", "setFromHex"].includes(method)) return "SyntaxError"
    return safeTypedMethods.has(method) || owner === "Uint8Array" && ["toBase64", "toHex"].includes(method) ? "never" : "unknown"
  }
  if (owner === "Promise") return !method || safeMethods.Promise.has(method) ? "never" : "unknown"
  if (["parseInt", "parseFloat", "isFinite", "isNaN"].includes(name) || errors.has(owner) && (!method || ["isError", "toString"].includes(method))) return "never"
  if (owner === "Array" || owner === "ReadonlyArray") {
    if (["reduce", "reduceRight"].includes(method)) return sig?.getParameters().some(p => p.name === "initialValue") ? "never" : "TypeError" // empty arrays without an initial value
    if (method === "with") return "RangeError"
  }
  if (owner === "Object" && ["create", "defineProperty", "defineProperties"].includes(method)) return "TypeError"
  if (owner === "Number" && !method) return "TypeError"
  if (owner === "String" && method === "fromCodePoint") return "RangeError"
  if (owner === "String" && ["matchAll", "replaceAll"].includes(method)) return "TypeError"
  if (["Date", "Number", "BigInt", "Array", "String"].includes(owner) && /Locale/.test(method ?? "")) return "RangeError | TypeError"
  if (owner === "Symbol" && method === "keyFor") return "TypeError"
  if (owner === "Reflect" && ["construct", "apply"].includes(method)) return "unknown"
  if (Object.hasOwn(safeMethods, owner) && safeMethods[owner].has(method) ||
      !method && ["Map", "Set", "WeakMap", "WeakSet", "Date", "Boolean", "String", "Object", "Symbol"].includes(owner)) return "never"
  return "unknown" // DOM/environment declarations without an available implementation are not proofs.
}

function propertyName(symbol, declaration) {
  // Escaped names such as __@iterator@252 contain checker-local IDs.
  // The computed property's declaration carries its stable public spelling.
  return declaration.name && ts.isComputedPropertyName(declaration.name)
    ? clean(declaration.name.getText())
    : symbol.name
}

export function generateThrowsInventory() {
  const libs = files(libDir, ".d.ts")
  const effectDeclarations = files(resolve(effectDir, "dist"), ".d.ts")
  const effectSources = files(resolve(effectDir, "dist"), ".js")
  const effectPackage = JSON.parse(read(resolve(effectDir, "package.json")))
  const manifest = JSON.parse(read(resolve(root, "docs/tools/package.json")))
  const runtime = JSON.parse(read(resolve(root, "packages/runtime/package.json")))
  if (effectPackage.version !== manifest.devDependencies.effect || effectPackage.version !== runtime.peerDependencies.effect)
    throw new Error("Install the pinned Effect version in docs/tools before generating throws.json")
  if (ts.version !== manifest.devDependencies.typescript) throw new Error("Install the pinned TypeScript parser")
  const version = read(resolve(root, "typescript/tsc/internal/core/version.go")).match(/var version = "([^"]+)"/)?.[1]
  if (!version) throw new Error("Missing bundled TypeScript version")
  const options = { noLib: true, strict: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }
  const program = ts.createProgram([...libs, ...effectDeclarations], options)
  const syntaxErrors = program.getSyntacticDiagnostics()
  if (syntaxErrors.length) throw new Error(ts.flattenDiagnosticMessageText(syntaxErrors[0].messageText, "\n"))
  const checker = program.getTypeChecker()
  const sources = new SourceAnalysis({ dualPath: resolve(effectDir, "dist/Function.js") })
  const entries = new Map()
  const sigString = sig => clean(checker.signatureToString(sig, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope))
  const typeString = type => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope)
  const isEffectful = type => {
    if (type.isUnion()) return type.types.every(isEffectful)
    const symbol = type.getSymbol()
    return ["Effect", "Stream", "Layer"].includes(symbol?.getName()) &&
      symbol.declarations?.some(d => /\/(?:Effect|Stream|Layer)\.d\.ts$/.test(d.getSourceFile().fileName))
  }
  function callbackSignatures(type, path, out, visited = new Set(), depth = 0) {
    if (visited.has(type)) return
    visited = new Set(visited).add(type)
    if (type.isUnion()) { for (const part of type.types) callbackSignatures(part, path, out, visited, depth); return }
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(type)
      if (constraint) callbackSignatures(constraint, path, out, visited, depth)
      return
    }
    const calls = type.getCallSignatures()
    for (const sig of calls) out.push({ parameter: path, signature: sigString(sig), admits: "never" })
    if (calls.length || depth >= 2 || !type.getProperties || !(type.flags & ts.TypeFlags.Object)) return
    // Only inline option records: traversing arbitrary Schema/Effect interfaces would enumerate their APIs.
    if (!type.getSymbol()?.declarations?.some(d => ts.isTypeLiteralNode(d))) return
    for (const property of type.getProperties()) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0]
      if (declaration) callbackSignatures(checker.getTypeOfSymbolAtLocation(property, declaration), path + "." + propertyName(property, declaration), out, visited, depth + 1)
    }
  }
  function contract(module, name, sig, kind, callable, depth = 0, ancestors = new Set(), dualArity) {
    const returnType = checker.getReturnTypeOfSignature(sig)
    const callbacks = []
    for (const parameter of sig.getParameters()) {
      const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0] ?? sig.declaration
      if (declaration) callbackSignatures(checker.getTypeOfSymbolAtLocation(parameter, declaration), parameter.name, callbacks)
    }
    const rethrows = []
    let ownThrows
    let evidence
    const leaf = module.split("/").at(-1)
    const dataLast = depth === 0 && dualArity !== undefined && sig.getParameters().length < dualArity &&
      !sig.declaration?.parameters?.some(p => p.dotDotDotToken) && returnType.getCallSignatures().length > 0
    if (isEffectful(returnType)) {
      ownThrows = "never"; evidence = "VIP-4 effectful return exemption"
    } else if (dataLast) {
      ownThrows = "never"; evidence = "detail 202; numeric dual arity defers the full body"
    } else if (leaf === "Effect" && name === "catchTag" && depth === 0 && returnType.getCallSignatures().length) {
      ownThrows = "never"; evidence = "detail 202 settled catchTag factory; dist/internal/effect.js selector tests isEffect"
    } else if (module === "global") {
      ownThrows = nativeContract(name, kind, sig)
      evidence = ownThrows === "unknown" ? "unavailable native source; conservative default" : "ECMA-262 argument validation; detail 81 implicit-state exclusions"
      const [owner, method] = name.split(".")
      if ((["Array", "ReadonlyArray"].includes(owner) || /Array$/.test(owner)) && rethrowMethods.has(method) ||
          method === "from" && (owner.replace(/Constructor$/, "") === "Array" || typedArrayOwner.test(owner.replace(/Constructor$/, ""))) || name === "JSON.parse" || name === "JSON.stringify" ||
          ["Map", "ReadonlyMap", "Set", "ReadonlySet", "String"].includes(owner) && ["forEach", "replace", "replaceAll"].includes(method)) {
        for (const callback of callbacks) if (!rethrows.includes(callback.parameter)) rethrows.push(callback.parameter)
      }
      if (name === "Promise" || name === "PromiseConstructor")
        for (const callback of callbacks) if (callback.parameter === "executor") callback.admits = "unknown"
      for (const callback of callbacks) if (rethrows.includes(callback.parameter)) callback.admits = "unknown"
    } else if (leaf === "Schema" && ["decodeUnknownSync", "decodeSync"].includes(name)) {
      ownThrows = depth === 0 ? "never" : "SchemaError"; evidence = "VIP-4 settled decoder/encoder contract; dist/Schema.js"
    } else if (leaf === "Data" && ["TaggedError", "taggedEnum"].includes(name) ||
               leaf === "Schema" && name === "TaggedError" && kind === "construct") {
      ownThrows = "never"; evidence = "VIP-4 settled generated constructor contract"
    } else {
      ownThrows = sources.analyze(callable)
      evidence = ownThrows === "unknown" ? "source proof incomplete; conservative default" : "synchronous dist source call graph"
    }
    if (leaf === "Effect" && ["try", "tryPromise"].includes(name) && depth === 0) {
      for (const callback of callbacks) if (callback.parameter === "options" || /(?:^|\.)try$/.test(callback.parameter)) callback.admits = "unknown"
    }
    const result = { signature: sigString(sig), kind, ownThrows, rethrows, callbacks, returns: [], evidence }
    if (ancestors.has(returnType)) {
      result.returnsReference = typeString(returnType)
      return result
    }
    const returned = [...returnType.getCallSignatures().map(sig => [sig, "call"]),
      ...returnType.getConstructSignatures().map(sig => [sig, "construct"])]
    if (returned.length) {
      const nextAncestors = new Set(ancestors).add(returnType)
      if (depth >= 8) throw new Error("Returned callable nesting exceeds inventory limit: " + module + "." + name)
      for (const [returnedSig, returnedKind] of returned) result.returns.push(contract(module, name, returnedSig, returnedKind, dataLast ? callable : sources.returned(callable), depth + 1, nextAncestors))
    }
    return result
  }
  function add(module, name, sig, kind = "call", callable, dualArity) {
    const key = JSON.stringify([module, name, kind, sigString(sig)])
    if (entries.has(key)) return
    const declaration = sig.declaration
    const file = declaration?.getSourceFile()
    const source = file ? {
      file: file.fileName.startsWith(effectDir) ? "effect/" + relative(effectDir, file.fileName) : relative(root, file.fileName),
      line: file.getLineAndCharacterOfPosition(declaration.getStart(file)).line + 1,
    } : undefined
    entries.set(key, { module, declaration: name, ...contract(module, name, sig, kind, callable, 0, new Set(), dualArity), source })
  }
  // Lib declarations: preserve overloads and merged interface members without expanding inherited DOM APIs.
  function libVisit(node, scope = "") {
    if (ts.isModuleDeclaration(node)) {
      const name = node.name.getText().replaceAll('"', "")
      if (node.body) libVisit(node.body, scope ? scope + "." + name : name === "global" ? "" : name)
      return
    }
    if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
      const owner = node.name?.text
      for (const member of node.members) {
        const name = member.name?.getText()
        if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
          const sig = checker.getSignatureFromDeclaration(member)
          if (sig) add("global", (scope ? scope + "." : "") + owner + "." + name, sig)
        } else if (ts.isPropertySignature(member) && name) {
          const type = checker.getTypeAtLocation(member)
          for (const sig of type.getCallSignatures()) add("global", (scope ? scope + "." : "") + owner + "." + name, sig)
        } else if (ts.isCallSignatureDeclaration(member) || ts.isConstructSignatureDeclaration(member) || ts.isConstructorDeclaration(member)) {
          const sig = checker.getSignatureFromDeclaration(member)
          if (sig) add("global", (scope ? scope + "." : "") + owner, sig, ts.isCallSignatureDeclaration(member) ? "call" : "construct")
        }
      }
      return
    }
    if (ts.isFunctionDeclaration(node)) {
      const sig = checker.getSignatureFromDeclaration(node)
      if (sig) add("global", (scope ? scope + "." : "") + node.name.text, sig)
      return
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const type = checker.getTypeAtLocation(node.name)
      const name = (scope ? scope + "." : "") + node.name.text
      for (const sig of type.getCallSignatures()) add("global", name, sig)
      for (const sig of type.getConstructSignatures()) add("global", name, sig, "construct")
      if (!type.getCallSignatures().length && !type.getConstructSignatures().length) {
        const key = JSON.stringify(["global", name, "value", ""])
        entries.set(key, { module: "global", declaration: name, signature: "", kind: "value", ownThrows: null, rethrows: [], callbacks: [], returns: [], evidence: "non-callable global value" })
      }
      // Static callable members on constructor variables (Array.from, Object.keys, Math.max, JSON.parse).
      for (const prop of type.getProperties()) {
        const declaration = prop.valueDeclaration ?? prop.declarations?.[0]
        if (!declaration || prop.name === "prototype") continue
        const propType = checker.getTypeOfSymbolAtLocation(prop, declaration)
        for (const sig of propType.getCallSignatures()) add("global", name + "." + propertyName(prop, declaration), sig)
      }
      return
    }
    ts.forEachChild(node, child => libVisit(child, scope))
  }
  for (const file of libs) libVisit(program.getSourceFile(file))
  // Resolve aliases/reexports through the published .d.ts surface, including subpath modules.
  const publicFiles = effectDeclarations.filter(file => !relative(resolve(effectDir, "dist"), file).split("/").includes("internal"))
  for (const file of publicFiles) {
    const ast = program.getSourceFile(file)
    const moduleSymbol = checker.getSymbolAtLocation(ast)
    if (!moduleSymbol) continue
    const rel = relative(resolve(effectDir, "dist"), file).replace(/\.d\.ts$/, "")
    const module = "effect" + (rel === "index" ? "" : "/" + rel.replace(/\/index$/, ""))
    for (let symbol of checker.getExportsOfModule(moduleSymbol)) {
      const name = symbol.name
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
      if (!(symbol.flags & ts.SymbolFlags.Value)) continue
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
      if (!declaration) continue
      const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
      const sourceFile = declaration.getSourceFile().fileName.replace(/\.d\.ts$/, ".js")
      const callable = sources.callable(sourceFile, symbol.name)
      const calls = type.getCallSignatures()
      const constructs = type.getConstructSignatures()
      const dualArity = sources.dualArity(sourceFile, symbol.name)
      for (const sig of calls) add(module, name, sig, "call", callable, dualArity)
      for (const sig of constructs) add(module, name, sig, "construct", callable)
      if (!calls.length && !constructs.length) {
        const key = JSON.stringify([module, name, "value", ""])
        entries.set(key, { module, declaration: name, signature: "", kind: "value", ownThrows: null, rethrows: [], callbacks: [], returns: [], evidence: "non-callable value" })
      }
    }
  }
  const input = (file, prefix, base) => ({ file: prefix + relative(base, file), sha256: hash(read(file)) })
  return {
    schemaVersion: 1,
    generatedBy: "node docs/tools/throws-inventory.mjs --write",
    classification: "VIP-4; details 40, 64, 66, 81, 81a, 202, 205, 206. Written contracts precede this inventory. Prove never from synchronous source, retain known error classes, otherwise unknown. Native receiver/environment state, coercion and iteration protocol hooks and resource limits are implicit. Function-type callbacks admit never unless annotated or rethrown. Returned callable contracts describe their invocation, separately from construction.",
    inputs: {
      typescript: { version, versionFile: "typescript/tsc/internal/core/version.go", parserVersion: ts.version, files: libs.map(f => input(f, "", root)) },
      effect: { version: effectPackage.version, packageSha256: hash(read(resolve(effectDir, "package.json"))), declarations: effectDeclarations.map(f => input(f, "effect/", effectDir)), sources: effectSources.map(f => input(f, "effect/", effectDir)) },
    },
    entries: [...entries.values()].sort((a, b) => compare(JSON.stringify([a.module, a.declaration, a.kind, a.signature]), JSON.stringify([b.module, b.declaration, b.kind, b.signature]))),
  }
}
export function serializeInventory(inventory) {
  // One overload per line keeps large inventory diffs reviewable.
  const { entries, ...header } = inventory
  return JSON.stringify(header, null, 2).replace(/\n}$/, ',\n  "entries": [\n') +
    entries.map(entry => "    " + JSON.stringify(entry)).join(",\n") + "\n  ]\n}\n"
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = generateThrowsInventory()
  const expected = serializeInventory(inventory)
  const path = resolve(root, artifactPath)
  if (process.argv.includes("--write")) {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, expected)
    console.log("throws.json: " + inventory.entries.length + " entries")
  } else if (!existsSync(path) || read(path) !== expected) {
    console.error("Stale or missing " + artifactPath + "; run node docs/tools/throws-inventory.mjs --write")
    process.exitCode = 1
  }
}
