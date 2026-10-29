/// <reference types="node" />
// The Node and Bun implementation of the experimental FileSystem members
// (D313). Every other member is Effect's own: the layer extends the
// FileSystem that Effect's NodeFileSystem.layer or BunFileSystem.layer
// provides, and plain opens go through Effect's open.
//
// The File class that a nonBlocking open returns, its makeFileInfo,
// openFlagBits and the errno mapping are copies of
// @effect/platform-node-shared 4.1.0's internal ones (src/NodeFileSystem.ts,
// src/internal/utils.ts), which these members need and Effect does not
// export. They go when Effect releases the members, as does this module.
import * as BI from "effect/BigInt"
import * as ByteSize from "effect/ByteSize"
import * as Effect from "effect/Effect"
import * as EffectFileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PlatformError from "effect/PlatformError"
import * as NFS from "node:fs"
import * as FileSystem from "../FileSystem.js"

/** What the implementation reads from its host; tests replace it to reach the unsupported paths. */
export interface Host {
  readonly platform: string
  readonly constants: {
    readonly O_NOFOLLOW?: number | undefined
    readonly O_NONBLOCK?: number | undefined
  }
}

const nodeHost: Host = { platform: process.platform, constants: NFS.constants }

// == errors (platform-node-shared's handleErrnoException)

const handleErrnoException = (method: string) =>
(
  err: NodeJS.ErrnoException,
  [path]: [path: NFS.PathLike | number, ...args: Array<any>]
): PlatformError.PlatformError => {
  let reason: PlatformError.SystemErrorTag = "Unknown"
  switch (err.code) {
    case "ENOENT":
      reason = "NotFound"
      break
    case "EACCES":
    case "EPERM":
      reason = "PermissionDenied"
      break
    case "EEXIST":
      reason = "AlreadyExists"
      break
    case "EISDIR":
    case "ENOTDIR":
    case "ELOOP":
      reason = "BadResource"
      break
    case "EBUSY":
      reason = "Busy"
      break
  }
  return PlatformError.systemError({
    _tag: reason,
    module: "FileSystem",
    method,
    pathOrDescriptor: path as string | number,
    syscall: err.syscall,
    cause: err
  })
}

const handleBadArgument = (method: string) => (err: unknown) =>
  PlatformError.badArgument({
    module: "FileSystem",
    method,
    description: (err as Error).message ?? String(err)
  })

const unsupported = (method: string, option: string) =>
  Effect.fail(PlatformError.badArgument({
    module: "FileSystem",
    method,
    description: `${option} is not supported on this platform`
  }))

// == file metadata (platform-node-shared's makeFileInfo)

const bigintToNumber = (value: bigint, field: string): number => {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`${field} exceeds the safe integer range: ${value}`)
  }
  return number
}

const bigintToNumberOption = (value: bigint | undefined): Option.Option<number> =>
  Option.flatMap(Option.fromNullishOr(value), BI.toNumber)

// Node fills bigint stats from a BigInt64Array, so unsigned 64-bit values such
// as dev_t and ino_t at or above 2^63 are reported as negative.
const toUint64 = (value: bigint): bigint => BigInt.asUintN(64, value)

const toUint64Option = (value: bigint | undefined): Option.Option<bigint> =>
  Option.map(Option.fromNullishOr(value), toUint64)

const makeFileInfo = (method: string) =>
(
  stat: NFS.BigIntStats
): Effect.Effect<EffectFileSystem.File.Info, PlatformError.PlatformError> =>
  Effect.try({
    try: (): EffectFileSystem.File.Info => ({
      type: stat.isFile() ?
        "File" :
        stat.isDirectory() ?
        "Directory" :
        stat.isSymbolicLink() ?
        "SymbolicLink" :
        stat.isBlockDevice() ?
        "BlockDevice" :
        stat.isCharacterDevice() ?
        "CharacterDevice" :
        stat.isFIFO() ?
        "FIFO" :
        stat.isSocket() ?
        "Socket" :
        "Unknown",
      mtime: Option.fromNullishOr(stat.mtime),
      atime: Option.fromNullishOr(stat.atime),
      birthtime: Option.fromNullishOr(stat.birthtime),
      dev: toUint64(stat.dev),
      rdev: toUint64Option(stat.rdev),
      ino: toUint64Option(stat.ino),
      mode: bigintToNumber(stat.mode, "mode"),
      nlink: toUint64Option(stat.nlink),
      uid: bigintToNumberOption(stat.uid),
      gid: bigintToNumberOption(stat.gid),
      size: ByteSize.bytes(stat.size),
      blksize: stat.blksize !== undefined ? Option.some(ByteSize.bytes(stat.blksize)) : Option.none(),
      blocks: Option.fromNullishOr(stat.blocks)
    }),
    catch: handleBadArgument(method)
  })

// == access

const access = (fileSystem: EffectFileSystem.FileSystem): FileSystem.Service["access"] => {
  const nodeAccess = Effect.effectify(NFS.access, handleErrnoException("access"), handleBadArgument("access"))
  return (path, options) => {
    if (options?.executable !== true) {
      return fileSystem.access(path, options)
    }
    let mode = NFS.constants.X_OK
    if (options.readable) {
      mode |= NFS.constants.R_OK
    }
    if (options.writable) {
      mode |= NFS.constants.W_OK
    }
    return nodeAccess(path, mode)
  }
}

// == chmod of an open file

const nodeFchmod = Effect.effectify(NFS.fchmod, handleErrnoException("chmod"), handleBadArgument("chmod"))

// Effect's Node File keeps its descriptor in `fd` (platform-node-shared's
// FileImpl); Effect's interface does not declare it.
const withChmod = (file: EffectFileSystem.File): FileSystem.File =>
  Object.assign(file, { chmod: (mode: number) => nodeFchmod((file as unknown as { readonly fd: number }).fd, mode) })

// == open

const openFlagBits = (flag: EffectFileSystem.OpenFlag): number => {
  const { O_APPEND, O_CREAT, O_EXCL, O_RDONLY, O_RDWR, O_TRUNC, O_WRONLY } = NFS.constants
  switch (flag) {
    case "r":
      return O_RDONLY
    case "r+":
      return O_RDWR
    case "w":
      return O_TRUNC | O_CREAT | O_WRONLY
    case "wx":
      return O_TRUNC | O_CREAT | O_WRONLY | O_EXCL
    case "w+":
      return O_TRUNC | O_CREAT | O_RDWR
    case "wx+":
      return O_TRUNC | O_CREAT | O_RDWR | O_EXCL
    case "a":
      return O_APPEND | O_CREAT | O_WRONLY
    case "ax":
      return O_APPEND | O_CREAT | O_WRONLY | O_EXCL
    case "a+":
      return O_APPEND | O_CREAT | O_RDWR
    case "ax+":
      return O_APPEND | O_CREAT | O_RDWR | O_EXCL
  }
}

// Reject unsupported platforms: libuv silently ignores unknown flags on
// Windows. As Effect's noFollow does.
const supported = (host: Host, flag: "O_NOFOLLOW" | "O_NONBLOCK"): number | undefined => {
  const bits = host.constants[flag]
  return host.platform === "win32" || typeof bits !== "number" || bits === 0 ? undefined : bits
}

const open = (fileSystem: EffectFileSystem.FileSystem, host: Host): FileSystem.Service["open"] => {
  const nodeOpen = Effect.effectify(NFS.open, handleErrnoException("open"), handleBadArgument("open"))
  const nodeClose = Effect.effectify(NFS.close, handleErrnoException("open"), handleBadArgument("open"))
  return (path, options) => {
    if (options?.nonBlocking !== true) {
      return Effect.map(fileSystem.open(path, options), withChmod)
    }
    const nonBlocking = supported(host, "O_NONBLOCK")
    if (nonBlocking === undefined) {
      return unsupported("open", "nonBlocking")
    }
    let flags = openFlagBits(options.flag ?? "r") | nonBlocking
    if (options.noFollow === true) {
      const noFollow = supported(host, "O_NOFOLLOW")
      if (noFollow === undefined) {
        return unsupported("open", "noFollow")
      }
      flags |= noFollow
    }
    return Effect.map(
      Effect.acquireRelease(nodeOpen(path, flags, options.mode), (fd) => Effect.orDie(nodeClose(fd))),
      (fd) => makeFile(fd, options.flag?.startsWith("a") ?? false)
    )
  }
}

// == the File of a nonBlocking open (platform-node-shared's makeFile, plus chmod)

// fs.write ignores bigint positions.
const positionToNumber = (position: bigint, method: string) =>
  Effect.try({
    try: () => bigintToNumber(position, "position"),
    catch: handleBadArgument(method)
  })

const negativePosition = (method: string) =>
  PlatformError.badArgument({
    module: "FileSystem",
    method,
    description: "Cannot read before the start of the file"
  })

const makeFile = (() => {
  const nodeReadFactory = (method: string) =>
    Effect.effectify(NFS.read, handleErrnoException(method), handleBadArgument(method))
  const nodeRead = nodeReadFactory("read")
  const nodeReadAlloc = nodeReadFactory("readAlloc")
  const nodeStat = Effect.effectify(NFS.fstat, handleErrnoException("stat"), handleBadArgument("stat"))
  const nodeTruncate = Effect.effectify(NFS.ftruncate, handleErrnoException("truncate"), handleBadArgument("truncate"))
  const nodeSync = Effect.effectify(NFS.fsync, handleErrnoException("sync"), handleBadArgument("sync"))
  const nodeWriteFactory = (method: string) =>
    Effect.effectify(NFS.write, handleErrnoException(method), handleBadArgument(method))
  const nodeWrite = nodeWriteFactory("write")
  const nodeWriteAll = nodeWriteFactory("writeAll")

  class FileImpl implements FileSystem.File {
    readonly [EffectFileSystem.FileTypeId]: typeof EffectFileSystem.FileTypeId
    readonly fd: number
    private readonly append: boolean

    private position: bigint = BigInt(0)

    constructor(fd: number, append: boolean) {
      this[EffectFileSystem.FileTypeId] = EffectFileSystem.FileTypeId
      this.fd = fd
      this.append = append
    }

    get stat() {
      return Effect.flatMap(nodeStat(this.fd, { bigint: true }), makeFileInfo("stat"))
    }

    get sync() {
      return nodeSync(this.fd)
    }

    chmod(mode: number) {
      return nodeFchmod(this.fd, mode)
    }

    seek(offset: bigint, from: EffectFileSystem.SeekMode) {
      return Effect.suspend(() => {
        const position = from === "start" ? offset : this.position + offset
        if (position < BigInt(0)) {
          return Effect.fail(PlatformError.badArgument({
            module: "FileSystem",
            method: "seek",
            description: "Cannot seek before the start of the file"
          }))
        }
        this.position = position
        return Effect.succeed(position)
      })
    }

    read(buffer: Uint8Array, options?: EffectFileSystem.File.ReadOptions) {
      return Effect.suspend(() => {
        const explicit = options?.position
        if (explicit !== undefined) {
          return explicit < BigInt(0)
            ? Effect.fail(negativePosition("read"))
            : nodeRead(this.fd, { buffer, position: explicit })
        }
        const position = this.position
        return Effect.map(
          nodeRead(this.fd, { buffer, position }),
          (bytesRead) => {
            this.position = position + BigInt(bytesRead)
            return bytesRead
          }
        )
      })
    }

    readAlloc(size: number, options?: EffectFileSystem.File.ReadOptions) {
      return Effect.suspend(() => {
        try {
          if (!Number.isInteger(size) || size < 0) {
            throw new RangeError("size must be a non-negative integer")
          }
          const explicit = options?.position
          if (explicit !== undefined && explicit < BigInt(0)) {
            return Effect.fail(negativePosition("readAlloc"))
          }
          const buffer = Buffer.allocUnsafeSlow(size)
          const position = explicit ?? this.position
          return Effect.map(
            nodeReadAlloc(this.fd, { buffer, position }),
            (bytesRead): Option.Option<Uint8Array> => {
              if (bytesRead === 0) {
                return Option.none()
              }
              if (explicit === undefined) {
                this.position = position + BigInt(bytesRead)
              }
              if (bytesRead === size) {
                return Option.some(buffer)
              }
              const dst = Buffer.allocUnsafeSlow(bytesRead)
              buffer.copy(dst, 0, 0, bytesRead)
              return Option.some(dst)
            }
          )
        } catch (cause) {
          return Effect.fail(handleBadArgument("readAlloc")(cause))
        }
      })
    }

    truncate(length?: number) {
      return Effect.map(nodeTruncate(this.fd, length || undefined), () => {
        if (!this.append) {
          const len = BigInt(length ?? 0)
          if (this.position > len) {
            this.position = len
          }
        }
      })
    }

    write(buffer: Uint8Array) {
      return Effect.suspend(() => {
        const position = this.position
        return Effect.flatMap(
          this.append ? Effect.succeed(undefined) : positionToNumber(position, "write"),
          (nodePosition) =>
            Effect.map(
              nodeWrite(this.fd, buffer, undefined, undefined, nodePosition),
              (bytesWritten) => {
                if (!this.append) {
                  this.position = position + BigInt(bytesWritten)
                }
                return bytesWritten
              }
            )
        )
      })
    }

    private writeAllChunk(buffer: Uint8Array): Effect.Effect<void, PlatformError.PlatformError> {
      return Effect.suspend(() => {
        const position = this.position
        return Effect.flatMap(
          this.append ? Effect.succeed(undefined) : positionToNumber(position, "writeAll"),
          (nodePosition) =>
            Effect.flatMap(
              nodeWriteAll(this.fd, buffer, undefined, undefined, nodePosition),
              (bytesWritten) => {
                if (bytesWritten === 0) {
                  return Effect.fail(
                    PlatformError.systemError({
                      module: "FileSystem",
                      method: "writeAll",
                      _tag: "WriteZero",
                      pathOrDescriptor: this.fd,
                      description: "write returned 0 bytes written"
                    })
                  )
                }
                if (!this.append) {
                  this.position = position + BigInt(bytesWritten)
                }
                return bytesWritten < buffer.length ? this.writeAllChunk(buffer.subarray(bytesWritten)) : Effect.void
              }
            )
        )
      })
    }

    writeAll(buffer: Uint8Array) {
      return buffer.length === 0 ? Effect.void : this.writeAllChunk(buffer)
    }
  }

  return (fd: number, append: boolean): FileSystem.File => new FileImpl(fd, append)
})()

/**
 * Extends Effect's Node FileSystem with the experimental members. `host`
 * defaults to this process's platform and `node:fs` constants.
 */
export const extend = (fileSystem: EffectFileSystem.FileSystem, host: Host = nodeHost): FileSystem.Service =>
  FileSystem.make(fileSystem, { access: access(fileSystem), open: open(fileSystem, host) })

/** Provides the experimental FileSystem from Effect's FileSystem in context. */
export const layer: Layer.Layer<FileSystem.FileSystem, never, EffectFileSystem.FileSystem> = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(Effect.service(EffectFileSystem.FileSystem), (fileSystem) => extend(fileSystem))
)
