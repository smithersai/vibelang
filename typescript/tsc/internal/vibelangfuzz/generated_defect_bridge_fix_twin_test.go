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

// Every generated synchronous defect bridge compiles with zero
// diagnostics and retains the stock Effect Exit (proxy ruling, 2026-11-04).
func FuzzGeneratedDefectBridgeFixTwin(f *testing.F) {
	startShortBudget(f)
	for mode := uint8(0); mode < 3; mode++ {
		for kind := uint8(0); kind < 5; kind++ {
			f.Add(mode, kind, false)
			f.Add(mode, kind, true)
		}
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, mode, kind uint8, existing bool) {
		// rule-evidence: docs/design/src/007-tooling.md#5f8d3350ff4ea0f0
		const target = "FuzzGeneratedDefectBridgeFixTwin"
		prefix := "import { Effect } from \"effect\"\nimport { log } from \"./foreign.js\"\n"
		if existing {
			prefix += "import { identity as preserve } from \"effect/Function\"\nvoid preserve\n"
		}
		value := []string{"undefined", "\"ok\"", "\"primitive\"", "\"object\"", "\"error\""}[kind%5]
		// Both sides inspect the Exit and compare the very same thrown object,
		// not just its serialized shape.
		foreign := "export const marker = { defect: true }\nexport const log = { info(value: string) { if (value === \"primitive\") throw 7; if (value === \"object\") throw marker; if (value === \"error\") throw new Error(\"boom\"); return value.length } }\n"
		stockBody := "export const work = (x: string | undefined) => Effect.gen(function* () { if (x) log.info(x); return 1 })\n"
		sourceBody := "export const work = effect (x: string | undefined) => { if (x) log.info(x); return 1 }\n"
		switch mode % 3 {
		case 1:
			sourceBody = stockBody
		case 2:
			prefix += "import { trusted } from \"vibelang-runtime\"\n"
			sourceBody = "const info = trusted(log.info, [])\nexport const work = effect (x: string | undefined) => { if (x) info(x); return 1 }\n"
		}
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
			if !strings.Contains(text, "catch: (e) => e") || strings.Count(text, "effect/Function") != strings.Count(prefix, "effect/Function") {
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
