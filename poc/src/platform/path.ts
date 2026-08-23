/**
 * `Path`: pure lexical path manipulation.
 *
 * **Why this module has no capability.** Every other entry in the platform
 * roster reaches the host: `FileSystem` touches the disk, `Process` reads the
 * running program, `Clock` reads time. Path manipulation touches none of them —
 * joining, normalizing, and taking a basename are string operations over a
 * documented grammar, exactly as `Duration` arithmetic is number arithmetic. The
 * split that runs through `Duration`/`Clock` and `ConfigSpec`/`Environment` runs
 * through here too: *describing* a path is pure, and only *resolving one against
 * the host* — its working directory, its separator convention — needs authority.
 * So this module is a namespace of total functions, not a `Context` class, and
 * a function that only manipulates paths gains no requirement by doing so.
 *
 * Consequences, all deliberate:
 *
 * - **Nothing here reads `process.platform`.** A pure function that silently
 *   changed meaning with the host would make every path-handling test
 *   host-dependent and every cross-compilation result unreproducible. The style
 *   is an explicit choice instead: `Path.*` is **posix** semantics, `Path.posix`
 *   and `Path.windows` name the two styles, and `Path.forHost()` is the one
 *   convenience that consults the host — through the `Process` capability, so
 *   the requirement is visible in the caller's inferred context row.
 * - **Posix is the portable default.** Forward slashes are accepted by every
 *   host including Windows, are what URLs, archives, and manifests carry, and
 *   are what a program should be emitting unless it is talking to a Windows
 *   shell.
 * - **Nothing here touches the filesystem.** `resolve` is lexical: it never
 *   consults a working directory, never follows a symlink, and never asks
 *   whether a path exists. A `..` segment is removed textually, which is *not*
 *   what a kernel does across a symlink; that is the price of purity and the
 *   reason this module cannot be used to prove containment of an untrusted path.
 * - **Total, with one exception.** Every function returns a string, a boolean,
 *   or a list, for every string input; there is no failure channel to thread.
 *   Only `parse` can fail, because "is this text a usable path at all" is a real
 *   question with a recoverable answer (`InvalidPath`). A non-string argument is
 *   a programming error and panics, as it does in `Duration` and `Instant`.
 * - **Normalization drops trailing separators.** `"/a/b/"` and `"/a/b"` are the
 *   same location, so they normalize to the same string and compare equal.
 */

import { type JsonValue, type NominalError, registerErrorCodec } from "../runtime/errors.ts";
import { panic } from "../runtime/panic.ts";
import type { Result } from "../runtime/result.ts";
import { RuntimeValues } from "../runtime/values.ts";
import { type HostPlatform, Process } from "./process.ts";

const { failure, success } = RuntimeValues;

/** Which grammar a path is read and written with. */
export type PathStyle = "posix" | "windows";

/** Text that cannot be a path on any host. */
export class InvalidPath extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
    message = `Not a usable path (${reason}): ${JSON.stringify(path)}`,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "InvalidPath";
  }
}
export interface InvalidPath extends NominalError<"smithers:InvalidPath@1"> {}

registerErrorCodec(InvalidPath, "smithers:InvalidPath@1", {
  encode: (error): JsonValue => ({ path: error.path, reason: error.reason, message: error.message }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 3 ||
      typeof payload.path !== "string" || typeof payload.reason !== "string" ||
      typeof payload.message !== "string"
    ) {
      throw new TypeError("invalid InvalidPath payload");
    }
    return new InvalidPath(payload.path, payload.reason, payload.message);
  },
});

/** The five parts `parse` reports, in Node's long-standing shape plus `absolute`. */
export interface ParsedPath {
  /** `"/"`, `"C:\\"`, `"\\\\server\\share\\"`, or `""` for a relative path. */
  readonly root: string;
  /** Everything before the final segment, root included. */
  readonly dir: string;
  /** The final segment, extension included. */
  readonly base: string;
  /** The final segment without its extension. */
  readonly name: string;
  /** The final extension, leading dot included, or `""`. */
  readonly ext: string;
  readonly absolute: boolean;
}

/** The pure operations, in one style. */
export interface PathApi {
  readonly style: PathStyle;
  /** The separator this style writes: `"/"` or `"\\"`. */
  readonly separator: string;
  /** The separator that divides entries in a host path list: `":"` or `";"`. */
  readonly delimiter: string;
  join(...segments: readonly string[]): string;
  normalize(path: string): string;
  /** Lexical `resolve`: the last rooted segment wins; no working directory is consulted. */
  resolve(...segments: readonly string[]): string;
  isAbsolute(path: string): boolean;
  dirname(path: string): string;
  basename(path: string, suffix?: string): string;
  extname(path: string): string;
  /** Lexical relative path from one location to another. */
  relative(from: string, to: string): string;
  /** The normalized segments; the root, when there is one, is the first element. */
  split(path: string): readonly string[];
  parse(path: string): Result<ParsedPath, InvalidPath>;
  format(parsed: ParsedPath): string;
  /** Rewrite a path of this style into the other style's separators. */
  toStyle(path: string, style: PathStyle): string;
}

interface RootSplit {
  readonly root: string;
  readonly rest: string;
  readonly absolute: boolean;
}

function assertPath(value: string, caller: string): string {
  if (typeof value !== "string") panic(`${caller} requires a path string`);
  return value;
}

const POSIX_SEPARATOR = "/";
const WINDOWS_SEPARATOR = "\\";
const DRIVE = /^[A-Za-z]:/;

function isPosixSeparator(character: string): boolean {
  return character === "/";
}

function isWindowsSeparator(character: string): boolean {
  return character === "/" || character === "\\";
}

function splitPosixRoot(path: string): RootSplit {
  // A leading `//` is implementation-defined in POSIX; it is folded into a
  // single root here so that `//a` and `/a` compare equal.
  return isPosixSeparator(path.charAt(0))
    ? { root: POSIX_SEPARATOR, rest: path.slice(1), absolute: true }
    : { root: "", rest: path, absolute: false };
}

function splitWindowsRoot(path: string): RootSplit {
  if (isWindowsSeparator(path.charAt(0)) && isWindowsSeparator(path.charAt(1))) {
    // UNC: `\\server\share\...`. Server and share belong to the root; the root
    // is opaque afterwards, so `..` can never climb out of a share.
    let index = 2;
    while (index < path.length && !isWindowsSeparator(path.charAt(index))) index += 1;
    const server = path.slice(2, index);
    while (index < path.length && isWindowsSeparator(path.charAt(index))) index += 1;
    const shareStart = index;
    while (index < path.length && !isWindowsSeparator(path.charAt(index))) index += 1;
    const share = path.slice(shareStart, index);
    if (server.length === 0) return { root: WINDOWS_SEPARATOR, rest: path.slice(2), absolute: true };
    const root = share.length === 0
      ? `\\\\${server}`
      : `\\\\${server}\\${share}\\`;
    return { root, rest: path.slice(index), absolute: true };
  }
  if (DRIVE.test(path)) {
    const drive = `${path.charAt(0).toUpperCase()}:`;
    if (isWindowsSeparator(path.charAt(2))) {
      return { root: `${drive}\\`, rest: path.slice(3), absolute: true };
    }
    // `C:foo` is drive-relative: rooted on a drive, but not absolute.
    return { root: drive, rest: path.slice(2), absolute: false };
  }
  if (isWindowsSeparator(path.charAt(0))) {
    return { root: WINDOWS_SEPARATOR, rest: path.slice(1), absolute: true };
  }
  return { root: "", rest: path, absolute: false };
}

/**
 * Fold `.` and `..` out of a segment list. `..` above a root disappears (a root
 * has no parent); `..` above a relative path is kept, because `../a` is a real
 * location that nothing lexical can simplify further.
 */
function foldSegments(segments: readonly string[], rooted: boolean): string[] {
  const folded: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      const last = folded[folded.length - 1];
      if (folded.length > 0 && last !== "..") folded.pop();
      else if (!rooted) folded.push("..");
      continue;
    }
    folded.push(segment);
  }
  return folded;
}

function makeApi(style: PathStyle): PathApi {
  const windows = style === "windows";
  const separator = windows ? WINDOWS_SEPARATOR : POSIX_SEPARATOR;
  const delimiter = windows ? ";" : ":";
  const isSeparator = windows ? isWindowsSeparator : isPosixSeparator;
  const splitRoot = windows ? splitWindowsRoot : splitPosixRoot;
  const segmentPattern = windows ? /[\\/]/ : /\//;

  function segmentsOf(rest: string): string[] {
    return rest.length === 0 ? [] : rest.split(segmentPattern);
  }

  function render(root: string, folded: readonly string[], absolute: boolean): string {
    if (folded.length === 0) return absolute ? root : `${root}.`;
    return `${root}${folded.join(separator)}`;
  }

  function normalize(path: string): string {
    const text = assertPath(path, "Path.normalize");
    if (text.length === 0) return ".";
    const { root, rest, absolute } = splitRoot(text);
    return render(root, foldSegments(segmentsOf(rest), root.length > 0), absolute);
  }

  function isAbsolute(path: string): boolean {
    return splitRoot(assertPath(path, "Path.isAbsolute")).absolute;
  }

  function join(...segments: readonly string[]): string {
    let joined = "";
    for (const segment of segments) {
      assertPath(segment, "Path.join");
      if (segment.length === 0) continue;
      if (joined.length === 0) joined = segment;
      // `C:` + `foo` stays drive-relative rather than becoming absolute.
      else if (windows && /^[A-Za-z]:$/.test(joined)) joined += segment;
      else joined += separator + segment;
    }
    return joined.length === 0 ? "." : normalize(joined);
  }

  function resolve(...segments: readonly string[]): string {
    let accumulated = "";
    for (const segment of segments) {
      assertPath(segment, "Path.resolve");
      if (segment.length === 0) continue;
      // A rooted segment discards everything to its left, exactly as a host
      // `resolve` does — the difference is only that nothing supplies a cwd.
      accumulated = splitRoot(segment).root.length > 0 || accumulated.length === 0
        ? segment
        : join(accumulated, segment);
    }
    return accumulated.length === 0 ? "." : normalize(accumulated);
  }

  /** The tail with trailing separators removed, and its root, without normalizing. */
  function trimmed(path: string): { readonly root: string; readonly tail: string } {
    const { root, rest } = splitRoot(path);
    let end = rest.length;
    while (end > 0 && isSeparator(rest.charAt(end - 1))) end -= 1;
    return { root, tail: rest.slice(0, end) };
  }

  function lastSeparator(tail: string): number {
    for (let index = tail.length - 1; index >= 0; index -= 1) {
      if (isSeparator(tail.charAt(index))) return index;
    }
    return -1;
  }

  function dirname(path: string): string {
    const { root, tail } = trimmed(assertPath(path, "Path.dirname"));
    const index = lastSeparator(tail);
    if (index < 0) return root.length > 0 ? root : ".";
    let head = tail.slice(0, index);
    while (head.length > 0 && isSeparator(head.charAt(head.length - 1))) head = head.slice(0, -1);
    return head.length > 0 ? `${root}${head}` : root.length > 0 ? root : ".";
  }

  function basename(path: string, suffix?: string): string {
    const { tail } = trimmed(assertPath(path, "Path.basename"));
    const base = tail.slice(lastSeparator(tail) + 1);
    if (suffix === undefined) return base;
    assertPath(suffix, "Path.basename");
    return suffix.length > 0 && base !== suffix && base.endsWith(suffix)
      ? base.slice(0, base.length - suffix.length)
      : base;
  }

  function extname(path: string): string {
    const base = basename(assertPath(path, "Path.extname"));
    const index = base.lastIndexOf(".");
    // A leading dot is a hidden-file marker, not an extension.
    return index <= 0 ? "" : base.slice(index);
  }

  function split(path: string): readonly string[] {
    const text = assertPath(path, "Path.split");
    const { root, rest } = splitRoot(text);
    const folded = foldSegments(segmentsOf(rest), root.length > 0);
    return Object.freeze(root.length > 0 ? [root, ...folded] : folded);
  }

  function comparable(segment: string): string {
    // Windows paths are case-insensitive; posix paths are not.
    return windows ? segment.toLowerCase() : segment;
  }

  function relative(from: string, to: string): string {
    const source = splitRoot(normalize(assertPath(from, "Path.relative")));
    const target = splitRoot(normalize(assertPath(to, "Path.relative")));
    // Different roots (`C:` vs `D:`, absolute vs relative) have no lexical path
    // between them; the destination itself is the only usable answer.
    if (comparable(source.root) !== comparable(target.root)) return normalize(to);
    const fromSegments = foldSegments(segmentsOf(source.rest), source.root.length > 0);
    const toSegments = foldSegments(segmentsOf(target.rest), target.root.length > 0);
    let shared = 0;
    while (
      shared < fromSegments.length && shared < toSegments.length &&
      comparable(fromSegments[shared] as string) === comparable(toSegments[shared] as string)
    ) shared += 1;
    const up = fromSegments.length - shared;
    const parts = [...Array.from({ length: up }, () => ".."), ...toSegments.slice(shared)];
    return parts.length === 0 ? "" : parts.join(separator);
  }

  function parse(path: string): Result<ParsedPath, InvalidPath> {
    const text = assertPath(path, "Path.parse");
    if (text.length === 0) return failure(new InvalidPath(text, "empty"));
    if (text.includes("\0")) return failure(new InvalidPath(text, "contains a NUL character"));
    const { root, absolute } = splitRoot(text);
    const base = basename(text);
    const ext = extname(text);
    return success(Object.freeze({
      root,
      dir: dirname(text),
      base,
      name: ext.length > 0 ? base.slice(0, base.length - ext.length) : base,
      ext,
      absolute,
    }));
  }

  function format(parsed: ParsedPath): string {
    if (parsed === null || typeof parsed !== "object") panic("Path.format requires a parsed path");
    const root = assertPath(parsed.root ?? "", "Path.format");
    const dir = assertPath(parsed.dir ?? "", "Path.format");
    const base = parsed.base !== undefined && parsed.base.length > 0
      ? assertPath(parsed.base, "Path.format")
      : `${assertPath(parsed.name ?? "", "Path.format")}${assertPath(parsed.ext ?? "", "Path.format")}`;
    if (dir.length === 0) return `${root}${base}`;
    // A root already carries its own separator (`/`, `C:\`, `\\s\sh\`).
    if (dir === root) return `${dir}${base}`;
    return `${dir}${separator}${base}`;
  }

  function toStyle(path: string, target: PathStyle): string {
    const text = assertPath(path, "Path.toStyle");
    if (target === style) return text;
    if (target !== "posix" && target !== "windows") panic(`Path.toStyle received an unknown style: ${String(target)}`);
    return windows ? text.split("\\").join("/") : text.split("/").join("\\");
  }

  return Object.freeze({
    style,
    separator,
    delimiter,
    join,
    normalize,
    resolve,
    isAbsolute,
    dirname,
    basename,
    extname,
    relative,
    split,
    parse,
    format,
    toStyle,
  });
}

const posix = makeApi("posix");
const windows = makeApi("windows");

function forStyle(style: PathStyle): PathApi {
  if (style === "posix") return posix;
  if (style === "windows") return windows;
  panic(`Path.forStyle received an unknown style: ${String(style)}`);
}

/** Which grammar a host uses. Only Windows writes backslashes. */
function styleFor(platform: HostPlatform): PathStyle {
  return platform === "win32" ? "windows" : "posix";
}

/**
 * The host-aware convenience, and the only member of this module that has a
 * requirement: it reads `Process` for the host style and working directory.
 */
export interface HostPath {
  readonly style: PathStyle;
  /** The pure API for the host's style; every function on it stays pure. */
  readonly path: PathApi;
  /** The host working directory, read through `Process` at call time. */
  cwd(): string;
  /**
   * Host `resolve`: the working directory is the leftmost base, so the result is
   * absolute unless the host itself reports a relative cwd.
   */
  resolve(...segments: readonly string[]): string;
  /** Lexical path from the host working directory to `target`. */
  relativeToCwd(target: string): string;
}

/**
 * Bind the pure API to the host, through the `Process` capability.
 *
 * Calling this adds `Process` to the caller's inferred requirements — which is
 * the point: a function that resolves against the host's working directory is
 * no longer pure, and its signature should say so.
 */
function forHost(): HostPath {
  const host = Process.context();
  const style = styleFor(host.platform());
  const api = forStyle(style);
  return Object.freeze({
    style,
    path: api,
    cwd: (): string => host.cwd(),
    resolve: (...segments: readonly string[]): string => api.resolve(host.cwd(), ...segments),
    relativeToCwd: (target: string): string => api.relative(host.cwd(), target),
  });
}

/**
 * The namespace. Its own members are posix semantics — `Path.style` reads
 * `"posix"` — while `Path.posix`, `Path.windows`, and `Path.forStyle(style)`
 * name a style explicitly, and `Path.forHost()` is the one capability-consulting
 * entry point.
 */
export const Path = Object.freeze({
  ...posix,
  posix,
  windows,
  forStyle,
  styleFor,
  forHost,
});
