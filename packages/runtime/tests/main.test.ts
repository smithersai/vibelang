import { expect, test } from "bun:test"
import { $runMain, Effect, Exit } from "vibelang-runtime"
import { observeChild } from "./subprocess"

for (const delayed of [false, true]) {
  test(`main removes signal listeners after ${delayed ? "asynchronous" : "synchronous"} success`, async () => {
    const before = [process.listeners("SIGINT"), process.listeners("SIGTERM")]
    let observed: unknown
    try {
      await new Promise<void>(resolve => {
        $runMain(delayed ? Effect.andThen(Effect.yieldNow, Effect.succeed(42)) : Effect.succeed(42), {
          teardown: (exit, finish) => {
            observed = exit
            finish(0)
            resolve()
          }
        })
      })
      expect(observed).toEqual(Exit.succeed(42))
      expect(process.listeners("SIGINT")).toEqual(before[0])
      expect(process.listeners("SIGTERM")).toEqual(before[1])
    } finally {
      for (const [i, signal] of ["SIGINT", "SIGTERM"].entries()) {
        for (const listener of process.listeners(signal)) {
          if (!before[i].includes(listener)) process.removeListener(signal, listener)
        }
      }
    }
  })
}

// Each child process loads the runtime and Effect; on a loaded host that can take longer than bun test's 5 s default.
const CHILD_PROCESS_TIMEOUT = 30_000

for (const executable of ["node", process.execPath]) {
  const host = executable === "node" ? "Node" : "Bun"
  test(`main on ${host} exits on failure and honors the runtime's exit-code marker`, () => {
    for (const [effect, code] of [
      ['Effect.fail("failed")', 1],
      ['Effect.fail({ [Runtime.errorExitCode]: 7 })', 7]
    ] as const) {
      const source = `import { $runMain, Effect } from "vibelang-runtime";
        import { Runtime } from "effect";
        $runMain(${effect}, { disableErrorReporting: true });`
      const result = observeChild(host, () => Bun.spawnSync([executable, "--input-type=module", "--eval", source], { cwd: import.meta.dir + "/..", timeout: 10_000 }))
      expect(result.exitCode).toBe(code)
      expect(result.stderr.toString()).toBe("")
    }
  }, CHILD_PROCESS_TIMEOUT)

  for (const signal of ["SIGINT", "SIGTERM"]) {
    test(`main on ${host} handles ${signal} and finishes resource cleanup before exit`, () => {
      const source = `import { $runMain, Effect } from "vibelang-runtime";
        $runMain(Effect.ensuring(Effect.never, Effect.andThen(Effect.yieldNow,
          Effect.sync(() => console.log("released")))));
        process.kill(process.pid, ${JSON.stringify(signal)});`
      const result = observeChild(host, () => Bun.spawnSync([executable, "--input-type=module", "--eval", source], { cwd: import.meta.dir + "/..", timeout: 10_000 }), { timeoutMs: 10_000 })
      expect(result.exitCode).toBe(130)
      expect(result.stdout.toString().trim()).toBe("released")
      expect(result.stderr.toString()).toBe("")
    }, CHILD_PROCESS_TIMEOUT)
  }
}

test("main can finish successfully without a host process (browser fallback)", () => {
  const source = `import { $runMain, Effect } from "vibelang-runtime";
    globalThis.process = undefined;
    $runMain(Effect.succeed(42), { teardown: (exit, finish) => {
      console.log(exit.value); finish(0);
    }});`
  const result = observeChild("Node", () => Bun.spawnSync(["node", "--input-type=module", "--eval", source], { cwd: import.meta.dir + "/..", timeout: 10_000 }))
  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString().trim()).toBe("42")
  expect(result.stderr.toString()).toBe("")
}, CHILD_PROCESS_TIMEOUT)

for (const executable of ["node", process.execPath]) {
  const host = executable === "node" ? "Node" : "Bun"
  test("main reports typed error fields on " + (executable === "node" ? "Node" : "Bun"), () => {
    const source = 'import { $runMain, Effect, TaggedError } from "vibelang-runtime"; class Fatal extends TaggedError("Fatal") {} const error = new Fatal({ why: "boom", count: 3 }); $runMain(Effect.fail(error));'
    const result = observeChild(host, () => Bun.spawnSync([executable, "--input-type=module", "--eval", source], { cwd: import.meta.dir + "/..", timeout: 10_000 }))
    expect(result.exitCode).toBe(1)
    const report = result.stdout.toString() + result.stderr.toString()
    expect(report).toContain("Fatal")
    expect(report).toContain("why")
    expect(report).toContain("boom")
    expect(report).toContain("count")
    expect(report).toContain("3")
  }, CHILD_PROCESS_TIMEOUT)
}

for (const executable of ["node", process.execPath]) {
  const host = executable === "node" ? "Node" : "Bun"
  test("main preserves curried reporting opt-outs on " + (executable === "node" ? "Node" : "Bun"), () => {
    for (const marker of ["", 'error[Runtime.errorReported] = false;']) {
      const source = 'import { $runMain, Effect, TaggedError } from "vibelang-runtime"; import { Runtime } from "effect"; class Fatal extends TaggedError("Fatal") {} const error = new Fatal({ why: "boom" }); ' + marker + ' $runMain(' + (marker ? '{}' : '{ disableErrorReporting: true }') + ')(Effect.fail(error));'
      const result = observeChild(host, () => Bun.spawnSync([executable, "--input-type=module", "--eval", source], { cwd: import.meta.dir + "/..", timeout: 10_000 }))
      expect(result.exitCode).toBe(1)
      expect(result.stdout.toString() + result.stderr.toString()).toBe("")
    }
  }, CHILD_PROCESS_TIMEOUT)

  test("main reports circular error fields on " + (executable === "node" ? "Node" : "Bun"), () => {
    const source = 'import { $runMain, Effect, TaggedError } from "vibelang-runtime"; class Fatal extends TaggedError("Fatal") {} const circular = {}; circular.self = circular; const error = new Fatal({ why: "boom", circular }); $runMain(Effect.fail(error));'
    const result = observeChild(host, () => Bun.spawnSync([executable, "--input-type=module", "--eval", source], { cwd: import.meta.dir + "/..", timeout: 10_000 }))
    expect(result.exitCode).toBe(1)
    const report = result.stdout.toString() + result.stderr.toString()
    expect(report).toContain("boom")
  }, CHILD_PROCESS_TIMEOUT)
}
