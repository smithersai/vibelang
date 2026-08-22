import { Context } from "../runtime/layer.ts";

export type ConsoleLevel = "info" | "warn" | "error";

export interface ConsoleEntry {
  readonly level: ConsoleLevel;
  readonly message: string;
}

/**
 * Diagnostic output. The ambient `console` global is a host facility, so writing
 * a line is a capability rather than an unconditional import.
 */
export abstract class Console extends Context {
  abstract info(message: string): void;
  abstract warn(message: string): void;
  abstract error(message: string): void;
}

/** Minimal structural view of the Node streams this service writes to. */
export interface OutputStream {
  write(chunk: string): unknown;
}

export interface SystemConsoleOptions {
  readonly out?: OutputStream;
  readonly err?: OutputStream;
}

/**
 * Node/Bun live implementation. `info` goes to stdout; `warn` and `error` go to
 * stderr so a piped stdout stays a clean data channel.
 */
export class SystemConsole extends Console {
  readonly #out: OutputStream;
  readonly #err: OutputStream;

  private constructor(out: OutputStream, err: OutputStream) {
    super();
    this.#out = out;
    this.#err = err;
  }

  static make(options: SystemConsoleOptions = {}): SystemConsole {
    return new SystemConsole(options.out ?? process.stdout, options.err ?? process.stderr);
  }

  info(message: string): void {
    this.#out.write(`${message}\n`);
  }

  warn(message: string): void {
    this.#err.write(`${message}\n`);
  }

  error(message: string): void {
    this.#err.write(`${message}\n`);
  }
}

/** Deterministic implementation that captures every entry in order. */
export class RecordingConsole extends Console {
  readonly #entries: ConsoleEntry[] = [];

  private constructor() {
    super();
  }

  static make(): RecordingConsole {
    return new RecordingConsole();
  }

  get entries(): readonly ConsoleEntry[] {
    return this.#entries.slice();
  }

  /** Messages in order, optionally narrowed to one level. */
  messages(level?: ConsoleLevel): readonly string[] {
    return this.#entries
      .filter((entry) => level === undefined || entry.level === level)
      .map((entry) => entry.message);
  }

  clear(): this {
    this.#entries.length = 0;
    return this;
  }

  info(message: string): void {
    this.#entries.push(Object.freeze({ level: "info", message }));
  }

  warn(message: string): void {
    this.#entries.push(Object.freeze({ level: "warn", message }));
  }

  error(message: string): void {
    this.#entries.push(Object.freeze({ level: "error", message }));
  }
}
