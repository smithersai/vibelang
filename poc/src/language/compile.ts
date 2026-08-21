import { analyzeSource } from "./analyze";
import type { Analysis, ErrorDeclaration } from "./model";
import { applyEdits, matchPair, scanFunctionTail, tokenize, type Edit, type Token } from "./syntax";

export interface CompileOptions {
  /** Import specifier used by generated TypeScript. */
  readonly runtimeImport?: string;
  readonly sourceName?: string;
}

export interface CompileResult {
  readonly code: string;
  readonly analysis: Analysis;
}

interface CompilerHelpers {
  readonly error: string;
  readonly catch: string;
  readonly throw: string;
  readonly unwrap: string;
  readonly use: string;
}

export function compileVibe(source: string, options: CompileOptions = {}): CompileResult {
  const analysis = analyzeSource(source);
  const errorNames = new Set(analysis.errors.map((error) => error.name));
  const helpers = allocateHelpers(source);
  const providerLayer = importsProviderLayer(source);
  let code = stripProviderImports(source);
  code = lowerErrorDeclarations(code, helpers.error);
  code = lowerErrorConstruction(code, errorNames);
  code = lowerFunctionChannels(code, helpers.use);
  code = lowerPromiseErrorRows(code);
  code = lowerCatchExpressions(code, helpers.catch);
  code = lowerTryMarkers(code);
  code = lowerOptionals(code, helpers.unwrap);
  code = lowerThrowExpressions(code, helpers.throw);
  code = lowerSimpleIfExpressions(code);

  // A plain TypeScript file must remain a plain TypeScript file. In particular,
  // do not turn scripts into modules or reserve helper names when no VibeLang
  // lowering was needed.
  if (code === source) return { code: source, analysis };

  const runtimeImport = options.runtimeImport ?? "../runtime/index.ts";
  const sourceName = options.sourceName ?? "<memory>.vibe";
  const emittedIdentifiers = new Set(tokenize(code).filter((token) => token.kind === "identifier").map((token) => token.text));
  const imports = [
    ["__VSError", helpers.error],
    ["__vsCatch", helpers.catch],
    ["__vsThrow", helpers.throw],
    ["__vsUnwrap", helpers.unwrap],
    ["__vsUse", helpers.use],
  ].filter(([, local]) => emittedIdentifiers.has(local!));
  if (providerLayer) imports.push(["Layer", "Layer"]);
  const importNames = imports.map(([exported, local]) => exported === local ? exported : `${exported} as ${local}`);
  const header = `// Generated from ${sourceName} by the VibeLang risk-spike compiler.\n` +
    (importNames.length > 0
      ? `import { ${importNames.join(", ")} } from ${JSON.stringify(runtimeImport)};\n\n`
      : "\n");
  return { code: header + code, analysis };
}

function allocateHelpers(source: string): CompilerHelpers {
  const identifiers = new Set(tokenize(source).filter((token) => token.kind === "identifier").map((token) => token.text));
  const allocate = (base: string): string => {
    let candidate = base;
    let suffix = 0;
    while (identifiers.has(candidate)) candidate = `${base}$vibe${suffix++ || ""}`;
    identifiers.add(candidate);
    return candidate;
  };
  return {
    error: allocate("__VSError"),
    catch: allocate("__vsCatch"),
    throw: allocate("__vsThrow"),
    unwrap: allocate("__vsUnwrap"),
    use: allocate("__vsUse"),
  };
}

function importsProviderLayer(source: string): boolean {
  return tokenize(source).some((token) => token.kind === "string" && unquote(token.text) === "vibelang:provider");
}

function stripProviderImports(source: string): string {
  const tokens = tokenize(source);
  const edits: Edit[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]!.text !== "import") continue;
    let end = index + 1;
    while (end < tokens.length && tokens[end]!.text !== ";") {
      const moduleText = tokens[end]!.kind === "string" ? unquote(tokens[end]!.text) : undefined;
      if (moduleText === "vibelang:provider") {
        const lineStart = source.lastIndexOf("\n", tokens[index]!.start - 1) + 1;
        const lineEndIndex = source.indexOf("\n", tokens[end]!.end);
        const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex + 1;
        edits.push({ start: lineStart, end: lineEnd, text: "" });
        break;
      }
      end++;
    }
  }
  return applyEdits(source, edits);
}

function lowerErrorDeclarations(source: string, errorHelper: string): string {
  const analysis = analyzeSource(source);
  return applyEdits(
    source,
    analysis.errors.map((declaration) => ({
      start: declaration.start,
      end: declaration.end,
      text: emitErrorClass(declaration, errorHelper),
    })),
  );
}

function emitErrorClass(declaration: ErrorDeclaration, errorHelper: string): string {
  const fields = declaration.fieldsSource
    .split(/[,;\n]/)
    .map((field) => field.trim())
    .filter(Boolean)
    .map((field) => {
      const match = field.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*:\s*(.+)$/s);
      if (!match) throw new Error(`cannot parse field '${field}' on error ${declaration.name}`);
      return { name: match[1]!, type: match[2]!.trim() };
    });
  const parameter = `{ ${fields.map((field) => `${field.name}: ${field.type}`).join("; ")} }`;
  return [
    `class ${declaration.name} extends ${errorHelper} {`,
    `  declare readonly _tag: ${JSON.stringify(declaration.name)};`,
    ...fields.map((field) => `  declare readonly ${field.name}: ${field.type};`),
    fields.length > 0
      ? `  constructor(fields: ${parameter}) { super(${JSON.stringify(declaration.name)}, fields); }`
      : `  constructor() { super(${JSON.stringify(declaration.name)}); }`,
    `}`,
  ].join("\n");
}

function lowerErrorConstruction(source: string, errorNames: ReadonlySet<string>): string {
  const tokens = tokenize(source);
  const edits: Edit[] = [];
  for (let index = 0; index < tokens.length - 2; index++) {
    if (tokens[index]!.text !== "throw") continue;
    const candidate = tokens[index + 1]!;
    if (errorNames.has(candidate.text) && tokens[index + 2]!.text === "(") {
      edits.push({ start: candidate.start, end: candidate.start, text: "new " });
    }
  }
  return applyEdits(source, edits);
}

function lowerFunctionChannels(source: string, useHelper: string): string {
  const tokens = tokenize(source);
  const edits: Edit[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]!.text !== "function" || tokens[index + 1]?.kind !== "identifier") continue;
    let parametersOpen = index + 2;
    while (parametersOpen < tokens.length && tokens[parametersOpen]!.text !== "(") parametersOpen++;
    if (parametersOpen === tokens.length) continue;
    const parametersClose = matchPair(tokens, parametersOpen);
    const tail = scanFunctionTail(tokens, parametersClose);
    if (!tail) continue;
    const { bodyOpen, throwsIndex, usesIndex, bangIndex, colonIndex } = tail;
    const isAsync = tokens.slice(Math.max(0, index - 3), index).some((token) => token.text === "async");

    if (isAsync && colonIndex !== -1) {
      const rowBoundary = Math.min(
        ...[throwsIndex, usesIndex, bodyOpen].filter((candidate) => candidate !== -1),
      );
      const typeStartIndex = colonIndex + 1;
      const firstTypeIndex = bangIndex === typeStartIndex ? typeStartIndex + 1 : typeStartIndex;
      const typeEndIndex = rowBoundary - 1;
      if (firstTypeIndex <= typeEndIndex && tokens[firstTypeIndex]!.text !== "Promise") {
        let returnType = source.slice(tokens[firstTypeIndex]!.start, tokens[typeEndIndex]!.end).trim();
        if (/^\?[A-Za-z_$]/.test(returnType)) returnType = `${returnType.slice(1)} | null`;
        edits.push({
          start: tokens[typeStartIndex]!.start,
          end: tokens[typeEndIndex]!.end,
          text: `Promise<${returnType}>`,
        });
      } else if (bangIndex !== -1) {
        edits.push({ start: tokens[bangIndex]!.start, end: tokens[bangIndex]!.end, text: "" });
      }
    } else if (bangIndex !== -1) {
      edits.push({ start: tokens[bangIndex]!.start, end: tokens[bangIndex]!.end, text: "" });
    }
    if (throwsIndex !== -1) {
      const end = usesIndex === -1 ? tokens[bodyOpen]!.start : tokens[usesIndex]!.start;
      edits.push({ start: tokens[throwsIndex]!.start, end, text: "" });
    }
    if (usesIndex !== -1) {
      const requirements = parseRequirementSources(source, tokens, usesIndex + 1, bodyOpen);
      edits.push({ start: tokens[usesIndex]!.start, end: tokens[bodyOpen]!.start, text: " " });
      edits.push({
        start: tokens[bodyOpen]!.end,
        end: tokens[bodyOpen]!.end,
        text: requirements
          .map(({ binding, type }) => `\n  const ${binding}: ${type} = ${useHelper}(${type});`)
          .join(""),
      });
    }
  }
  return applyEdits(source, edits);
}

/** Promise<A, E> carries E only in the VibeLang checker; JavaScript emit keeps
 * the ordinary one-parameter Promise<A> representation. */
function lowerPromiseErrorRows(source: string): string {
  const tokens = tokenize(source);
  const edits: Edit[] = [];
  for (let index = 0; index < tokens.length - 4; index++) {
    if (tokens[index]!.text !== "Promise" || tokens[index + 1]!.text !== "<") continue;
    let angleDepth = 1;
    let delimiterDepth = 0;
    let comma = -1;
    let close = -1;
    for (let cursor = index + 2; cursor < tokens.length; cursor++) {
      const text = tokens[cursor]!.text;
      if (["(", "[", "{"].includes(text)) delimiterDepth++;
      else if ([")", "]", "}"].includes(text)) delimiterDepth--;
      else if (delimiterDepth === 0 && text === "<") angleDepth++;
      else if (delimiterDepth === 0 && text === ">" && --angleDepth === 0) {
        close = cursor;
        break;
      } else if (delimiterDepth === 0 && angleDepth === 1 && text === ",") {
        comma = cursor;
      }
    }
    if (comma !== -1 && close !== -1) {
      edits.push({ start: tokens[comma]!.start, end: tokens[close]!.start, text: "" });
      index = close;
    }
  }
  return applyEdits(source, edits);
}

function parseRequirementSources(
  source: string,
  tokens: readonly Token[],
  start: number,
  end: number,
): Array<{ binding: string; type: string }> {
  const requirements: Array<{ binding: string; type: string }> = [];
  let index = start;
  while (index < end) {
    const binding = tokens[index];
    if (!binding || binding.kind !== "identifier" || tokens[index + 1]?.text !== ":") break;
    const typeStart = index + 2;
    let cursor = typeStart;
    const expected: string[] = [];
    const closeFor: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };
    while (cursor < end) {
      const text = tokens[cursor]!.text;
      if (closeFor[text]) expected.push(closeFor[text]!);
      else if (expected.at(-1) === text) expected.pop();
      if (text === "," && expected.length === 0) break;
      cursor++;
    }
    const typeEnd = cursor === typeStart ? tokens[typeStart]!.end : tokens[cursor - 1]!.end;
    requirements.push({
      binding: binding.text,
      type: source.slice(tokens[typeStart]!.start, typeEnd).trim(),
    });
    index = cursor + 1;
  }
  return requirements;
}

function lowerCatchExpressions(source: string, catchHelper: string): string {
  let result = source;
  for (;;) {
    const lowered = lowerFirstCatch(result, catchHelper);
    if (!lowered) return result;
    result = lowered;
  }
}

function lowerFirstCatch(source: string, catchHelper: string): string | undefined {
  const tokens = tokenize(source);
  for (let catchIndex = 0; catchIndex < tokens.length; catchIndex++) {
    if (tokens[catchIndex]!.text !== "catch") continue;
    // Preserve both JavaScript catch spellings: `catch (error) {}` and the
    // optional-binding form `catch {}`.
    if (
      tokens[catchIndex - 1]?.text === "}" &&
      ["(", "{"].includes(tokens[catchIndex + 1]?.text ?? "")
    ) continue;
    const leftEndIndex = catchIndex - 1;
    if (leftEndIndex < 0) continue;
    const leftStartIndex = expressionStart(tokens, leftEndIndex);
    let cursor = catchIndex + 1;
    let capture = "__failure";
    if (tokens[cursor]?.text === "|") {
      if (tokens[cursor + 1]?.kind !== "identifier" || tokens[cursor + 2]?.text !== "|") {
        throw new Error(`malformed catch capture at offset ${tokens[catchIndex]!.start}`);
      }
      capture = tokens[cursor + 1]!.text;
      cursor += 3;
    }

    let handler: string;
    let endOffset: number;
    if (tokens[cursor]?.text === "switch") {
      const lowered = lowerCatchSwitch(source, tokens, cursor, capture);
      handler = lowered.handler;
      endOffset = lowered.endOffset;
    } else {
      const fallbackEnd = expressionEnd(source, tokens, cursor);
      const fallback = source.slice(tokens[cursor]!.start, fallbackEnd).trim();
      const asyncPrefix = hasTokenBeforeOffset(tokens, cursor, fallbackEnd, "await") ? "async " : "";
      handler = fallback.startsWith("throw ")
        ? `${asyncPrefix}(${capture}: any) => { ${fallback}; }`
        : `${asyncPrefix}(${capture}: any) => (${fallback})`;
      endOffset = fallbackEnd;
    }

    let left = source.slice(tokens[leftStartIndex]!.start, tokens[leftEndIndex]!.end).trim();
    let awaitPrefix = "";
    if (/^try\s+/.test(left)) left = left.replace(/^try\s+/, "");
    if (/^await\s+/.test(left)) {
      left = left.replace(/^await\s+/, "");
      awaitPrefix = "await ";
    }
    if (/^try\s+/.test(left)) left = left.replace(/^try\s+/, "");
    const replacement = `${awaitPrefix}${catchHelper}(() => (${left}), ${handler})`;
    return (
      source.slice(0, tokens[leftStartIndex]!.start) +
      replacement +
      source.slice(endOffset)
    );
  }
  return undefined;
}

function lowerCatchSwitch(
  source: string,
  tokens: readonly Token[],
  switchIndex: number,
  capture: string,
): { handler: string; endOffset: number } {
  if (tokens[switchIndex + 1]?.text !== "(") throw new Error("catch switch requires a condition");
  const conditionClose = matchPair(tokens, switchIndex + 1);
  const bodyOpen = conditionClose + 1;
  if (tokens[bodyOpen]?.text !== "{") throw new Error("catch switch requires a body");
  const bodyClose = matchPair(tokens, bodyOpen);
  const cases: string[] = [];
  let isAsync = false;
  let cursor = bodyOpen + 1;
  while (cursor < bodyClose) {
    if (tokens[cursor]!.text === ",") {
      cursor++;
      continue;
    }
    const failure = tokens[cursor];
    if (!failure || failure.kind !== "identifier" || tokens[cursor + 1]?.text !== "=>") {
      throw new Error(`malformed catch switch arm at offset ${tokens[cursor]!.start}`);
    }
    const armStart = cursor + 2;
    const armEnd = findArmEnd(tokens, armStart, bodyClose);
    const expressionEndOffset = armEnd === bodyClose ? tokens[bodyClose]!.start : tokens[armEnd]!.start;
    const expression = source.slice(tokens[armStart]!.start, expressionEndOffset).trim();
    isAsync ||= hasTokenBeforeOffset(tokens, armStart, expressionEndOffset, "await");
    cases.push(
      expression.startsWith("throw ")
        ? `case ${JSON.stringify(failure.text)}: ${expression};`
        : `case ${JSON.stringify(failure.text)}: return (${expression});`,
    );
    cursor = armEnd + (tokens[armEnd]?.text === "," ? 1 : 0);
  }
  return {
    handler: `${isAsync ? "async " : ""}(${capture}: any) => { switch (${capture}._tag) { ${cases.join(" ")} default: throw ${capture}; } }`,
    endOffset: tokens[bodyClose]!.end,
  };
}

function hasTokenBeforeOffset(
  tokens: readonly Token[],
  start: number,
  endOffset: number,
  text: string,
): boolean {
  for (let index = start; index < tokens.length && tokens[index]!.start < endOffset; index++) {
    if (tokens[index]!.text === text) return true;
  }
  return false;
}

function lowerTryMarkers(source: string): string {
  const tokens = tokenize(source);
  const edits: Edit[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (
      tokens[index]!.text !== "try" ||
      tokens[index + 1]?.text === "{" ||
      tokens[index + 1]?.text === "(" ||
      tokens[index - 1]?.text === "." ||
      tokens[index - 1]?.text === "?."
    ) continue;
    edits.push({ start: tokens[index]!.start, end: tokens[index]!.end, text: "" });
  }
  return applyEdits(source, edits);
}

function lowerOptionals(source: string, unwrapHelper: string): string {
  let result = source;
  let tokens = tokenize(result);
  let edits: Edit[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (
      tokens[index]!.text === "orelse" &&
      isOptionalOperatorLeft(tokens[index - 1]) &&
      isOptionalOperatorRight(tokens[index + 1])
    ) {
      edits.push({ start: tokens[index]!.start, end: tokens[index]!.end, text: "??" });
    }
    if (
      tokens[index]!.text === "?" &&
      tokens[index - 1]?.text !== "." &&
      tokens[index + 1]?.kind === "identifier" &&
      (tokens[index - 1]?.text === ":" || tokens[index - 1]?.text === "!")
    ) {
      const type = tokens[index + 1]!;
      edits.push({ start: tokens[index]!.start, end: type.end, text: `${type.text} | null` });
    }
  }
  result = applyEdits(result, edits);

  // Lower asserted unwraps one at a time because each replacement changes the
  // token offsets used by the next expression.
  for (;;) {
    tokens = tokenize(result);
    const dot = tokens.findIndex(
      (token, index) => token.text === "." && ["?", "?."].includes(tokens[index + 1]?.text ?? ""),
    );
    if (dot === -1) break;
    const start = expressionStart(tokens, dot - 1);
    const expression = result.slice(tokens[start]!.start, tokens[dot - 1]!.end);
    const preservesFollowingProperty = tokens[dot + 1]!.text === "?.";
    result =
      result.slice(0, tokens[start]!.start) +
      `${unwrapHelper}(${expression})${preservesFollowingProperty ? "." : ""}` +
      result.slice(tokens[dot + 1]!.end);
  }
  return result;
}

function isOptionalOperatorLeft(token: Token | undefined): boolean {
  if (!token) return false;
  return token.kind === "identifier" || token.kind === "number" || token.kind === "string" ||
    token.kind === "template" || [")", "]", "}"].includes(token.text);
}

function isOptionalOperatorRight(token: Token | undefined): boolean {
  if (!token) return false;
  return token.kind === "identifier" || token.kind === "number" || token.kind === "string" ||
    token.kind === "template" || ["(", "[", "{"].includes(token.text);
}

function lowerSimpleIfExpressions(source: string): string {
  let result = source;
  for (;;) {
    const tokens = tokenize(result);
    let changed = false;
    for (let index = 0; index < tokens.length; index++) {
      if (tokens[index]!.text !== "if" || !["=", "return", "=>"].includes(tokens[index - 1]?.text ?? "")) continue;
      if (tokens[index + 1]?.text !== "(") continue;
      const conditionClose = matchPair(tokens, index + 1);
      if (tokens[conditionClose + 1]?.text === "{") continue; // block form: explicitly diagnosed by analysis
      const elseIndex = findElse(tokens, conditionClose + 1);
      if (elseIndex === -1 || tokens[elseIndex + 1]?.text === "if" || tokens[elseIndex + 1]?.text === "{") continue;
      const end = expressionEnd(result, tokens, elseIndex + 1);
      const condition = result.slice(tokens[index + 1]!.end, tokens[conditionClose]!.start);
      const whenTrue = result.slice(tokens[conditionClose + 1]!.start, tokens[elseIndex]!.start).trim();
      const whenFalse = result.slice(tokens[elseIndex + 1]!.start, end).trim();
      result = result.slice(0, tokens[index]!.start) + `((${condition}) ? (${whenTrue}) : (${whenFalse}))` + result.slice(end);
      changed = true;
      break;
    }
    if (!changed) return result;
  }
}

function lowerThrowExpressions(source: string, throwHelper: string): string {
  let result = source;
  for (;;) {
    const tokens = tokenize(result);
    const index = tokens.findIndex(
      (token, current) =>
        token.text === "throw" &&
        ["??", "=>", "=", "(", "[", ","].includes(tokens[current - 1]?.text ?? ""),
    );
    if (index === -1) return result;
    const end = expressionEnd(result, tokens, index + 1);
    const expression = result.slice(tokens[index + 1]!.start, end).trim();
    result =
      result.slice(0, tokens[index]!.start) +
      `${throwHelper}(${expression})` +
      result.slice(end);
  }
}

function findElse(tokens: readonly Token[], start: number): number {
  const expected: string[] = [];
  const closeFor: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (let index = start; index < tokens.length; index++) {
    const text = tokens[index]!.text;
    if (closeFor[text]) expected.push(closeFor[text]!);
    else if (expected.at(-1) === text) expected.pop();
    else if (expected.length === 0 && text === "else") return index;
    else if (expected.length === 0 && [";", ","].includes(text)) return -1;
  }
  return -1;
}

function expressionStart(tokens: readonly Token[], end: number): number {
  const expected: string[] = [];
  const openFor: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (let index = end; index >= 0; index--) {
    const text = tokens[index]!.text;
    if (openFor[text]) expected.push(openFor[text]!);
    else if (expected.at(-1) === text) expected.pop();
    else if (expected.length === 0 && ["(", "["].includes(text)) return index + 1;
    else if (
      expected.length === 0 &&
      ["=", ";", ",", "{", "}", ":", "return", "=>"].includes(text)
    ) {
      return index + 1;
    }
  }
  return 0;
}

function expressionEnd(source: string, tokens: readonly Token[], start: number): number {
  const expected: string[] = [];
  const closeFor: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (let index = start; index < tokens.length; index++) {
    const text = tokens[index]!.text;
    if (closeFor[text]) expected.push(closeFor[text]!);
    else if (expected.at(-1) === text) expected.pop();
    else if (expected.length === 0 && [";", ",", "}"].includes(text)) return tokens[index]!.start;
    if (expected.length === 0 && index + 1 < tokens.length) {
      const gap = source.slice(tokens[index]!.end, tokens[index + 1]!.start);
      if (gap.includes("\n")) return tokens[index]!.end;
    }
  }
  return source.length;
}

function findArmEnd(tokens: readonly Token[], start: number, bodyClose: number): number {
  const expected: string[] = [];
  const closeFor: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (let index = start; index < bodyClose; index++) {
    const text = tokens[index]!.text;
    if (closeFor[text]) expected.push(closeFor[text]!);
    else if (expected.at(-1) === text) expected.pop();
    else if (expected.length === 0 && text === ",") return index;
  }
  return bodyClose;
}

function findToken(tokens: readonly Token[], start: number, end: number, text: string): number {
  for (let index = start; index < end; index++) if (tokens[index]!.text === text) return index;
  return -1;
}

function unquote(text: string): string {
  return text.slice(1, -1);
}
