// Module mocks name a source module just as imports do (detail 272).
// Keep the codemod's lexical reader and the verifier's AST proof on one list.
const loaders = {
  vi: ["vitest", "vite-plus/test"],
  vitest: ["vitest", "vite-plus/test"],
  jest: ["@jest/globals"]
}
const methods = new Set(["mock", "doMock", "unmock", "doUnmock", "importActual", "importMock", "requireActual", "requireMock"])

// An omitted module denotes the runner's ambient global. An explicit import
// must prove both the export name and its exact module, never a lookalike.
export const isTestMockLoader = (name, module) => Object.hasOwn(loaders, name) &&
  (module === undefined || loaders[name].includes(module))

export const isTestMockCall = (name, method, proven = isTestMockLoader) =>
  methods.has(method) && proven(name)
