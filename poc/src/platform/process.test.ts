import { describe, expect, test } from "bun:test";
import { decodeError, encodeError, errorIs } from "../runtime/errors.ts";
import { Layer } from "../runtime/layer.ts";
import { type Panic, catchPanic, isPanic } from "../runtime/panic.ts";
import { NodePlatform, TestPlatform } from "./layers.ts";
import { NodeProcess, Process, ProcessExited, type Signal, TestProcess } from "./process.ts";

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

function panicOf(body: () => unknown): Panic | undefined {
  const outcome = catchPanic(body, (error) => error);
  return isPanic(outcome) ? outcome : undefined;
}

/** The contract both implementations satisfy, minus `exit`, which differs in kind. */
function assertProcessContract(runningProcess: Process): void {
  const argv = runningProcess.argv();
  expect(Array.isArray(argv)).toBe(true);
  expect(argv.length).toBeGreaterThan(0);
  expect(argv.every((entry) => typeof entry === "string")).toBe(true);
  // The reading is a frozen copy: editing it cannot rewrite the program's argv.
  expect(Object.isFrozen(argv)).toBe(true);
  expect(runningProcess.argv()).toEqual(argv);

  expect(Number.isInteger(runningProcess.pid())).toBe(true);
  expect(runningProcess.pid()).toBeGreaterThan(0);
  expect(typeof runningProcess.cwd()).toBe("string");
  expect(runningProcess.cwd().length).toBeGreaterThan(0);
  expect(typeof runningProcess.platform()).toBe("string");

  expect(panics(() => runningProcess.onSignal("SIGKILL" as Signal, () => {}))).toBe(true);
  expect(panics(() => runningProcess.onSignal("SIGINT", undefined as unknown as () => void))).toBe(true);
  expect(panics(() => runningProcess.exit(-1))).toBe(true);
  expect(panics(() => runningProcess.exit(1.5))).toBe(true);
}

describe("Process", () => {
  test("NodeProcess satisfies the contract against the live host", () => {
    assertProcessContract(NodeProcess.make());
    const live = NodeProcess.make();
    expect(live.pid()).toBe(process.pid);
    expect(live.cwd()).toBe(process.cwd());
    expect(live.platform()).toBe(process.platform);
  });

  test("TestProcess satisfies the contract from declared values", () => {
    assertProcessContract(TestProcess.make());
    const declared = TestProcess.make({
      argv: ["/bin/smithers", "build", "--watch"],
      cwd: "/workspace",
      pid: 99,
      platform: "win32",
    });
    expect(declared.argv()).toEqual(["/bin/smithers", "build", "--watch"]);
    expect(declared.cwd()).toBe("/workspace");
    expect(declared.pid()).toBe(99);
    expect(declared.platform()).toBe("win32");

    declared.setCwd("/elsewhere").setArgv(["/bin/smithers"]);
    expect(declared.cwd()).toBe("/elsewhere");
    expect(declared.argv()).toEqual(["/bin/smithers"]);
    expect(panics(() => declared.setCwd(""))).toBe(true);
    expect(panics(() => TestProcess.make({ pid: 0 }))).toBe(true);
    expect(panics(() => TestProcess.make({ argv: [1] as unknown as string[] }))).toBe(true);
  });

  test("TestProcess.exit records the code and never returns", () => {
    const runningProcess = TestProcess.make();
    expect(runningProcess.exits).toEqual([]);
    expect(runningProcess.exitCode()).toBeUndefined();

    let reachedAfterExit = false;
    const raised = panicOf(() => {
      runningProcess.exit(3);
      // Unreachable: `exit` returns `never` in the double as well as live.
      reachedAfterExit = true;
    });
    expect(reachedAfterExit).toBe(false);
    expect(errorIs(raised, ProcessExited)).toBe(true);
    expect((raised as ProcessExited).code).toBe(3);
    expect(runningProcess.exits).toEqual([3]);
    expect(runningProcess.exitCode() ?? -1).toBe(3);

    catchPanic(() => runningProcess.exit(), () => undefined);
    expect(runningProcess.exits).toEqual([3, 0]);
    // The first request is the one that would have terminated the program.
    expect(runningProcess.exitCode() ?? -1).toBe(3);
  });

  test("ProcessExited is a panic, not a recoverable failure, and survives the wire", () => {
    const exited = new ProcessExited(2);
    expect(isPanic(exited)).toBe(true);
    const decoded = decodeError(encodeError(exited));
    expect(decoded.constructor).toBe(ProcessExited);
    expect((decoded as ProcessExited).code).toBe(2);
    expect(decoded.message).toBe(exited.message);
    // Nominal narrowing does not confuse it with a bare Panic.
    expect(errorIs(decoded, ProcessExited)).toBe(true);
  });

  test("TestProcess delivers signals only when the test sends one", () => {
    const runningProcess = TestProcess.make();
    const seen: string[] = [];
    const first = runningProcess.onSignal("SIGINT", () => seen.push("first"));
    const second = runningProcess.onSignal("SIGINT", () => seen.push("second"));
    runningProcess.onSignal("SIGTERM", () => seen.push("term"));

    expect(runningProcess.subscriptions("SIGINT")).toBe(2);
    expect(seen).toEqual([]);
    expect(runningProcess.sendSignal("SIGINT")).toBe(2);
    expect(seen).toEqual(["first", "second"]);

    first.dispose();
    expect(first.disposed).toBe(true);
    expect(runningProcess.subscriptions("SIGINT")).toBe(1);
    runningProcess.sendSignal("SIGINT");
    expect(seen).toEqual(["first", "second", "second"]);

    // Disposal is idempotent and does not disturb the other subscription.
    first.dispose();
    expect(runningProcess.subscriptions("SIGINT")).toBe(1);
    second.dispose();
    expect(runningProcess.sendSignal("SIGINT")).toBe(0);
    expect(runningProcess.sendSignal("SIGTERM")).toBe(1);
    expect(seen).toEqual(["first", "second", "second", "term"]);
  });

  test("a handler that unsubscribes during delivery does not disturb the round", () => {
    const runningProcess = TestProcess.make();
    const seen: string[] = [];
    const subscription = runningProcess.onSignal("SIGHUP", () => {
      seen.push("self");
      subscription.dispose();
    });
    runningProcess.onSignal("SIGHUP", () => seen.push("other"));
    expect(runningProcess.sendSignal("SIGHUP")).toBe(2);
    expect(seen).toEqual(["self", "other"]);
    expect(runningProcess.subscriptions("SIGHUP")).toBe(1);
  });

  test("NodeProcess registers and removes a real host listener", () => {
    const runningProcess = NodeProcess.make();
    const before = process.listenerCount("SIGUSR2");
    let delivered = 0;
    const subscription = runningProcess.onSignal("SIGUSR2", () => {
      delivered += 1;
    });
    expect(process.listenerCount("SIGUSR2")).toBe(before + 1);

    // Emitted rather than sent by the OS: the wrapper, not the kernel, is what
    // this test is about.
    process.emit("SIGUSR2");
    expect(delivered).toBe(1);

    subscription.dispose();
    expect(subscription.disposed).toBe(true);
    expect(process.listenerCount("SIGUSR2")).toBe(before);
    process.emit("SIGUSR2");
    expect(delivered).toBe(1);
    subscription.dispose();
    expect(process.listenerCount("SIGUSR2")).toBe(before);
  });

  test("Process resolves through a Layer under its nominal key", () => {
    const double = TestProcess.make({ cwd: "/scoped" });
    const resolved = Layer.provide(Layer.succeed(Process, double), () => Process.context());
    expect(resolved).toBe(double);
    expect(resolved.cwd()).toBe("/scoped");
    expect(panics(() => Process.context())).toBe(true);
  });

  test("the platform bundles provide Process", () => {
    const platform = TestPlatform.make({ argv: ["/bin/smithers", "run"], pid: 7, cwd: "/bundle" });
    const fromTest = Layer.provide(platform.layer, () => Process.context());
    expect(fromTest).toBe(platform.process);
    expect(fromTest.argv()).toEqual(["/bin/smithers", "run"]);
    expect(fromTest.pid()).toBe(7);
    expect(fromTest.cwd()).toBe("/bundle");

    expect(Layer.provide(NodePlatform, () => Process.context())).toBeInstanceOf(NodeProcess);
  });
});
