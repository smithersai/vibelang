package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const inferredEffectDeclarationTarget = "FuzzInferredEffectDeclaration"

func TestInferredEffectDeclarationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), migrationDefaultProgramQuote) {
		t.Fatalf("Chapter 1 no longer says %q", migrationDefaultProgramQuote)
	}
}

// OpenCode's workerd entry imports Layer, while only a native helper names
// Effect. Compare the exported API of native declarations across factories, function shapes
// and authored imports; do not replace import types by equivalent aliases.
func FuzzInferredEffectDeclaration(f *testing.F) {
	startShortBudget(f)
	for family := uint8(0); family < 4; family++ {
		f.Add(family, family%3, family%3)
		if !testing.Short() || toolsFuzzing() {
			for shape := uint8(0); shape < 3; shape++ {
				for style := uint8(0); style < 3; style++ {
					f.Add(family, shape, style)
				}
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, family, shape, style uint8) {
		TestInferredEffectDeclarationQuoted(t)
		factories := []string{`Effect.succeed(1)`, `Effect.fail("failed" as const)`, `Effect.never`, `Effect.sync(() => [1, "two"] as const)`}
		imports := []string{`import { Layer } from "effect"`, `import * as L from "effect/Layer"`, `import { Layer as L } from "effect"`}
		name := "L"
		if style%3 == 0 {
			name = "Layer"
		}
		functions := []string{`export const create = () => make()`, `export function create() { return make() }`, `export const service = { create() { return make() } }`}
		main := imports[style%3] + "\nimport { make } from \"./helper.js\"\n" + functions[shape%3] + "\nexport const empty = " + name + ".empty\n"
		helper := "import { Effect } from \"effect\"\nexport const make = () => " + factories[family%4] + "\n"
		original := toolsCompile(t, w, inferredEffectDeclarationTarget, map[string]string{"main.ts": main, "helper.ts": helper})
		defer original.Remove()
		if !toolsErrorFree(original) {
			t.Fatalf("native source must compile: %v", SortedKeys(Keys(original.Dir, original.Diagnostics)))
		}
		candidate := toolsCompile(t, w, inferredEffectDeclarationTarget, map[string]string{"main.vibe": main, "helper.ts": helper})
		defer candidate.Remove()
		key := fmt.Sprintf("inferred-effect:%d:%d:%d", family%4, shape%3, style%3)
		if !toolsErrorFree(candidate) {
			Gap(t, inferredEffectDeclarationTarget, key, "source rename must compile: %v", SortedKeys(Keys(candidate.Dir, candidate.Diagnostics)))
		}
		declaration := func(r *Result) string {
			for path, text := range r.Outputs {
				if strings.HasSuffix(path, "/main.d.ts") {
					return text
				}
			}
			t.Fatal("main.d.ts was not emitted")
			return ""
		}
		want, got := declaration(original), declaration(candidate)
		if diff := compareDeclarationResults(t, original, candidate); diff != "" {
			Gap(t, inferredEffectDeclarationTarget, key, "Chapter 1: %q\nnative:\n%s\nvibe:\n%s\nsource:\n%s\nAPI:\n%s", migrationDefaultProgramQuote, want, got, main, diff)
		}
	})
}
