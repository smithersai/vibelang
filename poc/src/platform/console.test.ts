import { describe, expect, test } from "bun:test";
import { Layer } from "../runtime/layer.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { Console, type OutputStream, RecordingConsole, SystemConsole } from "./console.ts";

class CapturingStream implements OutputStream {
  readonly chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
}

/** Contract every Console implementation must satisfy, exercised through the abstract type. */
function emitThroughContract(console: Console): void {
  console.info("started");
  console.warn("slow");
  console.error("failed");
}

describe("Console", () => {
  test("SystemConsole writes info to stdout and diagnostics to stderr", () => {
    const out = new CapturingStream();
    const err = new CapturingStream();
    const console: Console = SystemConsole.make({ out, err });
    emitThroughContract(console);
    // stdout stays a clean data channel; warnings and errors go to stderr.
    expect(out.chunks).toEqual(["started\n"]);
    expect(err.chunks).toEqual(["slow\n", "failed\n"]);
  });

  test("SystemConsole defaults to the process streams", () => {
    const console = SystemConsole.make();
    expect(console).toBeInstanceOf(Console);
    // Exercised without asserting on the real terminal, which the test host owns.
    expect(typeof console.info).toBe("function");
  });

  test("RecordingConsole captures level and order", () => {
    const console = RecordingConsole.make();
    emitThroughContract(console);
    expect(console.entries).toEqual([
      { level: "info", message: "started" },
      { level: "warn", message: "slow" },
      { level: "error", message: "failed" },
    ]);
    expect(console.messages()).toEqual(["started", "slow", "failed"]);
    expect(console.messages("error")).toEqual(["failed"]);
    // The returned view is a copy; pushing into it cannot forge an entry.
    (console.entries as { length: number }).length = 0;
    expect(console.messages()).toHaveLength(3);
    console.clear();
    expect(console.entries).toEqual([]);
  });

  test("Console resolves through a Layer under its nominal key", () => {
    const recording = RecordingConsole.make();
    const report = (message: string): void => {
      Console.context().info(message);
    };
    Layer.provide(Layer.succeed(Console, recording), () => report("through the layer"));
    expect(recording.messages("info")).toEqual(["through the layer"]);
    expect(isPanic(catchPanic(() => report("unscoped"), (error) => error))).toBe(true);
  });
});
