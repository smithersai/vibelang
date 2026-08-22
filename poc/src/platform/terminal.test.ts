import { PassThrough } from "node:stream";
import { describe, expect, test } from "bun:test";
import { type ErrorConstructor, decodeError, encodeError, errorIs } from "../runtime/errors.ts";
import { Layer } from "../runtime/layer.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import type { Result } from "../runtime/result.ts";
import { NodePlatform, TestPlatform } from "./layers.ts";
import {
  InputClosed,
  NotInteractive,
  ScriptedTerminal,
  SystemTerminal,
  Terminal,
  TerminalError,
  TerminalFailure,
  type TerminalStream,
} from "./terminal.ts";

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

function value<A>(result: Result<A, TerminalError>): A {
  return result.match({
    ok: (ok) => ok,
    error: (error) => {
      throw error;
    },
  });
}

function failureOf<A>(result: Result<A, TerminalError>): TerminalError {
  return result.match({
    ok: (ok) => {
      throw new Error(`expected a failure, received ${String(ok)}`);
    },
    error: (error) => error,
  });
}

/** A pipe that records everything written to it, standing in for a host stream. */
function recordingStream(extra: { isTTY?: boolean; columns?: number; rows?: number } = {}) {
  const stream = Object.assign(new PassThrough(), extra);
  const chunks: string[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  return { stream, chunks, text: (): string => chunks.join("") };
}

/** The contract every Terminal implementation satisfies. */
function assertTerminalContract(terminal: Terminal, expectations: { readonly tty: boolean }): void {
  expect(terminal.isTTY("input")).toBe(expectations.tty);
  expect(terminal.isTTY("output")).toBe(expectations.tty);
  expect(terminal.isTTY("error")).toBe(expectations.tty);
  expect(panics(() => terminal.isTTY("stdout" as TerminalStream))).toBe(true);

  terminal.write("progress: ");
  terminal.write("done\n");
  terminal.writeError("warning\n");
  expect(panics(() => terminal.write(1 as unknown as string))).toBe(true);
  expect(panics(() => terminal.writeError(null as unknown as string))).toBe(true);

  const size = terminal.size();
  expect(size.isSome() || size.isNone()).toBe(true);
}

describe("Terminal", () => {
  test("SystemTerminal satisfies the contract over injected host streams", () => {
    const output = recordingStream({ isTTY: true, columns: 100, rows: 30 });
    const error = recordingStream({ isTTY: true });
    const input = recordingStream({ isTTY: true });
    const terminal = SystemTerminal.make({ input: input.stream, output: output.stream, error: error.stream });

    assertTerminalContract(terminal, { tty: true });
    // `write` is raw: no level, no added newline. That is the Console boundary.
    expect(output.text()).toBe("progress: done\n");
    expect(error.text()).toBe("warning\n");

    const size = terminal.size();
    expect(size.unwrapOr({ columns: -1, rows: -1 })).toEqual({ columns: 100, rows: 30 });
  });

  test("ScriptedTerminal satisfies the contract and records everything", () => {
    const terminal = ScriptedTerminal.make({ tty: true, size: { columns: 100, rows: 30 } });
    assertTerminalContract(terminal, { tty: true });
    expect(terminal.text()).toBe("progress: done\n");
    expect(terminal.output).toEqual(["progress: ", "done\n"]);
    expect(terminal.errors).toEqual(["warning\n"]);
    expect(terminal.size().unwrapOr({ columns: -1, rows: -1 })).toEqual({ columns: 100, rows: 30 });

    terminal.clear();
    expect(terminal.output).toEqual([]);
    expect(terminal.errors).toEqual([]);
  });

  test("a non-terminal stream reports no TTY and no size", () => {
    const output = recordingStream();
    const live = SystemTerminal.make({ input: recordingStream().stream, output: output.stream, error: output.stream });
    expect(live.isTTY("output")).toBe(false);
    expect(live.size().isNone()).toBe(true);

    // The double defaults the same way a piped process does.
    const scripted = ScriptedTerminal.make();
    expect(scripted.isTTY("output")).toBe(false);
    expect(scripted.size().isNone()).toBe(true);

    scripted.setSize({ columns: 40, rows: 12 });
    expect(scripted.size().unwrapOr({ columns: -1, rows: -1 })).toEqual({ columns: 40, rows: 12 });
    expect(panics(() => scripted.setSize({ columns: 0, rows: 12 }))).toBe(true);
  });

  test("ScriptedTerminal hands out scripted lines, records prompts, then reports EOF", async () => {
    const terminal = ScriptedTerminal.make({ input: ["ada", "42"] });
    expect(value(await terminal.readLine("name? "))).toBe("ada");
    expect(value(await terminal.readLine("age? "))).toBe("42");
    expect(terminal.prompts).toEqual(["name? ", "age? "]);
    // The prompt is echoed exactly as a terminal would echo it.
    expect(terminal.text()).toBe("name? age? ");
    expect(terminal.pending).toEqual([]);

    const closed = failureOf(await terminal.readLine());
    expect(errorIs(closed, InputClosed)).toBe(true);
    expect(closed.stream).toBe("input");
    // An omitted prompt still records a slot, so prompts line up with reads.
    expect(terminal.prompts).toEqual(["name? ", "age? ", ""]);

    terminal.enqueue("more");
    expect(value(await terminal.readLine())).toBe("more");
    expect(panics(() => terminal.readLine(7 as unknown as string))).toBe(true);
  });

  test("SystemTerminal reads a real line through node:readline", async () => {
    const input = new PassThrough();
    const output = recordingStream();
    const terminal = SystemTerminal.make({ input, output: output.stream, error: output.stream });
    input.write("grace\n");
    const line = await terminal.readLine("name? ");
    expect(value(line)).toBe("grace");
    expect(output.text()).toContain("name? ");
  });

  test("SystemTerminal reports end-of-input as InputClosed rather than an empty line", async () => {
    const input = new PassThrough();
    const output = recordingStream();
    const terminal = SystemTerminal.make({ input, output: output.stream, error: output.stream });
    input.end();
    const closed = failureOf(await terminal.readLine());
    expect(errorIs(closed, InputClosed)).toBe(true);
    expect(errorIs(closed, TerminalError)).toBe(true);
  });

  test("an unreadable input stream is NotInteractive, not a host throw", async () => {
    const output = recordingStream();
    const terminal = SystemTerminal.make({
      input: {} as unknown as PassThrough,
      output: output.stream,
      error: output.stream,
    });
    const failure = failureOf(await terminal.readLine("? "));
    expect(errorIs(failure, NotInteractive)).toBe(true);
  });

  test("terminal errors are nominal and survive the wire codec", () => {
    for (const error of [new InputClosed(), new NotInteractive("output"), new TerminalFailure("error", "EIO")]) {
      const decoded = decodeError(encodeError(error));
      expect(decoded.constructor).toBe(error.constructor);
      expect((decoded as TerminalError).stream).toBe(error.stream);
      expect(decoded.message).toBe(error.message);
      expect(errorIs(decoded, TerminalError)).toBe(true);
    }
    const failure = decodeError(encodeError(new TerminalFailure("input", "EIO")));
    expect((failure as TerminalFailure).code).toBe("EIO");

    // Siblings do not match each other: the narrowing is nominal, not structural.
    const cases: ReadonlyArray<ErrorConstructor<TerminalError>> = [InputClosed, NotInteractive, TerminalFailure];
    expect(cases.filter((type) => errorIs(new InputClosed(), type))).toEqual([InputClosed]);
  });

  test("Terminal resolves through a Layer, and the bundles provide one", () => {
    const scripted = ScriptedTerminal.make({ input: ["yes"] });
    expect(Layer.provide(Layer.succeed(Terminal, scripted), () => Terminal.context())).toBe(scripted);
    expect(panics(() => Terminal.context())).toBe(true);

    const platform = TestPlatform.make({ input: ["yes"], tty: true, terminalSize: { columns: 80, rows: 24 } });
    const fromTest = Layer.provide(platform.layer, () => Terminal.context());
    expect(fromTest).toBe(platform.terminal);
    expect(fromTest.isTTY("output")).toBe(true);
    expect(fromTest.size().unwrapOr({ columns: -1, rows: -1 })).toEqual({ columns: 80, rows: 24 });

    expect(Layer.provide(NodePlatform, () => Terminal.context())).toBeInstanceOf(SystemTerminal);
  });
});
