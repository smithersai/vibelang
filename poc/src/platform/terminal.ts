/**
 * `Terminal`: the interactive console attached to the program.
 *
 * **Terminal vs Console.** `Console` is structured diagnostics — a level, a
 * message, and a recording double a test asserts on; `Terminal` is the raw
 * character device the user is sitting at: whether it is a TTY, how wide it is,
 * a line typed in answer to a prompt, and unstructured text written with no
 * level and no newline policy. Log through `Console`; talk to the person through
 * `Terminal`.
 *
 * Reading a line is the only operation that can fail recoverably (the input can
 * end, or not be interactive at all), so it is the only one returning a
 * `Result`. Writing and the TTY readings follow `Console`'s shape: a host throw
 * is a broken host, so the live implementation escalates it as a `Panic` through
 * the usual `rethrowPanics(Result.try(...))` guard rather than inventing a
 * failure case for it.
 */

import * as readline from "node:readline";
import { type JsonValue, type NominalError, registerErrorCodec } from "../runtime/errors.ts";
import { Context } from "../runtime/layer.ts";
import { Optional } from "../runtime/optional.ts";
import { Panic, panic } from "../runtime/panic.ts";
import { Result, rethrowPanics } from "../runtime/result.ts";
import { RuntimeValues } from "../runtime/values.ts";
import { causeDetail, errnoCode } from "./internal.ts";

const { failure, success } = RuntimeValues;

/** The three standard streams, named rather than passed as host objects. */
export type TerminalStream = "input" | "output" | "error";

const STREAMS: ReadonlySet<string> = new Set<TerminalStream>(["input", "output", "error"]);

/** One consistent reading of the terminal's dimensions, in character cells. */
export interface TerminalSize {
  readonly columns: number;
  readonly rows: number;
}

/** Base of the terminal failure channel; every case names the stream involved. */
export abstract class TerminalError extends Error {
  constructor(
    readonly stream: TerminalStream,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "TerminalError";
  }
}

/** The input stream reached end-of-file: there is no further line to read. */
export class InputClosed extends TerminalError {
  constructor(
    stream: TerminalStream = "input",
    message = "Terminal input is closed",
    options?: { readonly cause?: unknown },
  ) {
    super(stream, message, options);
    this.name = "InputClosed";
  }
}
export interface InputClosed extends NominalError<"smithers:InputClosed@1"> {}

/**
 * There is no interactive input to read at all — the double was given no script,
 * or the host stream is unreadable. Distinct from `InputClosed`, which means a
 * real stream ended.
 */
export class NotInteractive extends TerminalError {
  constructor(
    stream: TerminalStream = "input",
    message = "Terminal is not interactive",
    options?: { readonly cause?: unknown },
  ) {
    super(stream, message, options);
    this.name = "NotInteractive";
  }
}
export interface NotInteractive extends NominalError<"smithers:NotInteractive@1"> {}

/** Anything the host reported that has no dedicated nominal case. */
export class TerminalFailure extends TerminalError {
  constructor(
    stream: TerminalStream,
    readonly code: string,
    message = `Terminal operation failed (${code}) on ${stream}`,
    options?: { readonly cause?: unknown },
  ) {
    super(stream, message, options);
    this.name = "TerminalFailure";
  }
}
export interface TerminalFailure extends NominalError<"smithers:TerminalFailure@1"> {}

function decodeStream(value: JsonValue): TerminalStream {
  if (typeof value !== "string" || !STREAMS.has(value)) throw new TypeError("invalid TerminalError stream");
  return value as TerminalStream;
}

type StreamErrorConstructor = new (stream?: TerminalStream, message?: string) => TerminalError;

const streamErrors: ReadonlyArray<readonly [StreamErrorConstructor, string]> = [
  [InputClosed, "smithers:InputClosed@1"],
  [NotInteractive, "smithers:NotInteractive@1"],
];

for (const [type, id] of streamErrors) {
  registerErrorCodec(type, id, {
    encode: (error): JsonValue => ({ stream: error.stream, message: error.message }),
    decode: (payload) => {
      if (
        payload === null || Array.isArray(payload) || typeof payload !== "object" ||
        Object.keys(payload).length !== 2 || typeof payload.message !== "string"
      ) {
        throw new TypeError("invalid TerminalError payload");
      }
      return new type(decodeStream(payload.stream), payload.message);
    },
  });
}

registerErrorCodec(TerminalFailure, "smithers:TerminalFailure@1", {
  encode: (error): JsonValue => ({ stream: error.stream, code: error.code, message: error.message }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 3 ||
      typeof payload.code !== "string" || typeof payload.message !== "string"
    ) {
      throw new TypeError("invalid TerminalFailure payload");
    }
    return new TerminalFailure(decodeStream(payload.stream), payload.code, payload.message);
  },
});

/** The interactive terminal. */
export abstract class Terminal extends Context {
  /** Whether the named stream is attached to a terminal rather than a pipe or file. */
  abstract isTTY(stream: TerminalStream): boolean;

  /**
   * The terminal's dimensions, absent when the output is not a terminal. One
   * reading returns both numbers so a caller can never mix a stale width with a
   * fresh height across a resize.
   */
  abstract size(): Optional<TerminalSize>;

  /**
   * Read one line, without its newline. The prompt, when given, is written to
   * the output first. End-of-input is `InputClosed`, not an empty string.
   */
  abstract readLine(prompt?: string): Promise<Result<string, TerminalError>>;

  /** Write text verbatim to the output; no level, no added newline. */
  abstract write(text: string): void;

  /** Write text verbatim to the error stream. */
  abstract writeError(text: string): void;
}

function assertStream(stream: TerminalStream, caller: string): TerminalStream {
  if (typeof stream !== "string" || !STREAMS.has(stream)) {
    panic(`${caller} received an unknown stream: ${String(stream)}`);
  }
  return stream;
}

function assertText(text: string, caller: string): string {
  if (typeof text !== "string") panic(`${caller} requires a string`);
  return text;
}

function guard<A>(caller: string, body: () => A): A {
  return rethrowPanics(Result.try(
    body,
    (cause) => new Panic(`${caller} failed: ${causeDetail(cause)}`, { cause }),
  )).unwrap();
}

/** Minimal structural view of the host input stream this service reads. */
export interface TerminalInputStream {
  readonly isTTY?: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

/** Minimal structural view of a host output stream and its terminal geometry. */
export interface TerminalOutputStream {
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
  write(text: string): unknown;
}

export interface SystemTerminalOptions {
  readonly input?: TerminalInputStream;
  readonly output?: TerminalOutputStream;
  readonly error?: TerminalOutputStream;
}

function dimension(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Marker for "the interface closed before the question was answered". */
const INPUT_ENDED = Object.freeze({ terminalInputEnded: true });

/** Node/Bun live implementation over the host streams and `node:readline`. */
export class SystemTerminal extends Terminal {
  readonly #input: TerminalInputStream;
  readonly #output: TerminalOutputStream;
  readonly #error: TerminalOutputStream;

  private constructor(
    input: TerminalInputStream,
    output: TerminalOutputStream,
    error: TerminalOutputStream,
  ) {
    super();
    this.#input = input;
    this.#output = output;
    this.#error = error;
  }

  static make(options: SystemTerminalOptions = {}): SystemTerminal {
    return new SystemTerminal(
      options.input ?? process.stdin,
      options.output ?? process.stdout,
      options.error ?? process.stderr,
    );
  }

  #stream(stream: TerminalStream): TerminalInputStream | TerminalOutputStream {
    switch (assertStream(stream, "SystemTerminal")) {
      case "input":
        return this.#input;
      case "output":
        return this.#output;
      default:
        return this.#error;
    }
  }

  isTTY(stream: TerminalStream): boolean {
    return guard("SystemTerminal.isTTY", () => this.#stream(stream).isTTY === true);
  }

  size(): Optional<TerminalSize> {
    return guard("SystemTerminal.size", () => {
      const columns = dimension(this.#output.columns);
      const rows = dimension(this.#output.rows);
      return columns === undefined || rows === undefined
        ? Optional.fromNullable<TerminalSize>(undefined)
        : Optional.fromNullable(Object.freeze({ columns, rows }));
    });
  }

  /**
   * Not `async`: an unusable argument panics at the call site rather than inside
   * a rejected Promise, the way `TestSleeper.sleep` does.
   */
  readLine(prompt?: string): Promise<Result<string, TerminalError>> {
    if (prompt !== undefined) assertText(prompt, "SystemTerminal.readLine");
    const input = this.#input;
    const output = this.#output;
    if (typeof input?.on !== "function") {
      return Promise.resolve(failure(new NotInteractive("input", "Terminal input stream is unreadable")));
    }
    return this.#question(input, output, prompt ?? "");
  }

  async #question(
    input: TerminalInputStream,
    output: TerminalOutputStream,
    prompt: string,
  ): Promise<Result<string, TerminalError>> {
    return rethrowPanics(await Result.tryPromise(
      () =>
        new Promise<string>((resolve, reject) => {
          const face = readline.createInterface({
            input,
            output,
            terminal: input.isTTY === true,
          } as Parameters<typeof readline.createInterface>[0]);
          let answered = false;
          const finish = (settle: () => void): void => {
            answered = true;
            // Closing detaches the interface's listeners from the shared host
            // stream, so a later read starts from a clean state.
            face.close();
            settle();
          };
          face.on("error", (cause: unknown) => {
            if (!answered) finish(() => reject(cause));
          });
          // A stream that ends before an answer closes the interface; that is
          // end-of-input, not a host failure.
          face.once("close", () => {
            if (!answered) reject(INPUT_ENDED);
          });
          face.question(prompt, (answer: string) => {
            finish(() => resolve(answer));
          });
        }),
      (cause): TerminalError => {
        if (cause === INPUT_ENDED) return new InputClosed();
        const code = errnoCode(cause);
        return new TerminalFailure(
          "input",
          code ?? "UNKNOWN",
          `Terminal read failed (${code ?? "UNKNOWN"}): ${causeDetail(cause)}`,
          { cause },
        );
      },
    ));
  }

  write(text: string): void {
    const chunk = assertText(text, "SystemTerminal.write");
    guard("SystemTerminal.write", () => {
      this.#output.write(chunk);
    });
  }

  writeError(text: string): void {
    const chunk = assertText(text, "SystemTerminal.writeError");
    guard("SystemTerminal.writeError", () => {
      this.#error.write(chunk);
    });
  }
}

export interface ScriptedTerminalOptions {
  /** Lines `readLine` hands out, in order. */
  readonly input?: readonly string[];
  /** Which streams report as a TTY; a bare `true` means all three. */
  readonly tty?: boolean | Partial<Record<TerminalStream, boolean>>;
  /** The reported dimensions. Absent unless declared, like a piped stream. */
  readonly size?: TerminalSize;
}

function ttyFlags(option: ScriptedTerminalOptions["tty"]): Record<TerminalStream, boolean> {
  if (option === undefined) return { input: false, output: false, error: false };
  if (typeof option === "boolean") return { input: option, output: option, error: option };
  return {
    input: option.input === true,
    output: option.output === true,
    error: option.error === true,
  };
}

function assertSize(size: TerminalSize, caller: string): TerminalSize {
  if (
    size === null || typeof size !== "object" ||
    dimension(size.columns) === undefined || dimension(size.rows) === undefined
  ) {
    panic(`${caller} requires positive whole columns and rows`);
  }
  return Object.freeze({ columns: size.columns, rows: size.rows });
}

/**
 * Deterministic implementation: a scripted input queue and a recording of every
 * prompt and every byte written. It never touches a host stream, so a test that
 * drives an interactive flow neither blocks nor prints.
 */
export class ScriptedTerminal extends Terminal {
  readonly #input: string[];
  readonly #tty: Record<TerminalStream, boolean>;
  #size: TerminalSize | undefined;
  readonly #prompts: string[] = [];
  readonly #output: string[] = [];
  readonly #errors: string[] = [];

  private constructor(
    input: readonly string[],
    tty: Record<TerminalStream, boolean>,
    size: TerminalSize | undefined,
  ) {
    super();
    this.#input = [...input];
    this.#tty = tty;
    this.#size = size;
  }

  static make(options: ScriptedTerminalOptions = {}): ScriptedTerminal {
    const input = options.input ?? [];
    if (!Array.isArray(input) || input.some((line) => typeof line !== "string")) {
      panic("ScriptedTerminal.make input option must be an array of strings");
    }
    return new ScriptedTerminal(
      input,
      ttyFlags(options.tty),
      options.size === undefined ? undefined : assertSize(options.size, "ScriptedTerminal.make"),
    );
  }

  /** Add a line to the end of the scripted input. */
  enqueue(...lines: readonly string[]): this {
    for (const line of lines) this.#input.push(assertText(line, "ScriptedTerminal.enqueue"));
    return this;
  }

  /** Every prompt passed to `readLine`, in order; an omitted prompt records `""`. */
  get prompts(): readonly string[] {
    return Object.freeze([...this.#prompts]);
  }

  /** Every chunk written to the output, in order. */
  get output(): readonly string[] {
    return Object.freeze([...this.#output]);
  }

  /** Every chunk written to the error stream, in order. */
  get errors(): readonly string[] {
    return Object.freeze([...this.#errors]);
  }

  /** The output as one string, which is what most assertions want. */
  text(): string {
    return this.#output.join("");
  }

  /** Lines still waiting to be read. */
  get pending(): readonly string[] {
    return Object.freeze([...this.#input]);
  }

  /** Resize the terminal, as a host would on a window change. */
  setSize(size: TerminalSize): this {
    this.#size = assertSize(size, "ScriptedTerminal.setSize");
    return this;
  }

  clear(): this {
    this.#prompts.length = 0;
    this.#output.length = 0;
    this.#errors.length = 0;
    return this;
  }

  isTTY(stream: TerminalStream): boolean {
    return this.#tty[assertStream(stream, "ScriptedTerminal.isTTY")];
  }

  size(): Optional<TerminalSize> {
    return Optional.fromNullable(this.#size);
  }

  readLine(prompt?: string): Promise<Result<string, TerminalError>> {
    if (prompt !== undefined) assertText(prompt, "ScriptedTerminal.readLine");
    this.#prompts.push(prompt ?? "");
    // The prompt is echoed the way a real terminal echoes it, so a transcript
    // assertion sees the same bytes the user would.
    if (prompt !== undefined && prompt.length > 0) this.#output.push(prompt);
    if (this.#input.length === 0) return Promise.resolve(failure(new InputClosed()));
    return Promise.resolve(success(this.#input.shift() as string));
  }

  write(text: string): void {
    this.#output.push(assertText(text, "ScriptedTerminal.write"));
  }

  writeError(text: string): void {
    this.#errors.push(assertText(text, "ScriptedTerminal.writeError"));
  }
}
