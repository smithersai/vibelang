package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const fixGeneratorReturnTarget = "FuzzFixGeneratorReturn"
const fixGeneratorReturnQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

// generatorShapes declare g, a plain function* of one number whose return value
// is what the driver reads.
var generatorShapes = map[string]string{
	"declaration": "function* g(n: number) {\n  yield n\n  return %VALUE%\n}\n",
	"expression":  "const g = function* (n: number) {\n  yield n\n  return %VALUE%\n}\n",
	"annotated":   "function* g(n: number): Generator<number, number, unknown> {\n  yield n\n  return %VALUE%\n}\n",
	"alias":       "type Eval<T> = Generator<number, T, unknown>\nconst g = function* (n: number): Eval<number> {\n  yield n\n  return %VALUE%\n}\n",
}

// generatorDrivers read the return value of g(1) as JavaScript callers do.
var generatorDrivers = map[string]string{
	"next":  "export const main = () => {\n  const it: any = g(1)\n  it.next()\n  return it.next().value\n}\n",
	"yield": "function* outer(): Generator<number, number, unknown> {\n  const x: any = yield* (g(1) as any)\n  return x + 100\n}\nexport const main = () => {\n  const it = outer()\n  it.next()\n  return it.next().value\n}\n",
}

var generatorValues = []string{"n + 1", "Math.max(n, 2)", "[n, 41].length"}

// For a generator whose returned value a caller reads, the fixed program behaves
// as the .ts twin, or --fix writes nothing.
func checkFixGeneratorReturn(t *testing.T, w *Workspace, node *Node, shape, driver, value string) {
	t.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), fixGeneratorReturnQuote) {
		t.Fatalf("Chapter 7 no longer says %q", fixGeneratorReturnQuote)
	}
	source := strings.ReplaceAll(generatorShapes[shape], "%VALUE%", value) + generatorDrivers[driver]
	key := "fix:" + shape + ":" + driver
	files := map[string]string{"main.vibe": source}
	before := toolsCompile(t, w, fixGeneratorReturnTarget, files)
	defer before.Remove()
	config := toolsConfig(w, before.Dir)
	if config == nil || len(config.Errors) > 0 {
		t.Skip("no config")
	}
	var result *vibelang.FixResult
	toolsRun(t, fixGeneratorReturnTarget, "fix", Archive(files), nil, func() {
		result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
	})
	fixed := maps.Clone(files)
	for name, file := range result.Files {
		fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
	}
	// Refused sites: each keeps its bytes, and none changed (fix_sites.go).
	for _, site := range result.Sites {
		if !vibelang.SiteHolds(source, fixed["main.vibe"], site) {
			Gap(t, fixGeneratorReturnTarget, key, "Chapter 7: refused site %+v changed\n%s\nto\n%s", site, source, fixed["main.vibe"])
		}
	}
	if len(result.Changed) > 0 {
		Gap(t, fixGeneratorReturnTarget, key, "Chapter 7: --fix changed refused sites %+v\n%s", result.Changed, source)
	}
	after := before
	if len(result.Files) > 0 {
		after = toolsCompile(t, w, fixGeneratorReturnTarget, fixed)
		defer after.Remove()
	}
	if !toolsErrorFree(after) {
		// Nothing runs, so the return must still be there for a later fix
		// or admission to keep.
		if !strings.Contains(fixed["main.vibe"], "return "+value) {
			Gap(t, fixGeneratorReturnTarget, key, "Chapter 7: %q; --fix dropped the returned value\n%s\nto\n%s", fixGeneratorReturnQuote, source, fixed["main.vibe"])
		}
		ExpectPending(t, fixGeneratorReturnTarget, key)
		return
	}
	twin := toolsCompile(t, w, fixGeneratorReturnTarget, map[string]string{"main.ts": source})
	defer twin.Remove()
	if !toolsErrorFree(twin) {
		t.Fatalf("the .ts twin does not compile:\n%s", source)
	}
	got, want := node.Run(after, "out/main.js", "main"), node.Run(twin, "out/main.js", "main")
	if want.Kind != "plain" {
		t.Fatalf("the .ts twin does not run: %+v\n%s", want, source)
	}
	if !toolsSameOutcome(got, want) {
		Gap(t, fixGeneratorReturnTarget, key, "Chapter 7: %q; fixed %+v, twin %+v\n%s\nfixed:\n%s", fixGeneratorReturnQuote, got, want, source, fixed["main.vibe"])
	}
	ExpectPending(t, fixGeneratorReturnTarget, key)
}

// The refusal side: a source --fix cannot repair keeps every byte. This text is
// the generic Effect.fn from drive2-opencode, after an earlier run with effect
// not installed lost its return.
func TestFixGeneratorRefusalLeavesBytes(t *testing.T) {
	w := NewWorkspace(t)
	source := "import * as Effect from \"effect/Effect\"\nexport const identity = Effect.fn(\"identity\")(function* <A>(value: A): Effect.fn.Return<A> {\n  { yield* Effect.succeed(value); return }\n})\n"
	files := map[string]string{"main.vibe": source}
	before := toolsCompile(t, w, fixGeneratorReturnTarget, files)
	defer before.Remove()
	result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
	for _, file := range result.Files {
		if file.Text != source {
			t.Fatalf("a refused file changed:\n%s", file.Text)
		}
	}
}

func FuzzFixGeneratorReturn(f *testing.F) {
	startShortBudget(f)
	shapes, drivers := fixGeneratorKeys(generatorShapes), fixGeneratorKeys(generatorDrivers)
	for i := range shapes {
		for d := range drivers {
			f.Add(uint8(i), uint8(d), uint8(i+d))
		}
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Cleanup(node.Close)
	f.Fuzz(func(t *testing.T, shape, driver, value uint8) {
		checkFixGeneratorReturn(t, w, node, shapes[int(shape)%len(shapes)], drivers[int(driver)%len(drivers)], generatorValues[int(value)%len(generatorValues)])
	})
}

// fixGeneratorKeys returns m's keys in order, so a seed names one case on every run.
func fixGeneratorKeys(m map[string]string) []string {
	keys := slices.Collect(maps.Keys(m))
	slices.Sort(keys)
	return keys
}
