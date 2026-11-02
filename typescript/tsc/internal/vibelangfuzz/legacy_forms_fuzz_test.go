package vibelangfuzz

import (
	"encoding/json"
	"maps"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// FuzzVIPLegacyForms checks --fix-vip-only on the pre-VIP-1 forms whose only
// Effect operation is not a call: a catch expression, and a function literal
// passed where a program is expected (foldkit-130, foldkit-131,
// foldkit-17067). Decided detail 274: "A legacy migration preserves the old
// call's result/run phase". Before VIP-1 a catch compiled to
// $catchExpression(() => left, handler), a program that builds its left side
// each time it runs, and a literal at a program position was the program it
// holds (D7, D44). The migrated program must compile without a refusal, and
// main's result, two runs of the owner and the trace their side effects
// write, must be what that model says (legacyFormWant), not merely what the
// migration's own spelling gives.
//
// An input is "<owner>:<operand>:<handler>" for a catch, or
// "argument:<body>" for a literal; other bytes pick by index. Corpus files
// foldkit-* hold the repository's patterns.
func FuzzVIPLegacyForms(f *testing.F) {
	startShortBudget(f)
	for _, owner := range legacyFormOwnerKeys() {
		for _, operand := range legacyFormOperandKeys() {
			f.Add([]byte(owner + ":" + operand + ":plain"))
		}
	}
	for _, handler := range legacyFormHandlerKeys() {
		f.Add([]byte("infer-factory:effect-block:" + handler))
	}
	for _, shape := range slices.Sorted(maps.Keys(legacyFormFallbacks)) {
		f.Add([]byte("fallback:" + shape))
	}
	for _, body := range slices.Sorted(maps.Keys(legacyFormArguments)) {
		f.Add([]byte("argument:" + body))
	}
	env := newVIPEnv(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key, source, want := legacyFormInput(data)
		if source == "" {
			t.Skip("the input names no form")
		}
		files := map[string]string{"main.vibe": source}
		old := legacyCompile(t, env, files)
		defer old.Remove()
		config := toolsConfig(env.w, old.Dir)
		if config == nil || len(config.Errors) > 0 {
			t.Fatalf("config of the legacy program: %v", config)
		}
		var result *vibelang.FixResult
		Within("fix", func() {
			result = vibelang.FixProjectWithOptions(t.Context(), env.w.fs, bundled.LibPath(), config, vibelang.FixOptions{VIPOnly: true})
		})
		var report strings.Builder
		result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
		if result.Err != nil || len(result.Refused) > 0 {
			Gap(t, "FuzzVIPLegacyForms", "refused/"+key, "--fix-vip-only refused or did not converge (%v):\n%s\nlegacy:\n%s", result.Err, report.String(), source)
		}
		fixed := maps.Clone(files)
		for _, file := range result.Files {
			fixed["main.vibe"] = file.Text
		}
		after := legacyCompile(t, env, fixed)
		defer after.Remove()
		if errors := legacyErrors(after); len(errors) > 0 {
			Gap(t, "FuzzVIPLegacyForms", "compile/"+key, "the migrated program does not compile: %s\nmigrated:\n%s\nlegacy:\n%s", strings.Join(errors, "\n"), fixed["main.vibe"], source)
		}
		got := env.node.RunVIP(after, "out/main.js")
		var exit struct {
			Tag   string          `json:"_tag"`
			Value json.RawMessage `json:"value"`
		}
		if got.Kind == "exit" {
			_ = json.Unmarshal(got.Exit, &exit)
		}
		if got.Kind != "exit" || exit.Tag != "Success" || !sameJSON(exit.Value, []byte(want)) {
			Gap(t, "FuzzVIPLegacyForms", "exit/"+key, "the migrated program ends %s %s, want Success %s (detail 274)\nmigrated:\n%s\nlegacy:\n%s\n%s", got.Kind, got.Exit, want, fixed["main.vibe"], source, got.Log)
		}
	})
}

// legacyFormOwners hold a catch expression, CATCH, as the old compiler did:
// a function whose form was an Effect function (annotated, bare or declared),
// or a plain `: infer _` factory and the top level, where the catch was a
// program value. main runs g(1) twice. factory says whether calling g writes
// "factory" to the trace.
var legacyFormOwners = map[string]struct {
	source  string
	factory bool
}{
	"annotated-arrow": {"const g = (n: number): number!! => CATCH\n", false},
	"bare-arrow":      {"const g = (n: number) => CATCH\n", false},
	"declaration":     {"function g(n: number) {\n  const a = CATCH\n  return a\n}\n", false},
	"infer-factory":   {"const g = (n: number): infer _ => {\n  trace.push(\"factory\")\n  const p: number!! = CATCH\n  return p\n}\n", true},
	"top-level":       {"const p: number!! = CATCH\nconst g = (n: number): infer _ => p\n", false},
	// In effect code at a held position the catch was the program the
	// position received (foldkit playground's FiberMap.run argument).
	"held-argument": {"effect function g(n: number) {\n  return legacyHold(CATCH)\n}\n", false},
	"held-const":    {"effect function g(n: number) {\n  const p: number!! = CATCH\n  return try p\n}\n", false},
}

// legacyFormOperands are a catch's left side: its source, whether it fails
// with LegacyMiss, and what building it (make) or running it (left) writes
// to the trace. $catchExpression builds the left side on each run.
var legacyFormOperands = map[string]struct {
	source       string
	fails        bool
	traceEachRun string
}{
	"fail-call": {"legacyBoom()", true, ""},
	// A call that ran inside the head, in effect code only (foldkit-17070).
	"nested-call":  {"legacyAdd(legacyWork())", false, "work"},
	"make-call":    {"legacyMake()", false, "make"},
	"effect-block": {"(effect {\n    trace.push(\"left\")\n    return try legacyBoom()\n  })", true, "left"},
}

// legacyFormHandlers are a catch's handler: its source, the value it gives
// for LegacyMiss, and what it writes to the trace.
var legacyFormHandlers = map[string]struct {
	source, value, trace string
}{
	"plain":     {"() => 0", "0", ""},
	"plain-tag": {"(e) => e._tag.length", "10", ""},
	"effect":    {"effect () => {\n    trace.push(\"handler\")\n    return 1\n  }", "1", "handler"},
}

// legacyFormFallbacks are pre-VIP-5 value fallbacks written as object
// literals; EK0509's repair must keep each an object, not a block
// (foldkit-17069: catch { directory }).
var legacyFormFallbacks = map[string]string{
	"object":         "{ v: 3 }",
	"shorthand":      "{ v }",
	"quoted-key":     "{ \"v\": 3 }",
	"trailing-comma": "{ v: 3, }",
	"parenthesized":  "({ v: 3 })",
	"spread":         "{ ...{ v: 3 } }",
}

// legacyFormArguments are function literals passed where Effect.all expects
// programs; each gives 5 and writes "work" once per run.
var legacyFormArguments = map[string]string{
	"expression": "() => legacyWork()",
	"block":      "() => {\n    return legacyWork()\n  }",
}

const legacyFormHelpers = `
const trace: string[] = []

error LegacyMiss

effect function legacyBoom(): never!LegacyMiss {
  throw new LegacyMiss()
}

function legacyMake(): number!! {
  trace.push("make")
  return Effect.succeed(7)
}

function legacyHold(p: number!!): number!! {
  return p
}

function legacyAdd(n: number): number {
  return n + 2
}

effect function legacyBoomObject(): Readonly<{ v: number }>!LegacyMiss {
  throw new LegacyMiss()
}

effect function legacyWork() {
  trace.push("work")
  return 5
}
`

func legacyFormOwnerKeys() []string   { return slices.Sorted(maps.Keys(legacyFormOwners)) }
func legacyFormOperandKeys() []string { return slices.Sorted(maps.Keys(legacyFormOperands)) }
func legacyFormHandlerKeys() []string { return slices.Sorted(maps.Keys(legacyFormHandlers)) }

// legacyFormInput reads an input: its key, the legacy main.vibe, and the
// JSON main must succeed with under the pre-VIP-1 model.
func legacyFormInput(data []byte) (key, source, want string) {
	parts := strings.Split(string(data), ":")
	if len(parts) == 2 && parts[0] == "fallback" {
		fallback, ok := legacyFormFallbacks[parts[1]]
		if !ok {
			return "", "", ""
		}
		main := "export effect function main() {\n  const v = 3\n  const a = try (legacyBoomObject() catch " + fallback + ")\n  const b = try (legacyBoomObject() catch " + fallback + ")\n  return [a, b]\n}\n"
		return "fallback:" + parts[1], legacyFormHelpers + main, `[{"v":3},{"v":3}]`
	}
	if len(parts) == 2 && parts[0] == "argument" {
		body, ok := legacyFormArguments[parts[1]]
		if !ok {
			return "", "", ""
		}
		main := "export effect function main() {\n  const [a, b] = try Effect.all([" + body + ", " + body + "])\n  return [a, b, trace.join(\",\")]\n}\n"
		return "argument:" + parts[1], legacyFormHelpers + main, `[5,5,"work,work"]`
	}
	owners, operands, handlers := legacyFormOwnerKeys(), legacyFormOperandKeys(), legacyFormHandlerKeys()
	if len(parts) != 3 || legacyFormOwners[parts[0]].source == "" || legacyFormOperands[parts[1]].source == "" || legacyFormHandlers[parts[2]].source == "" {
		if len(data) < 3 {
			return "", "", ""
		}
		parts = []string{owners[int(data[0])%len(owners)], operands[int(data[1])%len(operands)], handlers[int(data[2])%len(handlers)]}
	}
	owner, operand, handler := legacyFormOwners[parts[0]], legacyFormOperands[parts[1]], legacyFormHandlers[parts[2]]
	catch := operand.source + " catch " + handler.source
	main := "export effect function main() {\n  const a = try g(1)\n  const b = try g(1)\n  return [a, b, trace.join(\",\")]\n}\n"
	if parts[1] == "nested-call" && (parts[0] == "infer-factory" || parts[0] == "top-level") {
		return "", "", "" // plain code ran no call in a catch head
	}
	value := "7"
	var run []string
	if owner.factory {
		run = append(run, "factory")
	}
	if operand.traceEachRun != "" {
		run = append(run, operand.traceEachRun)
	}
	if operand.fails {
		value = handler.value
		if handler.trace != "" {
			run = append(run, handler.trace)
		}
	}
	trace, _ := json.Marshal(strings.Join(slices.Concat(run, run), ","))
	return strings.Join(parts, ":"), legacyFormHelpers + strings.ReplaceAll(owner.source, "CATCH", catch) + main, "[" + value + "," + value + "," + string(trace) + "]"
}

// sameJSON reports whether got, in the VIP worker's encoding (an array is
// {"$array": […]}, a plain object {"$class": "Object", "fields": {…}}),
// encodes the plain JSON value want.
func sameJSON(got, want []byte) bool {
	var x, y any
	return json.Unmarshal(got, &x) == nil && json.Unmarshal(want, &y) == nil && reflect.DeepEqual(plainVIPValue(x), y)
}

func plainVIPValue(v any) any {
	switch v := v.(type) {
	case map[string]any:
		if items, ok := v["$array"].([]any); ok && len(v) == 1 {
			return plainVIPValue(items)
		}
		if fields, ok := v["fields"].(map[string]any); ok && v["$class"] == "Object" && len(v) == 2 {
			return plainVIPValue(fields)
		}
		for k, item := range v {
			v[k] = plainVIPValue(item)
		}
	case []any:
		for i, item := range v {
			v[i] = plainVIPValue(item)
		}
	}
	return v
}
