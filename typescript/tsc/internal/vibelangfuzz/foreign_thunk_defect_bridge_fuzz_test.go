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

const foreignThunkAdmitQuote = "`promise` does not admit that throwing thunk"

// A TypeScript function passed straight to Effect.promise or Effect.sync is
// EK0402 (chapter 003), and --fix writes the explicit defect bridge. The
// fixed program compiles with zero diagnostics, declares what the stock twin
// declares, and keeps its Exit: the same value, or the same thrown object as
// a defect. kind encodes the API (promise, sync), the callee's shape and what
// it does (return, throw a primitive, throw a marker object, throw an Error).
func FuzzForeignThunkDefectBridge(f *testing.F) {
	startShortBudget(f)
	for kind := uint8(0); kind < 32; kind++ {
		f.Add(uint8(0), kind)
		if !testing.Short() || toolsFuzzing() {
			f.Add(uint8(1), kind)
			f.Add(uint8(2), kind)
		}
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, mode, kind uint8) {
		// rule-evidence: docs/design/src/003-failures.md#plain-code-never-throws docs/design/src/007-tooling.md#5f8d3350ff4ea0f0
		const target = "FuzzForeignThunkDefectBridge"
		if !strings.Contains(SpecText("003-failures.md"), foreignThunkAdmitQuote) || !strings.Contains(SpecText("007-tooling.md"), implicitDefectBridgeQuote) {
			t.Fatal("missing thunk admission or preserving quick-fix rule")
		}
		promise := kind%2 == 0
		value := []string{"\"ok\"", "\"primitive\"", "\"object\"", "\"error\""}[kind/8%4]
		record := "export const marker={defect:true};function record(value:string):number{if(value==='primitive')throw 7;if(value==='object')throw marker;if(value==='error')throw new Error('boom');return value.length}\n"
		var callee, api string
		if promise {
			api = "promise"
			callee = []string{
				"export async function run(): Promise<number> { return record(" + value + ") }\n",
				"export function run(): Promise<number> { const n = record(" + value + "); return Promise.resolve(n) }\n",
				"export const run = async (): Promise<number> => record(" + value + ")\n",
				"export function run(signal: AbortSignal): Promise<number> { return Promise.resolve(signal.aborted ? -1 : record(" + value + ")) }\n",
			}[kind/2%4]
		} else {
			api = "sync"
			callee = []string{
				"export function run(): number { return record(" + value + ") }\n",
				"export const run = (): number => record(" + value + ")\n",
				"export function run(prefix?: string): number { return record(prefix ?? " + value + ") }\n",
				"export function run(this: void): number { return record(" + value + ") }\n",
			}[kind/2%4]
		}
		foreign := record + callee
		body := "import { Effect } from \"effect\"\nimport { run } from \"./foreign.js\"\nexport const work = Effect." + api + "(run)\n"
		runner := "import { Cause, Effect, Exit } from \"effect\"\nimport { marker } from \"./foreign.js\"\nimport { work } from \"./main.js\"\nexport const main = () => Effect.map(Effect.exit(work), ex => Exit.isSuccess(ex) ? { exit: \"success\", value: ex.value } : { exit: \"failure\", reasons: ex.cause.reasons.map(r => r._tag), same: Cause.squash(ex.cause) === marker, value: String(Cause.squash(ex.cause)) })\n"
		options := []vibelang.FixOptions{{}, {MigrationOnly: true}, {VIPOnly: true}}[mode%3]
		toolsGuard(t, target, func() {
			stock := toolsCompile(t, w, target, map[string]string{"main.ts": body, "foreign.ts": foreign, "runner.ts": runner})
			defer stock.Remove()
			if len(stock.Diagnostics) != 0 {
				t.Fatalf("stock diagnostics: %v", SortedKeys(Keys(stock.Dir, stock.Diagnostics)))
			}
			files := map[string]string{"main.vibe": body, "foreign.ts": foreign, "runner.ts": runner}
			before := toolsCompile(t, w, target, files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if config == nil || len(config.Errors) != 0 {
				t.Fatal("invalid fix configuration")
			}
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, options)
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("mode=%d kind=%d fix: %v; refused: %v\nforeign:\n%s", mode%3, kind, result.Err, result.Refused, foreign)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			text := fixed["main.vibe"]
			if !strings.Contains(text, "Effect.orDie(Effect.") || !strings.Contains(text, "catch: (e) => e") {
				t.Fatalf("no defect bridge:\n%s", text)
			}
			after := toolsCompile(t, w, target, fixed)
			defer after.Remove()
			if len(after.Diagnostics) != 0 {
				t.Fatalf("generated bridge diagnostics: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), text)
			}
			if mismatch := toolsContractMismatch(t, w, stock, after, false); mismatch != "" {
				t.Fatalf("declaration changed: %s\n%s", mismatch, text)
			}
			was, is := node.Run(stock, "out/runner.js", "main"), node.Run(after, "out/runner.js", "main")
			if toolsInvalidOutcome(was) || toolsInvalidOutcome(is) || was.Kind != is.Kind || string(was.Value) != string(is.Value) {
				t.Fatal(fmt.Sprintf("Exit changed: stock=%+v fixed=%+v\n%s", was, is, text))
			}
			again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), options)
			if again.Err != nil || len(again.Refused) != 0 {
				t.Fatalf("second fix: %v; refused: %v", again.Err, again.Refused)
			}
			for name, file := range again.Files {
				if relative := strings.TrimPrefix(name.AsString(), filepath.ToSlash(after.Dir)+"/"); fixed[relative] != "" && fixed[relative] != file.Text {
					t.Fatalf("bridge changed on the second fix: %s", relative)
				}
			}
		})
	})
}
