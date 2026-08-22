import { describe, expect, test } from "bun:test";
import { decodeError, encodeError, errorIs } from "../runtime/errors.ts";
import { Layer } from "../runtime/layer.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { type Result, isResult } from "../runtime/result.ts";
import { TestPlatform } from "./layers.ts";
import { InvalidPath, type ParsedPath, Path } from "./path.ts";
import { Process, TestProcess } from "./process.ts";

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

function value<A>(result: Result<A, InvalidPath>): A {
  return result.match({
    ok: (ok) => ok,
    error: (error) => {
      throw error;
    },
  });
}

function failureOf<A>(result: Result<A, InvalidPath>): InvalidPath {
  return result.match({
    ok: (ok) => {
      throw new Error(`expected a failure, received ${String(ok)}`);
    },
    error: (error) => error,
  });
}

describe("Path", () => {
  test("the namespace is posix by default and names both styles explicitly", () => {
    expect(Path.style).toBe("posix");
    expect(Path.separator).toBe("/");
    expect(Path.delimiter).toBe(":");
    expect(Path.posix.style).toBe("posix");
    expect(Path.windows.style).toBe("windows");
    expect(Path.windows.separator).toBe("\\");
    expect(Path.windows.delimiter).toBe(";");
    expect(Path.forStyle("posix")).toBe(Path.posix);
    expect(Path.forStyle("windows")).toBe(Path.windows);
    expect(panics(() => Path.forStyle("dos" as "posix"))).toBe(true);
  });

  test("path manipulation is pure: it needs no Layer and no capability", () => {
    // Every other platform service panics outside a scope. These do not, which
    // is the whole point of keeping Path out of the capability roster.
    expect(Path.join("etc", "hosts")).toBe("etc/hosts");
    expect(Path.normalize("/var/./log/../run")).toBe("/var/run");
    expect(Path.basename("/tmp/report.json")).toBe("report.json");
  });

  test("normalize folds . and .., collapses separators, and drops trailing ones", () => {
    expect(Path.normalize("")).toBe(".");
    expect(Path.normalize(".")).toBe(".");
    expect(Path.normalize("/")).toBe("/");
    expect(Path.normalize("/a/b/")).toBe("/a/b");
    expect(Path.normalize("/a/b///c")).toBe("/a/b/c");
    expect(Path.normalize("//a//b")).toBe("/a/b");
    expect(Path.normalize("/a/./b/../c")).toBe("/a/c");
    expect(Path.normalize("a/../..")).toBe("..");
    expect(Path.normalize("../../a")).toBe("../../a");
    // A root has no parent: climbing past it is a no-op, not an escape.
    expect(Path.normalize("/../../a")).toBe("/a");
    expect(Path.normalize("a/b/")).toBe("a/b");
  });

  test("join concatenates then normalizes, and skips empty segments", () => {
    expect(Path.join("a", "b")).toBe("a/b");
    expect(Path.join("/a", "b/", "c")).toBe("/a/b/c");
    expect(Path.join("a", "", "b")).toBe("a/b");
    expect(Path.join()).toBe(".");
    expect(Path.join("")).toBe(".");
    expect(Path.join("a", "../b")).toBe("b");
    expect(Path.join("/", "etc")).toBe("/etc");
  });

  test("resolve is lexical: the last rooted segment wins and no cwd is consulted", () => {
    expect(Path.resolve("/a", "b")).toBe("/a/b");
    expect(Path.resolve("/a", "/b", "c")).toBe("/b/c");
    expect(Path.resolve("a", "b")).toBe("a/b");
    // Nothing absolute in, nothing absolute out — a pure function has no cwd.
    expect(Path.resolve("a", "../b")).toBe("b");
    expect(Path.resolve()).toBe(".");
    expect(Path.isAbsolute(Path.resolve("relative", "path"))).toBe(false);
  });

  test("isAbsolute, dirname, basename, and extname", () => {
    expect(Path.isAbsolute("/etc")).toBe(true);
    expect(Path.isAbsolute("etc")).toBe(false);
    expect(Path.isAbsolute("")).toBe(false);

    expect(Path.dirname("/a/b/c")).toBe("/a/b");
    expect(Path.dirname("/a")).toBe("/");
    expect(Path.dirname("/")).toBe("/");
    expect(Path.dirname("a")).toBe(".");
    expect(Path.dirname("a/b/")).toBe("a");

    expect(Path.basename("/a/b.txt")).toBe("b.txt");
    expect(Path.basename("/a/b/")).toBe("b");
    expect(Path.basename("/")).toBe("");
    expect(Path.basename("/a/b.txt", ".txt")).toBe("b");
    // Stripping a suffix never empties the name.
    expect(Path.basename("/a/.txt", ".txt")).toBe(".txt");

    expect(Path.extname("archive.tar.gz")).toBe(".gz");
    expect(Path.extname("/a/b.txt")).toBe(".txt");
    expect(Path.extname("noext")).toBe("");
    // A leading dot marks a hidden file; it is not an extension.
    expect(Path.extname(".gitignore")).toBe("");
  });

  test("split reports the root as its own segment", () => {
    expect(Path.split("/a/b")).toEqual(["/", "a", "b"]);
    expect(Path.split("a/b/../c")).toEqual(["a", "c"]);
    expect(Path.split("/")).toEqual(["/"]);
    expect(Path.split(".")).toEqual([]);
    expect(Object.isFrozen(Path.split("/a"))).toBe(true);
  });

  test("relative is lexical and total, even across unrelated roots", () => {
    expect(Path.relative("/a/b", "/a/c")).toBe("../c");
    expect(Path.relative("/a", "/a/b/c")).toBe("b/c");
    expect(Path.relative("/a/b/c", "/a")).toBe("../..");
    expect(Path.relative("/a", "/a")).toBe("");
    expect(Path.relative("a/b", "a/c")).toBe("../c");
    // Absolute and relative share no lexical ancestry: the destination stands.
    expect(Path.relative("a", "/a")).toBe("/a");
    expect(Path.relative("/a", "a")).toBe("a");
  });

  test("parse and format round-trip, and parse rejects unusable text", () => {
    const parsed = value(Path.parse("/home/ada/notes.md"));
    expect(parsed).toEqual({
      root: "/",
      dir: "/home/ada",
      base: "notes.md",
      name: "notes",
      ext: ".md",
      absolute: true,
    });
    expect(Path.format(parsed)).toBe("/home/ada/notes.md");
    expect(Path.format(value(Path.parse("/a")))).toBe("/a");
    expect(Path.format(value(Path.parse("rel/a.txt")))).toBe("rel/a.txt");
    // `format` also accepts name+ext instead of base, as callers expect.
    expect(Path.format({ root: "/", dir: "/x", base: "", name: "y", ext: ".z", absolute: true })).toBe("/x/y.z");

    expect(isResult(Path.parse("/a"))).toBe(true);
    const empty = failureOf(Path.parse(""));
    expect(errorIs(empty, InvalidPath)).toBe(true);
    expect(empty.reason).toBe("empty");
    expect(failureOf(Path.parse("a\0b")).reason).toBe("contains a NUL character");
  });

  test("windows style understands drives, UNC roots, and case-insensitive comparison", () => {
    const windows = Path.windows;
    expect(windows.normalize("C:\\a\\b\\..")).toBe("C:\\a");
    expect(windows.normalize("c:/temp/./x")).toBe("C:\\temp\\x");
    expect(windows.isAbsolute("C:\\")).toBe(true);
    // `C:foo` is drive-relative: rooted on a drive, but not absolute.
    expect(windows.isAbsolute("C:foo")).toBe(false);
    expect(windows.normalize("C:foo\\bar")).toBe("C:foo\\bar");
    expect(windows.join("C:", "foo")).toBe("C:foo");
    expect(windows.isAbsolute("\\a")).toBe(true);

    expect(windows.normalize("\\\\srv\\share\\a\\..\\b")).toBe("\\\\srv\\share\\b");
    // A share root is opaque: `..` cannot climb out of it.
    expect(windows.normalize("\\\\srv\\share\\..\\..")).toBe("\\\\srv\\share\\");
    expect(windows.split("\\\\srv\\share\\a")).toEqual(["\\\\srv\\share\\", "a"]);

    expect(windows.dirname("C:\\a\\b.txt")).toBe("C:\\a");
    expect(windows.basename("C:\\a\\b.txt")).toBe("b.txt");
    expect(windows.extname("C:\\a\\b.txt")).toBe(".txt");
    expect(windows.relative("C:\\a\\B", "C:\\A\\b\\c")).toBe("c");
    expect(windows.relative("C:\\a", "D:\\a")).toBe("D:\\a");
    const parsed: ParsedPath = value(windows.parse("C:\\a\\b.txt"));
    expect(parsed.root).toBe("C:\\");
    expect(windows.format(parsed)).toBe("C:\\a\\b.txt");
  });

  test("toStyle rewrites separators between the two grammars", () => {
    expect(Path.toStyle("a/b", "windows")).toBe("a\\b");
    expect(Path.toStyle("a/b", "posix")).toBe("a/b");
    expect(Path.windows.toStyle("C:\\a\\b", "posix")).toBe("C:/a/b");
    expect(panics(() => Path.toStyle("a", "dos" as "posix"))).toBe(true);
  });

  test("a non-string argument is a programming error and panics", () => {
    expect(panics(() => Path.join(1 as unknown as string))).toBe(true);
    expect(panics(() => Path.normalize(undefined as unknown as string))).toBe(true);
    expect(panics(() => Path.basename(null as unknown as string))).toBe(true);
    expect(panics(() => Path.parse(7 as unknown as string))).toBe(true);
    expect(panics(() => Path.format(null as unknown as ParsedPath))).toBe(true);
  });

  test("forHost reads the style and working directory through Process", () => {
    const posixPlatform = TestPlatform.make({ platform: "linux", cwd: "/srv/app" });
    const host = Layer.provide(posixPlatform.layer, () => Path.forHost());
    expect(host.style).toBe("posix");
    expect(host.path).toBe(Path.posix);
    expect(host.cwd()).toBe("/srv/app");
    expect(host.resolve("logs", "today.txt")).toBe("/srv/app/logs/today.txt");
    expect(host.resolve("/etc/hosts")).toBe("/etc/hosts");
    expect(host.relativeToCwd("/srv/app/logs")).toBe("logs");

    const windowsPlatform = TestPlatform.make({ platform: "win32", cwd: "C:\\app" });
    const windowsHost = Layer.provide(windowsPlatform.layer, () => Path.forHost());
    expect(windowsHost.style).toBe("windows");
    expect(windowsHost.resolve("logs")).toBe("C:\\app\\logs");

    // The reading is live: a later chdir is visible to the same handle.
    posixPlatform.process.setCwd("/srv/other");
    expect(host.resolve("x")).toBe("/srv/other/x");
  });

  test("forHost is the one member with a requirement, and fails closed without it", () => {
    expect(panics(() => Path.forHost())).toBe(true);
    const withProcess = Layer.succeed(Process, TestProcess.make({ platform: "darwin", cwd: "/Users/ada" }));
    expect(Layer.provide(withProcess, () => Path.forHost().resolve("code"))).toBe("/Users/ada/code");
  });

  test("InvalidPath survives the wire codec", () => {
    const error = new InvalidPath("a\0b", "contains a NUL character");
    const decoded = decodeError(encodeError(error));
    expect(decoded.constructor).toBe(InvalidPath);
    expect((decoded as InvalidPath).path).toBe("a\0b");
    expect((decoded as InvalidPath).reason).toBe("contains a NUL character");
    expect(decoded.message).toBe(error.message);
  });
});
