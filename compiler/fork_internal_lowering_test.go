package compiler

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// internalLoweringSource exercises the three lowered forms in one file: a
// `throw` inside a Result-returning function, a plain `return` of a success
// value, and `unwrap()` propagation of an error variant.
const internalLoweringSource = `export class NotFound extends Error {
    readonly key: string;
    constructor(key: string) {
        super("missing " + key);
        this.key = key;
    }
}

const store = new Map<string, number>([["answer", 42]]);

export function lookup(key: string): Result<number, NotFound> {
    const found = store.get(key);
    if (found === undefined) {
        throw new NotFound(key);
    }
    return found;
}

export function doubled(key: string): Result<number, NotFound> {
    const value = lookup(key).unwrap();
    return value * 2;
}
`

func TestPinnedForkInternalLoweringRewritesResultControlFlow(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm"},
		Files:     []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: internalLoweringSource}},
		Options:   Options{"declaration": true},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("internal lowering must check clean: %#v", result.Diagnostics)
	}

	texts := artifactTextsByPath(t, result.Artifacts)
	emitted, ok := texts["main.js"]
	if !ok {
		t.Fatalf("missing main.js: %v", artifactPaths(result.Artifacts))
	}
	if _, ok := texts["__smithers_prelude.js"]; !ok {
		t.Fatalf("the compiler-owned prelude must be emitted: %v", artifactPaths(result.Artifacts))
	}

	// The authored control flow is gone, replaced by variant construction.
	for _, authored := range []string{"throw new NotFound(key)", "return found;", ".unwrap()"} {
		if strings.Contains(emitted, authored) {
			t.Fatalf("authored form %q survived lowering:\n%s", authored, emitted)
		}
	}
	for _, lowered := range []string{
		"return new __smithersErr(new NotFound(key));",
		"return new __smithersOk(found);",
		"const __smithersUnwrapped0 = lookup(key);",
		"if (!__smithersUnwrapped0.ok)",
		"return __smithersUnwrapped0;",
		"const value = __smithersUnwrapped0.value;",
		"return new __smithersOk(value * 2);",
	} {
		if !strings.Contains(emitted, lowered) {
			t.Fatalf("missing lowered form %q:\n%s", lowered, emitted)
		}
	}
	if declaration := texts["main.d.sm.ts"]; !strings.Contains(declaration, "export declare function lookup(key: string): Result<number, NotFound>;") {
		t.Fatalf("declarations must keep the authored Result signature: %q", declaration)
	}

	// The lowered `return new __smithersErr(...)` maps back to the authored `throw`.
	parsed, points := decodeEmittedMap(t, texts["main.js.map"])
	if len(parsed.Sources) != 1 || !strings.HasSuffix(parsed.Sources[0], "main.sm") {
		t.Fatalf("emitted map lost authored identity: %#v", parsed.Sources)
	}
	loweredLine, loweredColumn := positionOf(t, emitted, "return new __smithersErr")
	authoredLine, authoredColumn := positionOf(t, internalLoweringSource, "throw new NotFound")
	if !hasMapping(points, loweredLine, loweredColumn, authoredLine, authoredColumn) {
		t.Fatalf("lowered throw does not map to the authored throw at %d:%d: %#v", authoredLine, authoredColumn, points)
	}
	// The injected prelude import has no authored origin and stays unmapped.
	for _, point := range points {
		if point.generatedLine == 0 && point.hasSource {
			t.Fatalf("the synthesized prelude import must stay unmapped: %#v", point)
		}
	}

	runEmittedProgram(t, result.Artifacts)
}

// runEmittedProgram writes the emitted artifacts to disk and executes them with
// node, asserting the observable Result semantics of the lowered program.
func runEmittedProgram(t *testing.T, artifacts []Artifact) {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is required to execute the emitted JavaScript")
	}
	directory := t.TempDir()
	for _, item := range artifacts {
		path := filepath.Join(directory, filepath.FromSlash(item.Path))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, item.Content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, "package.json"), []byte(`{"type":"module"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	harness := `import { lookup, doubled, NotFound } from "./main.js";
const ok = lookup("answer");
const err = lookup("nope");
let unwrapThrew = false;
try { err.unwrap(); } catch (thrown) { unwrapThrew = thrown instanceof NotFound; }
console.log(JSON.stringify({
    okTag: ok.ok, okValue: ok.value, okUnwrap: ok.unwrap(),
    errTag: err.ok, errIsNotFound: err.error instanceof NotFound, errKey: err.error.key,
    chainedTag: doubled("answer").ok, chainedValue: doubled("answer").value,
    propagatedTag: doubled("nope").ok, propagatedIsNotFound: doubled("nope").error instanceof NotFound,
    unwrapThrew,
}));
`
	if err := os.WriteFile(filepath.Join(directory, "harness.mjs"), []byte(harness), 0o644); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(node, "harness.mjs")
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("executing the emitted JavaScript failed: %v\n%s", err, output)
	}
	var observed struct {
		OkTag                bool    `json:"okTag"`
		OkValue              float64 `json:"okValue"`
		OkUnwrap             float64 `json:"okUnwrap"`
		ErrTag               bool    `json:"errTag"`
		ErrIsNotFound        bool    `json:"errIsNotFound"`
		ErrKey               string  `json:"errKey"`
		ChainedTag           bool    `json:"chainedTag"`
		ChainedValue         float64 `json:"chainedValue"`
		PropagatedTag        bool    `json:"propagatedTag"`
		PropagatedIsNotFound bool    `json:"propagatedIsNotFound"`
		UnwrapThrew          bool    `json:"unwrapThrew"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(output))), &observed); err != nil {
		t.Fatalf("unexpected program output %q: %v", output, err)
	}
	// A `throw` in a Result-returning function is now a returned error variant,
	// a plain `return` is a returned success variant, and `unwrap()` propagates.
	if !observed.OkTag || observed.OkValue != 42 || observed.OkUnwrap != 42 {
		t.Fatalf("success variant is wrong: %#v", observed)
	}
	if observed.ErrTag || !observed.ErrIsNotFound || observed.ErrKey != "nope" {
		t.Fatalf("error variant is wrong: %#v", observed)
	}
	if !observed.ChainedTag || observed.ChainedValue != 84 {
		t.Fatalf("unwrap propagation lost the success value: %#v", observed)
	}
	if observed.PropagatedTag || !observed.PropagatedIsNotFound {
		t.Fatalf("unwrap propagation did not return the error variant: %#v", observed)
	}
	if !observed.UnwrapThrew {
		t.Fatalf("the runtime unwrap of an error variant must throw: %#v", observed)
	}
}

// TestPinnedForkInternalLoweringScopesToResultReturningFunctions checks the
// lowering follows the checker's view of each function's return type: class
// methods and concise-bodied arrows are lowered, while a nested function whose
// own return type is not a Result keeps its authored control flow.
func TestPinnedForkInternalLoweringScopesToResultReturningFunctions(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	authored := `export class Boom extends Error { }

export const half = (n: number): Result<number, Boom> => n / 2;

export class Calc {
    scale(n: number): Result<number, Boom> {
        if (n < 0) {
            throw new Boom();
        }
        return n * 3;
    }
}

export function outer(n: number): Result<number, Boom> {
    const inner = (x: number): number => x + 1;
    return inner(n);
}

export function plain(n: number): number {
    try {
        if (n < 0) {
            throw new Boom();
        }
        return n;
    } catch (thrown) {
        return 0;
    }
}
`
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"scope.sm"},
		Files:     []SourceFile{{Path: "scope.sm", Kind: FileKindSmithers, Text: authored}},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("scoping project must check clean: %#v", result.Diagnostics)
	}
	emitted := artifactTextsByPath(t, result.Artifacts)["scope.js"]
	for _, lowered := range []string{
		"export const half = (n) => new __smithersOk(n / 2);",
		"return new __smithersErr(new Boom());",
		"return new __smithersOk(n * 3);",
		"const inner = (x) => x + 1;",
		"return new __smithersOk(inner(n));",
	} {
		if !strings.Contains(emitted, lowered) {
			t.Fatalf("missing lowered form %q:\n%s", lowered, emitted)
		}
	}
	// `plain` does not return a Result, so its authored throw survives.
	plain := emitted[strings.Index(emitted, "function plain"):]
	if !strings.Contains(plain, "throw new Boom();") || strings.Contains(plain, "__smithers") {
		t.Fatalf("a non-Result function must keep its authored control flow:\n%s", plain)
	}

	// The same JavaScript throw without a local catch is a recoverable exit at
	// the function boundary, so the non-Result contract must be rejected rather
	// than silently retaining an unchecked throw.
	uncaught := `export class Boom extends Error { }

export function invalid(n: number): number {
    if (n < 0) throw new Boom()
    return n
}
`
	uncaughtResult := compileInternalSource(t, []SourceFile{{Path: "uncaught.sm", Kind: FileKindSmithers, Text: uncaught}})
	diagnostic := requireDiagnostic(t, uncaughtResult, "SMITHERS1101", "uncaught.sm", "recoverable failures {Boom}")
	if diagnostic.Span == nil || diagnostic.Span.Start != strings.Index(uncaught, "export function invalid") {
		t.Fatalf("uncaught recoverable exit must be charged to the authored contract: %#v", diagnostic.Span)
	}
}

// TestPinnedForkInternalLoweringResolvesResultBySymbolIdentity proves the
// lowering recognizes the compiler-owned Result by resolved symbol identity,
// not by name spelling: a file that declares its own `Result` is untouched,
// while a file in the same project using the prelude's `Result` is lowered.
func TestPinnedForkInternalLoweringResolvesResultBySymbolIdentity(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	shadowed := `type Result<A, E> = A | E;

export function shadowed(value: number): Result<number, string> {
    return value;
}
`
	compilerOwned := `export function owned(value: number): Result<number, string> {
    return value;
}
`
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"shadowed.sm", "owned.sm"},
		Files: []SourceFile{
			{Path: "shadowed.sm", Kind: FileKindSmithers, Text: shadowed},
			{Path: "owned.sm", Kind: FileKindSmithers, Text: compilerOwned},
		},
		Lowering: LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("symbol-identity project must check clean: %#v", result.Diagnostics)
	}
	texts := artifactTextsByPath(t, result.Artifacts)
	if !strings.Contains(texts["shadowed.js"], "return value;") || strings.Contains(texts["shadowed.js"], "__smithersOk") {
		t.Fatalf("a user-declared Result must not be lowered:\n%s", texts["shadowed.js"])
	}
	if !strings.Contains(texts["owned.js"], "return new __smithersOk(value);") {
		t.Fatalf("the compiler-owned Result must be lowered:\n%s", texts["owned.js"])
	}
}

func TestPinnedForkInternalRowsResolveAliasesNamespacesAndCycles(t *testing.T) {
	files := []SourceFile{
		{Path: "errors.sm", Kind: FileKindSmithers, Text: `export class Boom extends Error { }
export class Other extends Error { }
`},
		{Path: "leaf.sm", Kind: FileKindSmithers, Text: `import { Boom } from "./errors.sm"
export function leaf(value: number): Result<number, Boom> {
    if (value < 0) throw new Boom()
    return value
}
`},
		{Path: "middle.sm", Kind: FileKindSmithers, Text: `import * as graph from "./leaf.sm"
import { Other } from "./errors.sm"
export function middle(value: number): Result<number, Other> {
    return graph.leaf(value)
}
`},
		{Path: "cap.sm", Kind: FileKindSmithers, Text: `import { Context } from "smthrs/context"
export abstract class Directory extends Context { abstract read(): string }
export function read(): string { return Directory.context().read() }
`},
		{Path: "a.sm", Kind: FileKindSmithers, Text: `import { b } from "./b.sm"
export function a(): string { return b(false) }
`},
		{Path: "b.sm", Kind: FileKindSmithers, Text: `import { a as again } from "./a.sm"
import * as capabilities from "./cap.sm"
export function b(recur: boolean): string {
    return recur ? again() : capabilities.read()
}
`},
		{Path: "main.sm", Kind: FileKindSmithers, Text: `import * as cycle from "./a.sm"
export const value = cycle.a()
`},
	}
	result := compileInternalSource(t, files)
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatalf("row diagnostics must suppress emit: %v", artifactPaths(result.Artifacts))
	}
	omitted := requireDiagnostic(t, result, "SMITHERS1104", "middle.sm", "Boom")
	if omitted.Span == nil || omitted.Span.Start != strings.Index(files[2].Text, "export function middle") {
		t.Fatalf("SMITHERS1104 must point at the authored declaration: %#v", omitted)
	}
	unsatisfied := requireDiagnostic(t, result, "SMITHERS2102", "main.sm", "Directory")
	if unsatisfied.Span == nil || unsatisfied.Span.Start != strings.Index(files[6].Text, "cycle.a()") {
		t.Fatalf("SMITHERS2102 must point at the namespace call after the cycle reaches a fixed point: %#v", unsatisfied)
	}
}

func TestPinnedForkInternalRowsExecuteContextLayers(t *testing.T) {
	authored := `import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"

abstract class Clock extends Context { abstract now(): number }
function stamped(): string { return "time=" + Clock.context().now() }
const live: Clock = { now: () => 7 }

export function main(): string[] {
    return Layer.provide(Layer.succeed(Clock, live), () => [stamped()])
}
`
	result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: authored}})
	requireCleanCompile(t, result)
	observed := executeEmitted(t, result.Artifacts, `import { main } from "./main.js";
console.log(JSON.stringify({ line: main()[0] }));
`)
	expectObserved(t, observed, "line", "time=7")
}

func TestPinnedForkInternalRowsIgnoreUserContextAndLayerSpellings(t *testing.T) {
	authored := `class Context {
    static context(): string { return "user context" }
}
const Layer = {
    succeed(): string { return "user layer" },
    provide(_layer: string, body: () => string): string { return body() },
}
export function main(): string[] {
    return [Context.context(), Layer.provide(Layer.succeed(), () => "ok")]
}
`
	result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: authored}})
	requireCleanCompile(t, result)
	observed := executeEmitted(t, result.Artifacts, `import { main } from "./main.js";
console.log(JSON.stringify({ lines: main().join("|") }));
`)
	expectObserved(t, observed, "lines", "user context|ok")
}

// TestPinnedForkInternalLoweringMapsDiagnosticsToAuthoredPositions checks that a
// diagnostic raised on a statement the lowering rewrote still lands on the exact
// authored span.
func TestPinnedForkInternalLoweringMapsDiagnosticsToAuthoredPositions(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	authored := `export function broken(key: string): Result<number, RangeError> {
    return "not a number";
}
`
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"broken.sm"},
		Files:     []SourceFile{{Path: "broken.sm", Kind: FileKindSmithers, Text: authored}},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatalf("errors in lowered output must suppress emit: %v", artifactPaths(result.Artifacts))
	}
	wantStart := strings.Index(authored, "return")
	found := false
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Code != "TS2322" || diagnostic.File != "broken.sm" || diagnostic.Phase != PhaseCheck {
			continue
		}
		if diagnostic.Span == nil || diagnostic.Span.Start != wantStart || diagnostic.Span.Length != len("return") {
			continue
		}
		// The message is restated in Smithers's own vocabulary: the lowered
		// variant classes are an implementation detail and must not leak.
		if diagnostic.Message != "Type 'string' is not assignable to the success type 'number' of 'Result<number, RangeError>'." {
			continue
		}
		found = true
	}
	if !found {
		t.Fatalf("missing authored-position TS2322 at %d: %#v", wantStart, result.Diagnostics)
	}
	for _, diagnostic := range result.Diagnostics {
		for _, leaked := range []string{"SmithersOk", "SmithersErr", "SmithersSome", "SmithersNone", "__smithers"} {
			if strings.Contains(diagnostic.Message, leaked) {
				t.Fatalf("lowered vocabulary %q leaked into a diagnostic: %q", leaked, diagnostic.Message)
			}
		}
	}
}

func TestPinnedForkInternalLoweringReportsSmithersDiagnosticIdentity(t *testing.T) {
	authored := `export class Missing extends Error { }
export class Timeout extends Error { }

function inner(key: string): Result<string, Missing> {
    if (key !== "ada") throw new Missing()
    return "Ada"
}

export function outer(key: string): Result<Result<string, Missing>, Missing> {
    return inner(key)
}

export function forbidden(key: string): Result<string, Missing> {
    if (key !== "ada") return Result.err(new Missing())
    return Result.ok("Ada")
}

export function partial(error: Missing | Timeout): string {
    return error.matchPartial({
        Missing: (failure) => failure.message,
    })
}
`
	result := compileInternalSource(t, []SourceFile{{Path: "identity.sm", Kind: FileKindSmithers, Text: authored}})
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatalf("language diagnostics must suppress emit: %v", artifactPaths(result.Artifacts))
	}
	wants := []struct {
		code   string
		needle string
	}{
		{code: "SMITHERS1203", needle: "Result<Result<string, Missing>, Missing>"},
		{code: "SMITHERS1201", needle: "Result.err"},
		{code: "SMITHERS1201", needle: "Result.ok"},
		{code: "SMITHERS1255", needle: "error.matchPartial"},
	}
	if len(result.Diagnostics) != len(wants) {
		t.Fatalf("expected only the four Smithers diagnostics, got %#v", result.Diagnostics)
	}
	for _, want := range wants {
		start := strings.Index(authored, want.needle)
		found := false
		for _, item := range result.Diagnostics {
			if item.Code == want.code && item.File == "identity.sm" && item.Span != nil && item.Span.Start == start {
				found = true
				if item.Phase != PhaseLower {
					t.Fatalf("%s must be recognized by semantic/lowering analysis, got phase %q", want.code, item.Phase)
				}
				break
			}
		}
		if !found {
			t.Fatalf("missing %s at authored %q (%d): %#v", want.code, want.needle, start, result.Diagnostics)
		}
	}

	// Same-spelled author declarations resolve to different symbols. Neither
	// the constructor-hook diagnostic nor nested-Result normalization applies.
	shadowed := `type Result<A, E> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: E }
const Result = {
    ok<A>(value: A): Result<A, never> { return { ok: true, value } },
}
export function nested(): Result<Result<number, string>, string> {
    return Result.ok(Result.ok(1))
}
`
	texts := requireCleanCompile(t, compileInternalSource(t, []SourceFile{{Path: "shadowed-result.sm", Kind: FileKindSmithers, Text: shadowed}}))
	if strings.Contains(texts["shadowed-result.js"], "__smithers") || !strings.Contains(texts["shadowed-result.js"], "Result.ok") {
		t.Fatalf("an authored Result type/value must remain untouched:\n%s", texts["shadowed-result.js"])
	}
}

func TestPinnedForkInternalLoweringRecognizesNegativeSyntaxSituations(t *testing.T) {
	braceless := `function combine(base: number, extra: number): number { return base + extra }
export function weighted(score: number, bonus: boolean): number {
    return combine(score, if (bonus) 10 else 0)
}
`
	unlabeled := `export function firstPassing(scores: number[]): number {
    const found = for (const score of scores) {
        if (score >= 60) score
    }
    return found
}
`
	withoutElse := `export function firstPassing(scores: number[]): number {
    const found = search: for (const score of scores) {
        if (score >= 60) break :search score
    }
    return found
}
`
	result := compileInternalSource(t, []SourceFile{
		{Path: "braceless.sm", Kind: FileKindSmithers, Text: braceless},
		{Path: "unlabeled.sm", Kind: FileKindSmithers, Text: unlabeled},
		{Path: "without-else.sm", Kind: FileKindSmithers, Text: withoutElse},
	})
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatalf("negative syntax must suppress emit: %v", artifactPaths(result.Artifacts))
	}
	wants := []struct {
		code   string
		file   string
		text   string
		needle string
	}{
		{code: "SMITHERS1709", file: "braceless.sm", text: braceless, needle: "if (bonus)"},
		{code: "SMITHERS1702", file: "unlabeled.sm", text: unlabeled, needle: "for (const score"},
		{code: "SMITHERS1715", file: "without-else.sm", text: withoutElse, needle: "search: for"},
		{code: "SMITHERS1702", file: "without-else.sm", text: withoutElse, needle: "for (const score"},
	}
	if len(result.Diagnostics) != len(wants) {
		t.Fatalf("expected only structurally recognized Smithers syntax diagnostics, got %#v", result.Diagnostics)
	}
	for _, want := range wants {
		start := strings.Index(want.text, want.needle)
		found := false
		for _, item := range result.Diagnostics {
			if item.Code == want.code && item.File == want.file && item.Phase == PhaseParse && item.Span != nil && item.Span.Start == start {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing %s at %s:%d: %#v", want.code, want.file, start, result.Diagnostics)
		}
	}

	// The same raw parser codes OUTSIDE those recovery-tree situations must not
	// be translated into a structural Smithers construct: the bridge never
	// decides by code alone, and TS1109/TS1005 mean something different here
	// than they do above.
	//
	// What such a failure becomes is SMITHERS1000 — an authored `.sm` file that
	// does not parse is not the supported grammar, whatever TypeScript called
	// the symptom. That is a phase rule, and this block pins the three
	// properties that make it honest rather than a rename: the parser's own
	// explanation is retained in the message, the authored position is
	// unchanged, and no structural code is invented.
	controls := `export const missingExpression = ;
export function missingBrace(): number {
    return 1
`
	controlResult := compileInternalSource(t, []SourceFile{{Path: "controls.sm", Kind: FileKindSmithers, Text: controls}})
	codes := requireDiagnosticCodes(controlResult)
	if strings.Contains(codes, "SMITHERS1702") || strings.Contains(codes, "SMITHERS1709") || strings.Contains(codes, "SMITHERS1715") {
		t.Fatalf("raw codes outside a proved Smithers construct were translated: %#v", controlResult.Diagnostics)
	}
	grammarFailures := 0
	for _, item := range controlResult.Diagnostics {
		if item.Code != "SMITHERS1000" {
			t.Fatalf("an authored .sm parser failure must be reported as a grammar mismatch: %#v", item)
		}
		if !strings.Contains(item.Message, "does not match the supported .sm grammar") {
			t.Fatalf("the grammar mismatch must say so: %#v", item)
		}
		// The parser's own text is the only description of what it choked on,
		// so relabeling must keep it rather than replace it with a generic line.
		if !strings.Contains(item.Message, "Expression expected.") && !strings.Contains(item.Message, "expected.") {
			t.Fatalf("the parser's own explanation must be retained: %#v", item)
		}
		if item.Span == nil || item.File != "controls.sm" {
			t.Fatalf("the authored position must survive relabeling: %#v", item)
		}
		grammarFailures++
	}
	if grammarFailures == 0 {
		t.Fatalf("the control source must still be rejected: %#v", controlResult.Diagnostics)
	}
	// The rule is scoped to authored `.sm`. A plain TypeScript module in the
	// same project is held to TypeScript's grammar and keeps TypeScript's
	// identity, because Smithers never claimed to own it.
	foreignResult := compileInternalSource(t, []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: "export function main(): string[] {\n  return [\"ada\"]\n}\n"},
		{Path: "broken.ts", Kind: FileKindTypeScript, Text: "export const missingExpression = ;\n"},
	})
	foreignCodes := requireDiagnosticCodes(foreignResult)
	if !strings.Contains(foreignCodes, "TS1109") {
		t.Fatalf("a plain TypeScript parser failure must keep its TypeScript identity: %#v", foreignResult.Diagnostics)
	}
	if strings.Contains(foreignCodes, "SMITHERS1000") {
		t.Fatalf("the .sm grammar rule must not be applied to a plain TypeScript module: %#v", foreignResult.Diagnostics)
	}
}

func TestPinnedForkInternalPreludeCompletesOptionalAndErrorAPIsByIdentity(t *testing.T) {
	errorAPI := `export class Missing extends Error {
    constructor(readonly key: string) { super("missing " + key) }
}
export class Timeout extends Error { }

export function partial(error: Missing | Timeout): string {
    return error.matchPartial({
        Missing: (failure) => "case:" + failure.key,
    }, (other) => "fallback:" + other.name)
}

export function inspect(): string[] {
    const root = new Missing("root")
    const outer = new Error("outer")
    Object.defineProperty(outer, "cause", { value: root })
    return [
        "is:" + String(root.is(Missing)),
        "matches:" + String(root.matches(Timeout, Missing)),
        "root:" + (outer.rootCause() as Error).message,
        partial(root),
        partial(new Timeout()),
    ]
}
`
	optionalAPI := `export function optionals(): string[] {
    const present = Optional.fromNullable("Ada")
    const absent = Optional.fromNullable<string>(null)
    return [present.unwrapOr("Guest"), absent.unwrapOr("Guest"), String(absent.toNullable())]
}
`
	result := compileInternalSource(t, []SourceFile{
		{Path: "errors.sm", Kind: FileKindSmithers, Text: errorAPI},
		{Path: "optional.sm", Kind: FileKindSmithers, Text: optionalAPI},
	})
	texts := requireCleanCompile(t, result)
	if !strings.Contains(texts["errors.js"], `import "./__smithers_prelude.js";`) {
		t.Fatalf("Error prototype helpers must pull in the prelude side effect:\n%s", texts["errors.js"])
	}
	if !strings.Contains(texts["optional.js"], "__smithersOptionalNamespace.fromNullable") ||
		strings.Contains(texts["optional.js"], "Optional.fromNullable") {
		t.Fatalf("compiler-owned Optional must become the imported runtime namespace:\n%s", texts["optional.js"])
	}
	_, optionalPoints := decodeEmittedMap(t, texts["optional.js.map"])
	aliasLine, aliasColumn := positionOf(t, texts["optional.js"], "__smithersOptionalNamespace.fromNullable")
	authoredLine, authoredColumn := positionOf(t, optionalAPI, "Optional.fromNullable")
	if !hasMapping(optionalPoints, aliasLine, aliasColumn, authoredLine, authoredColumn) {
		t.Fatalf("the generated Optional alias lost its authored semantic start mapping: %#v", optionalPoints)
	}
	observed := executeEmitted(t, result.Artifacts, `import { inspect } from "./errors.js";
import { optionals } from "./optional.js";
console.log(JSON.stringify({ errors: inspect().join("|"), optionals: optionals().join("|") }));
`)
	expectObserved(t, observed, "errors", "is:true|matches:true|root:missing root|case:root|fallback:Error")
	expectObserved(t, observed, "optionals", "Ada|Guest|null")

	shadowed := `const Optional = { fromNullable<A>(value: A): A { return value } }
class FauxError {
    is(_type: unknown): string { return "user is" }
    rootCause(): string { return "user root" }
}
export function main(): string[] {
    const value = Optional.fromNullable("user optional")
    const error = new FauxError()
    return [value, error.is(FauxError), error.rootCause()]
}
`
	shadowedTexts := requireCleanCompile(t, compileInternalSource(t, []SourceFile{{Path: "shadowed-api.sm", Kind: FileKindSmithers, Text: shadowed}}))
	if strings.Contains(shadowedTexts["shadowed-api.js"], "__smithers") {
		t.Fatalf("same-spelled authored APIs must not pull in compiler runtime behavior:\n%s", shadowedTexts["shadowed-api.js"])
	}
}

// TestInternalLoweringRejectsSuppliedLowering keeps the mode contract explicit:
// internal lowering owns the lowering, so a producer must not supply one.
func TestInternalLoweringRejectsSuppliedLowering(t *testing.T) {
	err := validateLoweredRequest(CompileRequest{
		RootNames: []string{"main.sm"},
		Files: []SourceFile{{
			Path:    "main.sm",
			Kind:    FileKindSmithers,
			Text:    "export const answer: number = 1;\n",
			Lowered: &LoweredSource{Text: "export const answer = 1;\n", SourceMap: "{}"},
		}},
		Lowering: LoweringInternal,
	})
	if err == nil || !strings.Contains(err.Error(), "carries lowered content") {
		t.Fatalf("internal lowering must reject supplied lowered content, got %v", err)
	}
}

// executeEmitted writes the emitted artifacts to disk, runs a harness module
// against them with node, and decodes the JSON the harness prints. Every
// semantic claim about a lowering in this file is proven by what the emitted
// JavaScript actually does, not by the shape of the text.
func executeEmitted(t *testing.T, artifacts []Artifact, harness string) map[string]any {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is required to execute the emitted JavaScript")
	}
	directory := t.TempDir()
	for _, item := range artifacts {
		path := filepath.Join(directory, filepath.FromSlash(item.Path))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, item.Content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, "package.json"), []byte(`{"type":"module"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "harness.mjs"), []byte(harness), 0o644); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(node, "harness.mjs")
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("executing the emitted JavaScript failed: %v\n%s", err, output)
	}
	observed := map[string]any{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(output))), &observed); err != nil {
		t.Fatalf("unexpected program output %q: %v", output, err)
	}
	return observed
}

func expectObserved(t *testing.T, observed map[string]any, key string, want any) {
	t.Helper()
	got, ok := observed[key]
	if !ok {
		t.Fatalf("harness did not report %q: %#v", key, observed)
	}
	if want, isNumber := want.(int); isNumber {
		number, ok := got.(float64)
		if !ok || int(number) != want {
			t.Fatalf("%s = %#v, want %d", key, got, want)
		}
		return
	}
	if got != want {
		t.Fatalf("%s = %#v, want %#v", key, got, want)
	}
}

func compileInternalSource(t *testing.T, files []SourceFile) CompileResult {
	t.Helper()
	backend, ctx := newPinnedTestBackend(t)
	roots := make([]string, 0, len(files))
	for _, file := range files {
		roots = append(roots, file.Path)
	}
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: roots,
		Files:     files,
		Options:   Options{"declaration": true},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func requireCleanCompile(t *testing.T, result CompileResult) map[string]string {
	t.Helper()
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("project must check clean: %#v", result.Diagnostics)
	}
	return artifactTextsByPath(t, result.Artifacts)
}

func requireDiagnostic(t *testing.T, result CompileResult, code string, file string, message string) Diagnostic {
	t.Helper()
	for _, item := range result.Diagnostics {
		if item.Code == code && item.File == file && strings.Contains(item.Message, message) {
			return item
		}
	}
	t.Fatalf("missing %s in %s containing %q: %#v", code, file, message, result.Diagnostics)
	return Diagnostic{}
}

// optionalLoweringSource exercises the Optional channel on its own and the
// outside-in `Result<Optional<A>, E>` composition, including absence
// propagation through `unwrap()` and an already-Optional pass-through.
const optionalLoweringSource = `export class Invalid extends Error { }

export function cached(hit: boolean): Optional<number> {
    if (hit) {
        return 7;
    }
    return undefined;
}

export function doubled(hit: boolean): Optional<number> {
    const value = cached(hit).unwrap();
    return value * 2;
}

export function passthrough(hit: boolean): Optional<number> {
    return cached(hit);
}

export function parsed(kind: number): Result<Optional<string>, Invalid> {
    if (kind < 0) {
        throw new Invalid();
    }
    if (kind === 0) {
        return null;
    }
    return "k" + kind;
}

export function shouted(kind: number): Result<Optional<string>, Invalid> {
    const found = parsed(kind).unwrap();
    const value = found.unwrap();
    return value.toUpperCase();
}
`

func TestPinnedForkInternalLoweringLiftsOptionalChannels(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{{Path: "opt.sm", Kind: FileKindSmithers, Text: optionalLoweringSource}})
	texts := requireCleanCompile(t, result)
	emitted := texts["opt.js"]

	for _, lowered := range []string{
		"return new __smithersSome(7);",
		"return new __smithersNone();",
		"if (!__smithersUnwrapped0.some)",
		"if (!__smithersUnwrapped1.ok)",
		"if (!__smithersUnwrapped2.some)",
		"return new __smithersOk(new __smithersNone());",
		"return new __smithersOk(new __smithersSome(\"k\" + kind));",
	} {
		if !strings.Contains(emitted, lowered) {
			t.Fatalf("missing lowered form %q:\n%s", lowered, emitted)
		}
	}
	// An already-Optional value is propagated, never wrapped a second time.
	passthrough := emitted[strings.Index(emitted, "function passthrough"):]
	passthrough = passthrough[:strings.Index(passthrough, "}")]
	if !strings.Contains(passthrough, "return cached(hit);") {
		t.Fatalf("a compatible Optional must pass through unchanged:\n%s", passthrough)
	}

	// Declarations still publish the authored Smithers signatures.
	for _, signature := range []string{
		"export declare function cached(hit: boolean): Optional<number>;",
		"export declare function parsed(kind: number): Result<Optional<string>, Invalid>;",
	} {
		if !strings.Contains(texts["opt.d.sm.ts"], signature) {
			t.Fatalf("declarations must keep %q:\n%s", signature, texts["opt.d.sm.ts"])
		}
	}

	// A rewritten statement still maps to the span it was authored at, and the
	// synthesized prelude import stays unmapped.
	parsedMap, points := decodeEmittedMap(t, texts["opt.js.map"])
	if len(parsedMap.Sources) != 1 || !strings.HasSuffix(parsedMap.Sources[0], "opt.sm") {
		t.Fatalf("emitted map lost authored identity: %#v", parsedMap.Sources)
	}
	loweredLine, loweredColumn := positionOf(t, emitted, "return new __smithersNone();")
	authoredLine, authoredColumn := positionOf(t, optionalLoweringSource, "return undefined;")
	if !hasMapping(points, loweredLine, loweredColumn, authoredLine, authoredColumn) {
		t.Fatalf("the lowered absent return does not map to the authored return at %d:%d", authoredLine, authoredColumn)
	}
	for _, point := range points {
		if point.generatedLine == 0 && point.hasSource {
			t.Fatalf("the synthesized prelude import must stay unmapped: %#v", point)
		}
	}

	observed := executeEmitted(t, result.Artifacts, `import { cached, doubled, passthrough, parsed, shouted, Invalid } from "./opt.js";
const present = cached(true);
const absent = cached(false);
const okSome = parsed(2);
const okNone = parsed(0);
const failed = parsed(-1);
console.log(JSON.stringify({
    presentSome: present.some, presentValue: present.value, presentUnwrap: present.unwrap(),
    absentSome: absent.some,
    doubledValue: doubled(true).value, doubledAbsent: doubled(false).some,
    passthroughValue: passthrough(true).value, passthroughAbsent: passthrough(false).some,
    okSomeTag: okSome.ok, okSomePresent: okSome.value.some, okSomeValue: okSome.value.value,
    okNoneTag: okNone.ok, okNonePresent: okNone.value.some,
    failedTag: failed.ok, failedIsInvalid: failed.error instanceof Invalid,
    shoutedValue: shouted(2).value.value,
    shoutedAbsentTag: shouted(0).ok, shoutedAbsentPresent: shouted(0).value.some,
    shoutedFailedTag: shouted(-1).ok,
}));
`)
	expectObserved(t, observed, "presentSome", true)
	expectObserved(t, observed, "presentValue", 7)
	expectObserved(t, observed, "presentUnwrap", 7)
	expectObserved(t, observed, "absentSome", false)
	expectObserved(t, observed, "doubledValue", 14)
	expectObserved(t, observed, "doubledAbsent", false)
	// Pass-through must yield the number itself, not an Optional of an Optional.
	expectObserved(t, observed, "passthroughValue", 7)
	expectObserved(t, observed, "passthroughAbsent", false)
	expectObserved(t, observed, "okSomeTag", true)
	expectObserved(t, observed, "okSomePresent", true)
	expectObserved(t, observed, "okSomeValue", "k2")
	// Nullish in a `Result<Optional<A>, E>` owner is success-and-absent, not an error.
	expectObserved(t, observed, "okNoneTag", true)
	expectObserved(t, observed, "okNonePresent", false)
	expectObserved(t, observed, "failedTag", false)
	expectObserved(t, observed, "failedIsInvalid", true)
	expectObserved(t, observed, "shoutedValue", "K2")
	// Absence propagates out of `unwrap()` as success-and-absent.
	expectObserved(t, observed, "shoutedAbsentTag", true)
	expectObserved(t, observed, "shoutedAbsentPresent", false)
	expectObserved(t, observed, "shoutedFailedTag", false)
}

// TestPinnedForkInternalLoweringLeavesNonOptionalShapesUntouched is the
// negative for the Optional channel: a user-declared `Optional`, a plain
// nullable return type, and an `unwrap()` with no Optional-capable owner are
// never rewritten.
func TestPinnedForkInternalLoweringLeavesNonOptionalShapesUntouched(t *testing.T) {
	shadowed := `type Optional<A> = A | null;

export function shadow(value: number): Optional<number> {
    return value;
}
`
	nullable := `export function nullable(hit: boolean): number | undefined {
    if (hit) {
        return 3;
    }
    return undefined;
}
`
	result := compileInternalSource(t, []SourceFile{
		{Path: "shadowed.sm", Kind: FileKindSmithers, Text: shadowed},
		{Path: "nullable.sm", Kind: FileKindSmithers, Text: nullable},
	})
	texts := requireCleanCompile(t, result)
	for name, text := range map[string]string{"shadowed.js": texts["shadowed.js"], "nullable.js": texts["nullable.js"]} {
		if strings.Contains(text, "__smithers") {
			t.Fatalf("%s must be left untouched:\n%s", name, text)
		}
	}

	// An `unwrap()` whose owner declares a contract that cannot carry the
	// propagated absence is a contract error at the declaration, which is where
	// the author has to fix it; the authored call is left intact.
	unowned := `export function find(key: number): Optional<string> {
    return key === 1 ? "x" : undefined;
}

export function bad(key: number): string {
    return find(key).unwrap();
}
`
	unownedResult := compileInternalSource(t, []SourceFile{{Path: "unowned.sm", Kind: FileKindSmithers, Text: unowned}})
	if !unownedResult.EmitSkipped || len(unownedResult.Artifacts) != 0 {
		t.Fatalf("a refused lowering must suppress emit: %v", artifactPaths(unownedResult.Artifacts))
	}
	diagnostic := requireDiagnostic(t, unownedResult, "SMITHERS1206", "unowned.sm", "Optional-returning")
	if diagnostic.Phase != PhaseLower {
		t.Fatalf("SMITHERS1206 must be a lowering diagnostic, got phase %q", diagnostic.Phase)
	}
	wantStart := strings.Index(unowned, "find(key).unwrap()")
	if diagnostic.Span == nil || diagnostic.Span.Start != wantStart {
		t.Fatalf("SMITHERS1206 must land on the authored call at %d: %#v", wantStart, diagnostic.Span)
	}

	// A Result propagation point in an owner that *has* a contract which cannot
	// carry the failure is a contract error at the declaration instead, which
	// is where the author has to fix it.
	contract := `export class E extends Error { }

export function value(key: number): Result<number, E> {
    return key;
}

export function bad(key: number): number {
    return value(key).unwrap();
}
`
	contractResult := compileInternalSource(t, []SourceFile{{Path: "contract.sm", Kind: FileKindSmithers, Text: contract}})
	contractDiagnostic := requireDiagnostic(t, contractResult, "SMITHERS1101", "contract.sm", "explicit return type cannot represent recoverable failures {E}")
	if contractDiagnostic.Span == nil || contractDiagnostic.Span.Start != strings.Index(contract, "export function bad") {
		t.Fatalf("SMITHERS1101 must land on the authored declaration: %#v", contractDiagnostic.Span)
	}
}

// asyncLoweringSource exercises `Promise<Result<A, E>>`-returning functions:
// the Result logic applies to the awaited type, an already-promised Result is
// forwarded unchanged, and a non-async function of the same declared type is
// left alone.
const asyncLoweringSource = `export class Boom extends Error { }

export async function fetched(kind: number): Promise<Result<number, Boom>> {
    if (kind < 0) {
        throw new Boom();
    }
    return kind * 3;
}

export async function chained(kind: number): Promise<Result<number, Boom>> {
    const value = (await fetched(kind)).unwrap();
    return value + 1;
}

export async function forwarded(kind: number): Promise<Result<number, Boom>> {
    return fetched(kind);
}

export function eager(kind: number): Promise<Result<number, Boom>> {
    return fetched(kind);
}
`

func TestPinnedForkInternalLoweringLiftsAsyncResults(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{{Path: "async.sm", Kind: FileKindSmithers, Text: asyncLoweringSource}})
	texts := requireCleanCompile(t, result)
	emitted := texts["async.js"]

	for _, lowered := range []string{
		"return new __smithersErr(new Boom());",
		"return new __smithersOk(kind * 3);",
		"const __smithersUnwrapped0 = (await fetched(kind));",
		"if (!__smithersUnwrapped0.ok)",
		"return new __smithersOk(value + 1);",
	} {
		if !strings.Contains(emitted, lowered) {
			t.Fatalf("missing lowered form %q:\n%s", lowered, emitted)
		}
	}
	// An async function that hands back a promise of a Result is already in the
	// channel, and a non-async function of the same declared type is not the
	// lowering's business at all.
	for _, name := range []string{"function forwarded", "function eager"} {
		body := emitted[strings.Index(emitted, name):]
		body = body[:strings.Index(body, "}")]
		if !strings.Contains(body, "return fetched(kind);") || strings.Contains(body, "__smithers") {
			t.Fatalf("%s must forward its value unchanged:\n%s", name, body)
		}
	}

	if signature := "export declare function fetched(kind: number): Promise<Result<number, Boom>>;"; !strings.Contains(texts["async.d.sm.ts"], signature) {
		t.Fatalf("declarations must keep %q:\n%s", signature, texts["async.d.sm.ts"])
	}

	observed := executeEmitted(t, result.Artifacts, `import { fetched, chained, forwarded, eager, Boom } from "./async.js";
const ok = await fetched(2);
const failed = await fetched(-1);
const forwardedOk = await forwarded(2);
const eagerOk = await eager(2);
console.log(JSON.stringify({
    okTag: ok.ok, okValue: ok.value,
    failedTag: failed.ok, failedIsBoom: failed.error instanceof Boom,
    chainedValue: (await chained(2)).value,
    chainedFailedTag: (await chained(-1)).ok,
    forwardedTag: forwardedOk.ok, forwardedValue: forwardedOk.value,
    eagerTag: eagerOk.ok, eagerValue: eagerOk.value,
}));
`)
	expectObserved(t, observed, "okTag", true)
	expectObserved(t, observed, "okValue", 6)
	expectObserved(t, observed, "failedTag", false)
	expectObserved(t, observed, "failedIsBoom", true)
	expectObserved(t, observed, "chainedValue", 7)
	expectObserved(t, observed, "chainedFailedTag", false)
	// A forwarded promise must not be wrapped a second time.
	expectObserved(t, observed, "forwardedTag", true)
	expectObserved(t, observed, "forwardedValue", 6)
	expectObserved(t, observed, "eagerTag", true)
	expectObserved(t, observed, "eagerValue", 6)
}

// TestPinnedForkInternalLoweringKeepsAwaitOrdering pins the one ordering that
// matters for the async channel: `await` unwraps only the Promise and leaves
// the Result, so `await f(x).unwrap()` is not an unwrap of a Result at all and
// is never lowered.
func TestPinnedForkInternalLoweringKeepsAwaitOrdering(t *testing.T) {
	authored := `export class Boom extends Error { }

export async function fetched(kind: number): Promise<Result<number, Boom>> {
    return kind;
}

export async function bad(kind: number): Promise<Result<number, Boom>> {
    return await fetched(kind).unwrap();
}
`
	result := compileInternalSource(t, []SourceFile{{Path: "order.sm", Kind: FileKindSmithers, Text: authored}})
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatalf("an unlowerable await must suppress emit: %v", artifactPaths(result.Artifacts))
	}
	diagnostic := requireDiagnostic(t, result, "TS2339", "order.sm", "'unwrap' does not exist on type 'Promise<Result<number, Boom>>'")
	wantStart := strings.Index(authored, "unwrap()")
	if diagnostic.Span == nil || diagnostic.Span.Start != wantStart || diagnostic.Span.Length != len("unwrap") {
		t.Fatalf("the rejection must land on the authored `unwrap` at %d: %#v", wantStart, diagnostic.Span)
	}
}

const matchErrorsSource = `export class NotFound extends Error {
    readonly key: string;
    constructor(key: string) {
        super("missing " + key);
        this.key = key;
    }
}

export class Timeout extends Error {
    readonly ms: number;
    constructor(ms: number) {
        super("timeout");
        this.ms = ms;
    }
}
`

// matchOtherSource declares a class whose *name* collides with one in
// matchErrorsSource. Nominal identity must come from the resolved class, not
// from the spelling of the case label.
const matchOtherSource = `export class NotFound extends Error { }
`

const matchMainSource = `import { NotFound as Missing, Timeout } from "./errors.sm";

export function describe(error: Missing | Timeout): string {
    return error.match({
        Missing: (value) => "missing:" + value.key,
        Timeout: (value) => "timeout:" + value.ms,
    });
}

export function lookup(key: string): Result<number, Missing | Timeout> {
    if (key === "slow") {
        throw new Timeout(50);
    }
    if (key !== "answer") {
        throw new Missing(key);
    }
    return 42;
}

export function report(key: string): string {
    const outcome = lookup(key);
    if (outcome.ok) {
        return "ok:" + outcome.value;
    }
    return describe(outcome.error);
}
`

func TestPinnedForkInternalLoweringDispatchesNominalErrorMatch(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "errors.sm", Kind: FileKindSmithers, Text: matchErrorsSource},
		{Path: "other.sm", Kind: FileKindSmithers, Text: matchOtherSource},
		{Path: "main.sm", Kind: FileKindSmithers, Text: matchMainSource},
	})
	texts := requireCleanCompile(t, result)
	emitted := texts["main.js"]

	if strings.Contains(emitted, ".match(") {
		t.Fatalf("the authored match survived lowering:\n%s", emitted)
	}
	for _, lowered := range []string{
		"error instanceof Missing ?",
		"error instanceof Timeout ?",
		"__smithersMatchFailed(error)",
	} {
		if !strings.Contains(emitted, lowered) {
			t.Fatalf("missing constructor-keyed case %q:\n%s", lowered, emitted)
		}
	}

	// The dispatch maps back to the authored match expression.
	parsedMap, points := decodeEmittedMap(t, texts["main.js.map"])
	loweredLine, loweredColumn := positionOf(t, emitted, "error instanceof Missing")
	authoredLine, authoredColumn := positionOf(t, matchMainSource, "error.match({")
	if len(parsedMap.Sources) != 1 || !hasMapping(points, loweredLine, loweredColumn, authoredLine, authoredColumn) {
		t.Fatalf("the lowered dispatch does not map to the authored match at %d:%d", authoredLine, authoredColumn)
	}

	observed := executeEmitted(t, result.Artifacts, `import { report, describe } from "./main.js";
import { NotFound, Timeout } from "./errors.js";
console.log(JSON.stringify({
    ok: report("answer"),
    missing: report("nope"),
    timeout: report("slow"),
    direct: describe(new NotFound("k")),
    directTimeout: describe(new Timeout(9)),
}));
`)
	expectObserved(t, observed, "ok", "ok:42")
	expectObserved(t, observed, "missing", "missing:nope")
	expectObserved(t, observed, "timeout", "timeout:50")
	expectObserved(t, observed, "direct", "missing:k")
	expectObserved(t, observed, "directTimeout", "timeout:9")
}

// TestPinnedForkInternalLoweringChecksErrorMatchExhaustiveness is the negative
// for nominal matching: an incomplete case set, a case outside the checked
// union, and a same-named class from another module are all refused, and the
// authored call is left intact rather than approximated.
func TestPinnedForkInternalLoweringChecksErrorMatchExhaustiveness(t *testing.T) {
	incomplete := `import { NotFound, Timeout } from "./errors.sm";

export function describe(error: NotFound | Timeout): string {
    return error.match({ NotFound: (value) => value.key });
}
`
	result := compileInternalSource(t, []SourceFile{
		{Path: "errors.sm", Kind: FileKindSmithers, Text: matchErrorsSource},
		{Path: "incomplete.sm", Kind: FileKindSmithers, Text: incomplete},
	})
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatalf("a non-exhaustive match must suppress emit: %v", artifactPaths(result.Artifacts))
	}
	requireDiagnostic(t, result, "SMITHERS1253", "incomplete.sm", "missing Timeout")

	// The case label spells `NotFound`, but it resolves to a *different* module's
	// class, so it neither covers the union member nor belongs to it.
	foreign := `import { NotFound, Timeout } from "./errors.sm";
import { NotFound as Other } from "./other.sm";

export function describe(error: NotFound | Timeout): string {
    return error.match({
        Other: (value) => String(value),
        Timeout: (value) => "timeout:" + value.ms,
    });
}
`
	foreignResult := compileInternalSource(t, []SourceFile{
		{Path: "errors.sm", Kind: FileKindSmithers, Text: matchErrorsSource},
		{Path: "other.sm", Kind: FileKindSmithers, Text: matchOtherSource},
		{Path: "foreign.sm", Kind: FileKindSmithers, Text: foreign},
	})
	requireDiagnostic(t, foreignResult, "SMITHERS1253", "foreign.sm", "missing NotFound")
}

// TestPinnedForkInternalLoweringRefusesUnsafePropagationPlacement proves the
// hoist is order-preserving: a propagation point is only lifted while
// everything evaluated ahead of it in the same statement is effect-free, and a
// point that may not be evaluated at all is never made unconditional.
func TestPinnedForkInternalLoweringRefusesUnsafePropagationPlacement(t *testing.T) {
	safe := `export class E extends Error { }

export function value(kind: number): Result<number, E> {
    return kind;
}

export function fine(kind: number): Result<number, E> {
    const scored = value(kind).unwrap();
    return scored + 1;
}

export function direct(kind: number): Result<number, E> {
    return value(kind).unwrap();
}
`
	texts := requireCleanCompile(t, compileInternalSource(t, []SourceFile{{Path: "safe.sm", Kind: FileKindSmithers, Text: safe}}))
	for _, lowered := range []string{
		"const scored = __smithersUnwrapped0.value;",
		"return new __smithersOk(__smithersUnwrapped1.value);",
	} {
		if !strings.Contains(texts["safe.js"], lowered) {
			t.Fatalf("a statement-safe placement must still propagate (%q):\n%s", lowered, texts["safe.js"])
		}
	}

	unsafe := `export class E extends Error { }

export function value(kind: number): Result<number, E> {
    return kind;
}

export function side(): number {
    return 1;
}

export function ordered(kind: number): Result<number, E> {
    return side() + value(kind).unwrap();
}

export function conditional(kind: number, flag: boolean): Result<number, E> {
    return flag ? value(kind).unwrap() : 0;
}

export function summed(kind: number): Result<number, E> {
    return value(kind).unwrap() + value(kind + 1).unwrap();
}
`
	result := compileInternalSource(t, []SourceFile{{Path: "unsafe.sm", Kind: FileKindSmithers, Text: unsafe}})
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatalf("a refused propagation must suppress emit: %v", artifactPaths(result.Artifacts))
	}
	ordered := requireDiagnostic(t, result, "SMITHERS1204", "unsafe.sm", "evaluation-order rewriting")
	if ordered.Span == nil || ordered.Span.Start != strings.Index(unsafe, "value(kind).unwrap()") {
		t.Fatalf("SMITHERS1204 must land on the authored call: %#v", ordered.Span)
	}
	found := 0
	for _, item := range result.Diagnostics {
		if item.Code == "SMITHERS1204" {
			found++
		}
	}
	if found != 4 {
		t.Fatalf("every operand-position propagation must be refused: %#v", result.Diagnostics)
	}
}

// TestPinnedForkInternalLoweringOffersTheResultAndOptionalSurface proves the
// operations the language defines on a Result and an Optional are real prelude
// methods with real runtime behavior, so nothing about them needs lowering.
func TestPinnedForkInternalLoweringOffersTheResultAndOptionalSurface(t *testing.T) {
	authored := `export class Missing extends Error {
    constructor(readonly key: string) {
        super("no entry for " + key);
    }
}

const names = new Map<string, string>([["ada", "Ada Lovelace"]]);

export function lookup(key: string): Result<string, Missing> {
    if (!names.has(key)) {
        throw new Missing(key);
    }
    return names.get(key) as string;
}

export function find(key: string): Optional<string> {
    return names.get(key);
}

export function describe(key: string): string {
    return lookup(key).match({
        ok: (value) => "ok " + value,
        error: (error) => "error " + error.key,
    });
}

export function shouted(key: string): string {
    return lookup(key).map((value) => value.toUpperCase()).unwrapOr("GUEST");
}

export function named(key: string): string {
    return find(key).match({ some: (value) => value, none: () => "absent" });
}

export function fallback(key: string): string {
    return find(key).unwrapOr("guest");
}
`
	result := compileInternalSource(t, []SourceFile{{Path: "surface.sm", Kind: FileKindSmithers, Text: authored}})
	texts := requireCleanCompile(t, result)
	// The operations are library calls, not language constructs: nothing about
	// them is rewritten.
	for _, authoredForm := range []string{".match({", ".unwrapOr(", ".map("} {
		if !strings.Contains(texts["surface.js"], authoredForm) {
			t.Fatalf("%q must survive as an ordinary method call:\n%s", authoredForm, texts["surface.js"])
		}
	}

	observed := executeEmitted(t, result.Artifacts, `import { describe, shouted, named, fallback } from "./surface.js";
console.log(JSON.stringify({
    describeOk: describe("ada"), describeError: describe("zoe"),
    shoutedOk: shouted("ada"), shoutedFallback: shouted("zoe"),
    namedSome: named("ada"), namedNone: named("zoe"),
    fallbackSome: fallback("ada"), fallbackNone: fallback("zoe"),
}));
`)
	expectObserved(t, observed, "describeOk", "ok Ada Lovelace")
	expectObserved(t, observed, "describeError", "error zoe")
	expectObserved(t, observed, "shoutedOk", "ADA LOVELACE")
	expectObserved(t, observed, "shoutedFallback", "GUEST")
	expectObserved(t, observed, "namedSome", "Ada Lovelace")
	expectObserved(t, observed, "namedNone", "absent")
	expectObserved(t, observed, "fallbackSome", "Ada Lovelace")
	expectObserved(t, observed, "fallbackNone", "guest")
}

// TestPinnedForkInternalLoweringFailsClosedOnDiscardedChannels covers the
// refusals that keep a checked channel from being silently dropped: a
// recoverable exit that a `catch` would have handled, a discarded Result or
// Promise, a Promise chained instead of awaited, and a top-level `throw`.
func TestPinnedForkInternalLoweringFailsClosedOnDiscardedChannels(t *testing.T) {
	authored := `export class Missing extends Error { }

export function lookup(key: string): Result<string, Missing> {
    if (key !== "ada") {
        throw new Missing();
    }
    return "Ada";
}

export async function fetched(key: string): Promise<Result<string, Missing>> {
    return lookup(key);
}

export function guarded(key: string): Result<string, Missing> {
    try {
        const value = lookup(key).unwrap();
        return value;
    } catch (thrown) {
        return "fallback";
    }
}

export function dropped(key: string): string {
    lookup(key);
    return "done";
}

export async function started(key: string): Promise<string> {
    fetched(key);
    return "done";
}

export async function chained(key: string): Promise<string> {
    const outcome = await fetched(key).then((settled) => settled);
    return outcome.unwrapOr("Guest");
}
`
	result := compileInternalSource(t, []SourceFile{{Path: "closed.sm", Kind: FileKindSmithers, Text: authored}})
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatalf("a refused program must suppress emit: %v", artifactPaths(result.Artifacts))
	}
	for _, expected := range []struct {
		code   string
		detail string
		needle string
	}{
		{code: "SMITHERS1205", detail: "silently bypass the catch handler", needle: "lookup(key).unwrap()"},
		{code: "SMITHERS1301", detail: "must still be returned", needle: "lookup(key);\n    return \"done\";"},
		{code: "SMITHERS1402", detail: "started Promise is not consumed", needle: "fetched(key);\n    return \"done\";"},
		{code: "SMITHERS1401", detail: "unavailable in authored .sm", needle: "fetched(key).then("},
	} {
		diagnostic := requireDiagnostic(t, result, expected.code, "closed.sm", expected.detail)
		if diagnostic.Span == nil || diagnostic.Span.Start != strings.Index(authored, expected.needle) {
			t.Fatalf("%s must land on the authored construct %q: %#v", expected.code, expected.needle, diagnostic.Span)
		}
	}
	// The recoverable exit inside the catch-guarded try keeps JavaScript throw
	// behavior rather than becoming an early return the catch could not see.
	if strings.Contains(requireDiagnosticCodes(result), "SMITHERS1511") {
		t.Fatalf("no top-level throw in this program: %#v", result.Diagnostics)
	}

	topLevel := `export class Boom extends Error { }

const enabled = true;

if (enabled) throw new Boom();
`
	topLevelResult := compileInternalSource(t, []SourceFile{{Path: "top.sm", Kind: FileKindSmithers, Text: topLevel}})
	diagnostic := requireDiagnostic(t, topLevelResult, "SMITHERS1511", "top.sm", "top-level throw")
	if diagnostic.Span == nil || diagnostic.Span.Start != strings.Index(topLevel, "throw new Boom();") {
		t.Fatalf("SMITHERS1511 must land on the authored throw: %#v", diagnostic.Span)
	}
}

func TestPinnedForkInternalLoweringExecutesDeferAndErrdefer(t *testing.T) {
	authored := `const events: string[] = []

function record(message: string): void { events.push(message) }

export class Failed extends Error { }

function run(mode: number): Result<number, Failed> {
    defer record(String(mode) + ":always")
    if (mode === 0) return mode
    defer record(String(mode) + ":late")
    errdefer record(String(mode) + ":error")
    if (mode < 0) throw new Failed()
    return mode
}

export function main(): string[] {
    const zero = run(0).match({ ok: (value) => "ok:" + String(value), error: () => "error" })
    const one = run(1).match({ ok: (value) => "ok:" + String(value), error: () => "error" })
    const failed = run(-1).match({ ok: (value) => "ok:" + String(value), error: () => "error" })
    return [zero, one, failed, events.join(",")]
}
`
	result := compileInternalSource(t, []SourceFile{{Path: "defer.sm", Kind: FileKindSmithers, Text: authored}})
	texts := requireCleanCompile(t, result)
	emitted := texts["defer.js"]
	if strings.Contains(emitted, "defer ") || strings.Contains(emitted, "errdefer ") {
		t.Fatalf("a defer marker reached JavaScript:\n%s", emitted)
	}
	_, points := decodeEmittedMap(t, texts["defer.js.map"])
	loweredLine, loweredColumn := positionOf(t, emitted, `record(String(mode) + ":always")`)
	authoredLine, authoredColumn := positionOf(t, authored, `record(String(mode) + ":always")`)
	if !hasMapping(points, loweredLine, loweredColumn, authoredLine, authoredColumn) {
		t.Fatalf("deferred cleanup lost its authored mapping at %d:%d", authoredLine, authoredColumn)
	}
	observed := executeEmitted(t, result.Artifacts, `import { main } from "./defer.js";
console.log(JSON.stringify({ lines: main().join("|") }));
`)
	expectObserved(t, observed, "lines", "ok:0|ok:1|error|0:always,1:late,1:always,-1:error,-1:late,-1:always")
}

func TestPinnedForkInternalLoweringExecutesConditionalDeclarationAndValueExpressions(t *testing.T) {
	authored := `let initializations = 0

function lookup(key: string): string | null {
    initializations++
    return key === "ada" ? "Ada" : null
}

function describe(key: string, bonus: boolean): string {
    if (const name = lookup(key); name !== null) {
        const points = if (bonus) { 10 } else { 0 }
        const grade = switch (points) {
            case 10: "bonus"
            default: "plain"
        }
        return name + ":" + grade
    } else {
        return "missing"
    }
}

export function main(): string[] {
    return [describe("ada", true), describe("ada", false), describe("zoe", true), String(initializations)]
}
`
	result := compileInternalSource(t, []SourceFile{{Path: "values.sm", Kind: FileKindSmithers, Text: authored}})
	texts := requireCleanCompile(t, result)
	emitted := texts["values.js"]
	for _, invalid := range []string{"if (const name", "const points = if", "const grade = switch"} {
		if strings.Contains(emitted, invalid) {
			t.Fatalf("authored Smithers syntax %q reached JavaScript:\n%s", invalid, emitted)
		}
	}
	_, points := decodeEmittedMap(t, texts["values.js.map"])
	loweredLine, loweredColumn := positionOf(t, emitted, "const name = lookup(key);")
	authoredLine, authoredColumn := positionOf(t, authored, "const name = lookup(key)")
	if !hasMapping(points, loweredLine, loweredColumn, authoredLine, authoredColumn) {
		t.Fatalf("conditional declaration lost its authored mapping at %d:%d", authoredLine, authoredColumn)
	}
	observed := executeEmitted(t, result.Artifacts, `import { main } from "./values.js";
console.log(JSON.stringify({ lines: main().join("|") }));
`)
	expectObserved(t, observed, "lines", "Ada:bonus|Ada:plain|missing|3")
}

// The fork wraps both block and loop values in a LabeledExpression containing
// the real LabeledStatement. This test executes the resulting joins, including
// argument position, value-break selection, normal loop completion, and the
// language's deliberate rule that a plain labeled break flows into loop else.
func TestPinnedForkInternalLoweringExecutesLabeledBlockAndLoopValueJoins(t *testing.T) {
	authored := `function select(events: string[], event: string, value: string): string {
    events.push(event)
    return value
}

function classify(score: number): string {
    return "[" + (verdict: {
        if (score >= 60) break :verdict "pass"
        break :verdict "fail"
    }) + "]"
}

function run(mode: string): string {
    const events: string[] = []
    const outcome = search: for (let index = 0; index < 2; index++) {
        events.push("body:" + String(index))
        if (mode === "value") break :search select(events, "value", "selected")
        if (mode === "plain") break search
    } else select(events, "else", "fallback")
    return outcome + "@" + events.join(",")
}

export function main(): string[] {
    return [classify(96), classify(41), run("value"), run("plain"), run("normal")]
}
`
	result := compileInternalSource(t, []SourceFile{{Path: "loop.sm", Kind: FileKindSmithers, Text: authored}})
	texts := requireCleanCompile(t, result)
	emitted := texts["loop.js"]
	if strings.Contains(emitted, "break :search") || strings.Contains(emitted, "} else record") {
		t.Fatalf("authored loop-value syntax reached JavaScript:\n%s", emitted)
	}
	_, points := decodeEmittedMap(t, texts["loop.js.map"])
	loweredLine, loweredColumn := positionOf(t, emitted, "break __smithersLabeledValueExit")
	authoredLine, authoredColumn := positionOf(t, authored, "break :verdict")
	if !hasMapping(points, loweredLine, loweredColumn, authoredLine, authoredColumn) {
		t.Fatalf("rewritten value break lost its authored mapping at %d:%d", authoredLine, authoredColumn)
	}
	wrapperLine, _ := positionOf(t, emitted, "__smithersLabeledValueExit")
	for _, point := range points {
		if point.generatedLine == wrapperLine && point.hasSource {
			t.Fatalf("the synthesized value-join wrapper must stay unmapped: %#v", point)
		}
	}
	observed := executeEmitted(t, result.Artifacts, `import { main } from "./loop.js";
console.log(JSON.stringify({ lines: main().join("|") }));
`)
	expectObserved(t, observed, "lines", "[pass]|[fail]|selected@body:0,value|fallback@body:0,else|fallback@body:0,body:1,else")
}

// A value-`switch` clause is `case <label>: <statements> <final expression>`.
// The conditional-expression chain the lowering used for single-expression
// clauses has nowhere to put a statement, so it built the chain from the
// clause's Expression and Value and silently discarded Statements: the program
// compiled clean, ran, and produced the right values with the clause's calls
// simply missing. Every claim below is made about what the emitted JavaScript
// actually did, because the defect type-checked perfectly.
func TestPinnedForkInternalLoweringExecutesSwitchClauseStatements(t *testing.T) {
	authored := `const seen: string[] = []

function record(message: string): string {
    seen.push(message)
    return message
}

// Records that it was evaluated, and separately decides what it evaluates to,
// so the trace tells scrutinee, label, and clause body apart even when two of
// them have to compare equal.
function probe(message: string, value: string): string {
    seen.push(message)
    return value
}

function describe(grade: string): string {
    return switch (probe("read", grade)) {
        case probe("label:pass", "pass"): record("ran:pass"); "met the bar"
        case probe("label:retry", "retry"): record("ran:retry"); "resit scheduled"
        default: record("ran:other"); "unrecognized"
    }
}

function attempt(grade: string): string {
    const chosen = switch (grade) {
        case "quit":
            record("ran:quit")
            return "left early"
        default: "stayed"
    }
    return chosen
}

export function main(): string[] {
    seen.length = 0
    const matched = describe("pass")
    const fell = describe("nothing")
    const selection = seen.join(",")
    seen.length = 0
    const quit = attempt("quit")
    const stayed = attempt("go")
    return [matched, fell, selection, quit, stayed, seen.join(",")]
}
`
	result := compileInternalSource(t, []SourceFile{{Path: "clause.sm", Kind: FileKindSmithers, Text: authored}})
	texts := requireCleanCompile(t, result)
	emitted := texts["clause.js"]
	// The exact call the old lowering dropped. Emitting it is necessary but not
	// sufficient — the execution below is what settles the semantics.
	for _, required := range []string{`record("ran:pass")`, `record("ran:other")`, `record("ran:quit")`} {
		if !strings.Contains(emitted, required) {
			t.Fatalf("a switch-expression clause statement never reached JavaScript: %s\n%s", required, emitted)
		}
	}
	if strings.Contains(emitted, "switch (") {
		t.Fatalf("a value switch must not lower to a statement switch, which would capture an unlabeled break:\n%s", emitted)
	}

	_, points := decodeEmittedMap(t, texts["clause.js.map"])
	loweredLine, loweredColumn := positionOf(t, emitted, `record("ran:pass")`)
	authoredLine, authoredColumn := positionOf(t, authored, `record("ran:pass")`)
	if !hasMapping(points, loweredLine, loweredColumn, authoredLine, authoredColumn) {
		t.Fatalf("a clause statement lost its authored mapping at %d:%d", authoredLine, authoredColumn)
	}

	observed := executeEmitted(t, result.Artifacts, `import { main } from "./clause.js";
console.log(JSON.stringify({ lines: main().join("|") }));
`)
	// Reading the trace: the scrutinee is evaluated exactly once and first; case
	// labels are evaluated in source order and only until one matches; the
	// selected clause runs its statements and then produces its final
	// expression; and exactly one clause body runs per call, because the
	// expression form does not fall through.
	expectObserved(t, observed, "lines", strings.Join([]string{
		"met the bar",
		"unrecognized",
		"read,label:pass,ran:pass,read,label:pass,label:retry,ran:other",
		"left early",
		"stayed",
		"ran:quit",
	}, "|"))
}

// The statement form has to move the whole construct ahead of the containing
// statement, so it must refuse the placements where that would be observable —
// the same discipline the labeled block/loop value lowering follows. These are
// the fail-closed halves of the fix: a wrong answer is never emitted silently.
func TestPinnedForkInternalLoweringRefusesUnsoundSwitchClauseStatements(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		authored string
		code     string
		message  string
	}{{
		name: "across an earlier observable expression",
		authored: `function note(message: string): string { return message }

export function combined(key: string): string {
    return note("first") + switch (key) {
        case "a": note("clause"); "A"
        default: "D"
    }
}
`,
		code:    "SMITHERS1707",
		message: "cannot be moved across an earlier observable expression",
	}, {
		name: "out of a conditional placement",
		authored: `function note(message: string): string { return message }

export function guarded(flag: boolean, key: string): string {
    return flag ? "skipped" : switch (key) {
        case "a": note("clause"); "A"
        default: "D"
    }
}
`,
		code:    "SMITHERS1707",
		message: "out of this conditional placement",
	}, {
		// In the authored text this break sits inside a `switch`, so it reads as
		// ending the construct — but the expression form owes its context a value
		// and an ended clause has none.
		name: "an unlabeled break with no representable target",
		authored: `function note(message: string): string { return message }

export function run(keys: string[]): string {
    let last = ""
    for (const key of keys) {
        last = switch (key) {
            case "stop": break; "stopped"
            default: note("kept")
        }
    }
    return last
}
`,
		code:    "SMITHERS1702",
		message: "unlabeled break inside a switch-expression clause",
	}, {
		// Label grouping reads naturally because the statement `switch` this
		// shares syntax with does fall through. Before this was reported, the
		// empty clause's absent value reached the printer as a conditional branch
		// that was not there, and the compiler died with a nil dereference.
		name: "an empty clause that reads as label grouping",
		authored: `export function pick(key: string): string {
    return switch (key) {
        case "a":
        case "b": "shared"
        default: "other"
    }
}
`,
		code:    "SMITHERS1702",
		message: "does not fall through into the next clause",
	}} {
		t.Run(testCase.name, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "unsound.sm", Kind: FileKindSmithers, Text: testCase.authored}})
			if !result.EmitSkipped {
				t.Fatalf("an unsound switch-expression clause must not be emitted: %s", requireDiagnosticCodes(result))
			}
			requireDiagnostic(t, result, testCase.code, "unsound.sm", testCase.message)
		})
	}
}

func requireDiagnosticCodes(result CompileResult) string {
	codes := make([]string, 0, len(result.Diagnostics))
	for _, item := range result.Diagnostics {
		codes = append(codes, item.Code)
	}
	return strings.Join(codes, ",")
}
