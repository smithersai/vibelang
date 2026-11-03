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

var retiredRuntimeFactoryKeys = []string{"named", "alias", "namespace", "namespace-keep", "disabled", "both", "optional-spread", "comments", "run-yield", "run-interrupt"}

func TestRetiredRuntimeFactoryQuoted(t *testing.T) { nativeFactoryPhaseQuoted(t) }

// Explicit runtime imports have the same pure factory contract as the old
// implicit factories. Check calls, aliases, namespaces and written runs against
// native TypeScript factories; exact outputs include argument evaluation counts.
func TestRetiredRuntimeFactoriesRuntime(t *testing.T) {
	w := NewWorkspace(t)
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(node.Close)
	for _, key := range retiredRuntimeFactoryKeys {
		t.Run(key, func(t *testing.T) { checkRetiredRuntimeFactories(t, w, []byte(key), node) })
	}
}

// Fuzz the static migration contract. Finite runtime regressions above use
// native factory references; language runtime generators remain in FuzzVIPDifferential.
func FuzzRetiredRuntimeFactories(f *testing.F) {
	startShortBudget(f)
	nativeFactoryPhaseQuoted(f)
	for _, key := range retiredRuntimeFactoryKeys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) { checkRetiredRuntimeFactories(t, w, data, nil) })
}

func checkRetiredRuntimeFactories(t *testing.T, w *Workspace, data []byte, node *Node) {
	key := string(data)
	if !slices.Contains(retiredRuntimeFactoryKeys, key) {
		key = retiredRuntimeFactoryKeys[0]
		if len(data) > 0 {
			key = retiredRuntimeFactoryKeys[int(data[0])%len(retiredRuntimeFactoryKeys)]
		}
	}
	prefix := fmt.Sprintf("import * as Native from \"effect/Effect\"; let calls=0; function next(): number { calls++; return %d }\n", len(data)%9-4)
	imports := `import { yieldNow, interrupt } from "vibelang-runtime";`
	y, i := "yieldNow", "interrupt"
	switch key {
	case "alias":
		imports = `import { yieldNow as pause, interrupt as stop } from "vibelang-runtime";`
		y, i = "pause", "stop"
	case "namespace", "namespace-keep":
		imports = `import * as Runtime from "vibelang-runtime";`
		y, i = "Runtime.yieldNow", "Runtime.interrupt"
	}
	body := "const value = " + y + "(next()); return [Native.isEffect(value), calls]"
	refBody := "const value = legacyYield(next()); return [Native.isEffect(value), calls]"
	switch key {
	case "both":
		body = "return [[" + y + "(next()), " + i + "()].map(Native.isEffect), calls]"
		refBody = "return [[legacyYield(next()), legacyStop()].map(Native.isEffect), calls]"
	case "optional-spread":
		body = "const args: [number?] = [next()]; const value = " + y + "?.(...args); return [Native.isEffect(value), calls]"
		refBody = "const args: [number?] = [next()]; const value = legacyYield?.(...args); return [Native.isEffect(value), calls]"
	case "comments":
		body = "const value = (/* factory */ " + y + ")(/* priority */ next()); return [Native.isEffect(value), calls]"
	case "run-yield":
		body = "try " + y + "(next()); return calls"
		refBody = "yield* legacyYield(next()); return calls"
	case "run-interrupt":
		body = "try " + i + "(); return calls"
		refBody = "yield* legacyStop(); return calls"
	}
	// Avoid introducing unrelated unused retired imports into the fixtures.
	if key != "namespace" && key != "namespace-keep" && key != "both" {
		if key == "run-interrupt" {
			imports = `import { interrupt } from "vibelang-runtime";`
		} else if key == "alias" {
			imports = `import { yieldNow as pause } from "vibelang-runtime";`
		} else {
			imports = `import { yieldNow } from "vibelang-runtime";`
		}
	}
	config := DefaultConfig
	if key == "disabled" {
		config = strings.TrimSuffix(config, "\n}") + ",\n\"vibe\":{\"effectGlobals\":false,\"effectModules\":false}\n}"
	}
	if key == "namespace-keep" {
		imports += "\nconst marker: symbol = Runtime.$noFailure;"
		body = "void marker; " + body
	}
	source := prefix + imports + "\nexport effect function main(){ " + body + " }\n"
	reference := prefix + "const legacyYield = (priority?: number) => priority === undefined ? Native.yieldNow : Native.yieldNowWith(priority); const legacyStop = () => Native.interrupt;\nexport function main(){ return Native."
	if strings.HasPrefix(key, "run-") {
		reference += "gen(function*(){ " + refBody + " }) }"
	} else {
		reference += "sync(() => { " + refBody + " }) }"
	}
	files := map[string]string{"main.vibe": source, "package.json": `{"type":"module"}`}
	before, err := w.Compile(t.Context(), Project{Files: files, Config: config})
	if err != nil {
		t.Fatal(err)
	}
	defer before.Remove()
	options := vibelang.FixOptions{MigrationOnly: true}
	result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), options)
	fixed := maps.Clone(files)
	for name, file := range result.Files {
		fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
	}
	if result.Err != nil || len(result.Refused) > 0 || fixed["main.vibe"] == source {
		Gap(t, "FuzzRetiredRuntimeFactories", key+":migration", "err=%v refused=%+v\n%s", result.Err, result.Refused, source)
		return
	}
	if lost := toolsLostComments(source, fixed["main.vibe"]); len(lost) > 0 {
		Gap(t, "FuzzRetiredRuntimeFactories", key+":comments", "lost=%v", lost)
	}
	after, err := w.Compile(t.Context(), Project{Files: fixed, Config: config})
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
		Gap(t, "FuzzRetiredRuntimeFactories", key+":types", "%v\n%s", errs, fixed["main.vibe"])
		return
	}
	if strings.Count(source, "try ") != strings.Count(fixed["main.vibe"], "try ") {
		Gap(t, "FuzzRetiredRuntimeFactories", key+":run-sites", "migration changed explicit run sites:\n%s", fixed["main.vibe"])
	}
	if strings.Count(source, "next()") != strings.Count(fixed["main.vibe"], "next()") {
		Gap(t, "FuzzRetiredRuntimeFactories", key+":evaluation-sites", "migration duplicated or removed an argument evaluation:\n%s", fixed["main.vibe"])
	}
	if node != nil {
		got, want := node.Run(after, "out/main.js", "main"), node.Run(twin, "out/main.js", "main")
		if toolsInvalidOutcome(got) || toolsInvalidOutcome(want) || !toolsSameOutcome(got, want) {
			Gap(t, "FuzzRetiredRuntimeFactories", key+":phase", "got=%+v want=%+v\n%s", got, want, fixed["main.vibe"])
		}
	}
	again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), options)
	if again.Err != nil || len(again.Files) > 0 {
		Gap(t, "FuzzRetiredRuntimeFactories", key+":fixed-point", "err=%v files=%+v", again.Err, again.Files)
	}
}
