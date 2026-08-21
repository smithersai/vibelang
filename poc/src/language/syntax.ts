export type TokenKind = "identifier" | "number" | "string" | "template" | "punctuation";

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface FunctionTail {
  readonly bodyOpen: number;
  readonly colonIndex: number;
  readonly bangIndex: number;
  readonly throwsIndex: number;
  readonly usesIndex: number;
}

const multiCharacterPunctuation = [
  ">>>=", "===", "!==", "**=", "&&=", "||=", "??=", ">>>", "<<=", ">>=",
  "=>", "==", "!=", "<=", ">=", "++", "--", "&&", "||", "??", "?.", "**",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "...",
] as const;

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index]!;
    if (/\s/.test(character)) {
      index++;
      continue;
    }

    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close === -1 ? source.length : close + 2;
      continue;
    }

    if (character === '"' || character === "'") {
      const start = index;
      index = skipQuoted(source, index, character);
      tokens.push({ kind: "string", text: source.slice(start, index), start, end: index });
      continue;
    }
    if (character === "`") {
      const start = index;
      index = skipTemplate(source, index);
      tokens.push({ kind: "template", text: source.slice(start, index), start, end: index });
      continue;
    }

    if (isIdentifierStart(character)) {
      const start = index++;
      while (index < source.length && isIdentifierContinue(source[index]!)) index++;
      tokens.push({ kind: "identifier", text: source.slice(start, index), start, end: index });
      continue;
    }

    if (/[0-9]/.test(character)) {
      const start = index++;
      while (index < source.length && /[\w.]/.test(source[index]!)) index++;
      tokens.push({ kind: "number", text: source.slice(start, index), start, end: index });
      continue;
    }

    const start = index;
    const punctuation = multiCharacterPunctuation.find((candidate) => source.startsWith(candidate, index));
    index += punctuation?.length ?? 1;
    tokens.push({
      kind: "punctuation",
      text: punctuation ?? character,
      start,
      end: index,
    });
  }

  return tokens;
}

function skipQuoted(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index++;
  }
  return index;
}

/** Template interpolation is deliberately opaque to this spike, but balanced
 * braces are still skipped so language keywords in strings are never parsed. */
function skipTemplate(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === "`") return index + 1;
    index++;
  }
  return index;
}

function isIdentifierStart(character: string): boolean {
  return /[A-Za-z_$]/.test(character);
}

function isIdentifierContinue(character: string): boolean {
  return /[A-Za-z0-9_$]/.test(character);
}

const pairs: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

export function matchPair(tokens: readonly Token[], openIndex: number): number {
  const open = tokens[openIndex]?.text;
  const close = open && pairs[open];
  if (!close) throw new Error(`expected opening delimiter at token ${openIndex}`);
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index++) {
    const text = tokens[index]!.text;
    if (text === open) depth++;
    if (text === close && --depth === 0) return index;
  }
  throw new Error(`unbalanced '${open}' at offset ${tokens[openIndex]!.start}`);
}

export function applyEdits(source: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start || right.end - left.end);
  let lastStart = source.length + 1;
  let result = source;
  for (const edit of ordered) {
    if (edit.end > lastStart) {
      throw new Error(`overlapping compiler edits at ${edit.start}..${edit.end}`);
    }
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    lastStart = edit.start;
  }
  return result;
}

export function lineAndColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index++) {
    if (source[index] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

export function tokenText(source: string, tokens: readonly Token[], start: number, endInclusive: number): string {
  return source.slice(tokens[start]!.start, tokens[endInclusive]!.end);
}

export function findTopLevelToken(
  tokens: readonly Token[],
  start: number,
  endExclusive: number,
  text: string,
): number {
  const stack: string[] = [];
  for (let index = start; index < endExclusive; index++) {
    const current = tokens[index]!.text;
    if (current in pairs) stack.push(pairs[current]!);
    else if (stack.at(-1) === current) stack.pop();
    else if (stack.length === 0 && current === text) return index;
  }
  return -1;
}

/**
 * Finds the source-language tail of a function declaration without confusing a
 * return object type with the function body. This remains a deliberately small
 * scanner, but keeping it shared prevents the analyzer and emitter from
 * disagreeing about contextual `throws`/`uses` tokens.
 */
export function scanFunctionTail(
  tokens: readonly Token[],
  parametersClose: number,
): FunctionTail | undefined {
  const colonIndex = tokens[parametersClose + 1]?.text === ":" ? parametersClose + 1 : -1;
  let cursor = parametersClose + 1;
  let bodyOpen = -1;
  const expected: string[] = [];
  const closeFor: Readonly<Record<string, string>> = { "(": ")", "[": "]", "<": ">" };
  const objectTypeIntroducers = new Set([":", "|", "&", "?", "=>", "is", "asserts"]);

  while (cursor < tokens.length) {
    const text = tokens[cursor]!.text;
    if (expected.length > 0) {
      if (closeFor[text]) expected.push(closeFor[text]!);
      else if (text === expected.at(-1)) expected.pop();
      cursor++;
      continue;
    }
    if (closeFor[text]) {
      expected.push(closeFor[text]!);
      cursor++;
      continue;
    }
    if (text === "{") {
      const previous = tokens[cursor - 1]?.text;
      if (colonIndex !== -1 && objectTypeIntroducers.has(previous ?? "")) {
        cursor = matchPair(tokens, cursor) + 1;
        continue;
      }
      bodyOpen = cursor;
      break;
    }
    cursor++;
  }
  if (bodyOpen === -1) return undefined;

  const usesIndex = findUsesMarker(tokens, parametersClose + 1, bodyOpen);
  const throwsBoundary = usesIndex === -1 ? bodyOpen : usesIndex;
  const throwsIndex = findThrowsMarker(tokens, parametersClose + 1, throwsBoundary);
  const bangIndex = colonIndex !== -1 && tokens[colonIndex + 1]?.text === "!" ? colonIndex + 1 : -1;
  return { bodyOpen, colonIndex, bangIndex, throwsIndex, usesIndex };
}

function findUsesMarker(tokens: readonly Token[], start: number, end: number): number {
  for (let index = start; index + 2 < end; index++) {
    if (
      tokens[index]!.text === "uses" &&
      tokens[index + 1]?.kind === "identifier" &&
      tokens[index + 2]?.text === ":"
    ) return index;
  }
  return -1;
}

function findThrowsMarker(tokens: readonly Token[], start: number, end: number): number {
  for (let index = end - 1; index >= start; index--) {
    if (tokens[index]!.text !== "throws" || index + 1 >= end) continue;
    let expectFailure = true;
    let valid = true;
    for (let cursor = index + 1; cursor < end; cursor++) {
      const token = tokens[cursor]!;
      if (expectFailure ? token.kind !== "identifier" : token.text !== "|") {
        valid = false;
        break;
      }
      expectFailure = !expectFailure;
    }
    if (valid && !expectFailure) return index;
  }
  return -1;
}
