/**
 * `Process`: the running program's own identity and lifetime.
 *
 * `process` is not an ambient global in VibeLang (docs/DECISIONS.md, "Imports
 * and platform dependencies": `process`, `window`, `document`, filesystem, and
 * network "are unavailable as ambient globals ... must be supplied as
 * dependencies"), so reading `argv`, the pid, the working directory, or the host
 * platform — and terminating, and subscribing to a signal — all go through this
 * capability.
 *
 * Nothing here returns a `Result`. Every reading either succeeds or means the
 * host itself is broken (a deleted working directory, a signal the host refuses
 * to register), which is a panic, not a recoverable failure. The live
 * implementation therefore guards each foreign call with the established
 * `rethrowPanics(Result.try(...))` idiom and lets the mapped `Panic` unwind: a
 * raw errno object never escapes the boundary, and `catchPanic` still sees it.
 *
 * `exit` is the one member whose two implementations differ in kind rather than
 * in data; see `TestProcess.exit`.
 */

import { type JsonValue, type NominalError, registerErrorCodec } from "../runtime/errors.ts";
import { Context } from "../runtime/layer.ts";
import { Optional } from "../runtime/optional.ts";
import { Panic, panic } from "../runtime/panic.ts";
import { Result, rethrowPanics } from "../runtime/result.ts";
import { causeDetail } from "./internal.ts";

/**
 * The host identifiers Node reports. It is a closed union rather than `string`
 * so `Path.styleFor` and similar switches stay exhaustive.
 */
export type HostPlatform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

/**
 * The signals a program may subscribe to. `SIGKILL` and `SIGSTOP` are absent on
 * purpose: no host lets a process observe them, so accepting the name would
 * promise something no implementation can deliver.
 */
export type Signal =
  | "SIGINT"
  | "SIGTERM"
  | "SIGHUP"
  | "SIGQUIT"
  | "SIGUSR1"
  | "SIGUSR2"
  | "SIGWINCH"
  | "SIGBREAK";

const SIGNALS: ReadonlySet<string> = new Set<Signal>([
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
  "SIGQUIT",
  "SIGUSR1",
  "SIGUSR2",
  "SIGWINCH",
  "SIGBREAK",
]);

/**
 * The disposal handle `onSignal` hands back.
 *
 * Imported host code that starts hidden background work owns that work, and
 * "APIs needing caller-controlled lifetime must be adapted to expose an explicit
 * completion and/or disposal handle" (docs/DECISIONS.md). A registered signal
 * listener is exactly that kind of work, so subscribing returns a handle rather
 * than leaving the caller to reconstruct the listener identity for removal.
 * `dispose` is idempotent, and a disposed subscription never fires again even if
 * the host had already queued the callback.
 */
export interface SignalSubscription {
  readonly disposed: boolean;
  dispose(): void;
}

/** Running-program facilities. */
export abstract class Process extends Context {
  /** The full argument vector, host-shaped: `[execPath, scriptPath, ...args]`. */
  abstract argv(): readonly string[];

  /**
   * Terminate the program. Returns `never`: control does not continue past a
   * call, in either implementation.
   */
  abstract exit(code?: number): never;

  abstract pid(): number;

  /** The current working directory, as the host reports it. */
  abstract cwd(): string;

  abstract platform(): HostPlatform;

  /** Subscribe to a host signal. The handler runs on every delivery until disposed. */
  abstract onSignal(signal: Signal, handler: () => void): SignalSubscription;
}

function assertSignal(signal: Signal, caller: string): void {
  if (typeof signal !== "string" || !SIGNALS.has(signal)) {
    panic(`${caller} received an unsupported signal: ${String(signal)}`);
  }
}

function assertHandler(handler: () => void, caller: string): void {
  if (typeof handler !== "function") panic(`${caller} requires a handler function`);
}

function assertExitCode(code: number, caller: string): number {
  if (typeof code !== "number" || !Number.isInteger(code) || code < 0 || code > 255) {
    panic(`${caller} requires a whole exit code between 0 and 255`);
  }
  return code;
}

/**
 * The foreign-call guard for a member that has no failure channel: a host throw
 * becomes a `Panic` carrying the caller's name, and an already-panicking unwind
 * passes through untouched. This is `rethrowPanics(Result.try(...))` from
 * filesystem.ts/http.ts, with the `Result` collapsed because there is no
 * recoverable case to report.
 */
function guard<A>(caller: string, body: () => A): A {
  return rethrowPanics(Result.try(
    body,
    (cause) => new Panic(`${caller} failed: ${causeDetail(cause)}`, { cause }),
  )).unwrap();
}

/**
 * The two host functions signal subscription needs. Reaching them through a
 * narrow structural view rather than the ambient overloads keeps this module
 * independent of which host's `process` typings are loaded (Bun's and Node's
 * disagree about the event names they enumerate) while naming exactly the seam
 * this service depends on.
 */
interface SignalTarget {
  on(signal: string, listener: () => void): unknown;
  off(signal: string, listener: () => void): unknown;
}

const signalTarget = process as unknown as SignalTarget;

/** Node/Bun live implementation over the ambient `process` object. */
export class NodeProcess extends Process {
  static make(): NodeProcess {
    return new NodeProcess();
  }

  argv(): readonly string[] {
    // A frozen copy: the host array is live and mutable, and a caller must not
    // be able to edit the program's own argv through this reading.
    return Object.freeze(guard("NodeProcess.argv", () => [...process.argv]));
  }

  /**
   * Immediate termination, with `process.exit`'s documented consequence: writes
   * still queued on stdout/stderr may be lost. Flush before calling.
   */
  exit(code = 0): never {
    const status = assertExitCode(code, "NodeProcess.exit");
    guard("NodeProcess.exit", () => process.exit(status));
    // Unreachable on any host that honours `process.exit`; a host that returns
    // from it has broken the `never` contract, which is a panic, not a value.
    panic("NodeProcess.exit returned instead of terminating the host");
  }

  pid(): number {
    return guard("NodeProcess.pid", () => process.pid);
  }

  cwd(): string {
    // Throws ENOENT when the directory was removed underneath the process; the
    // guard turns that into a Panic rather than an escaping errno object.
    return guard("NodeProcess.cwd", () => process.cwd());
  }

  platform(): HostPlatform {
    return guard("NodeProcess.platform", () => process.platform);
  }

  onSignal(signal: Signal, handler: () => void): SignalSubscription {
    assertSignal(signal, "NodeProcess.onSignal");
    assertHandler(handler, "NodeProcess.onSignal");
    let disposed = false;
    // The listener is a wrapper, not the handler itself: the host may already
    // have queued a delivery when `dispose` runs, and a disposed subscription
    // must stay silent.
    const listener = (): void => {
      if (!disposed) handler();
    };
    guard("NodeProcess.onSignal", () => {
      signalTarget.on(signal, listener);
    });
    return {
      get disposed(): boolean {
        return disposed;
      },
      dispose(): void {
        if (disposed) return;
        disposed = true;
        guard("SignalSubscription.dispose", () => {
          signalTarget.off(signal, listener);
        });
      },
    };
  }
}

/**
 * The panic a `TestProcess` raises instead of terminating the test runner.
 *
 * `exit` must not return, so the double cannot merely record and continue: the
 * code after an `exit` call would run, which is precisely the bug an `exit`
 * assertion is trying to rule out. Recording *and* panicking keeps both halves
 * of the contract — `process.exits` has the code, and control never continues.
 * Catch it with `catchPanic`, or assert on the recording.
 */
export class ProcessExited extends Panic {
  constructor(
    readonly code: number,
    message = `Process.exit(${code}) was called under a TestProcess`,
  ) {
    super(message);
    this.name = "ProcessExited";
  }
}
export interface ProcessExited extends NominalError<"vibelang:ProcessExited@1"> {}

registerErrorCodec(ProcessExited, "vibelang:ProcessExited@1", {
  encode: (error): JsonValue => ({ code: error.code, message: error.message }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 2 ||
      typeof payload.code !== "number" || typeof payload.message !== "string"
    ) {
      throw new TypeError("invalid ProcessExited payload");
    }
    return new ProcessExited(payload.code, payload.message);
  },
});

export interface TestProcessOptions {
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly pid?: number;
  readonly platform?: HostPlatform;
}

const DEFAULT_TEST_ARGV: readonly string[] = ["/usr/bin/vibe", "/app/main.vibe"];
const DEFAULT_TEST_CWD = "/app";
const DEFAULT_TEST_PID = 4242;
const DEFAULT_TEST_PLATFORM: HostPlatform = "linux";

/**
 * Deterministic implementation. It reads nothing from the host: argv, pid, cwd,
 * and platform are whatever the test declared, exiting records instead of
 * terminating, and signals arrive only when the test sends one.
 */
export class TestProcess extends Process {
  #argv: readonly string[];
  #cwd: string;
  readonly #pid: number;
  readonly #platform: HostPlatform;
  readonly #exits: number[] = [];
  readonly #subscriptions = new Map<Signal, Array<() => void>>();

  private constructor(argv: readonly string[], cwd: string, pid: number, platform: HostPlatform) {
    super();
    this.#argv = argv;
    this.#cwd = cwd;
    this.#pid = pid;
    this.#platform = platform;
  }

  static make(options: TestProcessOptions = {}): TestProcess {
    const argv = options.argv ?? DEFAULT_TEST_ARGV;
    if (!Array.isArray(argv) || argv.some((entry) => typeof entry !== "string")) {
      panic("TestProcess.make argv option must be an array of strings");
    }
    if (options.cwd !== undefined && typeof options.cwd !== "string") {
      panic("TestProcess.make cwd option must be a string");
    }
    if (options.pid !== undefined && (!Number.isInteger(options.pid) || options.pid <= 0)) {
      panic("TestProcess.make pid option must be a positive integer");
    }
    return new TestProcess(
      Object.freeze([...argv]),
      options.cwd ?? DEFAULT_TEST_CWD,
      options.pid ?? DEFAULT_TEST_PID,
      options.platform ?? DEFAULT_TEST_PLATFORM,
    );
  }

  argv(): readonly string[] {
    return this.#argv;
  }

  pid(): number {
    return this.#pid;
  }

  cwd(): string {
    return this.#cwd;
  }

  platform(): HostPlatform {
    return this.#platform;
  }

  /** Move the recorded working directory, the way a host `chdir` would. */
  setCwd(directory: string): this {
    if (typeof directory !== "string" || directory.length === 0) {
      panic("TestProcess.setCwd requires a non-empty path");
    }
    this.#cwd = directory;
    return this;
  }

  /** Replace the recorded argument vector. */
  setArgv(argv: readonly string[]): this {
    if (!Array.isArray(argv) || argv.some((entry) => typeof entry !== "string")) {
      panic("TestProcess.setArgv requires an array of strings");
    }
    this.#argv = Object.freeze([...argv]);
    return this;
  }

  /** Every exit code requested, in order. Empty when the program never exited. */
  get exits(): readonly number[] {
    return Object.freeze([...this.#exits]);
  }

  /** The first requested exit code, if the program asked to exit at all. */
  exitCode(): Optional<number> {
    return this.#exits.length === 0 ? Optional.fromNullable<number>(undefined) : Optional.fromNullable(this.#exits[0]);
  }

  /** Records the code, then panics with {@link ProcessExited}; it never returns. */
  exit(code = 0): never {
    const status = assertExitCode(code, "TestProcess.exit");
    this.#exits.push(status);
    throw new ProcessExited(status);
  }

  onSignal(signal: Signal, handler: () => void): SignalSubscription {
    assertSignal(signal, "TestProcess.onSignal");
    assertHandler(handler, "TestProcess.onSignal");
    const handlers = this.#subscriptions.get(signal) ?? [];
    handlers.push(handler);
    this.#subscriptions.set(signal, handlers);
    let disposed = false;
    return {
      get disposed(): boolean {
        return disposed;
      },
      dispose: (): void => {
        if (disposed) return;
        disposed = true;
        const current = this.#subscriptions.get(signal);
        if (current === undefined) return;
        const index = current.indexOf(handler);
        if (index >= 0) current.splice(index, 1);
      },
    };
  }

  /** Deliver a signal to every live subscription, in registration order. */
  sendSignal(signal: Signal): number {
    assertSignal(signal, "TestProcess.sendSignal");
    // A copy: a handler may dispose itself or subscribe again during delivery.
    const handlers = [...(this.#subscriptions.get(signal) ?? [])];
    for (const handler of handlers) handler();
    return handlers.length;
  }

  /** How many live subscriptions a signal currently has. */
  subscriptions(signal: Signal): number {
    assertSignal(signal, "TestProcess.subscriptions");
    return this.#subscriptions.get(signal)?.length ?? 0;
  }
}
