/**
 * Minimal dependency-free version-3 source-map helpers for the fork end-to-end
 * proof: base64 VLQ decode/encode, a generated-column shift that mirrors the Go
 * bridge's `adjustGeneratedColumn`, and an authored-position lookup with the
 * same run semantics the bridge documents on `compiler.LoweredSource`
 * (greatest mapping at or before the column on the same line, authored column
 * advancing one-for-one inside the run).
 */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = new Map([...BASE64].map((character, index) => [character, index]));

function decodeVlq(segment, start) {
  let value = 0;
  let shift = 0;
  let index = start;
  for (;;) {
    if (index >= segment.length || shift > 48) throw new TypeError("invalid source-map VLQ segment");
    const digit = BASE64_VALUE.get(segment[index++]);
    if (digit === undefined) throw new TypeError("invalid source-map base64 digit");
    value += (digit & 31) * 2 ** shift;
    if (!Number.isSafeInteger(value)) throw new TypeError("source-map VLQ exceeds safe integer range");
    if ((digit & 32) === 0) break;
    shift += 5;
  }
  const magnitude = Math.floor(value / 2);
  return [(value & 1) === 1 ? -magnitude : magnitude, index];
}

function encodeVlq(value) {
  let encoded = "";
  let remaining = value < 0 ? (-value << 1) | 1 : value << 1;
  do {
    let digit = remaining & 31;
    remaining >>>= 5;
    if (remaining > 0) digit |= 32;
    encoded += BASE64[digit];
  } while (remaining > 0);
  return encoded;
}

/**
 * Decode `mappings` into absolute per-line segments.
 * Each segment is `{ generatedColumn, source?, originalLine?, originalColumn?, name? }`.
 */
export function decodeMappings(mappings) {
  const lines = [];
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let name = 0;
  for (const encodedLine of mappings.split(";")) {
    let generatedColumn = 0;
    const segments = [];
    for (const encoded of encodedLine === "" ? [] : encodedLine.split(",")) {
      const values = [];
      for (let offset = 0; offset < encoded.length; ) {
        const [value, next] = decodeVlq(encoded, offset);
        values.push(value);
        offset = next;
      }
      if (values.length !== 1 && values.length !== 4 && values.length !== 5) {
        throw new TypeError(`source-map segment has ${values.length} fields; expected 1, 4, or 5`);
      }
      generatedColumn += values[0];
      if (generatedColumn < 0) throw new TypeError("source-map generated column is negative");
      const segment = { generatedColumn };
      if (values.length >= 4) {
        source += values[1];
        originalLine += values[2];
        originalColumn += values[3];
        if (source < 0 || originalLine < 0 || originalColumn < 0) {
          throw new TypeError("source-map contains a negative coordinate");
        }
        segment.source = source;
        segment.originalLine = originalLine;
        segment.originalColumn = originalColumn;
        if (values.length === 5) {
          name += values[4];
          segment.name = name;
        }
      }
      segments.push(segment);
    }
    lines.push(segments);
  }
  return lines;
}

/** Encode absolute per-line segments back into a `mappings` string. */
export function encodeMappings(lines) {
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let name = 0;
  return lines
    .map((segments) => {
      let generatedColumn = 0;
      return [...segments]
        .sort((left, right) => left.generatedColumn - right.generatedColumn)
        .map((segment) => {
          let encoded = encodeVlq(segment.generatedColumn - generatedColumn);
          generatedColumn = segment.generatedColumn;
          if (segment.source === undefined) return encoded;
          encoded += encodeVlq(segment.source - source);
          encoded += encodeVlq(segment.originalLine - originalLine);
          encoded += encodeVlq(segment.originalColumn - originalColumn);
          source = segment.source;
          originalLine = segment.originalLine;
          originalColumn = segment.originalColumn;
          if (segment.name !== undefined) {
            encoded += encodeVlq(segment.name - name);
            name = segment.name;
          }
          return encoded;
        })
        .join(",");
    })
    .join(";");
}

/**
 * Shift one pre-edit UTF-16 generated column across same-line text edits.
 * Mirrors `adjustGeneratedColumn` in `compiler/forkbridge/main.go.txt`:
 * columns inside a replaced span clamp to the replacement start.
 */
export function adjustGeneratedColumn(column, edits) {
  let adjusted = column;
  for (const edit of edits) {
    if (column >= edit.oldEnd) {
      adjusted += edit.newLength - (edit.oldEnd - edit.start);
      continue;
    }
    if (column > edit.start) adjusted -= column - edit.start;
    break;
  }
  return adjusted;
}

/**
 * Resolve one generated position to its authored origin, or `undefined` when
 * the position is unmapped.
 */
export function originalPositionFor(map, line, column) {
  const parsed = typeof map === "string" ? JSON.parse(map) : map;
  if (parsed.version !== 3 || typeof parsed.mappings !== "string") {
    throw new TypeError("unsupported version-3 source map shape");
  }
  const lines = decodeMappings(parsed.mappings);
  const segments = lines[line];
  if (!segments || segments.length === 0) return undefined;
  let selected;
  for (const segment of segments) {
    if (segment.generatedColumn > column) break;
    selected = segment;
  }
  if (!selected || selected.source === undefined) return undefined;
  return {
    source: parsed.sources[selected.source],
    line: selected.originalLine,
    column: selected.originalColumn + (column - selected.generatedColumn),
  };
}

/** UTF-16 (line, column) of a needle's first occurrence in `text`. */
export function positionOf(text, needle) {
  const offset = text.indexOf(needle);
  if (offset < 0) throw new TypeError(`${JSON.stringify(needle)} is absent from the text`);
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line, column: offset - lineStart, offset };
}
