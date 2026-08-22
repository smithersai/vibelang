import { Layer } from "../runtime/layer.ts";
import { Clock, SystemClock, TestClock } from "./clock.ts";
import { Console, RecordingConsole, SystemConsole } from "./console.ts";
import { Environment, MapEnvironment, ProcessEnvironment } from "./environment.ts";
import { FileSystem, InMemoryFileSystem, NodeFileSystem } from "./filesystem.ts";
import { FetchHttpClient, HttpClient, StubHttpClient } from "./http.ts";
import { type HostPlatform, NodeProcess, Process, TestProcess } from "./process.ts";
import { Random, SeededRandom, SystemRandom } from "./random.ts";
import { MemorySocket, NodeSocket, Socket } from "./socket.ts";
import { ScriptedTerminal, SystemTerminal, Terminal, type TerminalSize } from "./terminal.ts";

/**
 * The nominal keys every platform bundle provides.
 *
 * `Path` is deliberately absent: it is a namespace of pure functions, not a
 * capability, so nothing has to be provided for path manipulation to work.
 */
export type PlatformCapability =
  | typeof Clock
  | typeof Random
  | typeof Console
  | typeof Environment
  | typeof FileSystem
  | typeof HttpClient
  | typeof Process
  | typeof Terminal
  | typeof Socket;

export type PlatformLayer = Layer<PlatformCapability>;

export interface PlatformServices {
  readonly clock: Clock;
  readonly random: Random;
  readonly console: Console;
  readonly environment: Environment;
  readonly fileSystem: FileSystem;
  readonly http: HttpClient;
  /**
   * Added after the original six. They are optional so that a caller who
   * assembled a bundle by hand before they existed still compiles and still gets
   * exactly the environment it asked for; `nodePlatform` and `TestPlatform`
   * always supply all of them.
   */
  readonly process?: Process;
  readonly terminal?: Terminal;
  readonly socket?: Socket;
}

/** Package already constructed services into one environment. */
export function platformLayer(services: PlatformServices): PlatformLayer {
  const layers: PlatformLayer[] = [
    Layer.succeed(Clock, services.clock),
    Layer.succeed(Random, services.random),
    Layer.succeed(Console, services.console),
    Layer.succeed(Environment, services.environment),
    Layer.succeed(FileSystem, services.fileSystem),
    Layer.succeed(HttpClient, services.http),
  ];
  // Only what the caller supplied is provided: an absent optional service stays
  // unprovided, so reaching for it still fails closed rather than resolving a
  // default nobody chose.
  if (services.process !== undefined) layers.push(Layer.succeed(Process, services.process));
  if (services.terminal !== undefined) layers.push(Layer.succeed(Terminal, services.terminal));
  if (services.socket !== undefined) layers.push(Layer.succeed(Socket, services.socket));
  return Layer.merge(...layers);
}

export interface NodePlatformOptions extends Partial<PlatformServices> {}

/**
 * Live bundle. A Layer receives already acquired services and never owns their
 * lifetime, so every implementation here is constructed by the caller's `make`.
 */
export function nodePlatform(options: NodePlatformOptions = {}): PlatformLayer {
  return platformLayer({
    clock: options.clock ?? SystemClock.make(),
    random: options.random ?? SystemRandom.make(),
    console: options.console ?? SystemConsole.make(),
    environment: options.environment ?? ProcessEnvironment.make(),
    fileSystem: options.fileSystem ?? NodeFileSystem.make(),
    http: options.http ?? FetchHttpClient.make(),
    process: options.process ?? NodeProcess.make(),
    terminal: options.terminal ?? SystemTerminal.make(),
    socket: options.socket ?? NodeSocket.make(),
  });
}

/**
 * Default live environment. Every service in it is stateless with respect to the
 * program, so one shared instance is safe.
 */
export const NodePlatform: PlatformLayer = nodePlatform();

export interface TestPlatformOptions {
  /** ISO-8601 instant the TestClock starts at. */
  readonly now?: string;
  readonly seed?: number;
  readonly environment?: Readonly<Record<string, string>>;
  /** Text files to seed the InMemoryFileSystem with, keyed by path. */
  readonly files?: Readonly<Record<string, string>>;
  /** Argument vector the TestProcess reports. */
  readonly argv?: readonly string[];
  /** Working directory the TestProcess reports. */
  readonly cwd?: string;
  readonly pid?: number;
  /** Host the TestProcess reports; drives `Path.forHost()` style selection. */
  readonly platform?: HostPlatform;
  /** Lines the ScriptedTerminal hands out, in order. */
  readonly input?: readonly string[];
  /** Whether the scripted terminal reports as a TTY, and how big it is. */
  readonly tty?: boolean;
  readonly terminalSize?: TerminalSize;
  /** Cap on unread bytes for every in-memory socket connection. */
  readonly maxBufferedBytes?: number;
}

/** The deterministic bundle plus typed handles on each double, for assertions. */
export interface TestPlatformServices {
  readonly layer: PlatformLayer;
  readonly clock: TestClock;
  readonly random: SeededRandom;
  readonly console: RecordingConsole;
  readonly environment: MapEnvironment;
  readonly fileSystem: InMemoryFileSystem;
  readonly http: StubHttpClient;
  readonly process: TestProcess;
  readonly terminal: ScriptedTerminal;
  readonly socket: MemorySocket;
}

const DEFAULT_TEST_INSTANT = "2026-01-01T00:00:00.000Z";
const DEFAULT_TEST_SEED = 0x5eed;

/**
 * Deterministic bundle. This is a factory rather than a module-level constant
 * because every double carries mutable state; sharing one across tests would
 * leak recorded output and seeded files between them.
 */
export const TestPlatform = Object.freeze({
  make(options: TestPlatformOptions = {}): TestPlatformServices {
    const clock = TestClock.at(options.now ?? DEFAULT_TEST_INSTANT);
    const random = SeededRandom.withSeed(options.seed ?? DEFAULT_TEST_SEED);
    const console = RecordingConsole.make();
    const environment = MapEnvironment.of(options.environment ?? {});
    const fileSystem = InMemoryFileSystem.of(options.files ?? {});
    const http = StubHttpClient.make();
    const runningProcess = TestProcess.make({
      ...(options.argv === undefined ? {} : { argv: options.argv }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.pid === undefined ? {} : { pid: options.pid }),
      ...(options.platform === undefined ? {} : { platform: options.platform }),
    });
    const terminal = ScriptedTerminal.make({
      ...(options.input === undefined ? {} : { input: options.input }),
      ...(options.tty === undefined ? {} : { tty: options.tty }),
      ...(options.terminalSize === undefined ? {} : { size: options.terminalSize }),
    });
    const socket = MemorySocket.make(
      options.maxBufferedBytes === undefined ? {} : { maxBufferedBytes: options.maxBufferedBytes },
    );
    return Object.freeze({
      layer: platformLayer({
        clock,
        random,
        console,
        environment,
        fileSystem,
        http,
        process: runningProcess,
        terminal,
        socket,
      }),
      clock,
      random,
      console,
      environment,
      fileSystem,
      http,
      process: runningProcess,
      terminal,
      socket,
    });
  },
});
