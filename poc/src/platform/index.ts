/**
 * The standard platform capability library.
 *
 * Each service is an abstract class extending the runtime `Context`, so the
 * class is both the service contract and its nominal key. Callers reach an
 * implementation with `Service.context()`; a `Layer` supplies the one that the
 * current target provides. Every recoverable failure is an ordinary named
 * `Error` subclass carried in a `Result`, registered with a wire codec so it
 * survives a realm boundary.
 */

export { Clock, SystemClock, TestClock } from "./clock.ts";

// `Duration`, `Instant`, and `ConfigSpec` each export a type and a namespace of
// the same name, the way the runtime's `Result` and `Optional` do, so one
// re-export carries both meanings.
export { Config, ConfigError, ConfigSpecValue, InvalidConfig, MissingConfig } from "./config.ts";
export type { ConfigSpec } from "./config.ts";

export { Duration, DurationValue, MAX_DURATION_MILLIS } from "./duration.ts";

export { Instant, InvalidInstant, MAX_INSTANT, MIN_INSTANT } from "./instant.ts";

export { Console, RecordingConsole, SystemConsole } from "./console.ts";
export type { ConsoleEntry, ConsoleLevel, OutputStream, SystemConsoleOptions } from "./console.ts";

export { Environment, MapEnvironment, ProcessEnvironment } from "./environment.ts";

export {
  AlreadyExists,
  DirectoryNotEmpty,
  FileError,
  FileNotFound,
  FileSystemFailure,
  IsADirectory,
  NotADirectory,
  PermissionDenied,
  toFileError,
} from "./file-errors.ts";

export { FileSystem, InMemoryFileSystem, NodeFileSystem } from "./filesystem.ts";
export type { MkdirOptions, RemoveOptions } from "./filesystem.ts";

export {
  FetchHttpClient,
  HttpClient,
  HttpError,
  HttpResponse,
  InvalidUrl,
  MalformedResponse,
  RequestFailed,
  RequestTimeout,
  StubHttpClient,
  UnexpectedStatus,
} from "./http.ts";
export type {
  FetchHttpClientOptions,
  FetchLike,
  HttpMethod,
  HttpPostOptions,
  HttpRequestOptions,
  HttpResponseInit,
  StubRequest,
  StubRoute,
} from "./http.ts";

// `Path` exports a namespace of pure functions and no capability: manipulating a
// path is string arithmetic, and only `Path.forHost()` consults `Process`.
export { InvalidPath, Path } from "./path.ts";
export type { HostPath, ParsedPath, PathApi, PathStyle } from "./path.ts";

export { NodeProcess, Process, ProcessExited, TestProcess } from "./process.ts";
export type { HostPlatform, Signal, SignalSubscription, TestProcessOptions } from "./process.ts";

export { Random, SeededRandom, SystemRandom } from "./random.ts";

// `Schedule` exports a type and a namespace of the same name, like `Duration`.
// Provisional: the standard library lists the area but has not specified it.
export { Schedule, ScheduleValue, Sleeper, SystemSleeper, TestSleeper } from "./schedule.ts";
export type {
  DriverOptions,
  JitterBand,
  Operation,
  ScheduleDecision,
  ScheduleInfo,
  ScheduleState,
  SystemSleeperOptions,
  TestSleeperOptions,
  TimerLike,
} from "./schedule.ts";

export {
  AddressInUse,
  ConnectionClosed,
  ConnectionRefused,
  DEFAULT_MAX_BUFFERED_BYTES,
  MemorySocket,
  NodeSocket,
  ReceiveBufferOverflow,
  Socket,
  SocketError,
  SocketFailure,
  SocketTimeout,
  toSocketError,
} from "./socket.ts";
export type {
  ConnectOptions,
  ConnectionHandler,
  ListenOptions,
  MemorySocketOptions,
  SocketAddress,
  SocketConnection,
  SocketListener,
} from "./socket.ts";

export {
  InputClosed,
  NotInteractive,
  ScriptedTerminal,
  SystemTerminal,
  Terminal,
  TerminalError,
  TerminalFailure,
} from "./terminal.ts";
export type {
  ScriptedTerminalOptions,
  SystemTerminalOptions,
  TerminalInputStream,
  TerminalOutputStream,
  TerminalSize,
  TerminalStream,
} from "./terminal.ts";

export { NodePlatform, TestPlatform, nodePlatform, platformLayer } from "./layers.ts";
export type {
  NodePlatformOptions,
  PlatformCapability,
  PlatformLayer,
  PlatformServices,
  TestPlatformOptions,
  TestPlatformServices,
} from "./layers.ts";
