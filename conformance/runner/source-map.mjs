/**
 * Minimal version-3 source-map reader, used to move a diagnostic reported in
 * emitted TypeScript back onto the authored `.sm` line and column.
 *
 * The corpus's whole point is that line 1 of a case file is line 1 of the
 * program, so a diagnostic the harness reports has to be expressible in
 * *authored* coordinates. The emitted module has a generated runtime import
 * header and rewritten specifiers, so its coordinates are not the case's.
 *
 * This is deliberately fail-closed in the same way `poc/src/language/lsp.ts`'s
 * private copy is: an unmapped generated position yields `undefined` rather
 * than a plausible-looking wrong anchor, and the caller must then say so out
 * loud instead of inventing an authored position.
 */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Map([...BASE64].map((character, index) => [character, index]));

function decodeVlq(segment, start) {
  let value = 0;
  let shift = 0;
  let index = start;
  for (;;) {
    if (index >= segment.length || shift > 48) throw new TypeError("invalid source-map VLQ segment");
    const digit = BASE64_VALUES.get(segment[index++]);
    if (digit === undefined) throw new TypeError("invalid source-map base64 digit");
    value += (digit & 31) * 2 ** shift;
    if (!Number.isSafeInteger(value)) throw new TypeError("source-map VLQ exceeds the safe integer range");
    if ((digit & 32) === 0) break;
    shift += 5;
  }
  const magnitude = Math.floor(value / 2);
  return [(value & 1) === 1 ? -magnitude : magnitude, index];
}

/**
 * Nearest preceding mapping for a 0-based generated position.
 *
 * Returns `{ source, line, column }` with 0-based line and column, or
 * `undefined` when the position is not mapped at all.
 */
export function originalPosition(sourceMap, line, column) {
  let parsed;
  try {
    parsed = JSON.parse(sourceMap);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  if (parsed.version !== 3 || typeof parsed.mappings !== "string" || !Array.isArray(parsed.sources)) return undefined;
  const sources = parsed.sources.filter((entry) => typeof entry === "string");
  if (sources.length !== parsed.sources.length) return undefined;

  let previousSource = 0;
  let previousLine = 0;
  let previousColumn = 0;
  let selected;
  const lines = parsed.mappings.split(";");
  for (let generatedLine = 0; generatedLine < lines.length; generatedLine += 1) {
    if (generatedLine === line) selected = undefined;
    let previousGeneratedColumn = 0;
    for (const segment of lines[generatedLine] === "" ? [] : lines[generatedLine].split(",")) {
      const values = [];
      for (let offset = 0; offset < segment.length; ) {
        const [value, next] = decodeVlq(segment, offset);
        values.push(value);
        offset = next;
      }
      if (values.length !== 1 && values.length !== 4 && values.length !== 5) return undefined;
      previousGeneratedColumn += values[0];
      if (values.length === 1) {
        // A one-field segment marks generated text with no authored origin.
        if (generatedLine === line && previousGeneratedColumn <= column) selected = undefined;
        continue;
      }
      previousSource += values[1];
      previousLine += values[2];
      previousColumn += values[3];
      if (previousSource < 0 || previousSource >= sources.length || previousLine < 0 || previousColumn < 0) {
        return undefined;
      }
      if (generatedLine === line && previousGeneratedColumn <= column) {
        selected = {
          generatedColumn: previousGeneratedColumn,
          source: previousSource,
          line: previousLine,
          column: previousColumn,
        };
      }
    }
    if (generatedLine >= line) break;
  }
  if (!selected) return undefined;
  return {
    source: sources[selected.source],
    line: selected.line,
    column: selected.column + column - selected.generatedColumn,
  };
}
