package compiler

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Panic does not widen a return type.
//
// specification/failures.mdx §Panic Does Not Widen a Return Type (normative),
// with the matching Locked entry in docs/DECISIONS.md:
//
//	"Calling `panic(...)` MUST NOT force a function's return type to widen into
//	 `Result<A, Panic>`. ... A function that validates an argument, refuses a
//	 forgery, or asserts an invariant MUST therefore be able to abort with
//	 `panic(...)` while keeping a plain return type."
//
//	"An author MAY still annotate `Result<A, Panic>` explicitly to materialize a
//	 panic as a value; that is how panic is made explicitly catchable. The
//	 prohibition is on the compiler *forcing* that widening, not on an author
//	 choosing it."
//
// The rule follows from two MUSTs the same page already carried — the panic case
// is "tracked separately from ordinary recoverable Error variants" (§Compiler
// Lifting) and "Ordinary Result recovery MUST NOT swallow panic implicitly"
// (§Foreign Exceptions) — because `E` is the *expected*-error channel
// (reference/function-channels.mdx) and a panic is not an expected error.
//
// Every case here is EXECUTED. The defect this rule closes compiled with zero
// diagnostics and misbehaved only at run time: a panic forced into `E` was
// consumed by `unwrapOr` and vanished from the caller's row. A diagnostic-only
// test would have passed against the broken compiler.

// TestPinnedForkPanicKeepsAPlainReturnType pins the accepted direction across
// every construct that can host a `panic(...)` exit. Each row runs.
func TestPinnedForkPanicKeepsAPlainReturnType(t *testing.T) {
	const panicImport = "import { panic } from \"smithers:exceptions\"\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name:   "a plain function declaration aborts without widening",
			source: panicImport + "function guarded(ok: boolean): string {\n  if (!ok) panic(\"forged value\")\n  return \"real\"\n}\nexport function main(): string[] {\n  return [guarded(true)]\n}\n",
			stdout: "real",
		},
		{
			name:   "an unannotated function infers a plain return type",
			source: panicImport + "function guarded(ok: boolean) {\n  if (!ok) panic(\"forged value\")\n  return \"real\"\n}\nexport function main(): string[] {\n  return [guarded(true)]\n}\n",
			stdout: "real",
		},
		{
			name:   "an exported function needs no Result contract for a panic",
			source: panicImport + "export function assertPositive(value: number): void {\n  if (value <= 0) panic(\"value must be positive\")\n}\nexport function main(): string[] {\n  assertPositive(1)\n  return [\"ok\"]\n}\n",
			stdout: "ok",
		},
		{
			name:   "a never-returning abort helper is authorable",
			source: panicImport + "function fail(message: string): never {\n  panic(message)\n}\nexport function main(): string[] {\n  const values = [\"ada\"]\n  if (values.length === 0) fail(\"empty\")\n  return values\n}\n",
			stdout: "ada",
		},
		{
			name:   "a concise arrow body is an abort, not a value position",
			source: panicImport + "const fail = (message: string): never => panic(message)\nexport function main(): string[] {\n  const values = [\"ada\"]\n  if (values.length === 0) fail(\"empty\")\n  return values\n}\n",
			stdout: "ada",
		},
		{
			name:   "a braced arrow body aborts without widening",
			source: panicImport + "const guarded = (ok: boolean): string => {\n  if (!ok) panic(\"forged\")\n  return \"real\"\n}\nexport function main(): string[] {\n  return [guarded(true)]\n}\n",
			stdout: "real",
		},
		{
			name:   "instance and static methods abort without widening",
			source: panicImport + "class Box {\n  read(ok: boolean): string {\n    if (!ok) panic(\"forged\")\n    return \"real\"\n  }\n  static make(ok: boolean): Box {\n    if (!ok) panic(\"forged\")\n    return new Box()\n  }\n}\nexport function main(): string[] {\n  return [Box.make(true).read(true)]\n}\n",
			stdout: "real",
		},
		{
			// The closed contradiction. Before this rule a getter reading state
			// through a panicking helper drew SMITHERS1101 (widen to Result) and,
			// on the reference, SMITHERS1105 (accessors may not carry a Result
			// channel) on the same line, with each remedy forbidden by the other.
			// Seven public getters in poc/src/data/** had no legal spelling.
			name:   "a getter, a setter, and a constructor may all abort",
			source: panicImport + "class Box {\n  private stored = 0\n  constructor(size: number) {\n    if (size < 0) panic(\"negative size\")\n    this.stored = size\n  }\n  get size(): number {\n    if (this.stored < 0) panic(\"forged\")\n    return this.stored\n  }\n  set size(value: number) {\n    if (value < 0) panic(\"negative\")\n    this.stored = value\n  }\n}\nexport function main(): string[] {\n  const box = new Box(2)\n  box.size = 5\n  return [`${box.size}`]\n}\n",
			stdout: "5",
		},
		{
			name:   "an object-literal method and getter may abort",
			source: panicImport + "const box = {\n  read(ok: boolean): string {\n    if (!ok) panic(\"forged\")\n    return \"real\"\n  },\n  get label(): string {\n    panic(\"no label\")\n  },\n}\nexport function main(): string[] {\n  return [box.read(true)]\n}\n",
			stdout: "real",
		},
		{
			name:   "a generator may abort",
			source: panicImport + "function* items(ok: boolean): Generator<string> {\n  if (!ok) panic(\"forged\")\n  yield \"real\"\n}\nexport function main(): string[] {\n  return [...items(true)]\n}\n",
			stdout: "real",
		},
		{
			name:   "an async function may abort",
			source: panicImport + "async function guarded(ok: boolean): Promise<string> {\n  if (!ok) panic(\"forged\")\n  return \"real\"\n}\nexport async function main(): Promise<string[]> {\n  return [await guarded(true)]\n}\n",
			stdout: "real",
		},
		{
			name:   "an inline callback may abort",
			source: panicImport + "export function main(): string[] {\n  return [\"ada\"].map((key: string): string => {\n    if (key !== \"ada\") panic(\"forged\")\n    return key\n  })\n}\n",
			stdout: "ada",
		},
		{
			// A panic reached one and two hops away through helpers. Before this
			// rule the helper itself drew SMITHERS1101 and every call site drew a
			// cascading SMITHERS1301 for an unconsumed Result that never existed.
			name:   "a panic reached two hops deep leaves both callers plain",
			source: panicImport + "function fail(message: string): never { panic(message) }\nfunction refuse(ok: boolean): void { if (!ok) fail(\"forged\") }\nfunction guarded(ok: boolean): string {\n  refuse(ok)\n  return \"real\"\n}\nexport function main(): string[] {\n  return [guarded(true)]\n}\n",
			stdout: "real",
		},
		{
			// The `poc/src/data/**` shape: a branded value type whose accessor
			// reads private state through a helper that refuses a forgery.
			name:   "a branded value type reads its state through a panicking helper",
			source: panicImport + "type State = { readonly size: number }\nconst states = new WeakMap<object, State>()\nfunction stateOf(value: object): State {\n  const state = states.get(value)\n  if (!state) panic(\"forged receiver\")\n  return state\n}\nclass Box {\n  constructor(size: number) { states.set(this, { size }) }\n  get size(): number {\n    const state = stateOf(this)\n    return state.size\n  }\n}\nexport function main(): string[] {\n  return [`${new Box(3).size}`]\n}\n",
			stdout: "3",
		},
		{
			// The nuance the rule preserves: an author MAY choose the widening.
			name:   "an author-annotated Result of Panic still materializes the panic",
			source: "import { Panic, panic } from \"smithers:exceptions\"\nfunction force(key: string): Result<string, Panic> {\n  if (key !== \"ada\") panic(`no entry for ${key}`)\n  return \"Ada Lovelace\"\n}\nexport function main(): string[] {\n  return [\n    force(\"ada\").match({ ok: (value) => value, error: (error) => `panic: ${error.message}` }),\n    force(\"zoe\").match({ ok: (value) => value, error: (error) => `panic: ${error.message}` }),\n  ]\n}\n",
			stdout: "Ada Lovelace\npanic: no entry for zoe",
		},
		{
			name:   "Reflect.panic is the same abort under a plain return type",
			source: "function guarded(ok: boolean): string {\n  if (!ok) Reflect.panic(\"forged value\")\n  return \"real\"\n}\nexport function main(): string[] {\n  return [guarded(true)]\n}\n",
			stdout: "real",
		},
	})
}

// TestPinnedForkPanicStillRefusedWhereItMust pins the refusals the rule does not
// touch. A fix that made every panicking spelling legal would have replaced one
// contradiction with another.
func TestPinnedForkPanicStillRefusedWhereItMust(t *testing.T) {
	const panicImport = "import { panic } from \"smithers:exceptions\"\n"
	runFailClosedCases(t, []failClosedCase{
		{
			// A recoverable Error exit is NOT a panic. failures.mdx §Compiler
			// Lifting: "A `.sm` function with a reachable recoverable Error exit
			// MUST return or infer a Result. An explicit non-Result return
			// annotation on such a function MUST be a compile error."
			name:   "an ordinary throw still requires a Result contract",
			source: "class Missing extends Error {}\nexport function guarded(key: string): string {\n  if (key !== \"ada\") throw new Missing()\n  return \"Ada Lovelace\"\n}\n",
			reject: []string{"SMITHERS1101@2:1"},
		},
		{
			name:   "an exported unannotated function with an ordinary throw still spells its contract",
			source: "class Missing extends Error {}\nexport function guarded(key: string) {\n  if (key !== \"ada\") throw new Missing()\n  return \"Ada Lovelace\"\n}\n",
			reject: []string{"SMITHERS1102@2:1"},
		},
		{
			// `panic(...)` is an EXIT, not a value. The placement rule is a POC
			// lowering boundary and is unchanged by the widening rule.
			name:   "a panic written where a value is expected is still refused",
			source: panicImport + "export function force(key: string): string {\n  const value = key === \"ada\" ? key : panic(`no entry for ${key}`)\n  return value\n}\n",
			reject: []string{"SMITHERS1503@3:39"},
		},
		{
			name:   "a top-level panic is still refused",
			source: panicImport + "panic(\"no\")\nexport function main(): string[] { return [\"done\"] }\n",
			reject: []string{"SMITHERS1505@2:1"},
		},
		{
			name:   "a class static block containing a panic is still refused",
			source: panicImport + "export class Box {\n  static {\n    panic(\"no\")\n  }\n}\n",
			reject: []string{"SMITHERS1107@3:3"},
		},
		{
			// A fallible function value crossing a callback boundary is refused by
			// SMITHERS1303 whether it reaches the boundary as a plain argument or
			// through an accessor. This is the shape R1FIX recorded as "SMITHERS1105
			// already refused it": on this backend 1105 never existed, so 1303 was
			// always the refusal, and it survives the widening rule untouched.
			name:   "a fallible getter in an argument still cannot cross a callback boundary",
			source: "class Missing extends Error {}\nfunction apply(handlers: { transform: unknown }): string {\n  return String(handlers.transform)\n}\nexport function main(): string[] {\n  return [apply({ get transform() { throw new Missing() } })]\n}\n",
			reject: []string{"SMITHERS1303@6:19"},
		},
	})
}

// TestPinnedForkPanicIsNotAnExpectedError is the executed soundness proof: a
// panic must not arrive as an ordinary recoverable failure, and must not be
// consumable by ordinary Result recovery.
func TestPinnedForkPanicIsNotAnExpectedError(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	t.Run("a panic from an unannotated function aborts instead of arriving as a failure", func(t *testing.T) {
		source := "import { panic } from \"smithers:exceptions\"\n" +
			"function guarded(ok: boolean): string {\n" +
			"  if (!ok) panic(\"forged value\")\n" +
			"  return \"real\"\n" +
			"}\n" +
			"export function main(): string[] {\n" +
			"  return [guarded(false)]\n" +
			"}\n"
		result := compilePanicProgram(t, backend, ctx, source)
		output, err := runEmittedMainExpectingFailure(t, result)
		if err == nil {
			t.Fatalf("the panic was swallowed: main() returned %q instead of aborting", output)
		}
		if !strings.Contains(output, "Panic: forged value") {
			t.Fatalf("the abort must carry the distinguished Panic, got:\n%s", output)
		}
	})

	t.Run("a panic is not reachable through unwrapOr on an unannotated function", func(t *testing.T) {
		// The executed reproduction of the defect: with the widening in place,
		// `guarded` published `Result<string, Panic>` and this line returned
		// "fallback" with the panic gone from main()'s row. With the widening
		// removed there is no Result here at all, so the recovery surface the
		// panic was being swallowed through does not exist.
		source := "import { panic } from \"smithers:exceptions\"\n" +
			"function guarded(ok: boolean): string {\n" +
			"  if (!ok) panic(\"forged value\")\n" +
			"  return \"real\"\n" +
			"}\n" +
			"export function main(): string[] {\n" +
			"  return [guarded(false).unwrapOr(\"fallback\")]\n" +
			"}\n"
		diagnostics := compilePanicProgramDiagnostics(t, backend, ctx, source)
		// The refusal must be "`unwrapOr` is not a member of `string`" at the
		// `unwrapOr` itself, NOT a contract diagnostic on `guarded`'s
		// declaration: `guarded` is a correct program under the rule, and a
		// refusal there would mean the widening is still being forced.
		if got := strings.Join(diagnostics, " "); got != "TS2339@7:26" {
			t.Fatalf("diagnostics %v, want [TS2339@7:26] — the recovery surface must not exist on a plain return type", diagnostics)
		}
	})

	t.Run("a panic does not enter a declared recoverable error channel", func(t *testing.T) {
		// The over-correction guard. `force` publishes `Missing` as its expected
		// error channel; materializing the panic into that channel would hand a
		// Panic to an exhaustive `match` over `Missing`.
		source := "import { panic } from \"smithers:exceptions\"\n" +
			"class Missing extends Error {\n" +
			"  constructor(readonly key: string) { super(`no entry for ${key}`) }\n" +
			"}\n" +
			"function force(key: string): Result<string, Missing> {\n" +
			"  if (key === \"\") panic(\"empty key\")\n" +
			"  if (key !== \"ada\") throw new Missing(key)\n" +
			"  return \"Ada Lovelace\"\n" +
			"}\n" +
			"export function main(): string[] {\n" +
			"  return [\n" +
			"    force(\"ada\").match({ ok: (value) => value, error: (error) => `missing: ${error.key}` }),\n" +
			"    force(\"zoe\").match({ ok: (value) => value, error: (error) => `missing: ${error.key}` }),\n" +
			"    force(\"\").match({ ok: (value) => value, error: (error) => `missing: ${error.key}` }),\n" +
			"  ]\n" +
			"}\n"
		result := compilePanicProgram(t, backend, ctx, source)
		output, err := runEmittedMainExpectingFailure(t, result)
		if err == nil {
			t.Fatalf("the panic reached the recoverable error branch: %q", output)
		}
		if strings.Contains(output, "missing: ") {
			t.Fatalf("the panic was delivered as a Missing: %s", output)
		}
		if !strings.Contains(output, "Panic: empty key") {
			t.Fatalf("the abort must carry the distinguished Panic, got:\n%s", output)
		}
	})
}

func compilePanicProgram(t *testing.T, backend Compiler, ctx context.Context, source string) CompileResult {
	t.Helper()
	files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm"},
		Files:     files,
		Options:   Options{},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	if observed := formatDiagnosticPositions(t, files, result); len(observed) != 0 {
		t.Fatalf("the program must compile, but was rejected with %v", observed)
	}
	return result
}

func compilePanicProgramDiagnostics(t *testing.T, backend Compiler, ctx context.Context, source string) []string {
	t.Helper()
	files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm"},
		Files:     files,
		Options:   Options{},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	return formatDiagnosticPositions(t, files, result)
}

// runEmittedMainExpectingFailure is runEmittedMain's counterpart for a program
// whose whole point is that it aborts. It returns the combined output and the
// process error rather than failing the test on a nonzero exit.
func runEmittedMainExpectingFailure(t *testing.T, result CompileResult) (string, error) {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is required to execute the emitted JavaScript")
	}
	directory := t.TempDir()
	for _, item := range result.Artifacts {
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
	harness := "import { main } from \"./main.js\";\n" +
		"const value = await main();\n" +
		"process.stdout.write(value.join(\"\\n\"));\n"
	if err := os.WriteFile(filepath.Join(directory, "harness.mjs"), []byte(harness), 0o644); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(node, "harness.mjs")
	command.Dir = directory
	output, runErr := command.CombinedOutput()
	return string(output), runErr
}
