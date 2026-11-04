package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Predicate narrowing compiles with zero diagnostics and its Exit equals
// the gen twin for throwing and non-throwing predicates (proxy ruling, 2026-11-04).
func FuzzForeignPredicateFixTwin(f *testing.F) {
	startShortBudget(f)
	for mode := uint8(0); mode < 3; mode++ {
		for kind := uint8(0); kind < 7; kind++ {
			f.Add(mode, kind)
		}
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, mode, kind uint8) {
		const target = "FuzzForeignPredicateFixTwin"
		prefix := "import { Effect } from \"effect\"\nimport { isResolved } from \"./foreign.js\"\n"
		value := []string{"undefined", "\"\"", "\"ok\"", "\"primitive\"", "\"object\"", "\"error\"", "\"throw-undefined\""}[kind%7]
		foreign := "export const marker = { defect: true }\nexport function isResolved(value: string | undefined): value is string { if (value === \"primitive\") throw 7; if (value === \"object\") throw marker; if (value === \"error\") throw new Error(\"boom\"); if (value === \"throw-undefined\") throw undefined; return value !== undefined }\n"
		body := "if (!isResolved(x)) return -1; const narrowed: string = x; return narrowed.length"
		if mode%3 == 1 {
			body = "if (isResolved(x)) { const narrowed: string = x; return narrowed.length }; return -1"
		}
		if mode%3 == 2 {
			body = "const saved = keep(); if (!isResolved(x)) return -1; function keep(): string | undefined { return x }; const narrowed: string = x; return narrowed.length + (saved === undefined ? 0 : saved.length)"
		}
		stockBody := "export const work = (x: string | undefined) => Effect.gen(function* () { " + body + " })\n"
		sourceBody := "export const work = effect (x: string | undefined): number!! => { " + body + " }\n"
		runner := fmt.Sprintf("import { Cause, Effect, Exit } from \"effect\"\nimport { marker } from \"./foreign.js\"\nimport { work } from \"./main.js\"\nexport const main = () => Effect.map(Effect.exit(work(%s)), ex => Exit.isSuccess(ex) ? { exit: \"success\", value: ex.value } : { exit: \"failure\", reasons: ex.cause.reasons.map(r => r._tag), same: Cause.squash(ex.cause) === marker, value: String(Cause.squash(ex.cause)) })\n", value)
		toolsGuard(t, target, func() {
			stock := toolsCompile(t, w, target, map[string]string{"main.ts": prefix + stockBody, "foreign.ts": foreign, "runner.ts": runner})
			defer stock.Remove()
			if len(stock.Diagnostics) != 0 {
				t.Fatalf("stock diagnostics: %v", SortedKeys(Keys(stock.Dir, stock.Diagnostics)))
			}
			files := map[string]string{"main.vibe": prefix + sourceBody, "foreign.ts": foreign, "runner.ts": runner}
			before := toolsCompile(t, w, target, files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if config == nil || len(config.Errors) != 0 {
				t.Fatal("invalid fix configuration")
			}
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("fix: %v; refused: %v", result.Err, result.Refused)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			text := fixed["main.vibe"]
			if !strings.Contains(text, "catch: (e) => e") || !strings.Contains(text, "? x : undefined") {
				t.Fatalf("missing inline bridge or changed imports:\n%s", text)
			}
			after := toolsCompile(t, w, target, fixed)
			defer after.Remove()
			if len(after.Diagnostics) != 0 {
				t.Fatalf("generated bridge diagnostics: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), text)
			}
			was, is := node.Run(stock, "out/runner.js", "main"), node.Run(after, "out/runner.js", "main")
			if toolsInvalidOutcome(was) || toolsInvalidOutcome(is) || was.Kind != is.Kind || string(was.Value) != string(is.Value) {
				t.Fatalf("Exit changed: stock=%+v fixed=%+v\n%s", was, is, text)
			}
		})
	})
}
