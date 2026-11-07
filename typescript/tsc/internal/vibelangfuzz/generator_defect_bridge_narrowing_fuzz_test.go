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

// narrowedBridgeShapes are the places a guard proves a property that a
// generator's throwing call reads: in the call's own expression, or in an
// earlier statement, an enclosing block, an unbraced branch or an else.
// {c} is the guard, {n} its negation, {i} the invocation.
var narrowedBridgeShapes = map[string]string{
	"ternary":      "return {c} ? {i} : 0",
	"and":          "return ({c} && {i} > 0) ? 1 : 0",
	"or":           "return ({n} || {i} > 0) ? 1 : 0",
	"if-block":     "if ({c}) {\n    const r = {i}\n    return r\n  }\n  return 0",
	"early-return": "if ({n}) return 0\n  return {i}",
	"unbraced":     "let r = 0\n  if ({c}) r = {i}\n  return r",
	"else":         "let r = 0\n  if ({n}) r = 1\n  else r = {i}\n  return r",
	"same-line":    "if ({c}) { const r = {i}; return r }\n  return 0",
	"after-yield":  "yield* Effect.void\n  if ({n}) return 0\n  const r = {i}\n  return r",
}

// narrowedBridgeGuards prove the property a string, each with its negation.
var narrowedBridgeGuards = map[string][2]string{
	"truthy":  {"{p}", "!{p}"},
	"defined": {"{p} !== undefined", "{p} === undefined"},
	"typeof":  {"typeof {p} === \"string\"", "typeof {p} !== \"string\""},
	"nonnull": {"{p} != null", "{p} == null"},
}

// narrowedBridgeCalls read the property through a foreign function nothing
// says the exceptions of.
var narrowedBridgeCalls = map[string]string{
	"function": "size({p})",
	"method":   "log.size({p})",
	"two":      "log.join({p}, {p})",
}

var narrowedBridgePaths = map[string]string{"property": "o.p", "nested": "o.inner.p"}

// FuzzGeneratorDefectBridgeNarrowing: EK1002's fix of a generator whose foreign
// call reads a property a guard proved compiles with zero diagnostics and keeps
// the stock Effect Exit, the same oracle as FuzzImplicitGeneratorDefectBridge.
// The key is shape/guard/call/path; opencode's ai protocols kept their
// generators over the ternary and if shapes (TS2345 in the wrapper's function).
func FuzzGeneratorDefectBridgeNarrowing(f *testing.F) {
	startShortBudget(f)
	for _, shape := range sortedNames(narrowedBridgeShapes) {
		for _, guard := range sortedNames(narrowedBridgeGuards) {
			f.Add(shape+"/"+guard+"/method/property", uint8(0))
		}
		f.Add(shape+"/defined/two/nested", uint8(2))
		f.Add(shape+"/truthy/function/property", uint8(1))
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string, input uint8) {
		// rule-evidence: docs/design/src/007-tooling.md#5f8d3350ff4ea0f0
		const target = "FuzzGeneratorDefectBridgeNarrowing"
		shape, guard, call, path := narrowedBridgeKey(key)
		value := []string{"undefined", "\"ok\"", "\"error\""}[input%3]
		p := narrowedBridgePaths[path]
		replace := strings.NewReplacer("{c}", narrowedBridgeGuards[guard][0], "{n}", narrowedBridgeGuards[guard][1], "{i}", narrowedBridgeCalls[call])
		body := strings.ReplaceAll(replace.Replace(narrowedBridgeShapes[shape]), "{p}", p)
		param := "o: { readonly p?: string; readonly inner: { readonly p?: string } }"
		native := "export const work = Effect.fnUntraced(function* (" + param + ") {\n  " + body + "\n})\n"
		imports := "import { log, size } from \"./foreign.js\"\n"
		foreign := "export const marker = { defect: true }\n" +
			"function record(value: string): number { if (value === \"error\") throw marker; return value.length }\n" +
			"export function size(value: string): number { return record(value) }\n" +
			"export const log = { size(value: string): number { return record(value) }, join(a: string, b: string): number { return record(a) + record(b) } }\n"
		runner := fmt.Sprintf("import { Cause, Effect, Exit } from \"effect\"\nimport { marker } from \"./foreign.js\"\nimport { work } from \"./main.js\"\nconst p = %s\nexport const main = () => Effect.map(Effect.exit(work({ p, inner: { p } })), ex => Exit.isSuccess(ex) ? { exit: \"success\", value: ex.value } : { exit: \"failure\", reasons: ex.cause.reasons.map(r => r._tag), same: Cause.squash(ex.cause) === marker })\n", value)
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
			if strings.Contains(text, "function*") || !strings.Contains(text, "catch: (e) => e") {
				t.Fatalf("the generator or its call kept its native form:\n%s", text)
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

// narrowedBridgeKey reads shape/guard/call/path, and maps any other input onto
// the lists by its hash, so a saved file keeps naming the construct it tests.
func narrowedBridgeKey(key string) (shape, guard, call, path string) {
	parts := strings.Split(key, "/")
	pick := func(i int, names []string) string {
		if i < len(parts) {
			for _, name := range names {
				if parts[i] == name {
					return name
				}
			}
		}
		h := fnv.New32a()
		fmt.Fprintf(h, "%d:%s", i, key)
		return names[int(h.Sum32()%uint32(len(names)))]
	}
	return pick(0, sortedNames(narrowedBridgeShapes)), pick(1, sortedNames(narrowedBridgeGuards)), pick(2, sortedNames(narrowedBridgeCalls)), pick(3, sortedNames(narrowedBridgePaths))
}

// sortedNames returns m's keys in order.
func sortedNames[V any](m map[string]V) []string {
	return slices.Sorted(maps.Keys(m))
}
