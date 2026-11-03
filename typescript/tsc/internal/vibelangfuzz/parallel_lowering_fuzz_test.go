package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const parallelLoweringTarget = "FuzzParallelLowering"
const parallelLoweringQuote = "is that module: the emitted code imports it under a fresh name"

func TestParallelLoweringQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), parallelLoweringQuote) {
		t.Fatalf("Chapter 5 no longer says %q", parallelLoweringQuote)
	}
}

// parallelLoweringModule is module i of a project in which each file gives the
// checker something to record while it plans the file. Foldkit's dom/domBehavior
// wrote Effect.Array across its modules, and the build stopped with "concurrent
// map read and map write" in the lowering (foldkit-8).
func parallelLoweringModule(key string, i int) (string, bool) {
	switch key {
	case "value":
		return fmt.Sprintf("export const a%[1]d = Effect.Array.of(%[1]d)\nexport const b%[1]d = Effect.Array.append(a%[1]d, %[1]d)\n", i), true
	case "type":
		return fmt.Sprintf("export type T%[1]d = Effect.Array.NonEmptyReadonlyArray<number>\nexport const a%[1]d: T%[1]d = Effect.Array.of(%[1]d)\n", i), true
	case "typeof":
		return fmt.Sprintf("export type T%[1]d = typeof Effect.Array\nexport const a%[1]d: T%[1]d = Effect.Array\n", i), true
	case "shadow":
		return fmt.Sprintf("const Effect = { Array: { local: %[1]d } }\nexport const a%[1]d = Effect.Array.local\n", i), true
	case "intrinsic":
		return fmt.Sprintf("const Schema = %[1]d\nexport schema Data%[1]d { n: number }\nexport const a%[1]d = Schema\n", i), true
	case "mixed":
		switch i % 3 {
		case 0:
			return parallelLoweringModule("value", i)
		case 1:
			return parallelLoweringModule("intrinsic", i)
		}
		return parallelLoweringModule("shadow", i)
	case "foldkit-dom-behavior":
		return fmt.Sprintf("export const allowed%[1]d = (nodes: ReadonlyArray<string>, selector: string): boolean =>\n  Effect.Array.some(nodes, (node) => node === selector)\nexport const changed%[1]d = (added: Iterable<string>, removed: Iterable<string>): ReadonlyArray<string> => [\n  ...Effect.Array.fromIterable(added),\n  ...Effect.Array.fromIterable(removed),\n]\n", i), true
	}
	return "", false
}

// A compilation with the pool of checkers compares with one on a single
// goroutine, both of the same files. The comparison is of the compiler with
// itself: the chapter's sentence holds for each module whichever goroutine
// lowers it, so no output may depend on the other modules' timing.
func FuzzParallelLowering(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"value", "type", "typeof", "shadow", "intrinsic", "mixed", "foldkit-dom-behavior"} {
		f.Add(key, uint8(14))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, modules uint8) {
		TestParallelLoweringQuoted(t)
		if _, ok := parallelLoweringModule(key, 0); !ok {
			return
		}
		project := Project{Files: map[string]string{"package.json": `{"name":"parallel-lowering","type":"module"}`}}
		for i := range 2 + int(modules%15) {
			source, _ := parallelLoweringModule(key, i)
			project.Files[fmt.Sprintf("m%d.vibe", i)] = source
		}
		var single *Compilation
		var err error
		within(t, "compile", func() { single, err = w.CompileOrdered(t.Context(), project, OrderTsc, true) })
		if err != nil {
			t.Fatal(err)
		}
		defer single.Remove()
		if HasError(single.Diagnostics) {
			t.Fatalf("not a program of accepted constructs: %v", Keys(single.Dir, single.Diagnostics))
		}
		// Emit first: each file's plan checks the file while other files lower.
		var parallel *Compilation
		within(t, "parallel", func() { parallel = w.CompileIn(t.Context(), single.Dir, project, OrderEmitFirst, false) })
		if diff := DiffOutputs(single.Dir, single.Outputs, parallel.Dir, parallel.Outputs); diff != "" {
			Gap(t, parallelLoweringTarget, "feature:outputs:"+key, "Chapter 5: %q; the checkers' pool writes other outputs:\n%s", parallelLoweringQuote, diff)
		}
		for name, text := range parallel.Outputs {
			local := strings.Contains(text, "const Effect = ") // a local Effect keeps its own Array
			if !local && strings.HasSuffix(name, ".js") && strings.Contains(text, "Effect.Array") {
				Gap(t, parallelLoweringTarget, "feature:member:"+key, "Chapter 5: %q; %s keeps the member:\n%s", parallelLoweringQuote, name, text)
			}
		}
		ExpectPending(t, parallelLoweringTarget, "feature:outputs:"+key)
		ExpectPending(t, parallelLoweringTarget, "feature:member:"+key)
	})
}
