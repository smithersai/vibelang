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

// predicateBridgeShapes test a foreign type predicate {t} in an if, then read
// what it proved, {u}: in the branch, after a negated early return, or in the
// else of a negated test.
var predicateBridgeShapes = map[string]string{
	"early-return": "if (!{t}) return 0\n  return {u}",
	"positive":     "if ({t}) {\n    return {u}\n  }\n  return 0",
	"else":         "if (!{t}) {\n    return 0\n  } else {\n    return {u}\n  }",
	"after-yield":  "yield* Effect.void\n  if (!{t}) return 0\n  const n = {u}\n  return n",
}

var predicateBridgeTests = map[string]string{"function": "isText({v})", "method": "guards.isText({v})"}

// predicateBridgeBindings name the tested value: the parameter, or a const.
var predicateBridgeBindings = map[string][2]string{"parameter": {"", "v"}, "const": {"const w = v\n  ", "w"}}

// FuzzGeneratorDefectBridgePredicate: EK1002's fix of a generator that tests a
// foreign type predicate keeps the predicate's proof, compiles with zero
// diagnostics and keeps the stock Effect Exit, the same oracle as
// FuzzImplicitGeneratorDefectBridge. The key is shape/test/binding.
func FuzzGeneratorDefectBridgePredicate(f *testing.F) {
	startShortBudget(f)
	for _, shape := range slices.Sorted(maps.Keys(predicateBridgeShapes)) {
		for _, test := range slices.Sorted(maps.Keys(predicateBridgeTests)) {
			f.Add(shape+"/"+test+"/parameter", uint8(0))
		}
		f.Add(shape+"/function/const", uint8(1))
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string, input uint8) {
		// rule-evidence: docs/design/src/007-tooling.md#4aeb8089114b40e0
		const target = "FuzzGeneratorDefectBridgePredicate"
		shape, test, binding := predicateBridgeKey(key)
		value := []string{"\"ok\"", "\"bad\"", "7"}[input%3]
		bind := predicateBridgeBindings[binding]
		replace := strings.NewReplacer("{t}", predicateBridgeTests[test], "{u}", "size({v})")
		body := strings.ReplaceAll(replace.Replace(predicateBridgeShapes[shape]), "{v}", bind[1])
		native := "export const work = (v: unknown) => Effect.gen(function* () {\n  " + bind[0] + body + "\n})\n"
		imports := "import { guards, isText, size } from \"./foreign.js\"\n"
		foreign := "export const marker = { defect: true }\n" +
			"export function isText(x: unknown): x is string { if (x === \"bad\") throw marker; return typeof x === \"string\" }\n" +
			"export const guards = { isText }\n" +
			"export function size(value: string): number { return value.length }\n"
		runner := fmt.Sprintf("import { Cause, Effect, Exit } from \"effect\"\nimport { marker } from \"./foreign.js\"\nimport { work } from \"./main.js\"\nexport const main = () => Effect.map(Effect.exit(work(%s)), ex => Exit.isSuccess(ex) ? { exit: \"success\", value: ex.value } : { exit: \"failure\", reasons: ex.cause.reasons.map(r => r._tag), same: Cause.squash(ex.cause) === marker })\n", value)
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
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("fix: %v; refused: %v\n%s", result.Err, result.Refused, native)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			text := fixed["main.vibe"]
			if strings.Contains(text, "function*") || !strings.Contains(text, " ? "+bind[1]+" : undefined, catch: (e) => e") {
				t.Fatalf("the generator or its predicate kept its native form:\n%s", text)
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

// predicateBridgeKey reads shape/test/binding, and maps any other input onto
// the lists by its hash, so a saved file keeps naming the construct it tests.
func predicateBridgeKey(key string) (shape, test, binding string) {
	parts := strings.Split(key, "/")
	pick := func(i int, names []string) string {
		if i < len(parts) && slices.Contains(names, parts[i]) {
			return parts[i]
		}
		h := fnv.New32a()
		fmt.Fprintf(h, "%d:%s", i, key)
		return names[int(h.Sum32()%uint32(len(names)))]
	}
	return pick(0, slices.Sorted(maps.Keys(predicateBridgeShapes))), pick(1, slices.Sorted(maps.Keys(predicateBridgeTests))), pick(2, slices.Sorted(maps.Keys(predicateBridgeBindings)))
}
