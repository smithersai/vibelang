import { basename } from "node:path";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = new Map([...BASE64].map((character, index) => [character, index]));
const MAX_MAP_BYTES = 16 * 1024 * 1024;
const MAX_MAP_UNITS = 1_000_000;
const MAX_MAPPING_SEGMENTS = 1_250_000;
const MAX_SOURCES = 4_096;
const MAX_NAMES = 100_000;
const MAX_COORDINATE = 16_000_000;

interface ParsedMap {
  readonly version: 3;
  readonly file?: string;
  readonly sourceRoot?: string;
  readonly sources: readonly string[];
  readonly sourcesContent?: readonly (string | null)[];
  readonly names: readonly string[];
  readonly mappings: string;
}

interface Mapping {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly source?: number;
  readonly originalLine?: number;
  readonly originalColumn?: number;
}

export interface SourceMapAnchor {
  /** UTF-16 offset in the generated body, before generatedPrefix is prepended. */
  readonly generatedOffset: number;
  /** UTF-16 offset in the authored source. */
  readonly originalOffset: number;
}

export interface PreciseSourceMapInput {
  readonly generatedCode: string;
  readonly generatedBody: string;
  readonly generatedPrefix: string;
  readonly source: string;
  readonly sourceName: string;
  readonly fileName: string;
  /** Raw map emitted by TypeScript's AST-aware printer for generatedBody. */
  readonly printerSourceMap?: string;
  /** Deliberate semantic token anchors for rewritten tokens such as import paths. */
  readonly anchors?: readonly SourceMapAnchor[];
  /** Exact no-transform case. */
  readonly identity?: boolean;
}

function decodeVlq(segment: string, start: number): readonly [number, number] {
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
  const negative = (value & 1) === 1;
  const magnitude = Math.floor(value / 2);
  return [negative ? -magnitude : magnitude, index];
}

function encodeVlq(value: number): string {
  if (!Number.isSafeInteger(value)) throw new TypeError("source-map coordinate is not a safe integer");
  let current = Math.abs(value) * 2 + (value < 0 ? 1 : 0);
  let encoded = "";
  do {
    let digit = current % 32;
    current = Math.floor(current / 32);
    if (current > 0) digit += 32;
    encoded += BASE64[digit];
  } while (current > 0);
  return encoded;
}

function parsedMap(wire: string, label: string): ParsedMap {
  if (typeof wire !== "string" || Buffer.byteLength(wire, "utf8") > MAX_MAP_BYTES) {
    throw new TypeError(`${label} source map is missing or exceeds ${MAX_MAP_BYTES} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(wire);
  } catch (cause) {
    throw new TypeError(`${label} source map is not valid JSON`, { cause });
  }
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError(`${label} source map must be an object`);
  }
  const map = value as Record<string, unknown>;
  if (
    map.version !== 3 || !Array.isArray(map.sources) || !Array.isArray(map.names) ||
    typeof map.mappings !== "string" ||
    !map.sources.every((source) => typeof source === "string" && source.length <= 65_536) ||
    !map.names.every((name) => typeof name === "string" && name.length <= 65_536) ||
    (map.file !== undefined && typeof map.file !== "string") ||
    (map.sourceRoot !== undefined && typeof map.sourceRoot !== "string") ||
    (map.sourcesContent !== undefined &&
      (!Array.isArray(map.sourcesContent) ||
        !map.sourcesContent.every((source) => source === null || typeof source === "string")))
  ) throw new TypeError(`${label} source map has an unsupported version-3 shape`);
  if (map.sources.length > MAX_SOURCES || map.names.length > MAX_NAMES) {
    throw new TypeError(`${label} source map exceeds bounded source/name counts`);
  }
  if (map.sourcesContent !== undefined && map.sourcesContent.length !== map.sources.length) {
    throw new TypeError(`${label} source map sourcesContent length does not match sources`);
  }
  return map as unknown as ParsedMap;
}

function decodeMappings(map: ParsedMap): readonly Mapping[] {
  const output: Mapping[] = [];
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  let previousName = 0;
  let generatedLine = 0;
  let lineStart = 0;
  for (;;) {
    if (generatedLine > MAX_MAP_UNITS) throw new TypeError("source map exceeds bounded generated lines");
    const separator = map.mappings.indexOf(";", lineStart);
    const lineEnd = separator < 0 ? map.mappings.length : separator;
    let previousGeneratedColumn = 0;
    let segmentStart = lineStart;
    while (segmentStart < lineEnd) {
      const comma = map.mappings.indexOf(",", segmentStart);
      const segmentEnd = comma < 0 || comma > lineEnd ? lineEnd : comma;
      if (segmentEnd === segmentStart) throw new TypeError("source map contains an empty segment");
      const encoded = map.mappings.slice(segmentStart, segmentEnd);
      const values: number[] = [];
      let offset = 0;
      while (offset < encoded.length) {
        const [value, next] = decodeVlq(encoded, offset);
        values.push(value);
        offset = next;
      }
      if (values.length !== 1 && values.length !== 4 && values.length !== 5) {
        throw new TypeError("source map segment must have one, four, or five fields");
      }
      if (values[0]! < 0) throw new TypeError("source map generated columns must not backtrack");
      previousGeneratedColumn += values[0]!;
      if (previousGeneratedColumn > MAX_COORDINATE) throw new TypeError("source map coordinate exceeds POC bounds");
      if (values.length === 1) {
        output.push({ generatedLine, generatedColumn: previousGeneratedColumn });
      } else {
        previousSource += values[1]!;
        previousOriginalLine += values[2]!;
        previousOriginalColumn += values[3]!;
        if (values.length === 5) previousName += values[4]!;
        if (
          previousSource < 0 || previousSource >= map.sources.length ||
          previousOriginalLine < 0 || previousOriginalLine > MAX_COORDINATE ||
          previousOriginalColumn < 0 || previousOriginalColumn > MAX_COORDINATE ||
          (values.length === 5 && (previousName < 0 || previousName >= map.names.length))
        ) throw new TypeError("source map contains an out-of-range coordinate");
        output.push({
          generatedLine,
          generatedColumn: previousGeneratedColumn,
          source: previousSource,
          originalLine: previousOriginalLine,
          originalColumn: previousOriginalColumn,
        });
      }
      if (output.length > MAX_MAPPING_SEGMENTS) throw new TypeError("source map exceeds bounded segment count");
      segmentStart = segmentEnd + 1;
    }
    if (lineEnd > lineStart && map.mappings.charCodeAt(lineEnd - 1) === 44) {
      throw new TypeError("source map contains an empty segment");
    }
    if (separator < 0) break;
    lineStart = separator + 1;
    generatedLine++;
  }
  return output;
}

function encodeMappings(mappings: readonly Mapping[]): string {
  if (mappings.length > MAX_MAPPING_SEGMENTS) throw new TypeError("source map exceeds bounded segment count");
  for (const mapping of mappings) {
    if (
      !Number.isSafeInteger(mapping.generatedLine) || !Number.isSafeInteger(mapping.generatedColumn) ||
      mapping.generatedLine < 0 || mapping.generatedColumn < 0 ||
      mapping.generatedLine > MAX_MAP_UNITS || mapping.generatedColumn > MAX_COORDINATE
    ) throw new TypeError("source map contains an invalid generated coordinate");
    const complete = mapping.source !== undefined && mapping.originalLine !== undefined && mapping.originalColumn !== undefined;
    if ((mapping.source !== undefined || mapping.originalLine !== undefined || mapping.originalColumn !== undefined) && !complete) {
      throw new TypeError("source map mapping is partially specified");
    }
  }
  let alreadyOrdered = true;
  for (let index = 1; index < mappings.length; index++) {
    const previous = mappings[index - 1]!;
    const current = mappings[index]!;
    if (previous.generatedLine > current.generatedLine ||
      (previous.generatedLine === current.generatedLine && previous.generatedColumn > current.generatedColumn)) {
      alreadyOrdered = false;
      break;
    }
  }
  const ordered = alreadyOrdered ? mappings : [...mappings].sort((left, right) =>
    left.generatedLine - right.generatedLine || left.generatedColumn - right.generatedColumn);
  const maximumLine = ordered.at(-1)?.generatedLine ?? 0;
  const output: string[] = [];
  let index = 0;
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  for (let generatedLine = 0; generatedLine <= maximumLine; generatedLine++) {
    let previousGeneratedColumn = 0;
    const encoded: string[] = [];
    while (ordered[index]?.generatedLine === generatedLine) {
      let mapping = ordered[index++]!;
      while (ordered[index]?.generatedLine === mapping.generatedLine &&
        ordered[index]?.generatedColumn === mapping.generatedColumn) mapping = ordered[index++]!;
      let segment = encodeVlq(mapping.generatedColumn - previousGeneratedColumn);
      previousGeneratedColumn = mapping.generatedColumn;
      if (mapping.source !== undefined && mapping.originalLine !== undefined && mapping.originalColumn !== undefined) {
        segment += encodeVlq(mapping.source - previousSource) +
          encodeVlq(mapping.originalLine - previousOriginalLine) +
          encodeVlq(mapping.originalColumn - previousOriginalColumn);
        previousSource = mapping.source;
        previousOriginalLine = mapping.originalLine;
        previousOriginalColumn = mapping.originalColumn;
      }
      encoded.push(segment);
    }
    output.push(encoded.join(","));
  }
  return output.join(";");
}

function lineStarts(text: string): readonly number[] {
  const starts = [0];
  for (let offset = 0; offset < text.length; offset++) {
    const code = text.charCodeAt(offset);
    if (code === 13) {
      if (text.charCodeAt(offset + 1) === 10) offset++;
      starts.push(offset + 1);
    } else if (code === 10 || code === 0x2028 || code === 0x2029) {
      starts.push(offset + 1);
    }
  }
  return starts;
}

function lineContentEnd(text: string, starts: readonly number[], line: number): number {
  let end = line + 1 < starts.length ? starts[line + 1]! : text.length;
  while (end > starts[line]! && isLineBreakUnit(text, end - 1)) end--;
  return end;
}

function coordinateOffset(text: string, starts: readonly number[], line: number, column: number): number | undefined {
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 0 || column < 0 || line >= starts.length) {
    return undefined;
  }
  const start = starts[line]!;
  const end = lineContentEnd(text, starts, line);
  return column <= end - start ? start + column : undefined;
}

function locateOffset(starts: readonly number[], offset: number): { readonly line: number; readonly column: number } {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return { line: low, column: offset - starts[low]! };
}

function isLineBreakUnit(text: string, offset: number): boolean {
  const code = text.charCodeAt(offset);
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

function preciseMappings(input: PreciseSourceMapInput): readonly Mapping[] {
  const { generatedCode, generatedBody, generatedPrefix, source, printerSourceMap, anchors = [], identity = false } = input;
  if (generatedCode !== generatedPrefix + generatedBody) {
    throw new TypeError("precise source-map prefix/body do not reconstruct generated code");
  }
  if (generatedCode.length > MAX_MAP_UNITS || generatedBody.length > MAX_MAP_UNITS || source.length > MAX_MAP_UNITS) {
    throw new TypeError(`precise source map exceeds the ${MAX_MAP_UNITS} UTF-16 unit POC limit`);
  }
  const originalByGenerated = new Int32Array(generatedCode.length);
  originalByGenerated.fill(-1);
  if (identity) {
    if (generatedPrefix !== "" || generatedCode !== source) {
      throw new TypeError("identity source map requires byte-identical generated and authored text");
    }
    for (let offset = 0; offset < generatedCode.length; offset++) {
      if (!isLineBreakUnit(generatedCode, offset)) originalByGenerated[offset] = offset;
    }
  } else {
    if (!printerSourceMap) throw new TypeError("changed output requires an AST printer source map");
    const raw = parsedMap(printerSourceMap, "AST printer");
    const decoded = decodeMappings(raw);
    const matchingSources = new Set<number>();
    for (let index = 0; index < raw.sources.length; index++) {
      if (raw.sourcesContent?.[index] === source) matchingSources.add(index);
    }
    if (matchingSources.size === 0 && raw.sources.length === 1) matchingSources.add(0);
    const bodyStarts = lineStarts(generatedBody);
    const sourceStarts = lineStarts(source);
    const byLine = new Map<number, Mapping[]>();
    for (const mapping of decoded) {
      const line = byLine.get(mapping.generatedLine) ?? [];
      line.push(mapping);
      byLine.set(mapping.generatedLine, line);
    }
    for (const values of byLine.values()) values.sort((left, right) => left.generatedColumn - right.generatedColumn);
    for (const values of byLine.values()) {
      for (let index = 0; index < values.length; index++) {
        const mapping = values[index]!;
        if (mapping.source === undefined || mapping.originalLine === undefined || mapping.originalColumn === undefined ||
          !matchingSources.has(mapping.source)) continue;
        const generatedStart = coordinateOffset(generatedBody, bodyStarts, mapping.generatedLine, mapping.generatedColumn);
        const originalStart = coordinateOffset(source, sourceStarts, mapping.originalLine, mapping.originalColumn);
        if (generatedStart === undefined || originalStart === undefined) continue;
        const nextColumn = values[index + 1]?.generatedColumn ??
          lineContentEnd(generatedBody, bodyStarts, mapping.generatedLine) - bodyStarts[mapping.generatedLine]!;
        const generatedLimit = coordinateOffset(generatedBody, bodyStarts, mapping.generatedLine, nextColumn);
        const originalLimit = lineContentEnd(source, sourceStarts, mapping.originalLine);
        if (generatedLimit === undefined) continue;
        const length = Math.min(generatedLimit - generatedStart, originalLimit - originalStart);
        for (let delta = 0; delta < length; delta++) {
          if (generatedBody.charCodeAt(generatedStart + delta) !== source.charCodeAt(originalStart + delta)) break;
          originalByGenerated[generatedPrefix.length + generatedStart + delta] = originalStart + delta;
        }
      }
    }
    for (const anchor of anchors) {
      if (!Number.isSafeInteger(anchor.generatedOffset) || !Number.isSafeInteger(anchor.originalOffset) ||
        anchor.generatedOffset < 0 || anchor.generatedOffset >= generatedBody.length ||
        anchor.originalOffset < 0 || anchor.originalOffset >= source.length) {
        throw new TypeError("precise source-map anchor is out of range");
      }
      const generatedOffset = generatedPrefix.length + anchor.generatedOffset;
      if (!isLineBreakUnit(generatedCode, generatedOffset) && !isLineBreakUnit(source, anchor.originalOffset)) {
        originalByGenerated[generatedOffset] = anchor.originalOffset;
      }
    }
  }

  return mappingsFromOffsetTable(generatedCode, source, originalByGenerated);
}

/**
 * Emit one high-resolution mapping per exactly attributed character, with an
 * explicit unmapped stop wherever attribution ends, so composition can never
 * smear compiler text onto a nearby authored location.
 */
function mappingsFromOffsetTable(
  generatedCode: string,
  source: string,
  originalByGenerated: Int32Array,
): readonly Mapping[] {
  const generatedStarts = lineStarts(generatedCode);
  const originalStarts = lineStarts(source);
  const mappings: Mapping[] = [];
  for (let line = 0; line < generatedStarts.length; line++) {
    const start = generatedStarts[line]!;
    const end = lineContentEnd(generatedCode, generatedStarts, line);
    let priorMapped = false;
    for (let offset = start; offset < end; offset++) {
      const original = originalByGenerated[offset]!;
      if (original >= 0) {
        const coordinate = locateOffset(originalStarts, original);
        mappings.push({
          generatedLine: line,
          generatedColumn: offset - start,
          source: 0,
          originalLine: coordinate.line,
          originalColumn: coordinate.column,
        });
        priorMapped = true;
      } else {
        if (offset === start || priorMapped) mappings.push({ generatedLine: line, generatedColumn: offset - start });
        priorMapped = false;
      }
    }
  }
  return mappings;
}

export interface OffsetSourceMapRun {
  readonly derivedStart: number;
  readonly authoredStart: number;
  readonly length: number;
}

export interface OffsetSourceMapInput {
  /** The transformed text the mappings' generated coordinates describe. */
  readonly derivedText: string;
  /** The authored text the mappings' original coordinates describe. */
  readonly authoredText: string;
  /** Character-exact derived-to-authored runs; everything else is unmapped. */
  readonly runs: readonly OffsetSourceMapRun[];
  readonly sourceName: string;
  readonly fileName: string;
}

/**
 * Build an exact derived-to-authored map from verbatim text runs, for
 * composition beneath a generated-to-derived printer map. Compiler glue stays
 * explicitly unmapped. Every run must be character-identical text.
 */
export function createOffsetSourceMap(input: OffsetSourceMapInput): string {
  const { derivedText, authoredText, runs } = input;
  if (derivedText.length > MAX_MAP_UNITS || authoredText.length > MAX_MAP_UNITS) {
    throw new TypeError(`offset source map exceeds the ${MAX_MAP_UNITS} UTF-16 unit POC limit`);
  }
  const table = new Int32Array(derivedText.length);
  table.fill(-1);
  for (const run of runs) {
    if (!Number.isSafeInteger(run.derivedStart) || !Number.isSafeInteger(run.authoredStart) ||
      !Number.isSafeInteger(run.length) || run.derivedStart < 0 || run.authoredStart < 0 || run.length < 0 ||
      run.derivedStart + run.length > derivedText.length || run.authoredStart + run.length > authoredText.length) {
      throw new TypeError("offset source-map run is out of range");
    }
    for (let delta = 0; delta < run.length; delta++) {
      if (derivedText.charCodeAt(run.derivedStart + delta) !== authoredText.charCodeAt(run.authoredStart + delta)) {
        throw new TypeError("offset source-map run is not character-identical to the authored source");
      }
      if (!isLineBreakUnit(derivedText, run.derivedStart + delta)) {
        table[run.derivedStart + delta] = run.authoredStart + delta;
      }
    }
  }
  const wire = JSON.stringify({
    version: 3,
    file: basename(input.fileName),
    sourceRoot: "",
    sources: [input.sourceName],
    sourcesContent: [authoredText],
    names: [],
    mappings: encodeMappings(mappingsFromOffsetTable(derivedText, authoredText, table)),
  });
  if (Buffer.byteLength(wire, "utf8") > MAX_MAP_BYTES) {
    throw new TypeError(`offset source map exceeds the ${MAX_MAP_BYTES} byte POC limit`);
  }
  return wire;
}

/**
 * Convert TypeScript-printer provenance into a deterministic high-resolution
 * map. Only exact contiguous text from an AST-provided anchor is extended;
 * compiler text remains explicitly unmapped. Deliberate semantic rewrites can
 * contribute a single token-start anchor without claiming column equivalence.
 */
export function createPreciseSourceMap(input: PreciseSourceMapInput): string {
  const wire = JSON.stringify({
    version: 3,
    file: basename(input.fileName),
    sourceRoot: "",
    sources: [input.sourceName],
    sourcesContent: [input.source],
    names: [],
    mappings: encodeMappings(preciseMappings(input)),
  });
  if (Buffer.byteLength(wire, "utf8") > MAX_MAP_BYTES) {
    throw new TypeError(`precise source map exceeds the ${MAX_MAP_BYTES} byte POC limit`);
  }
  return wire;
}

function normalizedSource(root: string | undefined, source: string): string {
  const normalized = source.replaceAll("\\", "/");
  if (!root || /^(?:[A-Za-z][A-Za-z+.-]*:|\/)/.test(normalized)) return normalized;
  return `${root.replaceAll("\\", "/").replace(/\/$/, "")}/${normalized.replace(/^\.\//, "")}`;
}

function intermediateSourceIndex(outer: ParsedMap, inner: ParsedMap): number {
  if (outer.sources.length === 1) return 0;
  if (!inner.file) throw new TypeError("cannot identify the intermediate source in a multi-source outer map");
  const target = inner.file.replaceAll("\\", "/");
  const identities = outer.sources.map((source) => normalizedSource(outer.sourceRoot, source));
  const exact = identities.flatMap((identity, index) => identity === target || identity.endsWith(`/${target}`) ? [index] : []);
  if (exact.length === 1) return exact[0]!;
  const targetBase = basename(target);
  const byBase = identities.flatMap((identity, index) => basename(identity) === targetBase ? [index] : []);
  if (byBase.length === 1) return byBase[0]!;
  throw new TypeError("cannot uniquely identify the intermediate source in a multi-source outer map");
}

function selectMapping(values: readonly Mapping[] | undefined, column: number): Mapping | undefined {
  if (!values || values.length === 0) return undefined;
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]!.generatedColumn <= column) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? undefined : values[low - 1];
}

/** Compose an outer generated map through an inner map without inventing provenance. */
export function composeSourceMaps(
  javascriptToTypeScript: string,
  typeScriptToVibe: string,
  outputFileName: string,
): string {
  const outer = parsedMap(javascriptToTypeScript, "JavaScript");
  const inner = parsedMap(typeScriptToVibe, "VibeLang");
  const intermediate = intermediateSourceIndex(outer, inner);
  const innerByLine = new Map<number, Mapping[]>();
  for (const mapping of decodeMappings(inner)) {
    const line = innerByLine.get(mapping.generatedLine) ?? [];
    line.push(mapping);
    innerByLine.set(mapping.generatedLine, line);
  }
  for (const line of innerByLine.values()) line.sort((left, right) => left.generatedColumn - right.generatedColumn);

  const sources = inner.sources.map((source) => normalizedSource(inner.sourceRoot, source));
  const sourcesContent: Array<string | null> = inner.sources.map((_, index) => inner.sourcesContent?.[index] ?? null);
  const passthrough = new Map<number, number>();
  for (let index = 0; index < outer.sources.length; index++) {
    if (index === intermediate) continue;
    passthrough.set(index, sources.length);
    sources.push(normalizedSource(outer.sourceRoot, outer.sources[index]!));
    sourcesContent.push(outer.sourcesContent?.[index] ?? null);
  }
  if (sources.length > MAX_SOURCES) throw new TypeError("composed source map exceeds bounded source count");

  const composed: Mapping[] = [];
  for (const mapping of decodeMappings(outer)) {
    if (mapping.source === undefined || mapping.originalLine === undefined || mapping.originalColumn === undefined) {
      composed.push({ generatedLine: mapping.generatedLine, generatedColumn: mapping.generatedColumn });
      continue;
    }
    if (mapping.source !== intermediate) {
      composed.push({
        generatedLine: mapping.generatedLine,
        generatedColumn: mapping.generatedColumn,
        source: passthrough.get(mapping.source)!,
        originalLine: mapping.originalLine,
        originalColumn: mapping.originalColumn,
      });
      continue;
    }
    const selected = selectMapping(innerByLine.get(mapping.originalLine), mapping.originalColumn);
    if (selected?.source === undefined || selected.originalLine === undefined || selected.originalColumn === undefined) {
      composed.push({ generatedLine: mapping.generatedLine, generatedColumn: mapping.generatedColumn });
      continue;
    }
    const originalColumn = selected.originalColumn + (mapping.originalColumn - selected.generatedColumn);
    if (originalColumn < 0 || originalColumn > MAX_COORDINATE) {
      throw new TypeError("composed source map coordinate exceeds POC bounds");
    }
    composed.push({
      generatedLine: mapping.generatedLine,
      generatedColumn: mapping.generatedColumn,
      source: selected.source,
      originalLine: selected.originalLine,
      originalColumn,
    });
  }

  const wire = JSON.stringify({
    version: 3,
    file: basename(outputFileName),
    sourceRoot: "",
    sources,
    sourcesContent,
    names: [],
    mappings: encodeMappings(composed),
  });
  if (Buffer.byteLength(wire, "utf8") > MAX_MAP_BYTES) {
    throw new TypeError(`composed source map exceeds the ${MAX_MAP_BYTES} byte POC limit`);
  }
  return wire;
}
