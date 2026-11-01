package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// FuzzEffectBlockDeclarationTwin enforces Chapter 2, `effect` blocks, Meaning:
// "`effect { … }` is an expression. It builds an Effect from the block without
// running it. Each time the Effect runs, the block runs again. It is
// `Effect.gen(function* () { … })`, and the same as `(effect () => { … })()`."
// and Chapter 1, Declaration output: "Declarations are exactly what idiomatic
// Effect TypeScript would declare." The input picks where the block stands (a
// default export, a named constant, a default or named `effect` arrow, a
// default `effect function`), what its body does, and whether `Effect` comes
// from the prelude or an explicit import. The twin is the `Effect.gen` form the
// sentence and Chapter 1's table name, written independently of the compiler;
// the declarations of the .vibe and of the twin under stock tsc must agree
// under the migration identity gate's canonicalization. t3code's server
// migration kept 0 of 50 modules because `export default effect { … }`
// declared `declare function _default(): void` (inbox migrate-t3code
// 2026-11-01T03:10Z, 47 modules).
func FuzzEffectBlockDeclarationTwin(f *testing.F) {
	startShortBudget(f)
	effectBlockTwinChapters(f)
	tsc := StockTypeScript(f)
	api := declarationIdentityAPI(f)
	w := NewWorkspace(f)
	// A seed and its keyed corpus replay the same independent TypeScript
	// counterpart. Emit each distinct fixed counterpart once per target; still
	// compile and compare every Vibe input, including every pending replay.
	stockCache := map[string]string{}
	comparisons := map[string]effectBlockTwinComparison{}
	f.Cleanup(func() {
		for _, dir := range stockCache {
			os.RemoveAll(dir)
		}
	})
	for _, export := range effectBlockTwinExports {
		for _, body := range effectBlockTwinBodies {
			f.Add([]byte("block-twin:" + export.name + ":" + body.name + ":explicit"))
		}
	}
	for _, export := range effectBlockTwinExports {
		f.Add([]byte("block-twin:" + export.name + ":sleep:prelude"))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckEffectBlockDeclarationTwin(t, w, tsc, api, stockCache, comparisons, parseEffectBlockTwin(data))
	})
}

// TestEffectBlockDeclarationTwinQuoted fails when a chapter rewords a sentence
// the oracle quotes (RULES.md 9).
func TestEffectBlockDeclarationTwinQuoted(t *testing.T) { effectBlockTwinChapters(t) }

var effectBlockTwinQuotes = map[string][]string{
	"002-running.md": {
		"`effect { … }` is an expression. It builds an Effect from the block without running it. Each time the Effect runs, the block runs again. It is `Effect.gen(function* () { … })`, and the same as `(effect () => { … })()`.",
	},
	"001-functions.md": {
		"Declarations are exactly what idiomatic Effect TypeScript would declare.",
		"| `export default effect function (p) { B }` | `export default function (p) { return Effect.gen(function* () { B }) }` |",
		"| `effect (p) => { B }` | `(p) => Effect.gen(function* () { B })` |",
	},
}

func effectBlockTwinChapters(tb testing.TB) {
	tb.Helper()
	for chapter, quotes := range effectBlockTwinQuotes {
		text := SpecText(chapter)
		for _, quote := range quotes {
			if !strings.Contains(text, quote) {
				tb.Fatalf("%s no longer says %q", chapter, quote)
			}
		}
	}
}

// An effectBlockTwinExport is where the block stands: the .vibe form and the
// Effect TypeScript form around a body B (`%s`).
type effectBlockTwinExport struct {
	name, vibe, ts string
}

var effectBlockTwinExports = []effectBlockTwinExport{
	{"default", "export default effect {\n%s\n}\n", "export default Effect.gen(function* () {\n%s\n})\n"},
	{"named", "export const named = effect {\n%s\n}\n", "export const named = Effect.gen(function* () {\n%s\n})\n"},
	{"default-arrow", "export default effect (n: number) => {\n%s\n}\n", "export default (n: number) => Effect.gen(function* () {\n%s\n})\n"},
	{"named-arrow", "export const make = effect (n: number) => {\n%s\n}\n", "export const make = (n: number) => Effect.gen(function* () {\n%s\n})\n"},
	{"default-function", "export default effect function (n: number) {\n%s\n}\n", "export default function (n: number) {\n  return Effect.gen(function* () {\n%s\n  })\n}\n"},
	{"nested", "export const outer = effect {\n  const inner = effect {\n%s\n  }\n  return try inner\n}\n", "export const outer = Effect.gen(function* () {\n  const inner = Effect.gen(function* () {\n%s\n  })\n  return yield* inner\n})\n"},
}

// An effectBlockTwinBody is what the block does, in both spellings, with the
// declarations it needs.
type effectBlockTwinBody struct {
	name, vibe, ts, vibeDecls, tsDecls string
}

var effectBlockTwinBodies = []effectBlockTwinBody{
	{"sleep", "  try Effect.sleep(\"1 millis\")", "  yield* Effect.sleep(\"1 millis\")", "", ""},
	{"value", "  try Effect.sleep(\"1 millis\")\n  return 1", "  yield* Effect.sleep(\"1 millis\")\n  return 1", "", ""},
	{"fail", "  throw new Missing({ message: \"m\" })", "  return yield* Effect.fail(new Missing({ message: \"m\" }))",
		"export error Missing { message: string }\n\n", "export class Missing extends Data.TaggedError(\"Missing\")<{ readonly message: string }> {}\n\n"},
	{"object", "  const value = try Effect.succeed(2)\n  return { n: value, ok: true as const }", "  const value = yield* Effect.succeed(2)\n  return { n: value, ok: true as const }", "", ""},
}

type effectBlockTwin struct {
	export  effectBlockTwinExport
	body    effectBlockTwinBody
	prelude bool // the .vibe names Effect through the prelude, with no import
}

func (e effectBlockTwin) key() string {
	imports := "explicit"
	if e.prelude {
		imports = "prelude"
	}
	return "block-twin:" + e.export.name + ":" + e.body.name + ":" + imports
}

// parseEffectBlockTwin reads the keyed form, `block-twin:<export>:<body>:<imports>`,
// so a saved corpus file keeps what it tests (RULES.md 11), and otherwise reads
// the choice from the bytes.
func parseEffectBlockTwin(data []byte) effectBlockTwin {
	e := effectBlockTwin{export: effectBlockTwinExports[0], body: effectBlockTwinBodies[0]}
	if rest, ok := strings.CutPrefix(string(data), "block-twin:"); ok {
		parts := strings.Split(rest, ":")
		for _, export := range effectBlockTwinExports {
			if parts[0] == export.name {
				e.export = export
			}
		}
		if len(parts) > 1 {
			for _, body := range effectBlockTwinBodies {
				if parts[1] == body.name {
					e.body = body
				}
			}
		}
		e.prelude = len(parts) > 2 && parts[2] == "prelude"
		return e
	}
	at := func(i int) byte {
		if i < len(data) {
			return data[i]
		}
		return 0
	}
	e.export = effectBlockTwinExports[int(at(0))%len(effectBlockTwinExports)]
	e.body = effectBlockTwinBodies[int(at(1))%len(effectBlockTwinBodies)]
	e.prelude = at(2)&1 != 0
	return e
}

// vibe prints the .vibe module.
func (e effectBlockTwin) vibe() string {
	imports := ""
	if !e.prelude {
		imports = "import { Effect } from \"effect\"\n\n"
	}
	return imports + e.body.vibeDecls + fmt.Sprintf(e.export.vibe, e.body.vibe)
}

// twin prints the Effect TypeScript module the chapter says the block is.
func (e effectBlockTwin) twin() string {
	names := []string{"Effect"}
	if e.body.tsDecls != "" {
		names = append(names, "Data")
	}
	slices.Sort(names)
	return "import { " + strings.Join(names, ", ") + " } from \"effect\"\n\n" + e.body.tsDecls + fmt.Sprintf(e.export.ts, e.body.ts)
}

const effectBlockTwinConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"__identity_out","rootDir":"."},"files":["%s"]}`

type effectBlockTwinComparison struct {
	emitted string
	diff    string
}

// CheckEffectBlockDeclarationTwin compares one module's declarations with its
// twin's under stock tsc.
func CheckEffectBlockDeclarationTwin(t *testing.T, w *Workspace, tsc, api string, stockCache map[string]string, comparisons map[string]effectBlockTwinComparison, e effectBlockTwin) {
	const target = "FuzzEffectBlockDeclarationTwin"
	defer recoverCompilerPanic(t, target)
	vibe := Project{Files: map[string]string{"main.vibe": e.vibe(), "package.json": `{"type":"module"}`}, Config: fmt.Sprintf(effectBlockTwinConfig, "main.vibe")}
	stock := Project{Files: map[string]string{"main.ts": e.twin(), "package.json": `{"type":"module"}`}, Config: fmt.Sprintf(effectBlockTwinConfig, "main.ts")}
	g := &Gaps{Target: target, Input: e.vibe()}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	var c *Compilation
	var err error
	within(t, "compile", func() { c, err = w.CompileOrdered(t.Context(), vibe, OrderTsc, true) })
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	if c.Program == nil || HasError(c.Diagnostics) {
		g.Add("feature:"+e.key()+":compiles", "Chapter 2: an effect block is a valid expression wherever an expression goes; the compiler reports %v for:\n%s", SortedKeys(Keys(c.Dir, c.Diagnostics)), e.vibe())
		g.FinishInput(t, key)
		return
	}
	dir := stockCache[e.twin()]
	if dir == "" {
		dir = emitDeclarationIdentityStock(t, w, tsc, stock)
		stockCache[e.twin()] = dir
	}
	current := filepath.Join(c.Dir, "__identity_current")
	if err := os.MkdirAll(current, 0o755); err != nil {
		t.Fatal(err)
	}
	emitted := map[string]string{}
	for name, text := range c.Outputs {
		if rel, ok := strings.CutPrefix(name, "__identity_out/"); ok && isDeclaration(name) {
			emitted[rel] = text
			if err := writeInside(current, rel, text); err != nil {
				t.Fatal(err)
			}
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	// Replays of the same key still compile every input. Canonicalization is
	// pure for identical emitted bytes and the fixed native counterpart.
	// Bound this cache by the finite key set; changed bytes always compare anew.
	fingerprint := Archive(emitted)
	previous, found := comparisons[e.key()]
	diff := previous.diff
	if !found || previous.emitted != fingerprint {
		diff, err = compareIdentityDeclarations(ctx, api, filepath.Join(dir, "__identity_out"), current)
		if err != nil {
			t.Fatal(err)
		}
		comparisons[e.key()] = effectBlockTwinComparison{emitted: fingerprint, diff: diff}
	}
	if diff != "" {
		g.Add("feature:"+e.key(), "Chapter 2: \"`effect { … }` … is `Effect.gen(function* () { … })`\" and Chapter 1: \"Declarations are exactly what idiomatic Effect TypeScript would declare.\" The twin's (-) and the module's (+) canonical declarations differ:\n%s\nmodule:\n%s\ntwin:\n%s", diff, e.vibe(), e.twin())
	}
	g.FinishInput(t, key)
}
