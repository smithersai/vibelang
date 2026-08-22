import * as nodeFs from "node:fs";
import * as nodeFsPromises from "node:fs/promises";
import { errorIs } from "../runtime/errors.ts";
import { Context } from "../runtime/layer.ts";
import { Result, rethrowPanics } from "../runtime/result.ts";
import { RuntimeValues } from "../runtime/values.ts";
import {
  AlreadyExists,
  FileError,
  FileNotFound,
  IsADirectory,
  NotADirectory,
  PermissionDenied,
  toFileError,
} from "./file-errors.ts";

const { failure, success } = RuntimeValues;

export interface RemoveOptions {
  /**
   * Remove a directory and everything beneath it. Removing a directory without
   * this opt-in fails on every supported host, so it fails in the double too.
   */
  readonly recursive?: boolean;
}

export interface MkdirOptions {
  /** Create missing parents, and treat an existing directory as success. */
  readonly recursive?: boolean;
}

/**
 * Filesystem access. Every operation returns a `Result` in the nominal
 * `FileError` channel; nothing throws an errno object across the boundary.
 *
 * Both an async and a sync form of each operation exist. The async form is the
 * default for application code; the sync form matches the configuration-loading
 * shape the guide shows (`fs.readTextSync("app.json").unwrap()`) and keeps
 * comptime-style callers off the Promise channel entirely.
 */
export abstract class FileSystem extends Context {
  abstract readText(path: string): Promise<Result<string, FileError>>;
  abstract writeText(path: string, contents: string): Promise<Result<void, FileError>>;
  abstract readBytes(path: string): Promise<Result<Uint8Array, FileError>>;
  abstract writeBytes(path: string, contents: Uint8Array): Promise<Result<void, FileError>>;
  abstract exists(path: string): Promise<Result<boolean, FileError>>;
  abstract remove(path: string, options?: RemoveOptions): Promise<Result<void, FileError>>;
  abstract mkdir(path: string, options?: MkdirOptions): Promise<Result<void, FileError>>;
  /** Direct child names, sorted, without `.` or `..`. */
  abstract readDir(path: string): Promise<Result<readonly string[], FileError>>;

  abstract readTextSync(path: string): Result<string, FileError>;
  abstract writeTextSync(path: string, contents: string): Result<void, FileError>;
  abstract readBytesSync(path: string): Result<Uint8Array, FileError>;
  abstract writeBytesSync(path: string, contents: Uint8Array): Result<void, FileError>;
  abstract existsSync(path: string): Result<boolean, FileError>;
  abstract removeSync(path: string, options?: RemoveOptions): Result<void, FileError>;
  abstract mkdirSync(path: string, options?: MkdirOptions): Result<void, FileError>;
  abstract readDirSync(path: string): Result<readonly string[], FileError>;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** `exists` reports absence as `false`; only a real access failure is an error. */
function absenceIsFalse(result: Result<boolean, FileError>): Result<boolean, FileError> {
  return result.recover((error): Result<boolean, FileError> =>
    errorIs(error, FileNotFound) ? success(false) : failure(error)
  );
}

/** Node/Bun live implementation over `node:fs` and `node:fs/promises`. */
export class NodeFileSystem extends FileSystem {
  static make(): NodeFileSystem {
    return new NodeFileSystem();
  }

  async #attempt<A>(path: string, body: () => PromiseLike<A>): Promise<Result<A, FileError>> {
    return rethrowPanics(await Result.tryPromise(body, (cause) => toFileError(path, cause)));
  }

  #attemptSync<A>(path: string, body: () => A): Result<A, FileError> {
    return rethrowPanics(Result.try(body, (cause) => toFileError(path, cause)));
  }

  readText(path: string): Promise<Result<string, FileError>> {
    return this.#attempt(path, () => nodeFsPromises.readFile(path, "utf8"));
  }

  writeText(path: string, contents: string): Promise<Result<void, FileError>> {
    return this.#attempt(path, () => nodeFsPromises.writeFile(path, contents, "utf8"));
  }

  readBytes(path: string): Promise<Result<Uint8Array, FileError>> {
    // The Buffer is copied so the caller cannot observe Node's pooled memory.
    return this.#attempt(path, async () => new Uint8Array(await nodeFsPromises.readFile(path)));
  }

  writeBytes(path: string, contents: Uint8Array): Promise<Result<void, FileError>> {
    return this.#attempt(path, () => nodeFsPromises.writeFile(path, contents));
  }

  async exists(path: string): Promise<Result<boolean, FileError>> {
    return absenceIsFalse(await this.#attempt(path, async () => {
      await nodeFsPromises.stat(path);
      return true;
    }));
  }

  remove(path: string, options: RemoveOptions = {}): Promise<Result<void, FileError>> {
    return this.#attempt(path, () => nodeFsPromises.rm(path, { recursive: options.recursive === true }));
  }

  mkdir(path: string, options: MkdirOptions = {}): Promise<Result<void, FileError>> {
    return this.#attempt(path, async () => {
      await nodeFsPromises.mkdir(path, { recursive: options.recursive === true });
    });
  }

  readDir(path: string): Promise<Result<readonly string[], FileError>> {
    // Sorted so a directory listing is reproducible across hosts.
    return this.#attempt(path, async () => (await nodeFsPromises.readdir(path)).sort());
  }

  readTextSync(path: string): Result<string, FileError> {
    return this.#attemptSync(path, () => nodeFs.readFileSync(path, "utf8"));
  }

  writeTextSync(path: string, contents: string): Result<void, FileError> {
    return this.#attemptSync(path, () => nodeFs.writeFileSync(path, contents, "utf8"));
  }

  readBytesSync(path: string): Result<Uint8Array, FileError> {
    return this.#attemptSync(path, () => new Uint8Array(nodeFs.readFileSync(path)));
  }

  writeBytesSync(path: string, contents: Uint8Array): Result<void, FileError> {
    return this.#attemptSync(path, () => nodeFs.writeFileSync(path, contents));
  }

  existsSync(path: string): Result<boolean, FileError> {
    return absenceIsFalse(this.#attemptSync(path, () => {
      nodeFs.statSync(path);
      return true;
    }));
  }

  removeSync(path: string, options: RemoveOptions = {}): Result<void, FileError> {
    return this.#attemptSync(path, () => nodeFs.rmSync(path, { recursive: options.recursive === true }));
  }

  mkdirSync(path: string, options: MkdirOptions = {}): Result<void, FileError> {
    return this.#attemptSync(path, () => {
      nodeFs.mkdirSync(path, { recursive: options.recursive === true });
    });
  }

  readDirSync(path: string): Result<readonly string[], FileError> {
    return this.#attemptSync(path, () => nodeFs.readdirSync(path).sort());
  }
}

type MemoryNode =
  | { readonly kind: "file"; readonly data: Uint8Array }
  | { readonly kind: "directory" };

const ROOT = "/";

/**
 * POSIX-style canonicalization against an implicit root. Returns `undefined` for
 * a path the host would reject outright, which callers surface as `FileNotFound`
 * exactly as `node:fs` does for an empty path.
 */
function canonicalize(path: string): string | undefined {
  if (typeof path !== "string" || path.length === 0) return undefined;
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? ROOT : `/${segments.join("/")}`;
}

function parentOf(canonical: string): string {
  const index = canonical.lastIndexOf("/");
  return index <= 0 ? ROOT : canonical.slice(0, index);
}

function basenameOf(canonical: string): string {
  return canonical.slice(canonical.lastIndexOf("/") + 1);
}

/**
 * Deterministic implementation with the same nominal failure channel as the live
 * one: a missing parent is `FileNotFound`, writing over a directory is
 * `IsADirectory`, and a non-recursive `mkdir` over an existing entry is
 * `AlreadyExists`.
 */
export class InMemoryFileSystem extends FileSystem {
  readonly #nodes = new Map<string, MemoryNode>([[ROOT, { kind: "directory" }]]);

  private constructor() {
    super();
  }

  static make(): InMemoryFileSystem {
    return new InMemoryFileSystem();
  }

  /** Seed text files, creating each parent directory. */
  static of(files: Readonly<Record<string, string>>): InMemoryFileSystem {
    const filesystem = new InMemoryFileSystem();
    for (const [path, contents] of Object.entries(files)) {
      const canonical = canonicalize(path);
      if (canonical === undefined || canonical === ROOT) {
        throw new TypeError(`InMemoryFileSystem.of received an unusable path: ${JSON.stringify(path)}`);
      }
      filesystem.mkdirSync(parentOf(canonical), { recursive: true }).unwrap();
      filesystem.writeTextSync(canonical, contents).unwrap();
    }
    return filesystem;
  }

  /** Every canonical path currently present, sorted. Convenient in assertions. */
  paths(): readonly string[] {
    return [...this.#nodes.keys()].sort();
  }

  #node(path: string): Result<{ readonly canonical: string; readonly node: MemoryNode }, FileError> {
    const canonical = canonicalize(path);
    if (canonical === undefined) return failure(new FileNotFound(path));
    const node = this.#nodes.get(canonical);
    if (node === undefined) return failure(new FileNotFound(path));
    return success({ canonical, node });
  }

  #children(canonical: string): readonly string[] {
    const prefix = canonical === ROOT ? ROOT : `${canonical}/`;
    const names: string[] = [];
    for (const key of this.#nodes.keys()) {
      if (key === canonical) continue;
      if (key.startsWith(prefix) && parentOf(key) === canonical) names.push(basenameOf(key));
    }
    return names.sort();
  }

  #descendants(canonical: string): readonly string[] {
    const prefix = canonical === ROOT ? ROOT : `${canonical}/`;
    return [...this.#nodes.keys()].filter((key) => key !== canonical && key.startsWith(prefix));
  }

  // --- sync core -----------------------------------------------------------

  readBytesSync(path: string): Result<Uint8Array, FileError> {
    return this.#node(path).andThen(({ node }): Result<Uint8Array, FileError> =>
      node.kind === "directory"
        ? failure(new IsADirectory(path))
        : success(new Uint8Array(node.data))
    );
  }

  readTextSync(path: string): Result<string, FileError> {
    return this.readBytesSync(path).map((data) => decoder.decode(data));
  }

  writeBytesSync(path: string, contents: Uint8Array): Result<void, FileError> {
    const canonical = canonicalize(path);
    if (canonical === undefined) return failure(new FileNotFound(path));
    if (canonical === ROOT) return failure(new IsADirectory(path));
    const existing = this.#nodes.get(canonical);
    if (existing?.kind === "directory") return failure(new IsADirectory(path));
    const parent = this.#nodes.get(parentOf(canonical));
    if (parent === undefined) return failure(new FileNotFound(path));
    if (parent.kind !== "directory") return failure(new NotADirectory(path));
    this.#nodes.set(canonical, { kind: "file", data: new Uint8Array(contents) });
    return success(undefined);
  }

  writeTextSync(path: string, contents: string): Result<void, FileError> {
    return this.writeBytesSync(path, encoder.encode(contents));
  }

  existsSync(path: string): Result<boolean, FileError> {
    const canonical = canonicalize(path);
    return success(canonical !== undefined && this.#nodes.has(canonical));
  }

  removeSync(path: string, options: RemoveOptions = {}): Result<void, FileError> {
    const located = this.#node(path);
    return located.andThen(({ canonical, node }): Result<void, FileError> => {
      if (canonical === ROOT) return failure(new PermissionDenied(path, "Cannot remove the in-memory root"));
      if (node.kind === "directory") {
        // Every host requires the recursive opt-in to remove a directory at all,
        // empty or not; the double refuses it the same way.
        if (options.recursive !== true) return failure(new IsADirectory(path));
        for (const key of this.#descendants(canonical)) this.#nodes.delete(key);
      }
      this.#nodes.delete(canonical);
      return success(undefined);
    });
  }

  mkdirSync(path: string, options: MkdirOptions = {}): Result<void, FileError> {
    const canonical = canonicalize(path);
    if (canonical === undefined) return failure(new FileNotFound(path));
    const recursive = options.recursive === true;
    const existing = this.#nodes.get(canonical);
    if (existing !== undefined) {
      return recursive && existing.kind === "directory" ? success(undefined) : failure(new AlreadyExists(path));
    }
    if (!recursive) {
      const parent = this.#nodes.get(parentOf(canonical));
      if (parent === undefined) return failure(new FileNotFound(path));
      if (parent.kind !== "directory") return failure(new NotADirectory(path));
      this.#nodes.set(canonical, { kind: "directory" });
      return success(undefined);
    }
    let prefix = "";
    for (const segment of canonical.slice(1).split("/")) {
      prefix = `${prefix}/${segment}`;
      const node = this.#nodes.get(prefix);
      if (node === undefined) this.#nodes.set(prefix, { kind: "directory" });
      else if (node.kind !== "directory") return failure(new NotADirectory(path));
    }
    return success(undefined);
  }

  readDirSync(path: string): Result<readonly string[], FileError> {
    return this.#node(path).andThen(({ canonical, node }): Result<readonly string[], FileError> =>
      node.kind === "directory"
        ? success(this.#children(canonical))
        : failure(new NotADirectory(path))
    );
  }

  // --- async surface -------------------------------------------------------

  async readText(path: string): Promise<Result<string, FileError>> {
    return this.readTextSync(path);
  }

  async writeText(path: string, contents: string): Promise<Result<void, FileError>> {
    return this.writeTextSync(path, contents);
  }

  async readBytes(path: string): Promise<Result<Uint8Array, FileError>> {
    return this.readBytesSync(path);
  }

  async writeBytes(path: string, contents: Uint8Array): Promise<Result<void, FileError>> {
    return this.writeBytesSync(path, contents);
  }

  async exists(path: string): Promise<Result<boolean, FileError>> {
    return this.existsSync(path);
  }

  async remove(path: string, options: RemoveOptions = {}): Promise<Result<void, FileError>> {
    return this.removeSync(path, options);
  }

  async mkdir(path: string, options: MkdirOptions = {}): Promise<Result<void, FileError>> {
    return this.mkdirSync(path, options);
  }

  async readDir(path: string): Promise<Result<readonly string[], FileError>> {
    return this.readDirSync(path);
  }
}
