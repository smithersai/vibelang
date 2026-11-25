/**
 * Unified diffs for `Experimental.Tools.applyPatch` (VIP-64).
 *
 * Pure: it parses a patch and applies it to text it is handed. Reading and
 * writing files is the tool's job. A hunk applies only where every context
 * and removed line matches exactly, so a patch written against an older file
 * is rejected rather than applied in the wrong place.
 *
 * @internal
 */

/** One hunk: its old start line (1-based) and its lines with their marks. */
export interface Hunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: ReadonlyArray<{ readonly mark: " " | "-" | "+"; readonly text: string }>
  /** Whether the old side's last line had no newline. */
  readonly oldNoNewline: boolean
  /** Whether the new side's last line has no newline. */
  readonly newNoNewline: boolean
}

/** One file's change. `from` or `to` is `undefined` for a created or deleted file. */
export interface FilePatch {
  readonly from: string | undefined
  readonly to: string | undefined
  readonly hunks: ReadonlyArray<Hunk>
}

/** Why a patch did not parse or apply. */
export class PatchError extends Error {
  constructor(readonly code: "invalid_patch" | "patch_rejected", message: string, readonly path?: string) {
    super(message)
  }
}

const stripPrefix = (name: string): string | undefined => {
  // A tab separates a timestamp some tools append.
  const bare = name.split("\t")[0]!.trim()
  if (bare === "/dev/null") return undefined
  if (bare.startsWith("a/") || bare.startsWith("b/")) return bare.slice(2)
  return bare
}

const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Parses a unified diff with one or more files. */
export const parse = (patch: string): ReadonlyArray<FilePatch> => {
  const lines = patch.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  const files: Array<FilePatch> = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (!line.startsWith("--- ")) {
      index++
      continue
    }
    const next = lines[index + 1]
    if (next === undefined || !next.startsWith("+++ ")) {
      throw new PatchError("invalid_patch", `Line ${index + 2}: a "--- " line must be followed by a "+++ " line.`)
    }
    const from = stripPrefix(line.slice(4))
    const to = stripPrefix(next.slice(4))
    if (from === undefined && to === undefined) {
      throw new PatchError("invalid_patch", `Line ${index + 1}: a file patch cannot both create and delete.`)
    }
    index += 2
    const hunks: Array<Hunk> = []
    while (index < lines.length && lines[index]!.startsWith("@@")) {
      const match = header.exec(lines[index]!)
      if (match === null) throw new PatchError("invalid_patch", `Line ${index + 1}: a malformed hunk header.`)
      const oldStart = Number(match[1])
      const oldLines = match[2] === undefined ? 1 : Number(match[2])
      const newStart = Number(match[3])
      const newLines = match[4] === undefined ? 1 : Number(match[4])
      if (![oldStart, oldLines, newStart, newLines].every(Number.isSafeInteger)) {
        throw new PatchError("invalid_patch", `Line ${index + 1}: hunk numbers must be safe integers.`)
      }
      index++
      const body: Array<{ mark: " " | "-" | "+"; text: string }> = []
      let oldSeen = 0
      let newSeen = 0
      let oldNoNewline = false
      let newNoNewline = false
      while (index < lines.length && (oldSeen < oldLines || newSeen < newLines || lines[index]!.startsWith("\\"))) {
        const text = lines[index]!
        if (text.startsWith("\\")) {
          const last = body[body.length - 1]
          if (last === undefined) throw new PatchError("invalid_patch", `Line ${index + 1}: a "\\" line with no line before it.`)
          if (last.mark !== "+") oldNoNewline = true
          if (last.mark !== "-") newNoNewline = true
          index++
          continue
        }
        const mark = text === "" ? " " : text[0]
        if (mark !== " " && mark !== "-" && mark !== "+") {
          throw new PatchError("invalid_patch", `Line ${index + 1}: a hunk line must start with " ", "-" or "+".`)
        }
        body.push({ mark, text: text.slice(1) })
        if (mark !== "+") oldSeen++
        if (mark !== "-") newSeen++
        index++
      }
      if (oldSeen !== oldLines || newSeen !== newLines) {
        throw new PatchError(
          "invalid_patch",
          `A hunk at old line ${oldStart} declares ${oldLines} old and ${newLines} new lines but has ${oldSeen} and ${newSeen}.`
        )
      }
      hunks.push({ oldStart, oldLines, newStart, newLines, lines: body, oldNoNewline, newNoNewline })
    }
    if (hunks.length === 0) throw new PatchError("invalid_patch", `The patch for ${to ?? from} has no hunks.`)
    files.push({ from, to, hunks })
  }
  if (files.length === 0) throw new PatchError("invalid_patch", "The patch names no file: it needs \"--- \" and \"+++ \" lines.")
  return files
}

// A file's text as lines, and whether its last line ends with a newline.
const split = (text: string): { lines: Array<string>; newline: boolean } => {
  if (text === "") return { lines: [], newline: true }
  const newline = text.endsWith("\n")
  const lines = (newline ? text.slice(0, -1) : text).split("\n")
  return { lines, newline }
}

/**
 * Applies one file's hunks to `original` (`undefined` for a file that does
 * not exist). Gives the new text, or `undefined` when the file is deleted.
 */
export const apply = (file: FilePatch, original: string | undefined): string | undefined => {
  const name = file.to ?? file.from ?? ""
  if (file.from === undefined && original !== undefined) {
    throw new PatchError("patch_rejected", `${name} already exists; the patch creates it.`, name)
  }
  if (file.from !== undefined && original === undefined) {
    throw new PatchError("patch_rejected", `${name} does not exist; the patch changes it.`, name)
  }
  const { lines, newline } = split(original ?? "")
  const out: Array<string> = []
  let cursor = 0
  let endsWithNewline = newline
  for (const hunk of file.hunks) {
    // A hunk that adds to an empty file starts at line 0.
    const start = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1
    if (start < cursor || start > lines.length) {
      throw new PatchError("patch_rejected", `A hunk at line ${hunk.oldStart} of ${name} is out of order or past the end.`, name)
    }
    out.push(...lines.slice(cursor, start))
    let at = start
    for (const line of hunk.lines) {
      if (line.mark === "+") {
        out.push(line.text)
        continue
      }
      if (lines[at] !== line.text) {
        throw new PatchError(
          "patch_rejected",
          `Line ${at + 1} of ${name} does not match the patch: expected ${JSON.stringify(line.text)}.`,
          name
        )
      }
      if (line.mark === " ") out.push(line.text)
      at++
    }
    cursor = at
    if (at === lines.length) {
      if (hunk.oldNoNewline && newline) {
        throw new PatchError("patch_rejected", `The patch says ${name} has no final newline, but it has one.`, name)
      }
      endsWithNewline = !hunk.newNoNewline
    }
  }
  out.push(...lines.slice(cursor))
  if (file.to === undefined) {
    if (out.length > 0) throw new PatchError("patch_rejected", `The patch deletes ${name} but leaves lines in it.`, name)
    return undefined
  }
  if (out.length === 0) return ""
  return out.join("\n") + (endsWithNewline ? "\n" : "")
}
