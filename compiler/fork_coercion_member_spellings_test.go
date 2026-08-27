package compiler

import (
	"context"
	"sort"
	"strings"
	"testing"
)

// A protocol member is resolved on the Go fork by asking which checked function
// the member IS — and that question used to have one answer per SPELLING rather
// than one answer.
//
// `implicitInvocationProtocol` (hostrules.go) made the POSITION axis of the
// coercion rule total, and fork_coercion_rows_test.go pins that half. The
// MEMBER-RESOLUTION axis was still a list of one: `charge` resolved the member's
// symbol to its DECLARATIONS and looked each up in `byNode`, a single syntactic
// hop that lands only when the declaration IS the function — the method
// shorthand and the accessor, and nothing else.
//
// Measured on this backend before the fix, over a generated 23-spelling x
// 8-member matrix (`valueOf`, `toString`, `toJSON`, `Symbol.toPrimitive`,
// `Symbol.iterator`, `Symbol.asyncIterator`, `Symbol.hasInstance`, `then`), each
// cell written twice — once reading a capability and once with the member
// RECORDING its own invocation and reading nothing, so the program compiles,
// RUNS, and prints which member ECMAScript reached: 86 of 156 runnable cells
// were FAIL-OPEN, and the runtime oracle reached the member in every one of
// them. `{ valueOf: () => Db.context().read().length }` published
// `requirements: []`, checked `ok: true`, and panicked at run time with
// `capability 'Db' was not provided`.
//
// The second half of the same defect is about WALKS rather than about member
// resolution: a member's COMPUTED NAME is evaluated in the scope AROUND the
// member, but every walk here stops at a function boundary and a function's own
// walk starts at its BODY, so the name was visited by nobody. Nine spellings
// were fail-open, while the three member kinds that are NOT function-like were
// charged all along — which is the diagnosis, not a coincidence.
//
// The corrections are `memberInvocations` and `evaluatedOutsideFunction`
// (lowering.go), each written ONCE and consumed by every site that asks its
// question. The tests below are therefore written as EQUALITIES — every
// spelling of a member answers what the method shorthand answers — and not as
// per-spelling code lists, for the same reason the fix is not a second table: a
// rule that later changes its answer changes it for all of them, or fails here.
//
// Mirrors `memberInvocations`, `evaluatedOutsideFunction` and
// `implicitInvocations` in poc/src/language/semantic.ts, and
// poc/src/language/coercion-member-spellings.test.ts.

// memberSpellingSeam holds the capability alone, so each spelling below is the
// only thing that differs between one program and the next.
const memberSpellingSeam = "spelling.mod.sm\x00" + `import { Context } from "smthrs/context"

export abstract class Db extends Context {
  abstract read(): string
}
`

// memberSpellings each declare an `obj` whose `valueOf` reads the capability.
// The first is the control: the ONE spelling that was charged before the fix.
var memberSpellings = []struct {
	name        string
	declaration string
}{
	{
		"a method shorthand — the control",
		"const obj = { valueOf(): number { return Db.context().read().length } }\n",
	},
	{
		"an arrow property",
		"const obj = { valueOf: (): number => { return Db.context().read().length } }\n",
	},
	{
		"a function-expression property",
		"const obj = { valueOf: function (): number { return Db.context().read().length } }\n",
	},
	{
		"a property naming a function declaration",
		"function impl(): number { return Db.context().read().length }\n" +
			"const obj = { valueOf: impl }\n",
	},
	{
		"a shorthand property",
		"const valueOf = (): number => { return Db.context().read().length }\n" +
			"const obj = { valueOf }\n",
	},
	{
		"a class arrow field",
		"class C {\n  valueOf = (): number => { return Db.context().read().length }\n}\n" +
			"const obj = new C()\n",
	},
	{
		"a computed key spelled as a string literal, arrow-valued",
		"const obj = { [\"valueOf\"]: (): number => { return Db.context().read().length } }\n",
	},
	{
		"a computed key naming a const binding, arrow-valued",
		"const KEY = \"valueOf\"\n" +
			"const obj = { [KEY]: (): number => { return Db.context().read().length } }\n",
	},
	{
		"a computed key spelled as a string literal, method",
		"const obj = { [\"valueOf\"](): number { return Db.context().read().length } }\n",
	},
	{
		"a computed key naming a const binding, method",
		"const KEY = \"valueOf\"\n" +
			"const obj = { [KEY](): number { return Db.context().read().length } }\n",
	},
	{
		"a member on a nested property",
		"const holder = { inner: { valueOf: (): number => { return Db.context().read().length } } }\n" +
			"const obj = holder.inner\n",
	},
	{
		"a const alias",
		"const base = { valueOf(): number { return Db.context().read().length } }\n" +
			"const obj = base\n",
	},
	{
		"a getter returning a function, return type INFERRED",
		"const obj = { get valueOf() { return (): number => { return Db.context().read().length } } }\n",
	},
	{
		// The ORDERING pin. The getter's symbol type is its RETURN type, so the
		// checker path answers with the arrow — which reads nothing. Only the
		// DECLARATION lookup answers with the getter, and it is kept FIRST in
		// `memberInvocations` for exactly this cell: resolving through the
		// checker INSTEAD OF the declaration, or only as a fallback when the
		// checker answered nothing, silently drops this row. Measured: with the
		// checker path in front this program was accepted on this backend while
		// the reference refused it.
		"a getter that itself reads, return type INFERRED",
		"const obj = { get valueOf() { Db.context().read(); return (): number => { return 1 } } }\n",
	},
	{
		"a getter that itself reads, return type ANNOTATED",
		"const obj = { get valueOf(): (() => number) { Db.context().read(); return (): number => { return 1 } } }\n",
	},
	{
		"a class method",
		"class C {\n  valueOf(): number { return Db.context().read().length }\n}\n" +
			"const obj = new C()\n",
	},
	{
		"a member inherited from a base class",
		"class B {\n  valueOf(): number { return Db.context().read().length }\n}\n" +
			"class C extends B {}\n" +
			"const obj = new C()\n",
	},
	{
		"a prototype-object spread",
		"const proto = { valueOf(): number { return Db.context().read().length } }\n" +
			"const obj = { ...proto }\n",
	},
	{
		"an Object.assign copy",
		"const proto = { valueOf(): number { return Db.context().read().length } }\n" +
			"const obj = Object.assign({}, proto)\n",
	},
	// `Object.freeze({ valueOf() {…} })` is deliberately NOT in this table. The
	// callback-crossing rule refuses the literal AT THE FREEZE CALL, so the
	// program carries a SMITHERS2102 that the coercion walk did not put there:
	// the code-set equality would pass for it whether or not the member was
	// charged, and the string-hint pairing below could never be clean. A probe
	// that cannot come out negative measures nothing, so it is pinned on its own
	// with exact positions instead — see
	// TestPinnedForkCoercionMemberSpellingsAnswerAlike's `Object.freeze` case.
}

// memberSpellingModule puts one spelling in front of one position. The coercion
// is inside `f` and `f` is called at module scope, so a spelling that is charged
// draws SMITHERS2102 at the top-level call — which is the row having TRAVELLED,
// not merely the position having been refused.
func memberSpellingModule(declaration string, returns string) string {
	return "import { Db } from \"./spelling.mod.sm\"\n" +
		declaration +
		"function f(): number {\n  return " + returns + "\n}\n" +
		"const v = f()\n" +
		"export function main(): string[] {\n  return [`${v}`]\n}\n"
}

// memberSpellingCodes compiles one module against the seam and returns its
// distinct diagnostic codes. Codes and not positions: every spelling in the
// table above necessarily moves the line, so only the codes compare across
// spellings.
func memberSpellingCodes(t *testing.T, backend Compiler, ctx context.Context, source string) []string {
	t.Helper()
	name, text, _ := strings.Cut(memberSpellingSeam, "\x00")
	files := []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: source},
		{Path: name, Kind: FileKindSmithers, Text: text},
	}
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm", name},
		Files:     files,
		Options:   Options{},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	seen := make(map[string]bool)
	for _, position := range formatDiagnosticPositions(t, files, result) {
		code, _, _ := strings.Cut(position, "@")
		seen[code] = true
	}
	codes := make([]string, 0, len(seen))
	for code := range seen {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	return codes
}

// TestPinnedForkCoercionMemberSpellingsAnswerAlike is the ONE TABLE assertion
// for the member-resolution axis. Every spelling of a capability-reading
// `valueOf` must answer what the method shorthand answers, because every one of
// them IS the function `+obj` runs — measured, on the emitted program, for all
// twenty.
func TestPinnedForkCoercionMemberSpellingsAnswerAlike(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	control := memberSpellingCodes(t, backend, ctx, memberSpellingModule(memberSpellings[0].declaration, "+obj"))
	found := false
	for _, code := range control {
		if code == "SMITHERS2102" {
			found = true
		}
	}
	if !found {
		t.Fatalf("the method-shorthand control must already report SMITHERS2102, but reported %v; "+
			"an accepting baseline would make every equality below vacuous", control)
	}
	for _, spelling := range memberSpellings[1:] {
		t.Run(spelling.name, func(t *testing.T) {
			got := memberSpellingCodes(t, backend, ctx, memberSpellingModule(spelling.declaration, "+obj"))
			if strings.Join(got, " ") != strings.Join(control, " ") {
				t.Fatalf("%s answers %v; the method shorthand answers %v — the two declare the SAME "+
					"member and `+obj` runs it either way, so a spelling cannot change the row",
					spelling.name, got, control)
			}
		})
	}
	// The one spelling the equality above cannot measure, pinned with EXACT
	// positions so it is not silently carried by another rule's diagnostic:
	// `@2:13` is the callback-crossing refusal at the `Object.freeze` call and
	// `@6:11` is the coercion row arriving at the top-level call to `f`. Both
	// are present before and after the member-resolution widening, on both
	// backends.
	t.Run("an Object.freeze wrapper", func(t *testing.T) {
		runFailClosedCases(t, []failClosedCase{{
			name:    "the coercion row is charged beside the freeze refusal",
			modules: []string{memberSpellingSeam},
			source: memberSpellingModule(
				"const obj = Object.freeze({ valueOf(): number { return Db.context().read().length } })\n", "+obj"),
			reject: []string{"SMITHERS2102@2:13", "SMITHERS2102@6:11"},
		}})
	})
}

// TestPinnedForkCoercionWalkSurvivesEverySpelling is the load-bearing negative.
//
// Making `charge` see fifty-seven more members is exactly the change that would
// break `OrdinaryToPrimitive` if the walk were flattened to "charge all three".
// Every spelling above, at a STRING-hint position, on an object with no
// `toString`: ECMAScript stops at `Object.prototype.toString` and never calls
// `valueOf`. Each of these must be ACCEPTED and must RUN.
func TestPinnedForkCoercionWalkSurvivesEverySpelling(t *testing.T) {
	cases := make([]failClosedCase, 0, len(memberSpellings))
	for _, spelling := range memberSpellings {
		cases = append(cases, failClosedCase{
			name:    spelling.name + ", at a string-hint position",
			modules: []string{memberSpellingSeam},
			source: "import { Db } from \"./spelling.mod.sm\"\n" +
				spelling.declaration +
				"const v = `${obj}`\n" +
				"export function main(): string[] {\n  return [v]\n}\n",
			stdout: "[object Object]",
		})
	}
	runFailClosedCases(t, cases)
}

// memberProtocolSpellings crosses the ARROW spelling with every protocol member
// against that member's own METHOD spelling. The equality is per member, so an
// async member's own Promise diagnostics cannot be mistaken for a difference the
// spelling made.
var memberProtocolSpellings = []struct {
	name     string
	arrow    string
	method   string
	function string
}{
	{
		"valueOf", "const obj = { valueOf: (): number => { return Db.context().read().length } }\n",
		"const obj = { valueOf(): number { return Db.context().read().length } }\n",
		"function f(): number {\n  return +obj\n}\nconst v = f()\n",
	},
	{
		"toString", "const obj = { toString: (): string => { return Db.context().read() } }\n",
		"const obj = { toString(): string { return Db.context().read() } }\n",
		"function f(): number {\n  return `${obj}`.length\n}\nconst v = f()\n",
	},
	{
		"toJSON", "const obj = { toJSON: (): number => { return Db.context().read().length } }\n",
		"const obj = { toJSON(): number { return Db.context().read().length } }\n",
		"function f(): number {\n  return JSON.stringify(obj).length\n}\nconst v = f()\n",
	},
	{
		"Symbol.toPrimitive",
		"const obj = { [Symbol.toPrimitive]: (hint: string): number => { return Db.context().read().length + hint.length - hint.length } }\n",
		"const obj = { [Symbol.toPrimitive](hint: string): number { return Db.context().read().length + hint.length - hint.length } }\n",
		"function f(): number {\n  return +obj\n}\nconst v = f()\n",
	},
	{
		"Symbol.iterator",
		"const obj = { [Symbol.iterator]: (): Iterator<number> => { return [Db.context().read().length][Symbol.iterator]() } }\n",
		"const obj = { *[Symbol.iterator](): Iterator<number> { yield Db.context().read().length } }\n",
		"function f(): number {\n  return [...obj].length\n}\nconst v = f()\n",
	},
	{
		"Symbol.hasInstance",
		"const obj = { [Symbol.hasInstance]: (value: unknown): boolean => { return Db.context().read().length > 0 && value !== null } }\n",
		"const obj = { [Symbol.hasInstance](value: unknown): boolean { return Db.context().read().length > 0 && value !== null } }\n",
		"function f(): number {\n  return (({} as unknown) instanceof obj) ? 1 : 0\n}\nconst v = f()\n",
	},
	{
		"then",
		"const obj = { then: (resolve: (value: number) => void): void => { resolve(Db.context().read().length) } }\n",
		"const obj = { then(resolve: (value: number) => void): void { resolve(Db.context().read().length) } }\n",
		"async function f(): Promise<number> {\n  return await obj\n}\nconst v = f()\n",
	},
	{
		"Symbol.asyncIterator",
		"const obj = { [Symbol.asyncIterator]: (): AsyncIterator<number> => { const n = Db.context().read().length; return { next(): Promise<IteratorResult<number>> { return Promise.resolve({ value: n, done: true }) } } } }\n",
		"const obj = { [Symbol.asyncIterator](): AsyncIterator<number> { const n = Db.context().read().length; return { next(): Promise<IteratorResult<number>> { return Promise.resolve({ value: n, done: true }) } } } }\n",
		"async function f(): Promise<number> {\n  let total = 0\n  for await (const x of obj) { total = total + x }\n  return total\n}\nconst v = f()\n",
	},
}

// TestPinnedForkCoercionMemberSpellingCrossesEveryProtocolMember pins that the
// resolution is a property of the MEMBER TABLE and not of one member: the arrow
// spelling answers what the method spelling answers for all eight protocol
// members `implicitInvocations` knows about.
func TestPinnedForkCoercionMemberSpellingCrossesEveryProtocolMember(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, member := range memberProtocolSpellings {
		t.Run(member.name, func(t *testing.T) {
			body := member.function + "export function main(): string[] {\n  return [`${v}`]\n}\n"
			method := memberSpellingCodes(t, backend, ctx, "import { Db } from \"./spelling.mod.sm\"\n"+member.method+body)
			found := false
			for _, code := range method {
				if code == "SMITHERS2102" {
					found = true
				}
			}
			if !found {
				t.Fatalf("the method spelling of %s must already report SMITHERS2102, but reported %v; "+
					"an accepting baseline would make the equality vacuous", member.name, method)
			}
			arrow := memberSpellingCodes(t, backend, ctx, "import { Db } from \"./spelling.mod.sm\"\n"+member.arrow+body)
			if strings.Join(arrow, " ") != strings.Join(method, " ") {
				t.Fatalf("the arrow spelling of %s answers %v; the method spelling answers %v — "+
					"the position runs the same member either way", member.name, arrow, method)
			}
		})
	}
}

// TestPinnedForkComputedMemberNameIsChargedToTheEnclosingScope pins the WALK
// half. `{ [key]() {} }` evaluates `key` where the object literal is written,
// before the method exists, so `key`'s coercion belongs to the enclosing row.
//
// The three already-charged controls are landed WITH the nine repairs, because
// they are what identifies the cause as the function boundary rather than as
// computed keys: a value property, an arrow property and a class property
// declaration are not function-like, and were charged all along.
func TestPinnedForkComputedMemberNameIsChargedToTheEnclosingScope(t *testing.T) {
	declaration := "const obj = { toString(): string { return Db.context().read() } }\n"
	inFunction := func(member string) string {
		return "import { Db } from \"./spelling.mod.sm\"\n" + declaration +
			"function f(): number {\n" + member + "  return 1\n}\n" +
			"const v = f()\n" +
			"export function main(): string[] {\n  return [`${v}`]\n}\n"
	}
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "an object-literal method name",
			modules: []string{memberSpellingSeam},
			source:  inFunction("  const shape = { [obj as unknown as string]() { return 1 } }\n  void shape\n"),
			reject:  []string{"SMITHERS2102@8:11"},
		},
		{
			name:    "an object-literal getter name",
			modules: []string{memberSpellingSeam},
			source:  inFunction("  const shape = { get [obj as unknown as string](): number { return 1 } }\n  void shape\n"),
			reject:  []string{"SMITHERS2102@8:11"},
		},
		{
			name:    "an object-literal setter name",
			modules: []string{memberSpellingSeam},
			source:  inFunction("  const shape = { set [obj as unknown as string](x: number) { }\n }\n  void shape\n"),
			reject:  []string{"SMITHERS2102@9:11"},
		},
		{
			name:    "an object-literal async method name",
			modules: []string{memberSpellingSeam},
			source:  inFunction("  const shape = { async [obj as unknown as string](): Promise<number> { return 1 } }\n  void shape\n"),
			reject:  []string{"SMITHERS2102@8:11"},
		},
		{
			name:    "an object-literal generator method name",
			modules: []string{memberSpellingSeam},
			source:  inFunction("  const shape = { *[obj as unknown as string](): Generator<number> { yield 1 } }\n  void shape\n"),
			reject:  []string{"SMITHERS2102@8:11"},
		},
		{
			name:    "a class method name",
			modules: []string{memberSpellingSeam},
			source:  inFunction("  class S {\n    [obj as unknown as string]() { return 1 }\n  }\n  void S\n"),
			reject:  []string{"SMITHERS2102@10:11"},
		},
		{
			name:    "a class getter name",
			modules: []string{memberSpellingSeam},
			source:  inFunction("  class S {\n    get [obj as unknown as string](): number { return 1 }\n  }\n  void S\n"),
			reject:  []string{"SMITHERS2102@10:11"},
		},
		{
			name:    "a class static method name",
			modules: []string{memberSpellingSeam},
			source:  inFunction("  class S {\n    static [obj as unknown as string]() { return 1 }\n  }\n  void S\n"),
			reject:  []string{"SMITHERS2102@10:11"},
		},
		{
			name:    "a class async method name",
			modules: []string{memberSpellingSeam},
			source:  inFunction("  class S {\n    async [obj as unknown as string](): Promise<number> { return 1 }\n  }\n  void S\n"),
			reject:  []string{"SMITHERS2102@10:11"},
		},
		{
			// CONTROL: not function-like, and charged before the fix as well.
			name:    "an object-literal arrow property name — already charged",
			modules: []string{memberSpellingSeam},
			source:  inFunction("  const shape = { [obj as unknown as string]: (): number => 1 }\n  void shape\n"),
			reject:  []string{"SMITHERS2102@8:11"},
		},
		{
			name:    "an object-literal value property name — already charged",
			modules: []string{memberSpellingSeam},
			source:  inFunction("  const shape = { [obj as unknown as string]: 1 }\n  void shape\n"),
			reject:  []string{"SMITHERS2102@8:11"},
		},
		{
			name:    "a class property declaration name — already charged",
			modules: []string{memberSpellingSeam},
			source:  inFunction("  class S {\n    [obj as unknown as string]: number = 1\n  }\n  void S\n"),
			reject:  []string{"SMITHERS2102@10:11"},
		},
		{
			// The resolver half. A TOP-LEVEL computed name is module evaluation
			// and has no enclosing row to charge, so it must be refused where it
			// is written. Teaching only the body walk leaves this open.
			name:    "a TOP-LEVEL object-literal method name",
			modules: []string{memberSpellingSeam},
			source: "import { Db } from \"./spelling.mod.sm\"\n" + declaration +
				"const shape = { [obj as unknown as string]() { return 1 } }\n" +
				"export function main(): string[] {\n  return [`${Object.keys(shape).length}`]\n}\n",
			reject: []string{"SMITHERS2102@3:18"},
		},
		{
			name:    "a TOP-LEVEL class method name",
			modules: []string{memberSpellingSeam},
			source: "import { Db } from \"./spelling.mod.sm\"\n" + declaration +
				"class S {\n  [obj as unknown as string]() { return 1 }\n}\n" +
				"export function main(): string[] {\n  return [`${Object.keys(new S()).length}`]\n}\n",
			reject: []string{"SMITHERS2102@4:4"},
		},
		{
			// The carve-out, pinned as a NEGATIVE so a future lane cannot fold
			// parameter defaults into `evaluatedOutsideFunction` by accident: a
			// default is evaluated when the function is CALLED, so it belongs to
			// the callee's own row and not to the scope around it. `g` is never
			// called, so nothing runs and nothing is charged anywhere.
			name:    "a parameter default is NOT evaluated by the enclosing scope",
			modules: []string{memberSpellingSeam},
			source: "import { Db } from \"./spelling.mod.sm\"\n" + declaration +
				"function g(x: number = +(obj as unknown as number)): number { return x }\n" +
				"export function main(): string[] {\n  return [`${typeof g}`]\n}\n",
			stdout: "function",
		},
		{
			// A computed member name that reads NOTHING must stay accepted and
			// must RUN — the widened walk visits it either way.
			name:    "a computed method name reading no capability still runs",
			modules: []string{memberSpellingSeam},
			source: "import { Db } from \"./spelling.mod.sm\"\n" +
				"const plain = { toString(): string { return \"k\" } }\n" +
				"const shape = { [plain as unknown as string]() { return 1 } }\n" +
				"export function main(): string[] {\n  return [`${Object.keys(shape).length}${Db.name.length > 0}`]\n}\n",
			stdout: "1true",
		},
	})
}

// TestPinnedForkCoercionMemberSpellingRowReachesTheProvideSite is the gate.
// Refusing `+obj` would not show that the requirement TRAVELS; this pins that
// the row a newly-visible spelling introduces reaches `Layer.provide`, is
// reported when the layer does not carry it, and is discharged — and the program
// RUNS — when it does.
func TestPinnedForkCoercionMemberSpellingRowReachesTheProvideSite(t *testing.T) {
	// SMITHERS2101 is reported only where the provide site has no enclosing row
	// to hand the missing requirement to — see `checkOneLayer` — so the WRONG
	// layer is spelled at module scope and the RIGHT one inside `main`, exactly
	// as fork_coercion_rows_test.go spells the same pair.
	head := func(declaration string, expression string) string {
		return "import { Context } from \"smthrs/context\"\n" +
			"import { Layer } from \"smthrs/provider\"\n" +
			"import { Db } from \"./spelling.mod.sm\"\n" +
			"abstract class Label extends Context {\n  abstract text(): string\n}\n" +
			declaration +
			"function measure(): string {\n  return `${" + expression + "}`\n}\n"
	}
	wrongLayer := func(declaration string, expression string) string {
		return head(declaration, expression) +
			"const label: Label = { text: () => \"t\" }\n" +
			"export const lines = Layer.provide(Layer.succeed(Label, label), () => [measure()])\n"
	}
	rightLayer := func(declaration string, expression string) string {
		return head(declaration, expression) +
			"const db: Db = { read: () => \"DBX\" }\n" +
			"export function main(): string[] {\n" +
			"  return Layer.provide(Layer.succeed(Db, db), () => [measure()])\n}\n"
	}
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "an arrow-property valueOf reaches a provide site that lacks it",
			modules: []string{memberSpellingSeam},
			source:  wrongLayer("const obj = { valueOf: (): number => { return Db.context().read().length } }\n", "+obj"),
			reject:  []string{"SMITHERS2101@12:22"},
		},
		{
			name:    "an arrow-property valueOf is discharged by the right layer",
			modules: []string{memberSpellingSeam},
			source:  rightLayer("const obj = { valueOf: (): number => { return Db.context().read().length } }\n", "+obj"),
			stdout:  "3",
		},
		{
			name:    "a function-expression toString reaches a provide site that lacks it",
			modules: []string{memberSpellingSeam},
			source:  wrongLayer("const obj = { toString: function (): string { return Db.context().read() } }\n", "`${obj}`"),
			reject:  []string{"SMITHERS2101@12:22"},
		},
		{
			name:    "a function-expression toString is discharged by the right layer",
			modules: []string{memberSpellingSeam},
			source:  rightLayer("const obj = { toString: function (): string { return Db.context().read() } }\n", "`${obj}`"),
			stdout:  "DBX",
		},
		{
			name:    "a shorthand property reaches a provide site that lacks it",
			modules: []string{memberSpellingSeam},
			source:  wrongLayer("const valueOf = (): number => { return Db.context().read().length }\nconst obj = { valueOf }\n", "+obj"),
			reject:  []string{"SMITHERS2101@13:22"},
		},
		{
			name:    "a shorthand property is discharged by the right layer",
			modules: []string{memberSpellingSeam},
			source:  rightLayer("const valueOf = (): number => { return Db.context().read().length }\nconst obj = { valueOf }\n", "+obj"),
			stdout:  "3",
		},
		{
			name:    "a computed member name reaches a provide site that lacks it",
			modules: []string{memberSpellingSeam},
			source:  wrongLayer("const obj = { toString(): string { return Db.context().read() } }\n", "Object.keys({ [obj as unknown as string]() { return 1 } }).length"),
			reject:  []string{"SMITHERS2101@12:22"},
		},
		{
			name:    "a computed member name is discharged by the right layer",
			modules: []string{memberSpellingSeam},
			source:  rightLayer("const obj = { toString(): string { return Db.context().read() } }\n", "Object.keys({ [obj as unknown as string]() { return 1 } }).length"),
			stdout:  "1",
		},
	})
}

// TestPinnedForkWiderMemberResolutionStaysNarrow holds the other direction.
// Every one of these is a program the widened resolver could have started
// refusing and must not: each is ACCEPTED and each RUNS.
func TestPinnedForkWiderMemberResolutionStaysNarrow(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			// A property READ does not call what it reads. This is why
			// `memberInvocations` is not shared with `accessorInvocations`.
			name:    "reading the member without calling it charges nothing",
			modules: []string{memberSpellingSeam},
			source: "import { Db } from \"./spelling.mod.sm\"\n" +
				"const obj = { valueOf: (): number => { return Db.context().read().length } }\n" +
				"const m = obj.valueOf\n" +
				"export function main(): string[] {\n  return [`${typeof m === \"function\" ? 1 : 0}`]\n}\n",
			stdout: "1",
		},
		{
			// The short-circuit ordering: a value with `Symbol.toPrimitive` runs
			// THAT and nothing else, and the wider resolver must not reach past
			// it into an ARROW-spelled `valueOf`/`toString`.
			name:    "Symbol.toPrimitive shadows an ARROW valueOf and toString",
			modules: []string{memberSpellingSeam},
			source: "import { Db } from \"./spelling.mod.sm\"\n" +
				"const obj = {\n" +
				"  [Symbol.toPrimitive]: (hint: string): number => 1 + hint.length - hint.length,\n" +
				"  valueOf: (): number => { return Db.context().read().length },\n" +
				"  toString: (): string => { return Db.context().read() },\n" +
				"}\n" +
				"const v = +obj\n" +
				"export function main(): string[] {\n  return [`${v}`]\n}\n",
			stdout: "1",
		},
		{
			// The parenthesis ordering: the callee is read through
			// `ast.SkipParentheses` BEFORE the ambient identity test, so a
			// LEXICAL `function Number` stays an ordinary call under every
			// spelling.
			name:    "a local Number shadow is an ordinary call, parenthesised too",
			modules: []string{memberSpellingSeam},
			source: "import { Db } from \"./spelling.mod.sm\"\n" +
				"const obj = { valueOf: (): number => { return Db.context().read().length } }\n" +
				"function Number(value: unknown): number { return 0 }\n" +
				"const v = (Number)(obj)\n" +
				"export function main(): string[] {\n  return [`${v}`]\n}\n",
			stdout: "0",
		},
		{
			// The tagged-template carve-out: substitutions are handed to the tag
			// UNTOUCHED, so no member runs. The widened resolver must not reach
			// an arrow-spelled `toString` here either.
			name:    "a tagged template does not coerce an ARROW toString",
			modules: []string{memberSpellingSeam},
			source: "import { Db } from \"./spelling.mod.sm\"\n" +
				"const obj = { toString: (): string => { return Db.context().read() } }\n" +
				"/** @throws {never} */\n" +
				"function tag(parts: TemplateStringsArray, ...values: unknown[]): string {\n" +
				"  return parts.raw.join(\"|\") + values.length\n" +
				"}\n" +
				"const v = tag`x${obj}y`\n" +
				"export function main(): string[] {\n  return [v]\n}\n",
			stdout: "x|y1",
		},
		{
			// A class-body getter lives on the PROTOTYPE and a spread does not
			// copy it, so it must stay uncharged even now that more member
			// spellings are visible.
			name:    "an object spread does not run a class prototype getter",
			modules: []string{memberSpellingSeam},
			source: "import { Db } from \"./spelling.mod.sm\"\n" +
				"class Box {\n  get size(): number { return Db.context().read().length }\n}\n" +
				"const copy = { ...new Box() }\n" +
				"export function main(): string[] {\n  return [`${Object.keys(copy).length}`]\n}\n",
			stdout: "0",
		},
		{
			// `instanceof` runs `Symbol.hasInstance`, never a static `toString`
			// — not even an arrow-valued static field.
			name:    "instanceof does not run a static toString",
			modules: []string{memberSpellingSeam},
			source: "import { Db } from \"./spelling.mod.sm\"\n" +
				"class Named {\n  static toString = (): string => { return Db.context().read() }\n}\n" +
				"const v = ({} as unknown) instanceof Named ? 1 : 0\n" +
				"export function main(): string[] {\n  return [`${v}`]\n}\n",
			stdout: "0",
		},
		{
			// An ARROW `valueOf` that reads nothing is an ordinary object.
			name:    "an arrow valueOf that reads no capability still runs",
			modules: []string{memberSpellingSeam},
			source: "import { Db } from \"./spelling.mod.sm\"\n" +
				"const obj = { valueOf: (): number => 7 }\n" +
				"const v = +obj\n" +
				"export function main(): string[] {\n  return [`${v}${Db.name.length > 0}`]\n}\n",
			stdout: "7true",
		},
	})
}
