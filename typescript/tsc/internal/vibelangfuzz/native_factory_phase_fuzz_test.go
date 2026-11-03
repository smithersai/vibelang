package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

var nativeFactoryPhaseKeys = []string{"held-priority", "held-zero-yield", "held-interrupt", "plain-factory", "top-level", "async-factory", "argument", "array", "conditional", "spread", "optional", "inner-return", "run-yield", "run-interrupt"}

func nativeFactoryPhaseQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output") {
		t.Fatal("Chapter 7 quick-fix preservation rule moved")
	}
	if !strings.Contains(SpecText("005-services.md"), "The non-function value exports are globals too") {
		t.Fatal("Chapter 5 native Effect values rule moved")
	}
}

func TestNativeFactoryPhaseQuoted(t *testing.T) { nativeFactoryPhaseQuoted(t) }

// Compare the migration with native TypeScript factories implementing the old
// pure factory contract. Observations expose Effect values and argument counts,
// never serialize an opaque Effect or compare scheduler-specific fiber IDs.
func TestNativeFactoryPhaseRuntime(t *testing.T) {
	w := NewWorkspace(t)
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(node.Close)
	for _, key := range nativeFactoryPhaseKeys {
		t.Run(key, func(t *testing.T) { checkNativeFactoryPhase(t, w, []byte(key+"@0"), node) })
	}
}

// Fuzz the static migration contract. Finite runtime regressions above use
// native factory references; language runtime generators remain in FuzzVIPDifferential.
func FuzzNativeFactoryPhase(f *testing.F) {
	startShortBudget(f)
	nativeFactoryPhaseQuoted(f)
	for _, key := range nativeFactoryPhaseKeys {
		for mode := 0; mode < 2; mode++ {
			f.Add([]byte(fmt.Sprintf("%s@%d", key, mode)))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) { checkNativeFactoryPhase(t, w, data, nil) })
}

func checkNativeFactoryPhase(t *testing.T, w *Workspace, data []byte, node *Node) {
	key, modeText, _ := strings.Cut(string(data), "@")
	if !slices.Contains(nativeFactoryPhaseKeys, key) {
		key = nativeFactoryPhaseKeys[0]
		if len(data) > 0 {
			key = nativeFactoryPhaseKeys[int(data[0])%len(nativeFactoryPhaseKeys)]
		}
	}
	mode := 0
	if len(modeText) > 0 {
		mode = int(modeText[0]) % 2
	}
	options := vibelang.FixOptions{MigrationOnly: mode == 1}
	prefix := fmt.Sprintf("import * as Native from \"effect/Effect\";\nlet calls = 0;\nfunction next(): number { calls++; return %d }\n", len(data)%9-4)
	header, body := "", "const value = yieldNow(next()); return [Native.isEffect(value), calls]"
	refBody := ""
	switch key {
	case "held-zero-yield":
		body = "const value = yieldNow(); return [Native.isEffect(value), calls]"
	case "held-interrupt":
		body = "const value = interrupt(); return [Native.isEffect(value), calls]"
	case "plain-factory":
		header = "function make(): Native.Effect<void> { return yieldNow(next()) }\n"
		body = "const value = make(); return [Native.isEffect(value), calls]"
	case "top-level":
		header = "const value = yieldNow(next());\n"
		body = "return [Native.isEffect(value), calls]"
	case "async-factory":
		header = "async function make(): Promise<Native.Effect<void>> { return yieldNow(next()) }\n"
		body = "const value = try Native.promise(() => make()); return [Native.isEffect(value), calls]"
		refBody = "const value = yield* Native.promise(() => make()); return [Native.isEffect(value), calls]"
	case "argument":
		body = "return [Native.isEffect(yieldNow(next())), calls]"
	case "array":
		body = "const values = [yieldNow(next()), interrupt()]; return [values.map(Native.isEffect), calls]"
	case "conditional":
		body = "const value = next() >= 0 ? yieldNow(next()) : interrupt(); return [Native.isEffect(value), calls]"
	case "spread":
		body = "const args: [number?] = [next()]; const value = yieldNow(...args); return [Native.isEffect(value), calls]"
	case "optional":
		body = "const value = yieldNow?.(next()); return [Native.isEffect(value), calls]"
	case "inner-return":
		header = "effect function make(): Native.Effect<void>!! { return yieldNow(next()) }\n"
		body = "const value = try make(); return [Native.isEffect(value), calls]"
		refBody = "const value = yield* make(); return [Native.isEffect(value), calls]"
	case "run-yield":
		body = "try yieldNow(next()); return calls"
		refBody = "yield* legacyYield(next()); return calls"
	case "run-interrupt":
		body = "try interrupt(); return calls"
		refBody = "yield* legacyInterrupt(); return calls"
	}
	source := prefix + header + "export effect function main() { " + body + " }\n"
	referenceHeader := strings.ReplaceAll(strings.ReplaceAll(header, "yieldNow", "legacyYield"), "interrupt", "legacyInterrupt")
	if key == "inner-return" {
		referenceHeader = "function make(): Native.Effect<Native.Effect<void>> { return Native.sync(() => legacyYield(next())) }\n"
	}
	reference := prefix + "const legacyYield = (priority?: number) => priority === undefined ? Native.yieldNow : Native.yieldNowWith(priority);\nconst legacyInterrupt = () => Native.interrupt;\n" + referenceHeader
	if refBody != "" {
		reference += "export function main() { return Native.gen(function* () { " + refBody + " }) }\n"
	} else {
		reference += "export function main() { return Native.sync(() => { " + strings.ReplaceAll(strings.ReplaceAll(body, "yieldNow", "legacyYield"), "interrupt", "legacyInterrupt") + " }) }\n"
	}
	files := map[string]string{"main.vibe": source, "package.json": `{"type":"module"}`}
	before, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer before.Remove()
	result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), options)
	fixed := maps.Clone(files)
	for name, file := range result.Files {
		fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
	}
	if result.Err != nil || len(result.Refused) > 0 || fixed["main.vibe"] == source {
		Gap(t, "FuzzNativeFactoryPhase", key+":migration", "err=%v refused=%+v\n%s", result.Err, result.Refused, source)
		return
	}
	after, err := w.Compile(t.Context(), Project{Files: fixed})
	if err != nil {
		t.Fatal(err)
	}
	defer after.Remove()
	twin, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": reference, "package.json": `{"type":"module"}`}})
	if err != nil {
		t.Fatal(err)
	}
	defer twin.Remove()
	if errs := append(legacyErrors(after), legacyErrors(twin)...); len(errs) > 0 {
		Gap(t, "FuzzNativeFactoryPhase", key+":types", "%v\nfixed:\n%s\nreference:\n%s", errs, fixed["main.vibe"], reference)
		return
	}
	if strings.Count(source, "try ") != strings.Count(fixed["main.vibe"], "try ") {
		Gap(t, "FuzzNativeFactoryPhase", key+":run-sites", "migration changed explicit run sites:\n%s", fixed["main.vibe"])
	}
	if strings.Count(source, "next()") != strings.Count(fixed["main.vibe"], "next()") {
		Gap(t, "FuzzNativeFactoryPhase", key+":evaluation-sites", "migration duplicated or removed an argument evaluation:\n%s", fixed["main.vibe"])
	}
	if node != nil {
		got, want := node.Run(after, "out/main.js", "main"), node.Run(twin, "out/main.js", "main")
		if toolsInvalidOutcome(got) || toolsInvalidOutcome(want) || !toolsSameOutcome(got, want) {
			Gap(t, "FuzzNativeFactoryPhase", key+":phase", "got=%+v want=%+v\n%s", got, want, fixed["main.vibe"])
		}
	}
	again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), options)
	if again.Err != nil || len(again.Files) > 0 {
		Gap(t, "FuzzNativeFactoryPhase", key+":fixed-point", "err=%v files=%+v", again.Err, again.Files)
	}
}
