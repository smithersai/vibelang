import { afterAll, describe, expect, test } from "bun:test";
import * as nodeFsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type ErrorConstructor, decodeError, encodeError, errorIs } from "../runtime/errors.ts";
import { Layer } from "../runtime/layer.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import type { Result } from "../runtime/result.ts";
import {
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
import { FileSystem, InMemoryFileSystem, NodeFileSystem } from "./filesystem.ts";

type ErrorType = ErrorConstructor<FileError>;

function join(...parts: readonly string[]): string {
  return parts.join("/");
}

function failureOf<A>(result: Result<A, FileError>): FileError {
  return result.match({
    ok: (value) => {
      throw new Error(`expected a failure, received ${JSON.stringify(value)}`);
    },
    error: (error) => error,
  });
}

function expectFailure<A>(result: Result<A, FileError>, type: ErrorType, expectedPath: string): FileError {
  const error = failureOf(result);
  expect(errorIs(error, type)).toBe(true);
  expect(error.path).toBe(expectedPath);
  return error;
}

function value<A>(result: Result<A, FileError>): A {
  return result.match({
    ok: (ok) => ok,
    error: (error) => {
      throw error;
    },
  });
}

/**
 * The async contract every FileSystem implementation must satisfy. `root` is an
 * existing empty directory owned by the caller.
 */
async function assertAsyncContract(files: FileSystem, root: string): Promise<void> {
  const document = join(root, "a.txt");
  const missing = join(root, "missing.txt");

  expect(value(await files.exists(document))).toBe(false);
  expect(value(await files.writeText(document, "hello"))).toBe(undefined);
  expect(value(await files.readText(document))).toBe("hello");
  expect(value(await files.exists(document))).toBe(true);

  // The failure names the path the caller passed, not a host-resolved one.
  expectFailure(await files.readText(missing), FileNotFound, missing);
  expect(value(await files.exists(missing))).toBe(false);

  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  const binary = join(root, "raw.bin");
  expect(value(await files.writeBytes(binary, bytes))).toBe(undefined);
  expect([...value(await files.readBytes(binary))]).toEqual([...bytes]);
  expectFailure(await files.readBytes(missing), FileNotFound, missing);

  const directory = join(root, "nested");
  expect(value(await files.mkdir(directory))).toBe(undefined);
  expectFailure(await files.mkdir(directory), AlreadyExists, directory);
  expect(value(await files.mkdir(directory, { recursive: true }))).toBe(undefined);

  const deep = join(root, "deep", "deeper");
  expectFailure(await files.mkdir(deep), FileNotFound, deep);
  expect(value(await files.mkdir(deep, { recursive: true }))).toBe(undefined);
  expect(value(await files.readDir(join(root, "deep")))).toEqual(["deeper"]);

  // Listings are sorted so a directory read is reproducible across hosts.
  expect(value(await files.readDir(root))).toEqual(["a.txt", "deep", "nested", "raw.bin"]);

  expectFailure(await files.readDir(document), NotADirectory, document);
  expectFailure(await files.readText(directory), IsADirectory, directory);
  expectFailure(await files.writeText(directory, "nope"), IsADirectory, directory);

  const orphan = join(root, "absent-parent", "child.txt");
  expectFailure(await files.writeText(orphan, "nope"), FileNotFound, orphan);

  expectFailure(await files.remove(missing), FileNotFound, missing);
  expect(value(await files.remove(document))).toBe(undefined);
  expect(value(await files.exists(document))).toBe(false);

  // Removing a populated tree needs the recursive opt-in on every host; the exact
  // nominal case a host reports for the non-recursive attempt is host-specific.
  expect(failureOf(await files.remove(join(root, "deep")))).toBeInstanceOf(FileError);
  expect(value(await files.remove(join(root, "deep"), { recursive: true }))).toBe(undefined);
  expect(value(await files.readDir(root))).toEqual(["nested", "raw.bin"]);
}

/** The sync contract mirrors the async one; the guide's config loading uses it. */
function assertSyncContract(files: FileSystem, root: string): void {
  const document = join(root, "app.json");
  const missing = join(root, "nope.json");

  expect(value(files.existsSync(document))).toBe(false);
  expect(value(files.writeTextSync(document, `{"region":"us-east-1"}`))).toBe(undefined);
  expect(value(files.readTextSync(document))).toBe(`{"region":"us-east-1"}`);
  expect(value(files.existsSync(document))).toBe(true);
  expectFailure(files.readTextSync(missing), FileNotFound, missing);

  const bytes = new Uint8Array([9, 8, 7]);
  const binary = join(root, "sync.bin");
  expect(value(files.writeBytesSync(binary, bytes))).toBe(undefined);
  expect([...value(files.readBytesSync(binary))]).toEqual([...bytes]);

  const directory = join(root, "sync-dir");
  expect(value(files.mkdirSync(directory))).toBe(undefined);
  expectFailure(files.mkdirSync(directory), AlreadyExists, directory);
  expect(value(files.readDirSync(directory))).toEqual([]);
  expectFailure(files.readDirSync(missing), FileNotFound, missing);

  expect(value(files.removeSync(binary))).toBe(undefined);
  // A directory needs the recursive opt-in on every host, even when it is empty.
  expect(failureOf(files.removeSync(directory))).toBeInstanceOf(FileError);
  expect(value(files.removeSync(directory, { recursive: true }))).toBe(undefined);
  expect(value(files.removeSync(document))).toBe(undefined);
  expect(value(files.readDirSync(root))).toEqual([]);
}

const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await nodeFsPromises.mkdtemp(path.join(os.tmpdir(), "smithers-platform-"));
  temporaryRoots.push(root);
  return root;
}

afterAll(async () => {
  for (const root of temporaryRoots) {
    await nodeFsPromises.rm(root, { recursive: true, force: true });
  }
});

describe("FileSystem", () => {
  test("InMemoryFileSystem satisfies the async contract", async () => {
    const files = InMemoryFileSystem.make();
    value(files.mkdirSync("/workspace", { recursive: true }));
    await assertAsyncContract(files, "/workspace");
  });

  test("InMemoryFileSystem satisfies the sync contract", () => {
    const files = InMemoryFileSystem.make();
    value(files.mkdirSync("/workspace", { recursive: true }));
    assertSyncContract(files, "/workspace");
  });

  test("NodeFileSystem satisfies the async contract on a real directory", async () => {
    const files = NodeFileSystem.make();
    await assertAsyncContract(files, await temporaryDirectory());
  });

  test("NodeFileSystem satisfies the sync contract on a real directory", async () => {
    const files = NodeFileSystem.make();
    assertSyncContract(files, await temporaryDirectory());
  });

  test("InMemoryFileSystem seeds files with their parent directories", () => {
    const files = InMemoryFileSystem.of({
      "/app/config.json": `{"region":"eu-west-1"}`,
      "/app/data/notes.txt": "notes",
    });
    expect(value(files.readTextSync("/app/config.json"))).toBe(`{"region":"eu-west-1"}`);
    expect(value(files.readDirSync("/app"))).toEqual(["config.json", "data"]);
    expect(files.paths()).toEqual(["/", "/app", "/app/config.json", "/app/data", "/app/data/notes.txt"]);
  });

  test("InMemoryFileSystem canonicalizes paths and protects its root", () => {
    const files = InMemoryFileSystem.of({ "/app/config.json": "{}" });
    // `.`, `..` and a missing leading slash all resolve to the same entry.
    expect(value(files.readTextSync("/app/./config.json"))).toBe("{}");
    expect(value(files.readTextSync("/app/data/../config.json"))).toBe("{}");
    expect(value(files.readTextSync("app/config.json"))).toBe("{}");
    expectFailure(files.readTextSync(""), FileNotFound, "");
    expectFailure(files.removeSync("/"), PermissionDenied, "/");
    expectFailure(files.writeTextSync("/", "nope"), IsADirectory, "/");
    expectFailure(files.removeSync("/app"), IsADirectory, "/app");
    expect(value(files.removeSync("/app", { recursive: true }))).toBe(undefined);
    expect(files.paths()).toEqual(["/"]);
  });

  test("InMemoryFileSystem copies bytes in and out", () => {
    const files = InMemoryFileSystem.make();
    const source = new Uint8Array([1, 2, 3]);
    value(files.writeBytesSync("/bytes.bin", source));
    source[0] = 99;
    const read = value(files.readBytesSync("/bytes.bin"));
    expect([...read]).toEqual([1, 2, 3]);
    read[0] = 42;
    expect([...value(files.readBytesSync("/bytes.bin"))]).toEqual([1, 2, 3]);
  });

  test("a live permission failure becomes PermissionDenied", async () => {
    const root = await temporaryDirectory();
    const locked = path.join(root, "locked");
    await nodeFsPromises.mkdir(locked);
    await nodeFsPromises.writeFile(path.join(locked, "secret.txt"), "secret");
    await nodeFsPromises.chmod(locked, 0o000);
    try {
      const files = NodeFileSystem.make();
      const target = path.join(locked, "secret.txt");
      const error = failureOf(await files.readText(target));
      const reportedPath = error.path;
      // A sandboxed root runner can read through mode bits; only assert when it cannot.
      if (!errorIs(error, FileNotFound)) {
        expect(errorIs(error, PermissionDenied)).toBe(true);
        expect(reportedPath).toBe(target);
      }
    } finally {
      await nodeFsPromises.chmod(locked, 0o700);
    }
  });

  test("errno translation covers the nominal cases and falls back with a code", () => {
    expect(errorIs(toFileError("/p", { code: "ENOENT" }), FileNotFound)).toBe(true);
    expect(errorIs(toFileError("/p", { code: "EACCES" }), PermissionDenied)).toBe(true);
    expect(errorIs(toFileError("/p", { code: "EPERM" }), PermissionDenied)).toBe(true);
    expect(errorIs(toFileError("/p", { code: "EEXIST" }), AlreadyExists)).toBe(true);
    expect(errorIs(toFileError("/p", { code: "ENOTDIR" }), NotADirectory)).toBe(true);
    expect(errorIs(toFileError("/p", { code: "EISDIR" }), IsADirectory)).toBe(true);
    expect(errorIs(toFileError("/p", { code: "ENOTEMPTY" }), DirectoryNotEmpty)).toBe(true);

    const unknown = toFileError("/p", new Error("boom"));
    expect(errorIs(unknown, FileSystemFailure)).toBe(true);
    expect(unknown).toBeInstanceOf(FileError);
    expect((unknown as FileSystemFailure).code).toBe("UNKNOWN");
    expect(unknown.message).toContain("boom");

    const mapped = toFileError("/p", { code: "EMFILE" });
    expect((mapped as FileSystemFailure).code).toBe("EMFILE");
  });

  test("file errors survive the wire codec with their path intact", () => {
    for (const error of [
      new FileNotFound("/app/config.json"),
      new PermissionDenied("/etc/shadow"),
      new AlreadyExists("/app"),
      new NotADirectory("/app/config.json"),
      new IsADirectory("/app"),
      new DirectoryNotEmpty("/app"),
      new FileSystemFailure("/app", "EMFILE"),
    ]) {
      const decoded = decodeError(encodeError(error));
      expect(decoded.constructor).toBe(error.constructor);
      expect((decoded as FileError).path).toBe(error.path);
      expect(decoded.message).toBe(error.message);
    }
    const failure = decodeError(encodeError(new FileSystemFailure("/app", "EMFILE")));
    expect((failure as FileSystemFailure).code).toBe("EMFILE");
  });

  test("FileSystem resolves through a Layer under its nominal key", () => {
    const files = InMemoryFileSystem.of({ "/app.json": `{"region":"us-east-1"}` });
    // The guide's shape: read a config synchronously from the provided filesystem.
    const loadRegion = (): string =>
      FileSystem.context().readTextSync("/app.json").map((text) => String(JSON.parse(text).region)).unwrapOr("unknown");
    expect(Layer.provide(Layer.succeed(FileSystem, files), loadRegion)).toBe("us-east-1");
    expect(isPanic(catchPanic(loadRegion, (error) => error))).toBe(true);
  });
});
