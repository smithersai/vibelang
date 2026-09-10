import { expect, test } from "bun:test"
import { compileActionContract } from "./schema.ts"
import {
  compileActionImplementationContract, retainedCheckedImplementationProject,
  requireCompilerAuthenticatedContract, requireCompilerAuthenticatedImplementation,
  type CompileActionImplementationOptions
} from "./implementation-contract.ts"
import { digest, type ActionDescriptor } from "./value.ts"

function action(source: string, fileName = "action.vibe"): ActionDescriptor {
  const result = compileActionContract(source, { fileName, exportName: "Work", id: "test/native-work", version: 1 })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.descriptor
}
const neverAction = () => action('import { Action } from "vibelang:flows"; export class Work extends Action<(n: number) => Result<number, never>> {}')
const work = (n: number) => n + 1
const source = "export function work(n: number): Result<number, never> { return n + 1; }"
const options = (): CompileActionImplementationOptions => ({
  action: neverAction(), implementationId: "native-work", implementationVersion: "1",
  implementation: work, entryFile: "main.vibe", exportName: "work", sources: [{ fileName: "main.vibe", source }]
})

test("native infallible Action implementation pins the structural never failure codec", () => {
  const input = options()
  const contract = compileActionImplementationContract(input)
  expect(contract.failureSchemaDigest).toBe(input.action.errorSchema.digest)
  expect(contract.typedFailures).toEqual([])
  expect(contract.panic).toBe(false)
  expect(requireCompilerAuthenticatedContract(contract)).toBe(contract)
  expect(() => requireCompilerAuthenticatedImplementation(contract, work)).not.toThrow()
  expect(() => requireCompilerAuthenticatedContract({ ...contract })).toThrow("exact frozen contract")
  expect(() => requireCompilerAuthenticatedImplementation(contract, (n: number) => n + 1)).toThrow("exact runtime callback")
})

test("native implementation rows and nominal codec follow the complete imported source closure", () => {
  const declarations = `import { Action } from "vibelang:flows";
    export class Missing extends Error { constructor(readonly code: number) { super(); } }
    export class Work extends Action<(n: number) => Result<number, Missing>> {}`
  const contract = compileActionImplementationContract({
    ...options(), action: action(declarations, "lib/errors.vibe"),
    sources: [
      { fileName: "lib/errors.vibe", source: declarations },
      { fileName: "lib/helper.vibe", source: `import { Missing as Absent } from "./errors";
        export function helper(n: number): Result<number, Absent> { if (n < 0) throw new Absent(n); return n; }` },
      { fileName: "main.vibe", source: `import { helper } from "./lib/helper.js"; import type { Missing } from "./lib/errors";
        export function work(n: number): Result<number, Missing> { return helper(n)!; }` }
    ]
  })
  expect(contract.typedFailures).toEqual(["Missing"])
  expect(contract.failureSchemaDigest).toBe(contract.actionErrorSchemaDigest)
  expect(retainedCheckedImplementationProject(contract).sources).toHaveLength(3)
})

test("native implementation proof refuses unchecked unused sources and ambiguous logical identities", () => {
  const input = options()
  expect(() => compileActionImplementationContract({ ...input, sources: [...input.sources, { fileName: "unused.vibe", source: 'export const value: number = "bad";' }] })).toThrow("did not pass native checked lowering")
  expect(() => compileActionImplementationContract({ ...input, sources: [...input.sources, { fileName: "./main.vibe", source }] })).toThrow("unique logical file identities")
})

test("checking and retained evidence use one source and callback snapshot", () => {
  const input = options()
  let sourceReads = 0, callbackReads = 0, projectReads = 0, rootReads = 0
  const contract = compileActionImplementationContract({
    ...input,
    get sources() {
      projectReads++
      return [{ fileName: "main.vibe", get source() { return ++sourceReads === 1 ? source : 'export const work = "unchecked";' } }]
    },
    get implementation() { callbackReads++; return callbackReads === 1 ? work : () => 0 },
    get rootDir() { rootReads++; return "/virtual/project" }
  })
  expect([projectReads, sourceReads, callbackReads, rootReads]).toEqual([1, 1, 1, 1])
  expect(retainedCheckedImplementationProject(contract).sources).toEqual([{ fileName: "main.vibe", source }])
  expect(contract.projectDigest).toBe(digest({ sources: [{ fileName: "main.vibe", source }] }))
  expect(() => requireCompilerAuthenticatedImplementation(contract, work)).not.toThrow()
})

test("native diagnostics retain host file spelling and authored UTF16 lines", () => {
  const input = options()
  const fileName = "/virtual/project/main.vibe"
  const bad = '// 😀\u2028export function work(): number { return "bad"; }'
  try {
    compileActionImplementationContract({ ...input, rootDir: "/virtual/project", entryFile: fileName, sources: [{ fileName, source: bad }] })
    throw new Error("invalid function was accepted")
  } catch (error) {
    const issues = (error as { diagnostics?: readonly { fileName: string; code: string; line: number; start: number }[] }).diagnostics
    expect(issues).toBeDefined()
    expect(issues?.some(issue => issue.fileName === fileName && issue.code === "TS2322" && issue.line === 2 && issue.start >= 6)).toBe(true)
  }
})
