import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler, extract } from "./check-snippets"
import { runSnippets, runTestLimit } from "./run-snippets"

const repo = resolve(import.meta.dir, "../..")
const compiler = defaultCompiler()

test("the rendered Promise adapter forwards cancellation, maps rejection, and retries before fallback", async () => {
  const extractPage = (path: string) => extract(readFileSync(join(repo, path), "utf8"))
  const onboarding = extractPage("docs/user/src/001-onboarding.md")
  const adapter = onboarding.find(block => block.filename === "load-todo.vibe")!
  const todos = onboarding.find(block => block.filename === "todos.ts")!
  const home = extractPage("site/src/pages/index.mdx").find(block => block.source.includes("effect function getTodo("))!
  expect(adapter.pending).toBeUndefined()
  expect(home.source.replace(/from "\.\/todos\.ts"[^\n]*/, 'from "./todos.ts"').trim()).toBe(adapter.source.replace(/^\/\/ load-todo\.vibe\n/m, "")
    .replace(/from "\.\/todos\.ts"[^\n]*/, 'from "./todos.ts"')
    .trim())
  const temp = mkdtempSync(join(tmpdir(), "docs-hatches-"))
  try {
    const fence = (language: string, source: string) => "```" + language + "\n" + source + "\n```\n"
    const harness = [
      '// check.ts',
      '// Output: todo body',
      '// Output: TodoFailed',
      '// Output: Todo unavailable',
      '// Output: 4',
      '// Output: aborted',
      'import { Effect, Result } from "effect"',
      'import { getTodo, todoOrFallback } from "./load-todo.vibe"',
      'globalThis.fetch = async (_input, init) => {',
      '  if (!(init?.signal instanceof AbortSignal)) throw new Error("missing signal")',
      '  return new Response("todo body")',
      '}',
      'console.log(await Effect.runPromise(getTodo(1)))',
      'let attempts = 0',
      'globalThis.fetch = async () => { attempts++; throw new Error("offline") }',
      'const outcome = await Effect.runPromise(Effect.result(getTodo(1)))',
      'if (Result.isFailure(outcome)) console.log(outcome.failure._tag)',
      'console.log(await Effect.runPromise(todoOrFallback(1)))',
      'console.log(attempts)',
      'const controller = new AbortController()',
      'const started = Promise.withResolvers<void>()',
      'const aborted = Promise.withResolvers<void>()',
      'globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {',
      '  init!.signal!.addEventListener("abort", () => {',
      '    aborted.resolve(); reject(init!.signal!.reason)',
      '  }, { once: true })',
      '  started.resolve()',
      '})',
      'const running = Effect.runPromise(getTodo(1), { signal: controller.signal }).catch(() => {})',
      'await started.promise',
      'controller.abort()',
      'await running',
      'await aborted.promise',
      'console.log("aborted")'
    ].join("\n")
    const source = home.source.replace(/from "\.\/todos\.ts"[^\n]*/, 'from "./todos.ts"')
    writeFileSync(join(temp, "adapter.md"),
      fence("ts", todos.source) + fence("vibe", "// load-todo.vibe\n" + source.replace(/^effect function /gm, "export effect function ")) + fence("ts", harness))
    const { stdout, stderr, status } = await runSnippets(temp, compiler)
    expect({ status, stderr, stdout }).toEqual({ status: 0, stderr: "", stdout: expect.stringContaining('"passed":1,"failed":0') })
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, runTestLimit)
