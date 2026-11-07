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

const implicitDefectBridgeQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestImplicitGeneratorDefectBridgeQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), implicitDefectBridgeQuote) {
		t.Fatal("missing preserving quick-fix rule")
	}
	if !strings.Contains(SpecText("007-tooling.md"), "The inline catch mapper provably cannot throw and preserves the exact thrown value as a defect.") {
		t.Fatal("missing native defect identity rule")
	}
}

// Every generated synchronous defect bridge compiles with zero
// diagnostics and retains the stock Effect Exit (proxy ruling, 2026-11-04).
func FuzzImplicitGeneratorDefectBridge(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("007-tooling.md"), implicitDefectBridgeQuote) {
		f.Fatal("missing preserving quick-fix rule")
	}
	for mode := uint8(0); mode < 3; mode++ {
		for kind := uint8(0); kind < 45; kind++ {
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
		const target = "FuzzImplicitGeneratorDefectBridge"
		prefix := "import { Effect } from \"effect\"\nimport { log } from \"./foreign.js\"\n"
		if existing {
			prefix += "import { identity as preserve } from \"effect/Function\"\nvoid preserve\n"
		}
		value := []string{"undefined", "\"ok\"", "\"primitive\"", "\"object\"", "\"error\""}[kind%5]
		// Both sides inspect the Exit and compare the very same thrown object,
		// not just its serialized shape.
		safe := kind/15%3 == 1
		annotation := ""
		if safe {
			annotation = "/** @throws {never} */ "
		} else if kind/15%3 == 2 {
			annotation = "/** @throws {unknown} */ "
		}
		implementation := "if(value==='primitive')throw 7;if(value==='object')throw marker;if(value==='error')throw new Error('boom');return value.length"
		if safe {
			implementation = "return value.length"
		}
		foreign := "export const marker={defect:true};function record(value:string):number{" + implementation + "}\n" +
			"export const log={\n" + annotation + "info(value:string):number{return record(value)},Box:class{readonly value:number;\n" + annotation + "constructor(value:string){this.value=record(value)}},\n" + annotation + "tag(parts:TemplateStringsArray,value:string):number{return record(value)}}\n"
		stockBody := "export const work = (x: string | undefined) => Effect.gen(function* () { if (x) log.info(x); return 1 })\n"
		sourceBody := "export const work = effect (x: string | undefined) => { if (x) log.info(x); return 1 }\n"
		switch mode % 3 {
		case 1:
			sourceBody = stockBody
		case 2:
			prefix += "import { trusted } from \"vibelang-runtime\"\n"
			sourceBody = "const info = trusted(log.info, [])\nexport const work = effect (x: string | undefined) => { if (x) info(x); return 1 }\n"
		}
		invocation := []string{"log.info(x)", "new log.Box(x).value", "log.tag`${x}`"}[kind/5%3]
		stockBody = strings.ReplaceAll(stockBody, "log.info(x)", invocation)
		sourceBody = strings.ReplaceAll(sourceBody, "log.info(x)", invocation)
		runner := fmt.Sprintf("import { Cause, Effect, Exit } from \"effect\"\nimport { marker } from \"./foreign.js\"\nimport { work } from \"./main.js\"\nexport const main = () => Effect.map(Effect.exit(work(%s)), ex => Exit.isSuccess(ex) ? { exit: \"success\", value: ex.value } : { exit: \"failure\", reasons: ex.cause.reasons.map(r => r._tag), same: Cause.squash(ex.cause) === marker, value: String(Cause.squash(ex.cause)) })\n", value)
		toolsGuard(t, target, func() {
			stock := toolsCompile(t, w, target, map[string]string{"main.ts": prefix + stockBody, "foreign.ts": foreign, "runner.ts": runner})
			defer stock.Remove()
			if len(stock.Diagnostics) != 0 {
				t.Fatalf("stock diagnostics: %v", SortedKeys(Keys(stock.Dir, stock.Diagnostics)))
			}
			sourcePrefix := prefix
			if mode%3 == 1 {
				sourcePrefix = strings.Replace(prefix, "import { Effect } from \"effect\"\n", "", 1)
			}
			files := map[string]string{"main.vibe": sourcePrefix + sourceBody, "foreign.ts": foreign, "runner.ts": runner}
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
			hasBridge := strings.Contains(text, "catch: (e) => e")
			requiredBridge := mode%3 == 2 || !safe
			forbiddenBridge := safe && mode%3 != 2
			if requiredBridge && !hasBridge || forbiddenBridge && hasBridge || strings.Count(text, "effect/Function") != strings.Count(prefix, "effect/Function") {
				t.Fatalf("missing inline bridge or changed imports:\n%s", text)
			}
			after := toolsCompile(t, w, target, fixed)
			defer after.Remove()
			if len(after.Diagnostics) != 0 {
				t.Fatalf("generated bridge diagnostics: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), text)
			}
			if mismatch := toolsContractMismatch(t, w, stock, after, false); mismatch != "" {
				t.Fatalf("native contract changed: %s", mismatch)
			}
			was, is := node.Run(stock, "out/runner.js", "main"), node.Run(after, "out/runner.js", "main")
			if toolsInvalidOutcome(was) || toolsInvalidOutcome(is) || was.Kind != is.Kind || string(was.Value) != string(is.Value) {
				t.Fatalf("Exit changed: stock=%+v fixed=%+v\n%s", was, is, text)
			}
			againConfig := toolsConfig(w, after.Dir)
			again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), againConfig, vibelang.FixOptions{})
			if again.Err != nil || len(again.Refused) != 0 {
				t.Fatalf("second fix: %v; refused: %v", again.Err, again.Refused)
			}
			for name, file := range again.Files {
				relative := strings.TrimPrefix(name.AsString(), filepath.ToSlash(after.Dir)+"/")
				if prior, ok := fixed[relative]; ok && file.Text != prior {
					t.Fatalf("bridge changed on the second fix: %s", relative)
				}
			}
		})
	})
}
