package compiler

import (
	"strings"
	"testing"
)

// The `Layer.succeed` CAPABILITY ARGUMENT and the `Capability.context()`
// RECEIVER are one question, answered on this backend by one function.
//
// The runtime registers a layer under the constructor its capability argument
// EVALUATES to, and resolves `.context()` by the constructor its receiver
// EVALUATES to. A layer's provided set and a body's required set are therefore
// one fact about one program. They were computed by two resolvers — this
// bridge's `contextReceiverOf` for the read and a bespoke `classReferenceSymbol`
// for the layer — and the two disagreed with the JS reference in OPPOSITE
// directions, which is why no one-sided fix worked. Measured on THIS backend
// before the change, with the runtime oracle:
//
//	Layer.succeed(Db as unknown as typeof Cfg, cfg)   // body reads Cfg
//	    -> ok: true, RAN, `Panic: unsatisfied Context requirement`   [FAIL-OPEN]
//	Layer.succeed(<any>Db, db)                        // body reads Db
//	    -> SMITHERS2104, refused; the reference accepted it and RAN  [OVER-REFUSAL]
//	Layer.succeed(off ? Db : Twin, twin)              // body reads Db, off = false
//	    -> ok: true, RAN, panicked reading Db after registering Twin [FAIL-OPEN]
//
// `classReferenceSymbol` asked `GetTypeAtLocation` FIRST and the syntax only as
// a fallback. That is precisely the ordering `contextReceiverOf`'s own comment
// records as wrong: TypeScript subtype-reduces `typeof Db | typeof Twin` to
// `typeof Db` and nothing in the resulting type remembers the other arm, so a
// type-first walk records a MISATTRIBUTED row rather than an ambiguous one.
//
// The fix routes the capability argument through `contextReceiverOf` and
// deletes `classReferenceSymbol`, whose only caller it was. No rule is restated
// and no code is minted: an argument that pins no single class lands on
// `resolveLayer`'s own fail-closed `false`, which is the blunt SMITHERS2104 the
// resolver already answers for every expression it cannot see through.
//
// # What this table CANNOT see
//
// It measures diagnostics, not runtime behaviour; the panics quoted above were
// measured out of band with `smithers run --backend go`. And a table built only
// from type-PRESERVING spellings is VACUOUS for this rule — a syntax walk and a
// checker walk answer identically on every one of them, which is exactly why
// the previous 18-spelling matrix reported this site "SOUND on all 18". The
// rows that carry the distinction are the LAUNDERING ones (value and type name
// different classes) and the ERASING ones (`as any`, `<any>`); a type-directed
// implementation passes everything else here and fails exactly those.
func TestPinnedForkLayerCapabilityArgumentPinsOneContextClass(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	// Every spelling whose VALUE is `Db`. `direct` is the baseline and is
	// asserted clean in its own right, so an accidentally-refusing baseline
	// cannot make the equalities vacuous.
	pinned := []struct {
		name         string
		declarations string
		argument     string
	}{
		{"direct", "", "Db"},
		{"parenthesised", "", "(Db)"},
		{"as typeof", "", "Db as typeof Db"},
		{"satisfies typeof", "", "Db satisfies typeof Db"},
		{"angle-bracket assertion", "", "<typeof Db>Db"},
		{"as any", "", "Db as any"},
		{"angle-bracket any", "", "<any>Db"},
		{"as unknown as", "", "Db as unknown as typeof Db"},
		{"as unknown as any", "", "Db as unknown as any"},
		{"satisfies unknown", "", "Db satisfies unknown"},
		{"parenthesised as any", "", "(Db as any)"},
		{"angle any then satisfies", "", "(<any>Db) satisfies unknown"},
		{"const value alias", "const Alias = Db\n", "Alias"},
		{"const alias chain", "const A1 = Db\nconst A2 = A1\n", "A2"},
		{"typed const alias", "const Alias: typeof Db = Db\n", "Alias"},
		{"const alias of a wrapped initializer", "const Alias = Db as any\n", "Alias"},
		{"const alias wrapped at the use", "const Alias = Db\n", "Alias as any"},
		{"const alias with a union annotation", "const C: typeof Db | typeof Twin = Db\n", "C"},
		{"a conditional whose arms are the same class", "", "flag ? Db : Db"},
		{"a property-held alias", "const box = { Db }\n", "box.Db"},
	}

	for _, cell := range pinned {
		t.Run(cell.name, func(t *testing.T) {
			source := layerCapabilityModule(cell.declarations +
				"Layer.provide(Layer.succeed(" + cell.argument + ", db), () => { f() })\n")
			if got := smithersDiagnosticCodes(t, backend, ctx, source, layerSupport); len(got) != 0 {
				t.Fatalf("%s must resolve to Db and be accepted, but reported %v", cell.argument, got)
			}
		})
	}
}

// TestPinnedForkLayerCapabilityArgumentReadsSyntaxNotTheCheckerType is the pair
// of rows the table above structurally cannot contain, because every spelling
// in it preserves the type. A type-directed implementation passes every cell of
// the table above and fails exactly these.
func TestPinnedForkLayerCapabilityArgumentReadsSyntaxNotTheCheckerType(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	laundered := []struct {
		name           string
		declarations   string
		argument       string
		implementation string
		read           string
	}{
		{"as unknown as", "", "Db as unknown as typeof Cfg", "cfg", "g"},
		{"angle-bracket double assertion", "", "<typeof Cfg><unknown>Db", "cfg", "g"},
		{"through a const binding", "const L = Db as unknown as typeof Cfg\n", "L", "cfg", "g"},
		{"through an any hop", "", "(Db as any) as typeof Cfg", "cfg", "g"},
		{"in the other direction", "", "Cfg as unknown as typeof Db", "db", "f"},
	}

	for _, cell := range laundered {
		t.Run(cell.name, func(t *testing.T) {
			source := layerCapabilityModule(cell.declarations +
				"Layer.provide(Layer.succeed(" + cell.argument + ", " + cell.implementation +
				"), () => { " + cell.read + "() })\n")
			got := smithersDiagnosticCodes(t, backend, ctx, source, layerSupport)
			// The PRECISE code that names the capability, not the blunt one:
			// the syntax still spells which constructor the runtime registers.
			if strings.Join(got, " ") != "SMITHERS2101" {
				t.Fatalf("%s launders the TYPE but not the VALUE; it must stay SMITHERS2101 "+
					"naming the capability the runtime never registers, but answered %v", cell.argument, got)
			}
		})
	}
}

// TestPinnedForkLayerCapabilityArgumentRefusesAnUnpinnedArgument is the
// fail-closed half. `resolveLayer` is a fail-closed walk, so the only way to
// break it while every positive cell still passes is to make it answer "known"
// for something it cannot actually see.
func TestPinnedForkLayerCapabilityArgumentRefusesAnUnpinnedArgument(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	ambiguous := []struct {
		name         string
		declarations string
		argument     string
	}{
		{"a conditional over two capabilities", "", "flag ? Db : Twin"},
		{"a conditional whose runtime arm is the other class", "const off: boolean = false\n", "off ? Db : Twin"},
		{"a nested conditional", "", "flag ? Db : (flag ? Twin : Db)"},
		{"a logical-or over two capabilities", "", "Twin || Db"},
		{"an anonymous class expression", "", "class extends Context { read() { return \"x\" } }"},
	}

	for _, cell := range ambiguous {
		t.Run(cell.name, func(t *testing.T) {
			source := layerCapabilityModule(cell.declarations +
				"Layer.provide(Layer.succeed(" + cell.argument + ", db as never), () => { f() })\n")
			got := smithersDiagnosticCodes(t, backend, ctx, source, layerSupport)
			found := false
			for _, code := range got {
				if code == "SMITHERS2104" {
					found = true
				}
			}
			if !found {
				t.Fatalf("%s pins no single Context class, so the closure is unproven and the layer "+
					"must be opaque (SMITHERS2104); it answered %v", cell.argument, got)
			}
		})
	}

	// A bare type parameter is ambiguous EVEN WHEN ITS BOUND NAMES ONE CLASS,
	// because a subclass substitutes for it and carries a different nominal key.
	// That detail was settled with SMITHERS2106 and is inherited here, not
	// restated.
	parameterised := []struct {
		name string
		body string
	}{
		{
			name: "a union-typed parameter",
			body: `function boot(C: typeof Db | typeof Twin, impl: Db): void {
  Layer.provide(Layer.succeed(C, impl), () => { f() })
}
boot(Db, db)
`,
		},
		{
			name: "a bare type parameter, whose bound names ONE class",
			body: `function boot<C extends typeof Db>(C: C, impl: InstanceType<C>): void {
  Layer.provide(Layer.succeed(C, impl), () => { f() })
}
boot(Db, db)
`,
		},
	}

	for _, cell := range parameterised {
		t.Run(cell.name, func(t *testing.T) {
			got := smithersDiagnosticCodes(t, backend, ctx, layerCapabilityModule(cell.body), layerSupport)
			found := false
			for _, code := range got {
				if code == "SMITHERS2104" {
					found = true
				}
			}
			if !found {
				t.Fatalf("a parameter has no `const` initializer and its type pins no class — a bound "+
					"never pins the key, because a SUBCLASS substitutes for it and carries a different "+
					"nominal key — so the layer must be opaque; got %v", got)
			}
		})
	}
}

// TestPinnedForkLayerCapabilityArgumentKeepsTheRulesItDependsOn is the
// both-directions block. Everything here answered the same before the change
// and must answer the same after it; a fix that loosened any of them would be
// worse than the defect it closes.
func TestPinnedForkLayerCapabilityArgumentKeepsTheRulesItDependsOn(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	cases := []struct {
		name   string
		body   string
		expect string
		why    string
	}{
		{
			name:   "a layer that genuinely misses a capability NAMES it",
			body:   "Layer.provide(Layer.succeed(Cfg, cfg), () => { f() })\n",
			expect: "SMITHERS2101",
			why:    "the precise code, not the blunt SMITHERS2104",
		},
		{
			name:   "it names it through a wrapper too",
			body:   "Layer.provide(Layer.succeed(Cfg as typeof Cfg, cfg), () => { f() })\n",
			expect: "SMITHERS2101",
			why:    "a wrapper is erased at emit, so it cannot change which capability is missing",
		},
		{
			name:   "it names it through a const value alias",
			body:   "const Alias = Cfg\nLayer.provide(Layer.succeed(Alias, cfg), () => { f() })\n",
			expect: "SMITHERS2101",
			why:    "a const alias IS its initializer, so the missing capability is still Db",
		},
		{
			name: "a reassigned let LAYER binding stays opaque",
			body: "let app: Layer<typeof Db> = Layer.succeed(Db, db)\n" +
				"app = Layer.succeed(Cfg, cfg) as unknown as Layer<typeof Db>\n" +
				"Layer.provide(app, () => { f() })\n",
			expect: "SMITHERS2104",
			why:    "collectLayerBindings' const-ONLY rule is orthogonal to this site and must survive",
		},
		{
			name: "a never-reassigned let LAYER binding stays opaque",
			body: "let app: Layer<typeof Db> = Layer.succeed(Db, db)\n" +
				"Layer.provide(app, () => { f() })\n",
			expect: "SMITHERS2104",
			why:    "the const-only rule keys on the DECLARATION, not on reachability",
		},
		{
			name: "an opaque conditional LAYER stays opaque",
			body: "const a = Layer.succeed(Db, db)\nconst b = Layer.succeed(Db, db)\n" +
				"Layer.provide(flag ? a : b, () => { f() })\n",
			expect: "SMITHERS2104",
			why:    "opaque stays opaque",
		},
		{
			name:   "a const LAYER binding still resolves",
			body:   "const app = Layer.succeed(Db, db)\nLayer.provide(app, () => { f() })\n",
			expect: "",
			why:    "the acceptance guard for the rule above",
		},
		{
			name:   "a merged layer still adds up, and still names what it misses",
			body:   "Layer.provide(Layer.merge(Layer.succeed(Db, db), Layer.succeed(Cfg, cfg)), () => { g() })\n",
			expect: "",
			why:    "merge composes the two capability arguments the same way",
		},
		{
			name:   "postfix ! is refused in its own right and adds no second refusal",
			body:   "Layer.provide(Layer.succeed(Db!, db), () => { f() })\n",
			expect: "SMITHERS1207",
			why: "the attribution control: `!` IS in contextReceiverOf's spelled-out wrapper list, " +
				"so the capability under it still resolves and only the `!` itself is refused. " +
				"If the change had been 'assertions are ignored in a layer position' this row would " +
				"have kept a SMITHERS2104 beside the SMITHERS1207",
		},
	}

	for _, cell := range cases {
		t.Run(cell.name, func(t *testing.T) {
			got := smithersDiagnosticCodes(t, backend, ctx, layerCapabilityModule(cell.body), layerSupport)
			if strings.Join(got, " ") != cell.expect {
				t.Fatalf("expected %q (%s), got %v", cell.expect, cell.why, got)
			}
		})
	}
}

// KNOWN RESIDUAL, shared with SMITHERS2106 and pinned so it cannot be read as
// intentional. `let C = Db; C = Twin; Layer.succeed(C, db)` is accepted with the
// row `Db` and PANICS, on BOTH backends — because `constantInitializer` excludes
// `let` and the walk then falls through to the checker type, which TypeScript
// has already narrowed back to `typeof Db`. The receiver has it identically:
// `let C = Db; C = Twin; C.context()` checks clean with the row `Db` and aborts
// with `capability 'Twin' was not provided`. It is pinned here so that the day
// the receiver rule closes it, this site is KNOWN to move with it — they are one
// function now. Closing it needs a decision this change did not have:
// `const`-ness alone would refuse a `let` that is never reassigned, which is a
// correct program that runs.
func TestPinnedForkLayerCapabilityArgumentReassignedBindingResidual(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, body := range []string{
		"let C = Db\nC = Twin\nLayer.provide(Layer.succeed(C, db), () => { f() })\n",
		"var V = Db\nV = Twin\nLayer.provide(Layer.succeed(V, db), () => { f() })\n",
	} {
		if got := smithersDiagnosticCodes(t, backend, ctx, layerCapabilityModule(body), layerSupport); len(got) != 0 {
			t.Fatalf("this residual is recorded as ACCEPTED; if it now reports %v the rule moved "+
				"and SMITHERS2106's receiver walk must move with it", got)
		}
	}
}

// layerCapabilityModule renders one whole `.sm` program. `Twin` is
// structurally identical to `Db` on purpose: that is what makes TypeScript
// subtype-reduce `typeof Db | typeof Twin` and lets a type-directed resolver
// record the wrong nominal key.
func layerCapabilityModule(body string) string {
	return `import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"

abstract class Db extends Context {
  abstract read(): string
}

abstract class Twin extends Context {
  abstract read(): string
}

abstract class Cfg extends Context {
  abstract n(): number
}

function f(): number { return Db.context().read().length }

function g(): number { return Db.context().read().length + Cfg.context().n() }

const db: Db = { read: () => "DBX" }
const twin: Twin = { read: () => "TWN" }
const cfg: Cfg = { n: () => 7 }
const flag: boolean = true

` + body
}

// The panic intrinsic in a TEMPLATE TAG position, on this backend.
//
// `specification/failures.mdx` writes the intrinsic as `panic(...)` and writes
// no tagged-template spelling. Measured on THIS backend before the rule, with
// the runtime oracle:
//
//   - a panic tag over "authored message" checked clean and aborted with a
//     `Panic` whose `cause` was the ARRAY [ 'authored message' ] rather than the
//     authored string — a structurally different Panic value from the one the
//     call spelling builds, and from the one the reference builds (whose message
//     degraded outright, to "Smithers panic");
//   - `Reflect.panic` in a tag position survived lowering untouched, and the
//     ACCEPTED program died with `TypeError: Reflect.panic is not a function`.
//
// The code is SMITHERS1503, which already answers "this is the panic operation
// in a spelling the lowering does not support", reported at the whole tagged
// expression exactly where the call form reports it. The SHAPE is
// SMITHERS1604's: refuse the OPERATION, leave the NAME resolvable.
//
// The acceptance block is not decoration. Without it the rule can be widened to
// "any tag whose name is `panic`" and every refusal above stays green.
func TestPinnedForkPanicIsACallAndNotATemplateTag(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	refused := []struct {
		name         string
		declarations string
		statement    string
	}{
		{"the bare spelling", "", "panic`authored message`"},
		{"an empty template", "", "panic``"},
		{"a substituted template", "const n = 7\n", "panic`authored ${n} message`"},
		{"parenthesised", "", "(panic)`authored message`"},
		{"through satisfies", "", "(panic satisfies typeof panic)`authored message`"},
		{"through as", "", "(panic as typeof panic)`authored message`"},
		{"through an angle-bracket assertion", "", "(<typeof panic>panic)`authored message`"},
		{"through a const value alias", "const p = panic\n", "p`authored message`"},
		{"through a const alias chain", "const p1 = panic\nconst p2 = p1\n", "p2`authored message`"},
		{"the ambient Reflect spelling", "", "Reflect.panic`authored message`"},
		{"the ambient Reflect spelling through a computed key", "", "Reflect[\"panic\"]`authored message`"},
	}

	for _, cell := range refused {
		t.Run(cell.name, func(t *testing.T) {
			source := panicTagModule(cell.declarations, "  "+cell.statement+"\n")
			got := smithersDiagnosticCodes(t, backend, ctx, source, layerSupport)
			if strings.Join(got, " ") != "SMITHERS1503" {
				t.Fatalf("%s is the panic operation in a spelling the lowering does not support; "+
					"expected SMITHERS1503, got %v", cell.statement, got)
			}
		})
	}

	t.Run("at module scope too", func(t *testing.T) {
		source := "import { panic } from \"smithers:exceptions\"\n\npanic`authored message`\n"
		got := smithersDiagnosticCodes(t, backend, ctx, source, layerSupport)
		if strings.Join(got, " ") != "SMITHERS1503" {
			t.Fatalf("expected SMITHERS1503 at module scope, got %v", got)
		}
	})

	accepted := []struct {
		name         string
		declarations string
		statement    string
	}{
		{"an ordinary call", "", "panic(\"authored message\")"},
		{"a parenthesised call", "", "(panic)(\"authored message\")"},
		{"the ambient Reflect call", "", "Reflect.panic(\"authored message\")"},
		{"a call through a const value alias", "const p = panic\n", "p(\"authored message\")"},
		{"a call whose argument is itself a template", "", "panic(`authored message`)"},
	}

	for _, cell := range accepted {
		t.Run("the name stays resolvable: "+cell.name, func(t *testing.T) {
			source := panicTagModule(cell.declarations, "  "+cell.statement+"\n")
			if got := smithersDiagnosticCodes(t, backend, ctx, source, layerSupport); len(got) != 0 {
				t.Fatalf("%s is a CALL and must stay accepted, but reported %v", cell.statement, got)
			}
		})
	}

	guards := []struct {
		name   string
		source string
	}{
		{
			name: "String.raw is still a tag",
			source: "/** @throws {never} */\nexport function boom(): string {\n" +
				"  return String.raw`authored message`\n}\n\nboom()\n",
		},
		{
			name: "a LOCAL function named panic is still a tag",
			source: "/** @throws {never} */\n" +
				"function panic(parts: TemplateStringsArray): string { return parts.join(\"\") }\n\n" +
				"/** @throws {never} */\nexport function boom(): string {\n" +
				"  return panic`authored message`\n}\n\nboom()\n",
		},
		{
			name: "a local object named Reflect with a panic member is still a tag",
			source: "const Reflect = { panic: (parts: TemplateStringsArray): string => parts.join(\"\") }\n\n" +
				"/** @throws {never} */\nexport function boom(): string {\n" +
				"  return Reflect.panic`authored message`\n}\n\nboom()\n",
		},
	}

	for _, guard := range guards {
		t.Run("acceptance guard: "+guard.name, func(t *testing.T) {
			if got := smithersDiagnosticCodes(t, backend, ctx, guard.source, layerSupport); len(got) != 0 {
				t.Fatalf("this tag is not the panic intrinsic and must stay accepted, but reported %v; "+
					"a rule widened to 'any tag named panic' fails exactly here and nowhere else", got)
			}
		})
	}

	// KNOWN RESIDUAL: the tag walk uses the same `const`-only binding step every
	// other provenance walk in this bridge uses, so a MUTABLE alias escapes it
	// and still degrades. Closing it needs the same decision the reassigned
	// capability-argument binding needs.
	t.Run("KNOWN RESIDUAL: a let alias used as a tag is still accepted", func(t *testing.T) {
		source := panicTagModule("let p = panic\n", "  p`authored message`\n")
		if got := smithersDiagnosticCodes(t, backend, ctx, source, layerSupport); len(got) != 0 {
			t.Fatalf("this residual is recorded as ACCEPTED; if it now reports %v the const-only "+
				"binding step moved and every walk that shares it must move together", got)
		}
	})
}

func panicTagModule(declarations, statement string) string {
	return "import { panic } from \"smithers:exceptions\"\n\n" + declarations +
		"\n/** @throws {never} */\nexport function boom(): void {\n" + statement + "}\n\nboom()\n"
}
