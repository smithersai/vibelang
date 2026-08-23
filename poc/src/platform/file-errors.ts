import { type JsonValue, registerErrorCodec, registerErrorType } from "../runtime/errors.ts";
import { causeDetail, errnoCode } from "./internal.ts";

/**
 * Base of the filesystem failure channel. It is an ordinary named `Error`
 * subclass — no tag factory, no `_tag` field — and every operation that can fail
 * declares `Result<A, FileError>`.
 */
export abstract class FileError extends Error {
  constructor(
    readonly path: string,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "FileError";
  }
}

registerErrorType(FileError, "smithers:FileError@1");

export class FileNotFound extends FileError {
  constructor(path: string, message = `No such file or directory: ${path}`, options?: { readonly cause?: unknown }) {
    super(path, message, options);
    this.name = "FileNotFound";
  }
}

export class PermissionDenied extends FileError {
  constructor(path: string, message = `Permission denied: ${path}`, options?: { readonly cause?: unknown }) {
    super(path, message, options);
    this.name = "PermissionDenied";
  }
}

export class AlreadyExists extends FileError {
  constructor(path: string, message = `Already exists: ${path}`, options?: { readonly cause?: unknown }) {
    super(path, message, options);
    this.name = "AlreadyExists";
  }
}

export class NotADirectory extends FileError {
  constructor(path: string, message = `Not a directory: ${path}`, options?: { readonly cause?: unknown }) {
    super(path, message, options);
    this.name = "NotADirectory";
  }
}

export class IsADirectory extends FileError {
  constructor(path: string, message = `Is a directory: ${path}`, options?: { readonly cause?: unknown }) {
    super(path, message, options);
    this.name = "IsADirectory";
  }
}

export class DirectoryNotEmpty extends FileError {
  constructor(path: string, message = `Directory not empty: ${path}`, options?: { readonly cause?: unknown }) {
    super(path, message, options);
    this.name = "DirectoryNotEmpty";
  }
}

/** Anything the host reported that has no dedicated nominal case; `code` keeps the errno. */
export class FileSystemFailure extends FileError {
  constructor(
    path: string,
    readonly code: string,
    message = `Filesystem operation failed (${code}): ${path}`,
    options?: { readonly cause?: unknown },
  ) {
    super(path, message, options);
    this.name = "FileSystemFailure";
  }
}

function pathPayload(error: FileError): JsonValue {
  return { path: error.path, message: error.message };
}

function decodePathPayload(payload: JsonValue): { readonly path: string; readonly message: string } {
  if (
    payload === null || Array.isArray(payload) || typeof payload !== "object" ||
    Object.keys(payload).length !== 2 ||
    typeof payload.path !== "string" || typeof payload.message !== "string"
  ) {
    throw new TypeError("invalid FileError payload");
  }
  return { path: payload.path, message: payload.message };
}

type PathErrorConstructor = new (path: string, message?: string) => FileError;

const pathErrors: ReadonlyArray<readonly [PathErrorConstructor, string]> = [
  [FileNotFound, "smithers:FileNotFound@1"],
  [PermissionDenied, "smithers:PermissionDenied@1"],
  [AlreadyExists, "smithers:AlreadyExists@1"],
  [NotADirectory, "smithers:NotADirectory@1"],
  [IsADirectory, "smithers:IsADirectory@1"],
  [DirectoryNotEmpty, "smithers:DirectoryNotEmpty@1"],
];

for (const [type, id] of pathErrors) {
  registerErrorCodec(type, id, {
    encode: pathPayload,
    decode: (payload) => {
      const { path, message } = decodePathPayload(payload);
      return new type(path, message);
    },
  });
}

registerErrorCodec(FileSystemFailure, "smithers:FileSystemFailure@1", {
  encode: (error): JsonValue => ({ path: error.path, code: error.code, message: error.message }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 3 ||
      typeof payload.path !== "string" || typeof payload.code !== "string" || typeof payload.message !== "string"
    ) {
      throw new TypeError("invalid FileSystemFailure payload");
    }
    return new FileSystemFailure(payload.path, payload.code, payload.message);
  },
});

/**
 * Translate a foreign `node:fs` rejection into the nominal channel. The path the
 * caller passed is preserved rather than the host's resolved path, so an error
 * always names the argument the caller can act on.
 */
export function toFileError(path: string, cause: unknown): FileError {
  switch (errnoCode(cause)) {
    case "ENOENT":
      return new FileNotFound(path, undefined, { cause });
    case "EACCES":
    case "EPERM":
      return new PermissionDenied(path, undefined, { cause });
    case "EEXIST":
      return new AlreadyExists(path, undefined, { cause });
    case "ENOTDIR":
      return new NotADirectory(path, undefined, { cause });
    case "EISDIR":
      return new IsADirectory(path, undefined, { cause });
    case "ENOTEMPTY":
      return new DirectoryNotEmpty(path, undefined, { cause });
    default: {
      const code = errnoCode(cause) ?? "UNKNOWN";
      return new FileSystemFailure(
        path,
        code,
        `Filesystem operation failed (${code}): ${path}: ${causeDetail(cause)}`,
        { cause },
      );
    }
  }
}
