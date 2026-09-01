import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import * as ts from "typescript-js";
import type { Analysis, AnalyzeOptions, Diagnostic, ErrorDeclaration, FunctionChannel } from "./model.ts";
import {
  composeSourceMaps,
  createOffsetSourceMap,
  createPreciseSourceMap,
  type SourceMapAnchor,
} from "./source-map.ts";
import {
  buildSemanticModel,
  chargesCompilerPanic,
  declaredRequirementRow,
  effectiveChannel,
  expectReceiver,
  expressionShape,
  identityFileName,
  isErrorMatchCall,
  isErrorType,
  isLayerProvideCall,
  isPanicExitCall,
  isResultExpectExpression,
  isResultPropagationExpression,
  isUnwidenedIndexedAccess,
  NominalErrorIdentities,
  nominalErrorIdentity,
  type CallEdge,
  type SemanticFunction,
  type SemanticModel,
} from "./semantic.ts";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface CompileOptions extends AnalyzeOptions {
  /** Import specifier used by generated TypeScript. */
  readonly runtimeImport?: string;
  /** Display name and source-map source. */
  readonly sourceName?: string;
  /** Emit a version-3 source map in CompileResult.sourceMap (default true). */
  readonly sourceMap?: boolean;
  /** Generated file path, used to keep relative imports correct when moved. */
  readonly outputFileName?: string;
  /**
   * Keep relative authored `.sm` module specifiers exactly as written instead
   * of rewriting them to the generated output name. Cross-module analysis is
   * unaffected; an external bridge that performs its own `.sm` -> `.js`
   * rewrite needs the authored text (and therefore the authored columns) intact.
   * Compiler virtual modules and non-`.sm` relative specifiers still rewrite.
   */
  readonly preserveSmithersSpecifiers?: boolean;
}


/**
 * @internal Project-level emit bindings resolved once per `compileProject`
 * call and shared by every lowered module.
 */
export interface ProjectEmitBindings {
  /** Absolute authored/aliased source path -> absolute generated output path. */
  readonly outputBySource?: ReadonlyMap<string, string>;
  /** Absolute source paths whose import attributes must not survive emit. */
  readonly stripImportAttributesForSources?: ReadonlySet<string>;
  /** Absolute paths of the authored `.sm` modules in this project. */
  readonly smithersSourceNames?: ReadonlySet<string>;
  /**
   * The compilation-wide nominal Error identity assigner.
   *
   * `compileProject` passes ONE instance across every module so the invariant
   * spans the whole compilation rather than one file at a time: the two ways
   * {@link nominalErrorIdentity}'s predecessor lost injectivity were a
   * within-file one (the bound cut the class name off) and a cross-file one (two
   * file names normalized together), and a per-file assigner would only have
   * seen the first. A single-file `compileSmithers` gets its own instance.
   */
  readonly nominalIdentities?: NominalErrorIdentities;
}

/**
 * Nominal Error identity collisions across one compilation, one diagnostic per
 * declaration that could not be given an identity of its own.
 *
 * This is a defensive invariant and on today's algorithm it never fires:
 * {@link nominalErrorIdentity} is injective, and `SMITHERS1150` separately
 * refuses two Error classes with one name in one module. It exists because the
 * failure it guards is a fail-OPEN — a clean compile whose artifact throws
 * `stable Error identity … is already registered` at load — and because the
 * algorithm has now been weakened into exactly that state twice. With this in
 * the emit path, a third weakening is a refusal instead of a broken artifact.
 */
function nominalIdentityCollisions(
  sourceName: string,
  source: string,
  errors: readonly ErrorDeclaration[],
  identities: NominalErrorIdentities,
): readonly Diagnostic[] {
  const collisions: Diagnostic[] = [];
  for (const error of errors) {
    const claim = identities.claim(sourceName, error.name);
    if (claim.collidesWith === undefined) continue;
    const clamped = Math.max(0, Math.min(error.start, source.length));
    const preceding = source.lastIndexOf("\n", clamped - 1);
    collisions.push({
      severity: "error",
      code: "SMITHERS1151",
      message: `Error class '${error.name}' in '${sourceName}' cannot receive a stable nominal identity: ` +
        `it mints ${claim.identity}, which '${claim.collidesWith}' already holds`,
      start: error.start,
      line: clamped === 0 ? 1 : source.slice(0, clamped).split("\n").length,
      column: clamped - preceding,
    });
  }
  return collisions;
}

export interface CompileResult {
  readonly code: string;
  readonly sourceMap?: string;
  readonly analysis: Analysis;
}

interface HelperBinding {
  readonly exported: string;
  readonly local: string;
  readonly typeOnly?: boolean;
}

interface TransformState {
  readonly model: SemanticModel;
  readonly factory: ts.NodeFactory;
  readonly runtimeImport: string;
  readonly sourceName: string;
  readonly outputFileName?: string;
  readonly helpers: Map<string, HelperBinding>;
  readonly identifiers: Set<string>;
  readonly errorStarts: ReadonlyMap<number, string>;
  readonly projectOutputBySource?: ReadonlyMap<string, string>;
  readonly stripImportAttributesForSources?: ReadonlySet<string>;
  readonly preserveSmithersSpecifiers: boolean;
  readonly smithersSourceNames?: ReadonlySet<string>;
  readonly sourceMapOrigins: Map<ts.Node, ts.Node>;
  /** Lowered switch statements proven unable to complete past their clauses. */
  readonly nonFallingSwitches: Set<ts.Node>;
  /** @see resumableScopes */
  readonly scopes: ResumableScopes;
  changed: boolean;
  temporary: number;
}

/**
 * The three tables the `"yield"` lowering is decided by, computed once per
 * module before the transform runs.
 *
 * Computed rather than discovered mid-walk because both answers have to be
 * available at a node BEFORE that node's enclosing function is rebuilt: a call
 * site needs to know whether its own scope is resumable, and its scope needs to
 * know whether it contains a call that will be a `yield*`. A walk that answered
 * either question lazily would answer it differently depending on the order the
 * transformer happened to reach the two.
 */
interface ResumableScopes {
  /**
   * Every function in THIS module emitted as a generator: a resumable function
   * declaration ({@link isResumableFunction}), plus every `Layer.provide`
   * callback, which becomes the delimited computation whether or not it reads a
   * capability itself.
   */
  readonly generators: ReadonlySet<ts.Node>;
  /**
   * Every `Layer.provide` call in this module, mapped to the callback the
   * emitter can turn into a generator — or `undefined` when it cannot, in which
   * case the call is left exactly as authored and its capability reads are
   * answered by the environment shim.
   */
  readonly provides: ReadonlyMap<ts.CallExpression, FunctionLikeWithBody | undefined>;
  /**
   * Function declarations the project mentions somewhere other than in callee
   * position, and which therefore MUST keep the ordinary calling convention.
   *
   * MEASURED, not anticipated. `the-coercion-row-reaches-the-provide-site-and-runs`
   * writes `const referenceProperty = { valueOf: referenceImpl }` over a
   * function declaration that reads a capability; emitted as a generator it
   * made `Number(referenceProperty)` produce `NaN`, because the coercion
   * protocol called the slot and got a generator object. Nothing about that is
   * specific to `valueOf` — an element of an array of handlers, a field, a
   * default argument, a re-export all do it — so the rule is about the
   * REFERENCE, not about any host protocol.
   *
   * It also carries the soundness argument for {@link callConvention}'s last
   * arm: a function this set excludes is never a generator, and a function it
   * does not exclude is only ever reachable by its own name in callee position.
   * So a call through a value can never reach a generator, and a call the
   * checker cannot resolve at all can never reach one. The bare-name shape that
   * arm used to refuse is decided by the callee's type; see G7 there.
   */
  readonly escaping: ReadonlySet<ts.Node>;
}

/**
 * A function the `"yield"` lowering emits as a generator.
 *
 * DEPENDENCY ONLY, and the second clause is the load-bearing one: a non-empty
 * `failures` row means the function already carries the OTHER lowering — its
 * body returns a `Result` and every `!` in it is a `return` of the error
 * variant — and mixing the two conventions in one function is what step 7
 * exists to design. Until then a fallible function is left exactly as the
 * default lowering leaves it, and a capability read inside one reaches the
 * environment shim.
 *
 * Only a FUNCTION DECLARATION qualifies. An arrow or a function expression is
 * usually a value handed to something that will call it — `Array.prototype.map`,
 * a `valueOf` slot, a `Result.try` boundary — and none of those will drive a
 * generator; a method or an accessor cannot be one at all. The uniform
 * convention is uniform over the population it can be uniform over, and the
 * refusal below covers what is left.
 */
function isResumableFunction(fn: SemanticFunction, scopes: ResumableScopes): boolean {
  return ts.isFunctionDeclaration(fn.node) && !fn.async &&
    // `capabilityRequirements`, NOT `requirements`, and the difference is a
    // measured bug rather than a nicety. An ambient CHARGE
    // (`specification/compatibility.mdx` §Determinism-Sensitive Members rows
    // three and five: `Promise.race` charges `Scheduler`,
    // `"a".localeCompare(b)` charges `Locale`) publishes a requirement with no
    // `Capability.context()` anywhere to lower into a `get` request. Keyed on
    // the full row, the first ICU call in a program turned its `main` into a
    // generator that yields nothing and that nobody drives, and the conformance
    // harness received `[object Generator]` where it expected `string[]`.
    //
    // The row is still the published one; this is only the question "will this
    // body issue a request", which is the only question the calling convention
    // turns on.
    fn.capabilityRequirements.size > 0 && fn.failures.size === 0 &&
    !scopes.escaping.has(fn.node);
}

/**
 * Every declaration the project names outside callee position, over the whole
 * program.
 *
 * WHOLE PROGRAM, not this module: the convention a function is emitted in is
 * decided where it is DECLARED and the escape can be written anywhere, so a
 * per-module answer would emit a generator in one file because the value
 * reference sits in another. Declaration files are skipped — nothing in one was
 * emitted by this compiler — and so are the positions where an identifier names
 * a binding rather than reading it: the declaration's own name, an import or
 * export specifier, and a member name.
 */
function escapingDeclarations(model: SemanticModel): ReadonlySet<ts.Node> {
  const escaping = new Set<ts.Node>();
  const checker = model.checker;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isBindingPosition(node) && !isCalleePosition(node)) {
      // `{ reads }` is BOTH a property name and a read of the binding, and
      // `getSymbolAtLocation` answers with the property. The value symbol is
      // reached through the shorthand accessor, and it is the one that escapes.
      const parent = node.parent;
      const symbol = parent !== undefined && ts.isShorthandPropertyAssignment(parent)
        ? checker.getShorthandAssignmentValueSymbol(parent)
        : checker.getSymbolAtLocation(node);
      const resolved = symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
        ? checker.getAliasedSymbol(symbol)
        : symbol;
      for (const declaration of resolved?.declarations ?? []) escaping.add(declaration);
    }
    ts.forEachChild(node, visit);
  };
  for (const file of model.program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;
    visit(file);
  }
  return escaping;
}

/** An identifier that names a binding rather than reading its value. */
function isBindingPosition(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent)) {
    return true;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)) && parent.name === node) {
    return true;
  }
  // A shorthand property assignment is deliberately absent: `{ referenceImpl }`
  // both names the binding and READS it, and reading is what escapes.
  if (ts.isShorthandPropertyAssignment(parent)) return false;
  return (parent as ts.NamedDeclaration).name === node;
}

/** An identifier read only to be called immediately, through any number of parentheses. */
function isCalleePosition(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  while (current.parent !== undefined && ts.isParenthesizedExpression(current.parent)) current = current.parent;
  const parent = current.parent;
  return parent !== undefined &&
    (ts.isCallExpression(parent) || ts.isNewExpression(parent) || ts.isTaggedTemplateExpression(parent)) &&
    ((parent as ts.CallExpression | ts.NewExpression).expression === current ||
      (ts.isTaggedTemplateExpression(parent) && parent.tag === current));
}

function resumableScopes(model: SemanticModel): ResumableScopes {
  const generators = new Set<ts.Node>();
  const provides = new Map<ts.CallExpression, FunctionLikeWithBody | undefined>();
  const escaping = escapingDeclarations(model);
  const partial: ResumableScopes = { generators, provides, escaping };
  for (const fn of model.functions) {
    if (isResumableFunction(fn, partial)) generators.add(fn.node);
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isLayerProvideCall(node, model.checker)) {
      const callback = node.arguments[1];
      // An inline function literal with a body is the only shape that can be
      // turned into a generator in place. A callback that is a REFERENCE to a
      // function declared elsewhere would have to be lowered at its
      // declaration, which would make one function's convention depend on a
      // call site in another module; that is exactly the whole-program fact G7
      // adds and this step does not have.
      const inline = node.arguments.length === 2 && callback && isFunctionLikeWithBody(callback) &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        !hasAsyncModifier(callback) && callback.asteriskToken === undefined
        ? callback
        : undefined;
      provides.set(node, inline);
      if (inline) generators.add(inline);
    }
    ts.forEachChild(node, visit);
  };
  visit(model.sourceFile);
  return partial;
}

function hasAsyncModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
}

/** Whether the expression being rewritten sits directly in a generator scope. */
function inResumableScope(owner: SemanticFunction | undefined, state: TransformState): boolean {
  return owner !== undefined && state.scopes.generators.has(owner.node);
}

/** What the `"yield"` emitter does with one call site. */
type CallConvention = "plain" | "delegate";

/**
 * THE ONE TABLE that decides a call site's convention, asked by both the
 * refusal pass and the emitter so the two cannot disagree.
 *
 * The question is only ever "is the callee emitted as a generator", and there
 * are exactly four ways to answer it:
 *
 *   1. A resolved call edge names the callee. {@link isResumableFunction}
 *      decides, and this is the case for every ordinary `.sm` call.
 *   2. A foreign edge or a `panic` exit names something that is not a `.sm`
 *      function body at all, so it is never a generator.
 *   3. No edge, but the checker resolves the call to a signature with an
 *      IMPLEMENTATION — a method, an accessor, a constructor, an abstract
 *      member, a function the analysis owns. The uniform convention decides
 *      these without an edge, because it lowers only function declarations:
 *      `directory.lookup(key)` on a capability service is a method and can
 *      therefore never be a generator, which is why the DI lowering is usable
 *      at all.
 *   4. No edge and only a TYPE-level signature — a parameter typed
 *      `(x: string) => number`, a call through an interface member, a call into
 *      a `.d.ts`. The value actually called is whatever the caller passed, and
 *      the only fact that can settle it is a requirement row on the callee's
 *      TYPE.
 *
 * ## G7 — case 4 is decided, and `SMITHERS1807` is retired
 *
 * Case 4 was gap G2 and was REFUSED as `SMITHERS1807`, because emitting `f()`
 * where the value is a generator hands the caller a generator object — a silent
 * wrong answer — and `yield* f()` fails on every callee that is not one. There
 * is now a third answer, and it comes from two locked sentences in
 * `docs/DECISIONS.md` §Function model rather than from a guess:
 *
 *   - "An unannotated function type carries the empty row."
 *   - "A function whose row is empty is never emitted in the resumable calling
 *     convention."
 *
 * Together those make a bare type-level signature DECIDABLE and the answer
 * `"plain"`, not undecidable. `ResumableScopes.escaping` is the operational
 * proof for this compilation: a function this mode emits as a generator is
 * mentioned NOWHERE except in callee position, so no value in the program can
 * hold one, and a call through a parameter can never reach one.
 *
 * ## The fail-open G7 actually closes, which is the other half
 *
 * The retired arm exempted declaration files outright — "nothing in a `.d.ts`
 * was emitted by this compiler". That was FALSE the moment this mode emitted
 * one. `declarations.ts` writes `@smithersEffects {"requirements":[…]}` onto
 * every exported declaration and rewrites the return type to
 * `__vsResumable<A>`, so a `.d.ts` from a previously compiled `.sm` package
 * names generators this compiler produced — and the exemption lowered every
 * such call as `plain`. Measured on an emitted declaration: the tag is present,
 * carries the row, and the old walk reached `isImplementationSignature` first
 * and answered `plain`.
 *
 * So the published row is consulted BEFORE the kind test and before the
 * declaration-file exemption: a declaration that publishes a non-empty
 * requirement row is a generator whatever its kind. That ordering is the fix;
 * the ordering the other way round reproduces the fail-open exactly.
 *
 * `SMITHERS1802` stays where it is — the migration plan measures it as closing
 * roughly 80% of this same gap by keeping the call graph total.
 */
function callConvention(
  call: ts.CallExpression,
  model: SemanticModel,
  scopes: ResumableScopes,
): CallConvention {
  const edge = model.callEdges.get(call);
  if (edge?.callee) return isResumableFunction(edge.callee, scopes) ? "delegate" : "plain";
  if (edge) return "plain";
  const declaration = model.checker.getResolvedSignature(call)?.declaration;
  if (declaration !== undefined) {
    const known = model.functionByNode.get(declaration);
    if (known) return isResumableFunction(known, scopes) ? "delegate" : "plain";
    // G7, and FIRST: a declaration that publishes a row publishes it whatever
    // its syntactic kind, and both tests below would otherwise answer `plain`
    // for a generator this compiler emitted.
    if (declaredRequirementRow(declaration).size > 0) return "delegate";
    if (isImplementationSignature(declaration.kind)) return "plain";
    if (declaration.getSourceFile().isDeclarationFile) return "plain";
  }
  // The type carries the empty row, and a function whose row is empty is never
  // a generator. See the G7 note above for why this is a decision and not a
  // guess.
  return "plain";
}

/**
 * A signature that names a body position rather than a type. An abstract member
 * and an overload signature have no body of their own and still qualify: both
 * name a declaration site the analysis can see, and neither can be a function
 * declaration, which is the only shape this mode emits as a generator.
 */
function isImplementationSignature(kind: ts.SyntaxKind): boolean {
  switch (kind) {
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.FunctionExpression:
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
    case ts.SyntaxKind.Constructor:
      return true;
    default:
      return false;
  }
}

function lineAndColumnOfText(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const preceding = text.lastIndexOf("\n", clamped - 1);
  return { line: clamped === 0 ? 1 : text.slice(0, clamped).split("\n").length, column: clamped - preceding };
}

export function compileSmithers(source: string, options: CompileOptions = {}): CompileResult {
  const model = buildSemanticModel(source, options);
  return compileSemanticModel(source, options, model);
}

/** @internal Shared by the batch project compiler after one checker pass. */
export function compileSemanticModel(
  source: string,
  options: CompileOptions,
  model: SemanticModel,
  bindings: ProjectEmitBindings = {},
): CompileResult {
  // `sourceName` anchors every identity minted below, so the invariant runs
  // against the same string the lowerer will use — see the block after it.
  const identityAnchor = options.sourceName ??
    (options.fileName === undefined ? "<memory>.sm" : identityFileName(options.fileName));
  const identityCollisions = nominalIdentityCollisions(
    identityAnchor,
    source,
    model.errors,
    bindings.nominalIdentities ?? new NominalErrorIdentities(),
  );
  const scopes = resumableScopes(model);
  const emitDiagnostics = identityCollisions;
  const analysis: Analysis = {
    errors: model.errors,
    functions: model.publicFunctions,
    rows: model.rows,
    diagnostics: emitDiagnostics.length === 0
      ? model.diagnostics
      : [...model.diagnostics, ...emitDiagnostics],
  };
  // `sourceName` is the display name AND the anchor of every emitted nominal
  // Error identity ({@link nominalErrorIdentity}) and of the source map's `sources`, so an
  // absolute `fileName` falling through to it put a machine-specific path into
  // a runtime identity. The fallback goes through the one portable accessor;
  // `compileProject` still passes an explicit root-relative `sourceName`.
  const sourceName = identityAnchor;
  const runtimeImport = options.runtimeImport ?? "../runtime/index.ts";
  const identifiers = collectIdentifierTexts(model.sourceFile);
  const state: TransformState = {
    model,
    factory: ts.factory,
    runtimeImport,
    sourceName,
    outputFileName: options.outputFileName && resolve(options.outputFileName),
    helpers: new Map(),
    identifiers,
    // Error spans are published in authored coordinates; the transformer
    // works on the parsed (recovery-derived) tree.
    errorStarts: new Map(model.errors.flatMap((error) => {
      const derived = model.recovery.toDerived(error.start);
      return derived === undefined ? [] : [[derived, error.name] as const];
    })),
    projectOutputBySource: bindings.outputBySource,
    stripImportAttributesForSources: bindings.stripImportAttributesForSources,
    preserveSmithersSpecifiers: options.preserveSmithersSpecifiers === true,
    smithersSourceNames: bindings.smithersSourceNames,
    sourceMapOrigins: new Map(),
    nonFallingSwitches: new Set(),
    scopes,
    // A recovery-derived parse can never claim byte-identity with authored text.
    changed: model.recovery.changed,
    temporary: 0,
  };

  reserveBuiltinBindings(state);
  const transformed = ts.transform(model.sourceFile, [createTransformer(state)]);
  const transformedFile = transformed.transformed[0] as ts.SourceFile;
  try {
    let body: string;
    let printerSourceMap: string | undefined;
    if (!state.changed) {
      body = source;
    } else if (options.sourceMap === false) {
      body = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false }).printFile(transformedFile);
    } else {
      ({ code: body, sourceMap: printerSourceMap } = printFileWithSourceMap(transformedFile));
    }

    const header = emitHelperImport(state);
    if (header) state.changed = true;
    const code = state.changed ? header + body : source;
    let sourceMap: string | undefined;
    // The retired `.?` token makes TypeScript recover an overlapping ternary
    // tree. Its printer can display that malformed tree for diagnostics, but
    // the resulting provenance backtracks and is not a valid source map. Honor
    // correct-or-absent for this rejected spelling while retaining maps for
    // supported recovered syntax and unrelated diagnostics.
    const hasRetiredDotQuestion = analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "SMITHERS1001" && diagnostic.message.includes("`.?` postfix operator"));
    if (options.sourceMap !== false && !hasRetiredDotQuestion) {
      const fileName = options.outputFileName ?? basename(sourceName).replace(/\.sm$/, ".ts");
      try {
        // The printer's provenance describes the parsed (recovery-derived)
        // text. Build the precise map against that text, then compose it with
        // the exact derived-to-authored offset map so glue stays unmapped.
        const generatedToParsed = createPreciseSourceMap({
          generatedCode: code,
          generatedBody: body,
          generatedPrefix: header,
          source: model.recovery.changed ? model.recovery.parseSource : source,
          sourceName,
          fileName,
          printerSourceMap,
          anchors: state.changed ? locateSourceMapAnchors(transformedFile, body, state) : undefined,
          identity: !state.changed,
        });
        sourceMap = model.recovery.changed
          ? composeSourceMaps(
              generatedToParsed,
              createOffsetSourceMap({
                derivedText: model.recovery.parseSource,
                authoredText: source,
                runs: model.recovery.verbatim,
                sourceName,
                fileName: basename(sourceName),
              }),
              fileName,
            )
          : generatedToParsed;
      } catch (error) {
        // Correct-or-absent, same rule the retired `.?` spelling gets above.
        // A rejected program's printed tree can be malformed enough that its
        // provenance is not a valid map (`case x => v,` is one such shape), and
        // a rejected program must still return its diagnostics rather than
        // taking the whole compile down. An ACCEPTED program has no such
        // excuse: rethrow so a genuine provenance regression stays loud.
        if (!analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error")) throw error;
        sourceMap = undefined;
      }
    }
    return { code, sourceMap, analysis };
  } finally {
    transformed.dispose();
  }
}

function createTransformer(state: TransformState): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    const visit: ts.Visitor = (node) => {
      if (isFunctionLikeWithBody(node)) return transformFunction(node, state, context, visit);
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const rewritten = rewriteModuleDeclaration(node, state);
        if (rewritten) return rewritten;
      }
      if (ts.isCallExpression(node)) {
        const rewritten = rewriteDynamicImport(node, state);
        if (rewritten) return rewritten;
        // A `Layer.provide` at module scope has no owning function, so it never
        // reaches `rewriteExpression`; `lowerStatement` hands module-level
        // statements straight to this visitor. It is the shape
        // `export const lines = Layer.provide(...)` takes, and leaving it here
        // un-lowered would leave the promise-hook block live for exactly the
        // programs that do not wrap their provide in a function.
        if (state.scopes.provides.has(node)) {
          return lowerLayerProvide(node, undefined, undefined, state, context, visit);
        }
      }
      return ts.visitEachChild(node, visit, context);
    };

    return (sourceFile) => {
      const statements = lowerStatementSequence(
        sourceFile.statements,
        undefined,
        false,
        state,
        context,
        visit,
      );
      return state.factory.updateSourceFile(sourceFile, statements);
    };
  };
}

function transformFunction(
  node: FunctionLikeWithBody,
  state: TransformState,
  context: ts.TransformationContext,
  visit: ts.Visitor,
): ts.FunctionLikeDeclaration {
  const info = state.model.functionByNode.get(node);
  if (!info) return ts.visitEachChild(node, visit, context) as ts.FunctionLikeDeclaration;

  let body: ts.ConciseBody;
  if (ts.isBlock(node.body)) {
    body = transformBlock(node.body, info, false, state, context, visit);
  } else {
    const prologue: ts.Statement[] = [];
    const panicCall = unwrapPanicCall(node.body, state.model);
    if (effectiveChannel(info) === "plain" && !panicCall) {
      body = rewriteExpression(node.body, info, prologue, state, context, visit);
      if (prologue.length > 0) {
        body = state.factory.createBlock([...prologue, state.factory.createReturnStatement(body)], true);
        state.changed = true;
      }
    } else {
      const statements = lowerReturn(node.body, info, state, context, visit);
      body = state.factory.createBlock(statements, true);
      state.changed = true;
    }
  }
  if (ts.isBlock(body) && mayFallThrough(body.statements, state)) {
    const completion = implicitCompletion(info, state);
    if (completion) {
      body = state.factory.updateBlock(body, [...body.statements, completion]);
      state.changed = true;
    }
  }

  if (state.scopes.generators.has(node)) return asResumable(node, body, state);

  if (ts.isFunctionDeclaration(node)) {
    return state.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name,
      node.typeParameters, node.parameters, node.type, body as ts.Block);
  }
  if (ts.isFunctionExpression(node)) {
    return state.factory.updateFunctionExpression(node, node.modifiers, node.asteriskToken, node.name,
      node.typeParameters, node.parameters, node.type, body as ts.Block);
  }
  if (ts.isArrowFunction(node)) {
    return state.factory.updateArrowFunction(node, node.modifiers, node.typeParameters, node.parameters,
      node.type, node.equalsGreaterThanToken, body);
  }
  if (ts.isMethodDeclaration(node)) {
    return state.factory.updateMethodDeclaration(node, node.modifiers, node.asteriskToken, node.name,
      node.questionToken, node.typeParameters, node.parameters, node.type, body as ts.Block);
  }
  if (ts.isGetAccessorDeclaration(node)) {
    return state.factory.updateGetAccessorDeclaration(node, node.modifiers, node.name, node.parameters, node.type, body as ts.Block);
  }
  if (ts.isSetAccessorDeclaration(node)) {
    return state.factory.updateSetAccessorDeclaration(node, node.modifiers, node.name, node.parameters, body as ts.Block);
  }
  return state.factory.updateConstructorDeclaration(node, node.modifiers, node.parameters, body as ts.Block);
}

/**
 * Re-emit one lowered function in the resumable calling convention.
 *
 * Three things change and nothing else does. The `*` is the convention. The
 * return type becomes `Resumable<T>` — not decoration: the emitted module set is
 * checked by STOCK TypeScript (`validate.ts` `checkEmittedTypeScript`), which
 * rejects `function* f(): string` outright, so a declared return type that was
 * not rewritten would turn every resumable function into an emit-check failure.
 * A function with no declared return type keeps none and is inferred.
 *
 * An arrow becomes a function expression, because an arrow cannot be a
 * generator. That changes `this` and `arguments` inside it, and the only arrows
 * this applies to are `Layer.provide` callbacks — a position where `this` is
 * already `undefined` under the module's implicit strict mode, since the
 * callback is invoked as a bare function by `Layer.provide` itself.
 */
function asResumable(
  node: FunctionLikeWithBody,
  body: ts.ConciseBody,
  state: TransformState,
): ts.FunctionLikeDeclaration {
  state.changed = true;
  const block = ts.isBlock(body)
    ? body
    : state.factory.createBlock([state.factory.createReturnStatement(body)], true);
  const asterisk = state.factory.createToken(ts.SyntaxKind.AsteriskToken);
  const returnType = node.type
    ? state.factory.createTypeReferenceNode(helper(state, "Resumable", "__vsResumable", true), [node.type])
    : undefined;
  if (ts.isFunctionDeclaration(node)) {
    return state.factory.updateFunctionDeclaration(node, node.modifiers, asterisk, node.name,
      node.typeParameters, node.parameters, returnType, block);
  }
  if (ts.isFunctionExpression(node)) {
    return state.factory.updateFunctionExpression(node, node.modifiers, asterisk, node.name,
      node.typeParameters, node.parameters, returnType, block);
  }
  return state.factory.createFunctionExpression(undefined, asterisk, undefined,
    node.typeParameters, node.parameters, returnType, block);
}

function transformBlock(
  block: ts.Block,
  owner: SemanticFunction,
  caughtByJavaScript: boolean,
  state: TransformState,
  context: ts.TransformationContext,
  visit: ts.Visitor,
): ts.Block {
  return state.factory.updateBlock(block,
    lowerStatementSequence(block.statements, owner, caughtByJavaScript, state, context, visit));
}

function lowerStatementSequence(
  sourceStatements: readonly ts.Statement[],
  owner: SemanticFunction | undefined,
  caughtByJavaScript: boolean,
  state: TransformState,
  context: ts.TransformationContext,
  visit: ts.Visitor,
): ts.Statement[] {
  return sourceStatements.flatMap((statement) =>
    lowerStatement(statement, owner, caughtByJavaScript, state, context, visit));
}


function lowerStatement(
  statement: ts.Statement,
  owner: SemanticFunction | undefined,
  caughtByJavaScript: boolean,
  state: TransformState,
  context: ts.TransformationContext,
  visit: ts.Visitor,
): ts.Statement[] {
  if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
    const rewritten = rewriteModuleDeclaration(statement, state);
    if (rewritten) return [rewritten];
  }
  if (ts.isFunctionDeclaration(statement) && statement.body) {
    return [transformFunction(statement as FunctionLikeWithBody, state, context, visit) as ts.FunctionDeclaration];
  }
  if (ts.isBlock(statement) && owner) return [transformBlock(statement, owner, caughtByJavaScript, state, context, visit)];

  if (ts.isClassDeclaration(statement)) {
    const updated = ts.visitEachChild(statement, visit, context) as ts.ClassDeclaration;
    const name = state.errorStarts.get(statement.getStart(state.model.sourceFile));
    if (!name || !statement.name || emitsNoRuntimeBinding(statement)) return [updated];
    state.changed = true;
    const register = helper(state, "__vsRegisterError");
    const stableId = nominalErrorIdentity(state.sourceName, name);
    const brand = nominalErrorInterface(statement, stableId, state);
    return [
      updated,
      ...(brand ? [brand] : []),
      state.factory.createExpressionStatement(state.factory.createCallExpression(
        state.factory.createIdentifier(register),
        undefined,
        [state.factory.createIdentifier(statement.name.text), state.factory.createStringLiteral(stableId)],
      )),
    ];
  }

  if (!owner) return [ts.visitEachChild(statement, visit, context) as ts.Statement];

  if (ts.isVariableStatement(statement)) {
    const prologue: ts.Statement[] = [];
    const declarations = statement.declarationList.declarations.map((declaration) => {
      if (!declaration.initializer) return ts.visitEachChild(declaration, visit, context) as ts.VariableDeclaration;
      const expression = rewriteExpression(declaration.initializer, owner, prologue, state, context, visit);
      return state.factory.updateVariableDeclaration(declaration, declaration.name, declaration.exclamationToken,
        declaration.type, expression);
    });
    return [
      ...prologue,
      state.factory.updateVariableStatement(statement, statement.modifiers,
        state.factory.updateVariableDeclarationList(statement.declarationList, declarations)),
    ];
  }

  if (ts.isReturnStatement(statement)) return lowerReturn(statement.expression, owner, state, context, visit, statement);

  if (ts.isThrowStatement(statement) && statement.expression) {
    const prologue: ts.Statement[] = [];
    const expression = rewriteExpression(statement.expression, owner, prologue, state, context, visit);
    if (caughtByJavaScript || effectiveChannel(owner) === "plain") {
      return [...prologue, state.factory.updateThrowStatement(statement, expression)];
    }
    state.changed = true;
    return [...prologue, sourceMapAnchor(
      state.factory.createReturnStatement(resultFailure(expression, state)),
      statement,
      state,
    )];
  }

  if (ts.isExpressionStatement(statement)) {
    const panicCall = unwrapPanicCall(statement.expression, state.model);
    if (panicCall) {
      if (!panicMaterializes(owner, state.model)) return throwPanic(panicCall, owner, state, context, visit, statement);
      const prologue: ts.Statement[] = [];
      const failure = lowerPanicValue(panicCall, owner, prologue, state, context, visit);
      state.changed = true;
      return [...prologue, sourceMapAnchor(
        state.factory.createReturnStatement(resultFailure(failure, state)),
        statement,
        state,
      )];
    }
    const prologue: ts.Statement[] = [];
    const expression = rewriteExpression(statement.expression, owner, prologue, state, context, visit);
    return [...prologue, state.factory.updateExpressionStatement(statement, expression)];
  }

  if (ts.isIfStatement(statement)) {
    const prologue: ts.Statement[] = [];
    const expression = rewriteExpression(statement.expression, owner, prologue, state, context, visit);
    const thenStatement = singleStatement(lowerStatement(statement.thenStatement, owner, caughtByJavaScript, state, context, visit), state);
    const elseStatement = statement.elseStatement
      ? singleStatement(lowerStatement(statement.elseStatement, owner, caughtByJavaScript, state, context, visit), state)
      : undefined;
    return [...prologue, state.factory.updateIfStatement(statement, expression, thenStatement, elseStatement)];
  }

  if (ts.isLabeledStatement(statement)) {
    return [state.factory.updateLabeledStatement(
      statement,
      statement.label,
      singleStatement(lowerStatement(statement.statement, owner, caughtByJavaScript, state, context, visit), state),
    )];
  }

  if (ts.isTryStatement(statement)) {
    const tryBlock = transformBlock(statement.tryBlock, owner, caughtByJavaScript || Boolean(statement.catchClause), state, context, visit);
    const catchClause = statement.catchClause
      ? state.factory.updateCatchClause(statement.catchClause, statement.catchClause.variableDeclaration,
          transformBlock(statement.catchClause.block, owner, caughtByJavaScript, state, context, visit))
      : undefined;
    const finallyBlock = statement.finallyBlock
      ? transformBlock(statement.finallyBlock, owner, caughtByJavaScript, state, context, visit)
      : undefined;
    return [state.factory.updateTryStatement(statement, tryBlock, catchClause, finallyBlock)];
  }

  if (ts.isWhileStatement(statement)) {
    const expression = rewriteLoopHeaderExpression(statement.expression, owner, state, context, visit);
    const body = singleStatement(
      lowerStatement(statement.statement, owner, caughtByJavaScript, state, context, visit),
      state,
    );
    return [state.factory.updateWhileStatement(statement, expression, body)];
  }

  if (ts.isDoStatement(statement)) {
    const body = singleStatement(
      lowerStatement(statement.statement, owner, caughtByJavaScript, state, context, visit),
      state,
    );
    const expression = rewriteLoopHeaderExpression(statement.expression, owner, state, context, visit);
    return [state.factory.updateDoStatement(statement, body, expression)];
  }

  if (ts.isForStatement(statement)) {
    const prologue: ts.Statement[] = [];
    let initializer: ts.ForInitializer | undefined;
    if (statement.initializer && ts.isVariableDeclarationList(statement.initializer)) {
      const declarations = statement.initializer.declarations.map((declaration) => {
        const value = declaration.initializer
          ? rewriteExpression(declaration.initializer, owner, prologue, state, context, visit)
          : undefined;
        return state.factory.updateVariableDeclaration(
          declaration,
          declaration.name,
          declaration.exclamationToken,
          declaration.type,
          value,
        );
      });
      initializer = state.factory.updateVariableDeclarationList(statement.initializer, declarations);
    } else if (statement.initializer) {
      initializer = rewriteExpression(statement.initializer, owner, prologue, state, context, visit);
    }
    const condition = statement.condition
      ? rewriteLoopHeaderExpression(statement.condition, owner, state, context, visit)
      : undefined;
    const incrementor = statement.incrementor
      ? rewriteLoopHeaderExpression(statement.incrementor, owner, state, context, visit)
      : undefined;
    const body = singleStatement(
      lowerStatement(statement.statement, owner, caughtByJavaScript, state, context, visit),
      state,
    );
    return [
      ...prologue,
      state.factory.updateForStatement(statement, initializer, condition, incrementor, body),
    ];
  }

  if (ts.isForInStatement(statement)) {
    // The ITERABLE is evaluated once, before the first iteration, so a hoisted
    // propagation guard runs exactly as often as the authored operand did. The
    // withdrawn placement walk refused this position anyway; `failures.mdx`
    // §Refusal Conditions accepts it and `repeatedlyEvaluatedPosition` agrees.
    const prologue: ts.Statement[] = [];
    const expression = rewriteExpression(statement.expression, owner, prologue, state, context, visit);
    const body = singleStatement(
      lowerStatement(statement.statement, owner, caughtByJavaScript, state, context, visit),
      state,
    );
    return [...prologue, state.factory.updateForInStatement(statement, statement.initializer, expression, body)];
  }

  if (ts.isForOfStatement(statement)) {
    // See the `for…in` arm: the iterable is a once-evaluated position.
    const prologue: ts.Statement[] = [];
    const expression = rewriteExpression(statement.expression, owner, prologue, state, context, visit);
    const body = singleStatement(
      lowerStatement(statement.statement, owner, caughtByJavaScript, state, context, visit),
      state,
    );
    return [...prologue, state.factory.updateForOfStatement(
      statement,
      statement.awaitModifier,
      statement.initializer,
      expression,
      body,
    )];
  }

  if (ts.isSwitchStatement(statement)) {
    const prologue: ts.Statement[] = [];
    const expression = rewriteExpression(statement.expression, owner, prologue, state, context, visit);
    const clauses = statement.caseBlock.clauses.map((clause) => {
      const statements = clause.statements.flatMap((item) => lowerStatement(item, owner, caughtByJavaScript, state, context, visit));
      return ts.isCaseClause(clause)
        ? state.factory.updateCaseClause(clause, rewriteExpression(clause.expression, owner, prologue, state, context, visit), statements)
        : state.factory.updateDefaultClause(clause, statements);
    });
    return [...prologue, state.factory.updateSwitchStatement(statement, expression,
      state.factory.updateCaseBlock(statement.caseBlock, clauses))];
  }

  const prologue: ts.Statement[] = [];
  const expressionVisitor: ts.Visitor = (node) => {
    if (isFunctionLikeWithBody(node)) return transformFunction(node, state, context, visit);
    if (ts.isExpression(node)) return rewriteExpression(node, owner, prologue, state, context, visit);
    return ts.visitEachChild(node, expressionVisitor, context);
  };
  const updated = ts.visitEachChild(statement, expressionVisitor, context) as ts.Statement;
  return [...prologue, updated];
}

function lowerReturn(
  original: ts.Expression | undefined,
  owner: SemanticFunction,
  state: TransformState,
  context: ts.TransformationContext,
  visit: ts.Visitor,
  statement?: ts.ReturnStatement,
): ts.Statement[] {
  const prologue: ts.Statement[] = [];
  const panicCall = original && unwrapPanicCall(original, state.model);
  if (panicCall) {
    if (!panicMaterializes(owner, state.model)) {
      return throwPanic(panicCall, owner, state, context, visit, statement ?? panicCall);
    }
    const failure = lowerPanicValue(panicCall, owner, prologue, state, context, visit);
    state.changed = true;
    return [...prologue, sourceMapAnchor(
      state.factory.createReturnStatement(resultFailure(failure, state)),
      statement ?? panicCall,
      state,
    )];
  }
  const expression = original
    ? rewriteExpression(original, owner, prologue, state, context, visit)
    : undefined;
  const lifted = liftSuccess(expression, original, owner, state);
  const updated = statement
    ? state.factory.updateReturnStatement(statement, lifted)
    : state.factory.createReturnStatement(lifted);
  return [...prologue, updated];
}

function liftSuccess(
  expression: ts.Expression | undefined,
  original: ts.Expression | undefined,
  owner: SemanticFunction,
  state: TransformState,
): ts.Expression | undefined {
  const channel = effectiveChannel(owner);
  if (channel === "plain") return expression;
  state.changed = true;
  const originalShape = original ? expressionShape(original, state.model) : undefined;
  if (originalShape?.channel === "result") return expression;
  return resultSuccess(expression ?? state.factory.createIdentifier("undefined"), state);
}

function rewriteExpression(
  expression: ts.Expression,
  owner: SemanticFunction,
  prologue: ts.Statement[],
  state: TransformState,
  context: ts.TransformationContext,
  visit: ts.Visitor,
): ts.Expression {
  if (ts.isNonNullExpression(expression) && isResultPropagationExpression(expression, state.model)) {
    const rewritten = rewriteExpression(expression.expression, owner, prologue, state, context, visit);
    // The operand's `| undefined` came from `noUncheckedIndexedAccess`, not
    // from anything the author wrote, and the provenance walk has already
    // proved the value is a Result. Assert that to the stock TypeScript that
    // checks the emitted module set; see isUnwidenedIndexedAccess.
    const receiver = isUnwidenedIndexedAccess(expression.expression, state.model)
      ? state.factory.createNonNullExpression(rewritten)
      : rewritten;
    const temporary = freshTemporary(state, "result");
    const inspect = helper(state, "__vsInspectResult");
    prologue.push(state.factory.createVariableStatement(undefined,
      state.factory.createVariableDeclarationList([
        state.factory.createVariableDeclaration(temporary, undefined, undefined,
          state.factory.createCallExpression(state.factory.createIdentifier(inspect), undefined, [receiver])),
      ], ts.NodeFlags.Const)));
    const propagate = sourceMapAnchor(state.factory.createReturnStatement(resultFailure(
      state.factory.createPropertyAccessExpression(temporary, "error"), state)), expression, state);
    prologue.push(state.factory.createIfStatement(
      state.factory.createBinaryExpression(
        state.factory.createPropertyAccessExpression(temporary, "ok"),
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        state.factory.createFalse()),
      propagate,
    ));
    state.changed = true;
    return state.factory.createPropertyAccessExpression(temporary, "value");
  }
  if (ts.isCallExpression(expression)) {
    // A dynamic import has no callee expression to rewrite; lower the
    // specifier and attributes in place.
    if (expression.expression.kind === ts.SyntaxKind.ImportKeyword) {
      return rewriteDynamicImport(expression, state) ?? expression;
    }
    if (state.scopes.provides.has(expression)) {
      return lowerLayerProvide(expression, owner, prologue, state, context, visit);
    }
    if (inResumableScope(owner, state)) {
      const request = lowerCapabilityRead(expression, state);
      if (request) return request;
    }
    if (isResultExpectExpression(expression, state.model) && effectiveChannel(owner).startsWith("result")) {
      // `r.expect(m)` and `r["expect"](m)` select the same member, so the
      // receiver is read through the shared member-selection helper rather
      // than by asserting one of the two access node kinds.
      const receiver = rewriteExpression(
        expectReceiver(expression, state.model.checker)!, owner, prologue, state, context, visit);
      const receiverTemporary = freshTemporary(state, "expect_receiver");
      prologue.push(state.factory.createVariableStatement(undefined,
        state.factory.createVariableDeclarationList([
          state.factory.createVariableDeclaration(receiverTemporary, undefined, undefined, receiver),
        ], ts.NodeFlags.Const)));

      // Call arguments are evaluated even when the receiver holds an error.
      // Bind the message after the receiver and before inspection to preserve
      // ordinary call evaluation order and ensure it is evaluated exactly once.
      const message = expression.arguments[0]
        ? rewriteExpression(expression.arguments[0], owner, prologue, state, context, visit)
        : state.factory.createIdentifier("undefined");
      const messageTemporary = freshTemporary(state, "expect_message");
      prologue.push(state.factory.createVariableStatement(undefined,
        state.factory.createVariableDeclarationList([
          state.factory.createVariableDeclaration(messageTemporary, undefined, undefined, message),
        ], ts.NodeFlags.Const)));

      const resultTemporary = freshTemporary(state, "expect_result");
      const inspect = helper(state, "__vsInspectResult");
      prologue.push(state.factory.createVariableStatement(undefined,
        state.factory.createVariableDeclarationList([
          state.factory.createVariableDeclaration(resultTemporary, undefined, undefined,
            state.factory.createCallExpression(state.factory.createIdentifier(inspect), undefined, [receiverTemporary])),
        ], ts.NodeFlags.Const)));
      const cause = state.factory.createNewExpression(state.factory.createIdentifier("Error"), undefined, [
        messageTemporary,
        state.factory.createObjectLiteralExpression([
          state.factory.createPropertyAssignment("cause",
            state.factory.createPropertyAccessExpression(resultTemporary, "error")),
        ]),
      ]);
      const panic = state.factory.createCallExpression(
        state.factory.createIdentifier(helper(state, "__vsPanicValue")),
        undefined,
        [cause],
      );
      const propagate = sourceMapAnchor(
        state.factory.createReturnStatement(resultFailure(panic, state)),
        expression,
        state,
      );
      prologue.push(state.factory.createIfStatement(
        state.factory.createBinaryExpression(
          state.factory.createPropertyAccessExpression(resultTemporary, "ok"),
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          state.factory.createFalse(),
        ),
        propagate,
      ));
      state.changed = true;
      return state.factory.createPropertyAccessExpression(resultTemporary, "value");
    }

    const called = rewriteExpression(expression.expression, owner, prologue, state, context, visit);
    const arguments_ = expression.arguments.map((argument) =>
      rewriteExpression(argument, owner, prologue, state, context, visit));
    let updated: ts.Expression = state.factory.updateCallExpression(expression, called, expression.typeArguments, arguments_);
    if (isErrorMatchCall(expression, state.model.checker) && ts.isObjectLiteralExpression(arguments_[0])) {
      const cases = lowerErrorCases(arguments_[0], state);
      updated = state.factory.updateCallExpression(expression, called, expression.typeArguments, [cases, ...arguments_.slice(1)]);
      state.changed = true;
    }
    const edge = state.model.callEdges.get(expression);
    if (edge?.foreign && edge.foreign.kind !== "never" && edge.foreign.lowerable && !edge.authoredBoundary) {
      updated = wrapForeignCall(updated, edge, state);
      state.changed = true;
    }
    // A foreign edge and a resolved callee are mutually exclusive
    // (`collectFacts` computes `foreign` only when `callee` is absent), so the
    // wrapper above and the delegation below cannot both fire on one call.
    if (inResumableScope(owner, state) && callConvention(expression, state.model, state.scopes) === "delegate") {
      state.changed = true;
      updated = delegate(updated, state);
    }
    return updated;
  }
  if (isFunctionLikeWithBody(expression)) return transformFunction(expression, state, context, visit) as ts.Expression;
  const expressionVisitor: ts.Visitor = (node) => {
    if (node === expression) return ts.visitEachChild(node, expressionVisitor, context);
    if (isFunctionLikeWithBody(node)) return transformFunction(node, state, context, visit);
    if (ts.isExpression(node)) return rewriteExpression(node, owner, prologue, state, context, visit);
    return ts.visitEachChild(node, expressionVisitor, context);
  };
  return ts.visitEachChild(expression, expressionVisitor, context) as ts.Expression;
}

/** `yield* <call>`; the printer supplies whatever parentheses the position needs. */
function delegate(call: ts.Expression, state: TransformState): ts.Expression {
  return state.factory.createYieldExpression(
    state.factory.createToken(ts.SyntaxKind.AsteriskToken),
    call,
  );
}

/**
 * `Capability.context()` -> `yield* __vsGet(Capability, "<site>")`.
 *
 * `undefined` — leave the call exactly as authored — whenever the receiver is
 * not a plain reference. That is not a shortfall being papered over, and the
 * list of shapes it declines is the argument: an optional receiver
 * (`Reader?.context()`), an optional call (`Reader.context?.()`), a ternary, a
 * type assertion, an IIFE. Every one of them either changes the meaning when
 * re-evaluated as an argument or has already been evaluated for its effects by
 * the time the request would be built. `SMITHERS2107` guarantees the RECEIVER
 * denotes exactly one capability in all of them, so leaving the call verbatim
 * is sound: it reaches `useCapability`, and the environment scope that
 * `__vsProvide` opens answers it with the same instance the handler would have.
 */
function lowerCapabilityRead(call: ts.CallExpression, state: TransformState): ts.Expression | undefined {
  const site = state.model.capabilitySites.get(call);
  if (!site || site.name === undefined) return undefined;
  const key = capabilityKeyExpression(call);
  const identity = state.model.effectSites.get(call);
  if (!key || identity === undefined) return undefined;
  state.changed = true;
  return delegate(
    state.factory.createCallExpression(
      state.factory.createIdentifier(helper(state, "__vsGet")),
      undefined,
      [key, state.factory.createStringLiteral(identity)],
    ),
    state,
  );
}

/** The receiver of a `Capability.context()` call, when it may be re-evaluated as an argument. */
function capabilityKeyExpression(call: ts.CallExpression): ts.Expression | undefined {
  if (call.questionDotToken) return undefined;
  let callee: ts.Expression = call.expression;
  while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
  if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return undefined;
  if (callee.questionDotToken) return undefined;
  return plainReference(callee.expression);
}

/**
 * An identifier, or a dotted chain of them. Re-evaluating one twice is
 * indistinguishable from evaluating it once, which is the property that lets
 * the receiver move from the callee position into an argument position.
 */
function plainReference(expression: ts.Expression): ts.Expression | undefined {
  let current: ts.Expression = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  if (ts.isIdentifier(current)) return current;
  if (ts.isPropertyAccessExpression(current) && !current.questionDotToken &&
    ts.isIdentifier(current.name) && plainReference(current.expression) !== undefined) {
    return current;
  }
  return undefined;
}

/**
 * `Layer.provide(L, () => body)` -> the handler install.
 *
 * Two spellings, chosen by whether there is an enclosing resumable computation
 * to delegate into. Inside one, `yield* __vsProvide(...)` — so an inner scope's
 * unprovided `get` forwards outward to the scope that does provide it, which is
 * what makes nesting compose. Outside one — module top level, or a function the
 * mode left in the ordinary convention, which is the usual shape because a
 * provide SUBTRACTS its capabilities and so the enclosing function's row is
 * typically empty — `__vsProvideRoot(...)` is both the delimiter and the
 * driver, and returns the computation's value rather than a generator.
 *
 * A callback the emitter cannot turn into a generator (a reference rather than
 * a literal, an `async` one, an authored generator) leaves the call verbatim.
 * `Layer.provide` then runs as it does under the default lowering — including
 * its promise-tracking block, which is exactly why the conformance backend
 * asserts on `acquired` leases rather than assuming they are zero.
 */
function lowerLayerProvide(
  call: ts.CallExpression,
  owner: SemanticFunction | undefined,
  prologue: ts.Statement[] | undefined,
  state: TransformState,
  context: ts.TransformationContext,
  visit: ts.Visitor,
): ts.Expression {
  const callback = state.scopes.provides.get(call);
  const layer = call.arguments[0];
  if (!callback || !layer) {
    return ts.visitEachChild(call, visit, context);
  }
  const layerArgument = owner && prologue
    ? rewriteExpression(layer, owner, prologue, state, context, visit)
    : (ts.visitNode(layer, visit, ts.isExpression) as ts.Expression);
  const body = transformFunction(callback, state, context, visit) as ts.Expression;
  state.changed = true;
  const inside = inResumableScope(owner, state);
  const installed = state.factory.createCallExpression(
    state.factory.createIdentifier(helper(state, inside ? "__vsProvide" : "__vsProvideRoot")),
    undefined,
    [layerArgument, body],
  );
  return inside ? delegate(installed, state) : installed;
}

/**
 * A REPEATED loop header — a `while`/`do` condition, a `for` condition, a `for`
 * incrementor.
 *
 * A Result propagation/expect or panic exit needs statements at the exact
 * evaluation point, and hoisting those statements in front of the loop would run
 * them a different number of times. `repeatedlyEvaluatedPosition` in the
 * analysis rejects the construct as `SMITHERS1703` and the emitter leaves it
 * untouched, which keeps the module fail-closed rather than reordered. Ordinary
 * calls (including foreign calls, whose wrappers are expressions) can still be
 * rewritten in place.
 *
 * The once-evaluated headers — the `for` initializer, and the `for…of`/`for…in`
 * iterable — do NOT come here; they take an ordinary prologue.
 */
function rewriteLoopHeaderExpression(
  expression: ts.Expression,
  owner: SemanticFunction,
  state: TransformState,
  context: ts.TransformationContext,
  visit: ts.Visitor,
): ts.Expression {
  if (containsLoopHeaderExit(expression, state.model)) {
    return ts.visitEachChild(expression, visit, context) as ts.Expression;
  }
  const prologue: ts.Statement[] = [];
  const result = rewriteExpression(expression, owner, prologue, state, context, visit);
  // The only current expression lowering that introduces statements is an
  // propagation. Keep this guard fail-closed if a future lowering does the same.
  if (prologue.length > 0) return expression;
  return result;
}

function containsLoopHeaderExit(expression: ts.Expression, model: SemanticModel): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== expression && isFunctionLikeWithBody(node)) return;
    if (ts.isNonNullExpression(node) && isResultPropagationExpression(node, model)) {
      found = true;
      return;
    }
    if (ts.isCallExpression(node) &&
      (isResultExpectExpression(node, model) || isPanicExitCall(node, model))) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function lowerPanicValue(
  call: ts.CallExpression,
  owner: SemanticFunction,
  prologue: ts.Statement[],
  state: TransformState,
  context: ts.TransformationContext,
  visit: ts.Visitor,
): ts.Expression {
  const cause = call.arguments[0]
    ? rewriteExpression(call.arguments[0], owner, prologue, state, context, visit)
    : state.factory.createIdentifier("undefined");
  return state.factory.createCallExpression(
    state.factory.createIdentifier(helper(state, "__vsPanicValue")),
    undefined,
    [cause],
  );
}

/**
 * Whether a `panic(...)` exit inside `owner` becomes a Result *value* or stays
 * an unwinding throw.
 *
 * `specification/failures.mdx` §Panic Does Not Widen a Return Type: "An author
 * MAY still annotate `Result<A, Panic>` explicitly to materialize a panic as a
 * value; that is how panic is made explicitly catchable. The prohibition is on
 * the compiler *forcing* that widening, not on an author choosing it."
 *
 * So the materialization is keyed on the channel this function actually
 * publishes naming `Panic` — an authored `Result<A, Panic>` annotation, or an
 * inferred row that already carries `Panic` from a foreign boundary. It is NOT
 * keyed on "the function returns some Result", because
 * `function force(k: string): Result<string, Missing>` publishes `Missing` as
 * its expected-error channel; materializing a panic into that channel would put
 * a `Panic` where a caller's exhaustive `match` believes only `Missing` can
 * appear. That shape is `D03`/`D04` in the lane probe: before this change the
 * annotated half was caught by SMITHERS1104 while the INFERRED half compiled
 * clean and emitted `__vsResultFailure(__vsPanicValue(...))` into a row of
 * `["Missing","Panic"]`.
 *
 * Everywhere else the panic lowers to `throw __vsPanicValue(...)`, which is
 * exactly what the runtime `panic()` does and what `catchPanic` catches, and is
 * the same shape an ordinary `throw` already takes in a plain-channel function.
 *
 * The membership test is `chargesCompilerPanic`, not `failures.has("Panic")`.
 * A failure row is a set of STRINGS and a user `class Panic extends Error`
 * mints the same member, so the bare spelling let an author's own `Panic`
 * satisfy a test about the compiler's distinguished channel; see that
 * predicate for the program it shipped wrong.
 */
function panicMaterializes(owner: SemanticFunction, model: SemanticModel): boolean {
  return effectiveChannel(owner) !== "plain" && chargesCompilerPanic(owner, model);
}

function throwPanic(
  panicCall: ts.CallExpression,
  owner: SemanticFunction,
  state: TransformState,
  context: ts.TransformationContext,
  visit: ts.Visitor,
  anchor: ts.Node,
): ts.Statement[] {
  const prologue: ts.Statement[] = [];
  const failure = lowerPanicValue(panicCall, owner, prologue, state, context, visit);
  state.changed = true;
  return [...prologue, sourceMapAnchor(state.factory.createThrowStatement(failure), anchor, state)];
}

function unwrapPanicCall(expression: ts.Expression, model: SemanticModel): ts.CallExpression | undefined {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return ts.isCallExpression(current) && isPanicExitCall(current, model) ? current : undefined;
}

function lowerErrorCases(object: ts.ObjectLiteralExpression, state: TransformState): ts.Expression {
  const entries: ts.Expression[] = [];
  for (const property of object.properties) {
    if (!property.name || !ts.isIdentifier(property.name)) continue;
    let handler: ts.Expression | undefined;
    if (ts.isPropertyAssignment(property)) handler = property.initializer;
    else if (ts.isMethodDeclaration(property) && property.body) {
      handler = state.factory.createFunctionExpression(
        ts.getModifiers(property),
        property.asteriskToken,
        undefined,
        property.typeParameters,
        property.parameters,
        property.type,
        property.body,
      );
    }
    if (!handler) continue;
    entries.push(state.factory.createArrayLiteralExpression([
      state.factory.createIdentifier(property.name.text),
      handler,
    ]));
  }
  return state.factory.createCallExpression(
    state.factory.createIdentifier(helper(state, "__vsErrorCases")),
    undefined,
    entries,
  );
}

function wrapForeignCall(call: ts.Expression, edge: CallEdge, state: TransformState): ts.Expression {
  const runtime = helper(state, "Result", "__vsResultRuntime");
  const policy = edge.foreign!;
  const body = state.factory.createArrowFunction(undefined, undefined, [], undefined,
    state.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), call);
  const arguments_: ts.Expression[] = [body];
  if (policy.kind === "declared" && policy.errorName) {
    const validate = helper(state, "__vsValidateForeignError");
    const cause = state.factory.createIdentifier("cause");
    const path = policy.errorValuePath ?? [policy.errorName];
    const constructor = path.slice(1).reduce<ts.Expression>(
      (receiver, member) => state.factory.createPropertyAccessExpression(receiver, member),
      state.factory.createIdentifier(path[0]!),
    );
    arguments_.push(state.factory.createArrowFunction(undefined, undefined, [
      state.factory.createParameterDeclaration(undefined, undefined, cause),
    ], undefined, state.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    state.factory.createCallExpression(state.factory.createIdentifier(validate), undefined,
      [cause, constructor])));
  }
  return state.factory.createCallExpression(
    state.factory.createPropertyAccessExpression(state.factory.createIdentifier(runtime), policy.async ? "tryPromise" : "try"),
    undefined,
    arguments_,
  );
}

function implicitCompletion(owner: SemanticFunction, state: TransformState): ts.ReturnStatement | undefined {
  const channel = effectiveChannel(owner);
  if (channel === "plain") return undefined;
  return state.factory.createReturnStatement(resultSuccess(state.factory.createIdentifier("undefined"), state));
}

function resultSuccess(value: ts.Expression, state: TransformState): ts.Expression {
  return state.factory.createCallExpression(state.factory.createIdentifier(helper(state, "__vsResultSuccess")), undefined, [value]);
}

function resultFailure(value: ts.Expression, state: TransformState): ts.Expression {
  return state.factory.createCallExpression(state.factory.createIdentifier(helper(state, "__vsResultFailure")), undefined, [value]);
}

function helper(state: TransformState, exported: string, preferred = exported, typeOnly = false): string {
  const existing = state.helpers.get(exported);
  if (existing) return existing.local;
  const local = allocateIdentifier(state, preferred);
  state.helpers.set(exported, { exported, local, typeOnly });
  return local;
}

function reserveBuiltinBindings(state: TransformState): void {
  const used = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && (node.text === "Result" || node.text === "Panic")) {
      const symbol = state.model.checker.getSymbolAtLocation(node);
      if (symbol?.declarations?.some((declaration) => declaration.getSourceFile().fileName.endsWith("__smithers_frontend_prelude__.d.ts"))) {
        used.add(node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(state.model.sourceFile);
  for (const name of used) {
    state.helpers.set(name, { exported: name, local: name });
    state.identifiers.add(name);
  }
  // These checker-only globals become runtime imports in emitted code. Mark
  // that known output change before choosing identity versus AST-printer maps;
  // emitHelperImport runs after printing and is too late to make that choice.
  if (used.size > 0) state.changed = true;
}

function emitHelperImport(state: TransformState): string {
  if (state.helpers.size === 0) return "";
  const specifiers = [...state.helpers.values()]
    .sort((left, right) => compareText(left.exported, right.exported))
    // A type-only specifier is erased by every TypeScript-to-JavaScript pass,
    // so a type-only helper never changes the emitted JavaScript.
    .map(({ exported, local, typeOnly }) =>
      `${typeOnly ? "type " : ""}${exported === local ? exported : `${exported} as ${local}`}`);
  return `// Generated from ${state.sourceName} by the Smithers checked POC.\n` +
    `import { ${specifiers.join(", ")} } from ${JSON.stringify(state.runtimeImport)};\n`;
}

interface InternalTextWriter {
  getText(): string;
}

interface InternalSourceMapGenerator {
  toString(): string;
}

interface TypeScriptPrinterInternals {
  createTextWriter(newLine: string): InternalTextWriter;
  createSourceMapGenerator(
    host: { readonly getCurrentDirectory: () => string; readonly getCanonicalFileName: (fileName: string) => string },
    file: string,
    sourceRoot: string,
    sourcesDirectoryPath: string,
    options: { readonly inlineSources: boolean; readonly extendedDiagnostics: boolean },
  ): InternalSourceMapGenerator;
}

function printFileWithSourceMap(sourceFile: ts.SourceFile): { readonly code: string; readonly sourceMap: string } {
  const internals = ts as unknown as TypeScriptPrinterInternals;
  if (typeof internals.createTextWriter !== "function" || typeof internals.createSourceMapGenerator !== "function") {
    throw new TypeError("typescript-js does not expose the bounded AST source-map printer required by this frontend");
  }
  const writer = internals.createTextWriter("\n");
  const directory = dirname(resolve(sourceFile.fileName));
  const generator = internals.createSourceMapGenerator({
    getCurrentDirectory: () => directory,
    getCanonicalFileName: (fileName) => fileName.replaceAll("\\", "/"),
  }, basename(sourceFile.fileName).replace(/\.sm$/, ".ts"), "", directory, {
    inlineSources: true,
    extendedDiagnostics: false,
  });
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: false,
    inlineSources: true,
  } as ts.PrinterOptions & { readonly inlineSources: boolean }) as ts.Printer & {
    writeFile(file: ts.SourceFile, writer: InternalTextWriter, generator: InternalSourceMapGenerator): void;
  };
  if (typeof printer.writeFile !== "function") {
    throw new TypeError("typescript-js printer cannot emit AST source-map provenance");
  }
  printer.writeFile(sourceFile, writer, generator);
  return { code: writer.getText(), sourceMap: generator.toString() };
}

function sourceMapAnchor<T extends ts.Node>(node: T, origin: ts.Node, state: TransformState): T {
  state.sourceMapOrigins.set(node, origin);
  return node;
}

function childNodes(node: ts.Node): readonly ts.Node[] {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => { children.push(child); });
  return children;
}

function locateSourceMapAnchors(
  transformed: ts.SourceFile,
  body: string,
  state: TransformState,
): readonly SourceMapAnchor[] {
  if (state.sourceMapOrigins.size === 0) return [];
  const emitted = ts.createSourceFile(
    transformed.fileName.replace(/\.sm$/, ".generated.ts"),
    body,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const anchors: SourceMapAnchor[] = [];
  const pair = (planned: ts.Node, printed: ts.Node): void => {
    if (planned.kind !== printed.kind) return;
    const origin = state.sourceMapOrigins.get(planned);
    if (origin && origin.getSourceFile() === state.model.sourceFile && origin.pos >= 0) {
      anchors.push({
        generatedOffset: printed.getStart(emitted),
        originalOffset: origin.getStart(state.model.sourceFile),
      });
    }
    const plannedChildren = childNodes(planned);
    const printedChildren = childNodes(printed);
    if (plannedChildren.length !== printedChildren.length) return;
    for (let index = 0; index < plannedChildren.length; index++) {
      if (plannedChildren[index]!.kind !== printedChildren[index]!.kind) return;
    }
    for (let index = 0; index < plannedChildren.length; index++) {
      pair(plannedChildren[index]!, printedChildren[index]!);
    }
  };
  pair(transformed, emitted);
  const byGenerated = new Map<number, SourceMapAnchor>();
  for (const anchor of anchors) byGenerated.set(anchor.generatedOffset, anchor);
  return [...byGenerated.values()].sort((left, right) => left.generatedOffset - right.generatedOffset);
}

function allocateIdentifier(state: TransformState, preferred: string): string {
  let candidate = preferred;
  let suffix = 0;
  while (state.identifiers.has(candidate)) candidate = `${preferred}$smithers${suffix++ || ""}`;
  state.identifiers.add(candidate);
  return candidate;
}

function freshTemporary(state: TransformState, purpose: string): ts.Identifier {
  return state.factory.createIdentifier(allocateIdentifier(state, `__smithers_${purpose}_${++state.temporary}`));
}

function collectIdentifierTexts(sourceFile: ts.SourceFile): Set<string> {
  const values = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) values.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

function singleStatement(statements: readonly ts.Statement[], state: TransformState): ts.Statement {
  if (statements.length === 1) return statements[0]!;
  state.changed = true;
  return state.factory.createBlock(statements, true);
}

function mayFallThrough(statements: readonly ts.Statement[], state: TransformState): boolean {
  const last = statements.at(-1);
  if (!last) return true;
  return statementMayFallThrough(last, state);
}

function statementMayFallThrough(statement: ts.Statement, state: TransformState): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return false;
  if (ts.isBlock(statement)) return mayFallThrough(statement.statements, state);
  if (ts.isIfStatement(statement) && statement.elseStatement) {
    return statementMayFallThrough(statement.thenStatement, state) ||
      statementMayFallThrough(statement.elseStatement, state);
  }
  if (ts.isSwitchStatement(statement)) {
    // A default-covered or proven-exhaustive switch completes past its
    // clauses only when some selected clause can; break statements keep the
    // conservative fall-through answer through the clause check.
    const clauses = statement.caseBlock.clauses;
    const covered = state.nonFallingSwitches.has(statement) || clauses.some(ts.isDefaultClause);
    if (!covered) return true;
    return clauses.some((clause) => clause.statements.length === 0 || mayFallThrough(clause.statements, state));
  }
  if (ts.isTryStatement(statement)) {
    if (statement.finallyBlock && !mayFallThrough(statement.finallyBlock.statements, state)) return false;
    const tryFallsThrough = mayFallThrough(statement.tryBlock.statements, state);
    return statement.catchClause
      ? tryFallsThrough || mayFallThrough(statement.catchClause.block.statements, state)
      : tryFallsThrough;
  }
  // A labeled statement and an unconditional loop are the two forms whose body
  // can be the whole of a function's control flow while the construct itself
  // still cannot complete normally. Without these arms the answer defaulted to
  // `true`, `implicitCompletion` appended `return __vsResultSuccess(undefined)`
  // after a `return` that always runs, and the stock emitted-module check
  // rejected the lowered program with TS2322 — a program the rules ACCEPT,
  // lowered into TypeScript that cannot be checked.
  //
  // `break` is the only way out of either, so any `break` beneath the construct
  // restores the conservative answer. It is counted rather than resolved to its
  // target: an over-approximation here re-adds a dead statement, which is the
  // safe direction, while an under-approximation would drop a completion the
  // program needs. That direction is also self-checking — a function that really
  // can run off its end without the completion is refused by the emitted-module
  // check's own "not all code paths return a value", never accepted silently.
  if (ts.isLabeledStatement(statement)) {
    return statementMayFallThrough(statement.statement, state) || containsBreak(statement.statement);
  }
  if (ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
    return statement.expression.kind !== ts.SyntaxKind.TrueKeyword || containsBreak(statement.statement);
  }
  if (ts.isForStatement(statement)) {
    return statement.condition !== undefined || containsBreak(statement.statement);
  }
  return true;
}

/**
 * True when any `break` appears beneath `statement` in the same function.
 *
 * Nested functions are not entered: `break` cannot cross a function boundary,
 * so a `break` inside one belongs to that function's own control flow. Which
 * construct a given `break` targets is deliberately NOT resolved — see
 * `statementMayFallThrough` for why the over-approximation is the safe side.
 */
function containsBreak(statement: ts.Statement): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || ts.isFunctionLike(node)) return;
    if (ts.isBreakStatement(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
}

/**
 * True when a declaration introduces no runtime binding, so nothing the lowering
 * emits may name it.
 *
 * `declare class X extends Error {}` — and any declaration inside an enclosing
 * ambient container — is erased entirely by TypeScript. Emitting
 * `__vsRegisterError(X, …)` beside it produces a module that compiles with zero
 * diagnostics and then dies while it is still loading with `ReferenceError: X is
 * not defined`. A clean compile that cannot run is strictly worse than a
 * diagnostic, and specification/failures.mdx, "Error Classes", conditions the
 * identity obligation on classes the compiler emits while requiring that
 * ordinary `Error` behaviour be preserved — which a module that cannot load
 * violates outright.
 *
 * This is deliberately the *only* gate: the identity is still RESERVED, because
 * `collectErrorDeclarations` — and so the SMITHERS1150 duplicate-name refusal —
 * is untouched, and two same-named ambient Error classes still collide. The Go
 * fork draws the line in exactly the same place (`isNominalErrorClass` is
 * unchanged; its registration site carries the ambient guard), so both backends
 * reserve identically and neither emits a reference to nothing.
 *
 * The walk covers both spellings — the `declare` modifier on the declaration
 * itself, and an enclosing ambient container — because either one is enough for
 * TypeScript to emit nothing. `ts.NodeFlags.Ambient` is the binder's own answer
 * to exactly this question and would be one expression, but it is `@internal`
 * and absent from the public typings, so the syntactic walk stands in for it.
 */
function emitsNoRuntimeBinding(declaration: ts.Declaration): boolean {
  for (let node: ts.Node | undefined = declaration; node !== undefined; node = node.parent) {
    if (ts.isSourceFile(node)) return node.isDeclarationFile;
    if (ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) {
      return true;
    }
  }
  return false;
}

/**
 * The type-only nominal merge for an authored Error class.
 *
 * Two `class X extends Error {}` declarations are the same *structural* type,
 * so `errorIs(error, X)` cannot subtract a sibling in the else branch. Merging
 * `interface X extends NominalError<"<stableId>"> {}` alongside the class makes
 * siblings nominally distinct in the generated program while adding no runtime
 * member: the brand is a phantom type-only property and the import specifier is
 * type-only, so the emitted JavaScript is unchanged.
 *
 * The brand identity is the same stable id given to `__vsRegisterError`, so the
 * nominal key and the transport key cannot drift apart.
 *
 * Exactly one level of an inheritance chain may carry a brand (TypeScript
 * requires an inherited brand property to be identical), so a class whose base
 * is itself an Error class declaration is left unbranded and inherits its
 * ancestor's brand. Generic Error classes are also left unbranded because the
 * merged interface would have to restate their type parameter list exactly.
 */
function nominalErrorInterface(
  declaration: ts.ClassDeclaration,
  stableId: string,
  state: TransformState,
): ts.InterfaceDeclaration | undefined {
  if (!declaration.name || declaration.typeParameters?.length) return undefined;
  if (hasErrorClassBase(declaration, state.model.checker)) return undefined;
  const nominal = helper(state, "NominalError", "NominalError", true);
  const exportModifiers = ts.getModifiers(declaration)
    ?.filter((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  return state.factory.createInterfaceDeclaration(
    exportModifiers?.length ? [state.factory.createModifier(ts.SyntaxKind.ExportKeyword)] : undefined,
    state.factory.createIdentifier(declaration.name.text),
    undefined,
    [state.factory.createHeritageClause(ts.SyntaxKind.ExtendsKeyword, [
      state.factory.createExpressionWithTypeArguments(
        state.factory.createIdentifier(nominal),
        [state.factory.createLiteralTypeNode(state.factory.createStringLiteral(stableId))],
      ),
    ])],
    [],
  );
}

/** True when the class extends another Error *class declaration*. */
function hasErrorClassBase(declaration: ts.ClassDeclaration, checker: ts.TypeChecker): boolean {
  const heritage = declaration.heritageClauses
    ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword);
  for (const typeNode of heritage?.types ?? []) {
    let symbol = checker.getSymbolAtLocation(typeNode.expression);
    if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
    const base = symbol?.declarations?.find(ts.isClassDeclaration);
    if (base?.name && isErrorType(checker.getTypeAtLocation(base.name), checker)) return true;
  }
  return false;
}

function isCompilerVirtualModule(name: string): boolean {
  return name === "smthrs/context" || name === "smthrs/provider" || name === "smithers:exceptions";
}

function rewriteImportSpecifier(name: string, state: TransformState): string {
  if (isCompilerVirtualModule(name)) return state.runtimeImport;
  if (!name.startsWith(".") || !state.outputFileName) return name;
  if (state.preserveSmithersSpecifiers && isAuthoredSmithersSpecifier(name, state)) return name;
  const sourceTarget = resolve(state.model.resolutionDirectory, name);
  const projectOutput = projectOutputForSpecifier(sourceTarget, state.projectOutputBySource);
  let rewritten = relative(dirname(state.outputFileName), projectOutput ?? sourceTarget).split(sep).join("/");
  if (!rewritten.startsWith(".")) rewritten = `./${rewritten}`;
  return rewritten;
}

/**
 * A relative specifier the caller authored against a `.sm` module. The
 * literal `.sm` extension is decisive on its own; extensionless and `.js`
 * spellings are only preserved when they resolve to a supplied `.sm` source,
 * so an ordinary TypeScript/JavaScript neighbour still rewrites normally.
 */
function isAuthoredSmithersSpecifier(name: string, state: TransformState): boolean {
  if (name.endsWith(".sm")) return true;
  if (!state.smithersSourceNames) return false;
  const sourceTarget = resolve(state.model.resolutionDirectory, name);
  return projectSourceCandidates(sourceTarget)
    .some((candidate) => candidate.endsWith(".sm") && state.smithersSourceNames!.has(candidate));
}

function projectOutputForSpecifier(
  exact: string,
  outputs: ReadonlyMap<string, string> | undefined,
): string | undefined {
  if (!outputs) return undefined;
  return projectSourceCandidates(exact)
    .map((candidate) => outputs.get(candidate))
    .find((candidate) => candidate !== undefined);
}

function projectSourceCandidates(exact: string): readonly string[] {
  const candidates = [exact];
  if (extname(exact) === "") candidates.push(`${exact}.sm`, resolve(exact, "index.sm"));
  if (exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.sm`);
  return candidates;
}

/**
 * Static module-graph edges share one specifier-rewrite and import-attribute
 * policy. `export { default as x } from "./a.json" with { type: "json" }` moves
 * the same generated asset module an `import` does, so it must be lowered
 * identically; a generated JavaScript target retains neither form's attributes.
 */
function rewriteModuleDeclaration(
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
  state: TransformState,
): ts.Statement | undefined {
  const moduleSpecifier = statement.moduleSpecifier;
  if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) return undefined;
  const rewritten = rewriteImportSpecifier(moduleSpecifier.text, state);
  const strip = statement.attributes !== undefined &&
    shouldStripImportAttributes(moduleSpecifier.text, state);
  if (rewritten === moduleSpecifier.text && !strip) return undefined;
  state.changed = true;
  const specifier = sourceMapAnchor(state.factory.createStringLiteral(rewritten), moduleSpecifier, state);
  const attributes = strip ? undefined : statement.attributes;
  return ts.isImportDeclaration(statement)
    ? state.factory.updateImportDeclaration(
        statement,
        statement.modifiers,
        statement.importClause,
        specifier,
        attributes,
      )
    : state.factory.updateExportDeclaration(
        statement,
        statement.modifiers,
        statement.isTypeOnly,
        statement.exportClause,
        specifier,
        attributes,
      );
}

/**
 * `import("./a.json", { with: { type: "json" } })` with a literal specifier and
 * a literal single-property `with` options object is the only dynamic form the
 * asset lane admits, so it is the only one lowered here. Anything else keeps
 * its authored text: a specifier the compiler cannot evaluate must not be
 * silently repointed at a generated module.
 */
function rewriteDynamicImport(call: ts.CallExpression, state: TransformState): ts.CallExpression | undefined {
  if (call.expression.kind !== ts.SyntaxKind.ImportKeyword) return undefined;
  const specifier = call.arguments[0];
  if (!specifier || !ts.isStringLiteral(specifier) || call.arguments.length > 2) return undefined;
  const rewritten = rewriteImportSpecifier(specifier.text, state);
  const options = call.arguments[1];
  const stripTarget = shouldStripImportAttributes(specifier.text, state);
  // An options object the compiler cannot evaluate may still carry attributes
  // that must not survive; leave the whole call authored rather than repoint
  // the specifier while keeping an unanalyzable attribute bag.
  if (stripTarget && options !== undefined && !isLiteralImportAttributeOptions(options)) return undefined;
  const strip = stripTarget && options !== undefined;
  if (rewritten === specifier.text && !strip) return undefined;
  state.changed = true;
  const literal = sourceMapAnchor(state.factory.createStringLiteral(rewritten), specifier, state);
  return state.factory.updateCallExpression(
    call,
    call.expression,
    call.typeArguments,
    strip ? [literal] : [literal, ...call.arguments.slice(1)],
  );
}

function isLiteralImportAttributeOptions(options: ts.Expression | undefined): boolean {
  if (!options || !ts.isObjectLiteralExpression(options) || options.properties.length !== 1) return false;
  const property = options.properties[0]!;
  return ts.isPropertyAssignment(property) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
    property.name.text === "with" &&
    ts.isObjectLiteralExpression(property.initializer);
}

function shouldStripImportAttributes(name: string, state: TransformState): boolean {
  if (!name.startsWith(".") || !state.stripImportAttributesForSources) return false;
  const sourceTarget = resolve(state.model.resolutionDirectory, name);
  return projectSourceCandidates(sourceTarget)
    .some((candidate) => state.stripImportAttributesForSources!.has(candidate));
}

type FunctionLikeWithBody = ts.FunctionLikeDeclaration & { readonly body: ts.ConciseBody };

function isFunctionLikeWithBody(node: ts.Node): node is FunctionLikeWithBody {
  return (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)) && Boolean(node.body);
}
