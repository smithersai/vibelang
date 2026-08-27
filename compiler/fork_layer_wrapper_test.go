package compiler

import (
	"strings"
	"testing"
)

// The LAYER RESOLVER, on the Go fork, when a TYPE-ONLY WRAPPER stands between
// `Layer.provide` and the layer it is given.
//
// `resolveLayer` — the walk that answers "which capabilities does this layer
// expression provide, and do we know the whole closure?" — carried its own
// wrapper chain, and that chain had exactly ONE entry:
//
//	if ast.IsParenthesizedExpression(expression) { ... }
//
// So it knew the parenthesis but never learned `as` (TypeScript 1.0), never
// `<T>x`, and never `satisfies` (TypeScript 4.9). It was the ninth walk in this
// bridge to spell its own copy of a table that already existed three functions
// away — the same drift `typeOnlyWrapperOperand` and `valueBranches` each
// record in lowering.go, one walk at a time.
//
// The consequence, measured on this backend before the fix:
//
//	Layer.provide(Layer.succeed(Db, db) satisfies Layer<typeof Db>, body)
//	    -> SMITHERS2104 "Layer expression is opaque"
//	Layer.provide(Layer.succeed(Db, db), body)
//	    -> ok: true, and it RUNS
//
// and compiling both through this backend with `--out-dir` produced
// BYTE-IDENTICAL emitted modules, down to the prelude — because a type-only
// wrapper is erased at emit. The refused program and the accepted program were
// the same program; one of them was refused. Across a 18-spelling x 25-probe
// matrix, 143 cells moved: ten distinct layer positions x thirteen spellings,
// plus thirteen at the missing-capability control.
//
// The second half of the defect is the one that matters more than the
// over-refusal. `resolveLayer`'s `bool` result is the fail-closed switch: when
// it is false the caller answers the BLUNT SMITHERS2104 instead of the PRECISE
// SMITHERS2101 that names the capability the program forgot. So a program that
// genuinely forgot `Db` was told "this layer is opaque" rather than "Db is
// missing", purely because someone wrote `satisfies` — the diagnostic stopped
// naming the bug. That is the `theMissingCapabilityIsNamed` block below.
//
// The fix is one line: the walk now CALLS `typeOnlyWrapperOperand` instead of
// restating a subset of it. It is deliberately not a `satisfies` case added
// beside the parenthesis case; a copy taught one missing entry is exactly how
// this defect was introduced, and the next copy is how the next one would be.
//
// # Why these tests are an equality table
//
// Every position below asserts that each wrapper spelling answers EXACTLY what
// the DIRECT spelling of the same program answers, rather than hard-coding a
// code list per spelling. That is the property: a wrapper that changes only the
// type changes no value, so it cannot change the closure. It also makes the
// genuinely-OPAQUE positions (a helper's return, an array element) load-bearing
// rows rather than omissions — they are refused in the direct spelling too, and
// no wrapper may smuggle one past.
//
// # Why the walk is over SYNTAX and not over the checker type
//
// `Layer.succeed(Cfg, cfg) as unknown as Layer<typeof Db>` has the checker type
// `Layer<typeof Db>`, but the value the runtime registers is keyed on `Cfg`.
// Reading the TYPE would certify a `Db` that is never provided. Stripping the
// wrapper and resolving the call underneath answers `{Cfg}` and reports the
// missing `Db`. `theWalkIsOverSyntax` pins both directions of that: the
// laundering spelling stays refused and NAMES `Db`, while `as any` — where the
// type is gone entirely — is accepted, which no type-directed walk could do.
//
// # What is deliberately NOT in the table
//
// `!` is this language's checked `Result` propagation, not TypeScript's
// non-null assertion, so it is a real operation and a layer under it stays on
// the fail-closed path. It is the attribution control: it proves the change is
// THE TABLE and not "assertions are ignored here".
//
// `x as const` is not a legal spelling for a layer at all. TypeScript itself
// refuses `<call> as const` with TS1355, and SMITHERS2104 had been MASKING that
// error; unmasking it is the correct answer, not a regression.
//
// # The const-only tightening is orthogonal and must survive
//
// `collectLayerBindings` records only `const` bindings, because a reassigned
// `let` layer certified a `Layer.provide` as complete and then panicked at run
// time. Looking through a type-only wrapper says nothing about whether the
// binding under it can be reassigned, and `collectLayerBindings` was not
// touched — but "orthogonal by construction" is an argument, not a
// measurement, so `theMutableBindingRuleSurvives` measures it in every
// spelling.
//
// Mirrors `resolveLayerExpression` in lowering.go, `resolveLayerExpression` in
// poc/src/language/semantic.ts, and poc/src/language/layer-wrapper-spellings.test.ts.

// layerSupport is an unused-but-valid support module: `diagnosticCodes` compiles
// a two-file project, and nothing here needs a foreign value.
const layerSupport = `/**
 * @module
 * @throws {never}
 */

export const unused = "unused";
`

// layerModule renders one whole `.sm` program around a layer expression. Two
// capabilities, so a control can be MISSING one and the precise diagnostic has
// something to name.
func layerModule(body string) string {
	return `import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"

abstract class Db extends Context {
  abstract read(): string
}

abstract class Cfg extends Context {
  abstract n(): number
}

function f(): number { return Db.context().read().length }

function g(): number { return Db.context().read().length + Cfg.context().n() }

const db: Db = { read: () => "DBX" }
const cfg: Cfg = { n: () => 7 }

` + body
}

// layerTypeOnlyWrappers are the spellings that change only the TYPE and never
// the value. Each must reach the same verdict as "direct" at every position,
// because each evaluates to exactly the same value at run time — and each emits
// exactly the same JavaScript.
//
// Selecting operators (`??`, `?:`, the comma) are absent on purpose: those
// belong to `valueBranches`, they CAN change which value arrives, and a layer
// under one is legitimately opaque. `N05-opaque-conditional` below pins that.
var layerTypeOnlyWrappers = []struct {
	name     string
	spelling func(value, typeText string) string
}{
	{"direct", func(v, _ string) string { return v }},
	{"parenthesised", func(v, _ string) string { return "(" + v + ")" }},
	{"satisfies T", func(v, ty string) string { return v + " satisfies " + ty }},
	{"satisfies unknown", func(v, _ string) string { return v + " satisfies unknown" }},
	{"satisfies over a parenthesis", func(v, ty string) string { return "(" + v + ") satisfies " + ty }},
	{"parenthesis over a satisfies", func(v, ty string) string { return "(" + v + " satisfies " + ty + ")" }},
	{"double satisfies", func(v, ty string) string { return "(" + v + " satisfies " + ty + ") satisfies unknown" }},
	{"as T", func(v, ty string) string { return v + " as " + ty }},
	{"angle-bracket cast", func(v, ty string) string { return "<" + ty + ">" + v }},
	{"as unknown as T", func(v, ty string) string { return v + " as unknown as " + ty }},
	{"satisfies then as", func(v, ty string) string { return "(" + v + " satisfies " + ty + ") as " + ty }},
	{"as then satisfies", func(v, ty string) string { return "(" + v + " as " + ty + ") satisfies " + ty }},
}

// layerWrapperPositions are the authored positions a layer can occupy. `governs`
// is the code the DIRECT spelling must already report, asserted so that neither
// an accidentally-clean nor an accidentally-refusing baseline can make the
// equality vacuous; an empty `governs` means the direct spelling must be CLEAN.
var layerWrapperPositions = []struct {
	name     string
	typeText string
	body     func(wrapped string) string
	governs  string
}{
	{
		name: "the argument to Layer.provide", typeText: "Layer<typeof Db>",
		body: func(w string) string { return "Layer.provide(" + w + ", () => { f() })\n" },
	},
	{
		name: "the initializer of a const binding", typeText: "Layer<typeof Db>",
		body: func(w string) string {
			return "const app = " + w + "\nLayer.provide(app, () => { f() })\n"
		},
	},
	{
		name: "a reference to a const binding", typeText: "Layer<typeof Db>",
		body: func(w string) string {
			return "const app = Layer.succeed(Db, db)\nLayer.provide(" +
				strings.Replace(w, "Layer.succeed(Db, db)", "app", 1) + ", () => { f() })\n"
		},
	},
	{
		name: "the initializer of a TYPE-ANNOTATED const binding", typeText: "Layer<typeof Db>",
		body: func(w string) string {
			return "const app: Layer<typeof Db> = " + w + "\nLayer.provide(app, () => { f() })\n"
		},
	},
	{
		name: "an argument of a merged layer", typeText: "Layer<typeof Db>",
		body: func(w string) string {
			return "Layer.provide(Layer.merge(" + w + ", Layer.succeed(Cfg, cfg)), () => { g() })\n"
		},
	},
	{
		name: "the merged layer itself", typeText: "Layer<typeof Db | typeof Cfg>",
		body: func(w string) string {
			return "Layer.provide(" +
				strings.Replace(w, "Layer.succeed(Db, db)", "Layer.merge(Layer.succeed(Db, db), Layer.succeed(Cfg, cfg))", 1) +
				", () => { g() })\n"
		},
	},
	{
		name: "a chain of two const bindings", typeText: "Layer<typeof Db>",
		body: func(w string) string {
			return "const inner = " + w + "\nconst app = inner\nLayer.provide(app, () => { f() })\n"
		},
	},
	{
		name: "an explicit type argument on Layer.succeed", typeText: "Layer<typeof Db>",
		body: func(w string) string {
			return "Layer.provide(" +
				strings.Replace(w, "Layer.succeed(Db, db)", "Layer.succeed<typeof Db>(Db, db)", 1) + ", () => { f() })\n"
		},
	},
	// The two genuinely-OPAQUE positions. They are refused in the DIRECT
	// spelling too, so they are equality rows that stop a future loosening from
	// riding in on a wrapper — not omissions.
	{
		name: "a layer returned from a helper (opaque in the direct spelling too)", typeText: "Layer<typeof Db>",
		body: func(w string) string {
			return "function mk(): Layer<typeof Db> { return " + w + " }\nLayer.provide(mk(), () => { f() })\n"
		},
		governs: "SMITHERS2104",
	},
	{
		name: "a layer read out of an array (opaque in the direct spelling too)", typeText: "Layer<typeof Db>",
		body: func(w string) string {
			return "const layers = [" + w + "]\nLayer.provide(layers[0], () => { f() })\n"
		},
		governs: "SMITHERS2104",
	},
}

// TestPinnedForkLayerThroughATypeOnlyWrapperIsTheSameLayer is the ONE TABLE
// assertion for the layer resolver.
func TestPinnedForkLayerThroughATypeOnlyWrapperIsTheSameLayer(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, position := range layerWrapperPositions {
		t.Run(position.name, func(t *testing.T) {
			direct := smithersDiagnosticCodes(t, backend, ctx,
				layerModule(position.body("Layer.succeed(Db, db)")), layerSupport)
			if position.governs == "" {
				if len(direct) != 0 {
					t.Fatalf("the DIRECT spelling must be accepted here, but reported %v; "+
						"a refusing baseline would make every equality below vacuous", direct)
				}
			} else if strings.Join(direct, " ") != position.governs {
				t.Fatalf("the DIRECT spelling must report exactly %s here, but reported %v; "+
					"an accepting baseline would make every equality below vacuous", position.governs, direct)
			}
			for _, wrapper := range layerTypeOnlyWrappers {
				if wrapper.name == "direct" {
					continue
				}
				t.Run(wrapper.name, func(t *testing.T) {
					wrapped := wrapper.spelling("Layer.succeed(Db, db)", position.typeText)
					got := smithersDiagnosticCodes(t, backend, ctx,
						layerModule(position.body(wrapped)), layerSupport)
					if strings.Join(got, " ") != strings.Join(direct, " ") {
						t.Fatalf("%s answers %v; the direct spelling answers %v — a wrapper that "+
							"changes only the TYPE is erased at emit, so the two are the same program",
							wrapped, got, direct)
					}
				})
			}
		})
	}
}

// TestPinnedForkLayerWrapperKeepsEveryRefusalTheResolverExistsFor is the other
// direction, and it is not decoration: `resolveLayer` is a FAIL-CLOSED walk, so
// the only way to break it while every positive cell still passes is to make it
// answer "known" for something it cannot actually see.
func TestPinnedForkLayerWrapperKeepsEveryRefusalTheResolverExistsFor(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	negatives := []struct {
		name     string
		typeText string
		body     func(wrapped string) string
		// expect is what EVERY spelling including the direct one must answer.
		expect string
		why    string
	}{
		{
			name: "a Layer.provide missing a capability NAMES it", typeText: "Layer<typeof Cfg>",
			body: func(w string) string {
				return "Layer.provide(" +
					strings.Replace(w, "Layer.succeed(Db, db)", "Layer.succeed(Cfg, cfg)", 1) + ", () => { f() })\n"
			},
			expect: "SMITHERS2101",
			why: "the PRECISE code that names the missing capability, not the blunt SMITHERS2104; " +
				"before the fix every wrapped spelling degraded to the blunt one and the diagnostic stopped naming the bug",
		},
		{
			name: "a REASSIGNED let layer stays opaque", typeText: "Layer<typeof Db | typeof Cfg>",
			body: func(w string) string {
				return "let app: Layer<typeof Db | typeof Cfg> = " + w +
					"\napp = Layer.succeed(Cfg, cfg)\nLayer.provide(app, () => { f() })\n"
			},
			expect: "SMITHERS2104",
			why: "the const-only tightening: a reassigned layer certified a Layer.provide as complete " +
				"and then panicked at run time, and looking through a wrapper must not undo that",
		},
		{
			name: "a REASSIGNED var layer stays opaque", typeText: "Layer<typeof Db | typeof Cfg>",
			body: func(w string) string {
				return "var app: Layer<typeof Db | typeof Cfg> = " + w +
					"\napp = Layer.succeed(Cfg, cfg)\nLayer.provide(app, () => { f() })\n"
			},
			expect: "SMITHERS2104",
			why:    "as the let twin; `var` broke identically when it was measured",
		},
		{
			name: "a let layer that is NEVER reassigned stays opaque", typeText: "Layer<typeof Db>",
			body: func(w string) string {
				return "let app = " + w + "\nLayer.provide(app, () => { f() })\n"
			},
			expect: "SMITHERS2104",
			why: "collectLayerBindings records `const` only, and fail-closed means a binding that MIGHT be " +
				"reassigned is refused rather than resolved from a possibly-stale initializer",
		},
		{
			name: "an opaque conditional stays opaque", typeText: "Layer<typeof Db | typeof Cfg>",
			body: func(w string) string {
				return "const flag: boolean = true\nconst app = " +
					strings.Replace(w, "Layer.succeed(Db, db)", "(flag ? Layer.succeed(Db, db) : Layer.succeed(Cfg, cfg))", 1) +
					"\nLayer.provide(app, () => { f() })\n"
			},
			expect: "SMITHERS2104",
			why:    "a conditional belongs to valueBranches, CAN change which layer arrives, and is not a type-only wrapper",
		},
		{
			name: "an opaque helper call stays opaque", typeText: "Layer<typeof Db>",
			body: func(w string) string {
				return "function mk(): Layer<typeof Db> { return Layer.succeed(Db, db) }\nconst app = " +
					strings.Replace(w, "Layer.succeed(Db, db)", "mk()", 1) +
					"\nLayer.provide(app, () => { f() })\n"
			},
			expect: "SMITHERS2104",
			why:    "the POC cannot see through a helper's return in the direct spelling either",
		},
	}

	for _, negative := range negatives {
		t.Run(negative.name, func(t *testing.T) {
			for _, wrapper := range layerTypeOnlyWrappers {
				t.Run(wrapper.name, func(t *testing.T) {
					wrapped := wrapper.spelling("Layer.succeed(Db, db)", negative.typeText)
					got := smithersDiagnosticCodes(t, backend, ctx,
						layerModule(negative.body(wrapped)), layerSupport)
					if strings.Join(got, " ") != negative.expect {
						t.Fatalf("%s answers %v; every spelling of this program must answer exactly [%s] — %s",
							wrapped, got, negative.expect, negative.why)
					}
				})
			}
		})
	}
}

// TestPinnedForkLayerResolutionReadsSyntaxNotTheCheckerType is the pair of
// probes the 12-spelling table above CANNOT see, because every spelling in it
// preserves the expression's type. Without these two rows a type-directed
// implementation would pass every cell above and still be wrong in both
// directions.
func TestPinnedForkLayerResolutionReadsSyntaxNotTheCheckerType(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	t.Run("a laundering assertion does not certify a capability the runtime never registers", func(t *testing.T) {
		// The checker type here is `Layer<typeof Db>`. The value registered at
		// run time is keyed on `Cfg`. A type-directed walk would answer `{Db}`
		// and accept a program that panics.
		source := layerModule("Layer.provide(Layer.succeed(Cfg, cfg) as unknown as Layer<typeof Db>, () => { f() })\n")
		got := smithersDiagnosticCodes(t, backend, ctx, source, layerSupport)
		if strings.Join(got, " ") != "SMITHERS2101" {
			t.Fatalf("a layer laundered to `Layer<typeof Db>` answered %v; it must stay refused with the "+
				"PRECISE SMITHERS2101 naming the missing Db, because the walk reads the syntax under the "+
				"wrapper and not the type the wrapper claims", got)
		}
	})

	t.Run("an assertion that erases the type entirely is still the same layer", func(t *testing.T) {
		// `as any` leaves a type-directed walk with nothing to resolve. The
		// syntax underneath is unchanged, and the program runs.
		for _, spelling := range []string{
			"Layer.succeed(Db, db) as any",
			"<any>Layer.succeed(Db, db)",
		} {
			source := layerModule("Layer.provide(" + spelling + ", () => { f() })\n")
			if got := smithersDiagnosticCodes(t, backend, ctx, source, layerSupport); len(got) != 0 {
				t.Fatalf("`%s` was refused with %v; the wrapper is erased at emit and the layer underneath "+
					"is the same call, so this is the same program as the direct spelling", spelling, got)
			}
		}
	})
}

// TestPinnedForkLayerNonNullIsNotInTheWrapperTable is the attribution control.
// If the change had been "assertions are ignored in a layer position" rather
// than "this walk calls THE ONE TABLE", this test is what would fail.
func TestPinnedForkLayerNonNullIsNotInTheWrapperTable(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, spelling := range []string{
		"Layer.succeed(Db, db)!",
		"(Layer.succeed(Db, db) satisfies Layer<typeof Db>)!",
	} {
		source := layerModule("Layer.provide(" + spelling + ", () => { f() })\n")
		got := smithersDiagnosticCodes(t, backend, ctx, source, layerSupport)
		if strings.Join(got, " ") != "SMITHERS1207 SMITHERS2104" {
			t.Fatalf("`%s` answered %v; `!` is this language's checked Result propagation, NOT a type-only "+
				"wrapper, so it must draw SMITHERS1207 in its own right and leave the layer on the "+
				"fail-closed SMITHERS2104 path", spelling, got)
		}
	}
}

// TestPinnedForkLayerAsConstIsTypeScriptsOwnRefusal records the spelling the
// over-refusal had been MASKING. `x as const` over a call is TS1355 by
// TypeScript's own rule ("a 'const' assertion can only be applied to references
// to enum members, or string, number, boolean, array, or object literals"), and
// the correct answer is to let that error be seen — not to teach the resolver
// to accept a spelling the language's own checker rejects.
func TestPinnedForkLayerAsConstIsTypeScriptsOwnRefusal(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := layerModule("Layer.provide(Layer.succeed(Db, db) as const, () => { f() })\n")
	codes := diagnosticCodes(t, backend, ctx, source, layerSupport)
	if strings.Join(codes, " ") != "TS1355" {
		t.Fatalf("`Layer.succeed(Db, db) as const` answered %v; it must be TypeScript's own TS1355 alone — "+
			"SMITHERS2104 was masking it, and unmasking it is the answer, not a regression", codes)
	}
}
