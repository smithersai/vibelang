package vibelangfuzz

import (
	"fmt"
	"hash/fnv"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// pipeStageBridgePipelines place a stage {s} that a foreign call builds in a
// generator's pipe: alone, before a custom stage, after a standard one, and in
// a held program.
var pipeStageBridgePipelines = map[string]string{
	"alone":           "return yield* e.pipe({s})",
	"before-custom":   "return yield* e.pipe({s}, mapErrors)",
	"after-standard":  "return yield* e.pipe(Effect.map((n: number) => n + 1), {s})",
	"between":         "return yield* e.pipe(Effect.map((n: number) => n + 1), {s}, mapErrors)",
	"held":            "const p = e.pipe({s})\n  return yield* p",
	"statement-value": "const n = yield* e.pipe({s})\n  return n + 1",
}

// pipeStageBridgeStages build the stage through a foreign function or method.
var pipeStageBridgeStages = map[string]string{"function": "provide(s)", "method": "stages.provide(s)"}

// pipeStageBridgeHosts hold the generator: an arrow's body, a curried arrow's
// body, or Effect.fnUntraced.
var pipeStageBridgeHosts = map[string][2]string{
	"arrow":   {"export const work = (e: Effect.Effect<number>, s: string) => Effect.gen(function* () {\n  ", "\n})\n"},
	"curried": {"export const work = (e: Effect.Effect<number>, s: string) => ((t: string) => Effect.gen(function* () {\n  ", "\n}))(s)\n"},
	"fn":      {"export const work = Effect.fnUntraced(function* (e: Effect.Effect<number>, s: string) {\n  ", "\n})\n"},
}

// FuzzGeneratorDefectBridgePipeStage: EK1002's fix of a generator whose pipe
// stage a foreign call builds converts the generator, compiles with zero
// diagnostics and keeps the stock Effect Exit, the same oracle as
// FuzzImplicitGeneratorDefectBridge. The key is pipeline/stage/host.
func FuzzGeneratorDefectBridgePipeStage(f *testing.F) {
	startShortBudget(f)
	for _, pipeline := range slices.Sorted(maps.Keys(pipeStageBridgePipelines)) {
		for _, host := range slices.Sorted(maps.Keys(pipeStageBridgeHosts)) {
			f.Add(pipeline+"/function/"+host, uint8(1))
		}
		f.Add(pipeline+"/method/arrow", uint8(0))
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string, input uint8) {
		// rule-evidence: docs/design/src/007-tooling.md#5f8d3350ff4ea0f0
		const target = "FuzzGeneratorDefectBridgePipeStage"
		pipeline, stage, host := pipeStageBridgeKey(key)
		value := []string{"\"ok\"", "\"bad\""}[input%2]
		body := strings.ReplaceAll(pipeStageBridgePipelines[pipeline], "{s}", pipeStageBridgeStages[stage])
		native := pipeStageBridgeHosts[host][0] + body + pipeStageBridgeHosts[host][1]
		imports := "import { provide, stages } from \"./foreign.js\"\nconst mapErrors = <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.orDie(self)\n"
		foreign := "import { Effect } from \"effect\"\nexport const marker = { defect: true }\n" +
			"export const provide = (s: string) => <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => { if (s === \"bad\") throw marker; return self }\n" +
			"export const stages = { provide }\n"
		runner := fmt.Sprintf("import { Cause, Effect, Exit } from \"effect\"\nimport { marker } from \"./foreign.js\"\nimport { work } from \"./main.js\"\nexport const main = () => Effect.map(Effect.exit(work(Effect.succeed(2), %s)), ex => Exit.isSuccess(ex) ? { exit: \"success\", value: ex.value } : { exit: \"failure\", reasons: ex.cause.reasons.map(r => r._tag), same: Cause.squash(ex.cause) === marker })\n", value)
		toolsGuard(t, target, func() {
			stock := toolsCompile(t, w, target, map[string]string{"main.ts": "import { Effect } from \"effect\"\n" + imports + native, "foreign.ts": foreign, "runner.ts": runner})
			defer stock.Remove()
			if len(stock.Diagnostics) != 0 {
				t.Fatalf("stock diagnostics: %v\n%s", SortedKeys(Keys(stock.Dir, stock.Diagnostics)), native)
			}
			files := map[string]string{"main.vibe": imports + native, "foreign.ts": foreign, "runner.ts": runner}
			before := toolsCompile(t, w, target, files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if config == nil || len(config.Errors) != 0 {
				t.Fatal("invalid fix configuration")
			}
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			if result.Err != nil {
				t.Fatalf("fix: %v", result.Err)
			}
			for _, refusal := range result.Refused {
				if refusal.Code == 1002 || strings.Contains(refusal.Error, "EK0403") {
					t.Fatalf("refused: %+v\n%s", refusal, native)
				}
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			text := fixed["main.vibe"]
			if strings.Contains(text, "function*") || !strings.Contains(text, "provide(s), catch: (e) => e") {
				t.Fatalf("the generator or its stage kept its native form:\n%s", text)
			}
			after := toolsCompile(t, w, target, fixed)
			defer after.Remove()
			if len(after.Diagnostics) != 0 {
				t.Fatalf("fixed diagnostics: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), text)
			}
			if mismatch := toolsContractMismatch(t, w, stock, after, false); mismatch != "" {
				t.Fatalf("native contract changed: %s\n%s", mismatch, text)
			}
			was, is := node.Run(stock, "out/runner.js", "main"), node.Run(after, "out/runner.js", "main")
			if toolsInvalidOutcome(was) || toolsInvalidOutcome(is) || was.Kind != is.Kind || string(was.Value) != string(is.Value) {
				t.Fatalf("Exit changed: stock=%+v fixed=%+v\n%s", was, is, text)
			}
		})
	})
}

// pipeStageBridgeKey reads pipeline/stage/host, and maps any other input onto
// the lists by its hash, so a saved file keeps naming the construct it tests.
func pipeStageBridgeKey(key string) (pipeline, stage, host string) {
	parts := strings.Split(key, "/")
	pick := func(i int, names []string) string {
		if i < len(parts) && slices.Contains(names, parts[i]) {
			return parts[i]
		}
		h := fnv.New32a()
		fmt.Fprintf(h, "%d:%s", i, key)
		return names[int(h.Sum32()%uint32(len(names)))]
	}
	return pick(0, slices.Sorted(maps.Keys(pipeStageBridgePipelines))), pick(1, slices.Sorted(maps.Keys(pipeStageBridgeStages))), pick(2, slices.Sorted(maps.Keys(pipeStageBridgeHosts)))
}
