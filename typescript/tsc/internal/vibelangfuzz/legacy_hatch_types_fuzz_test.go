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

const legacyHatchTypesQuote = "Every breaking change ships a `vibelang --fix` codemod, so code that compiled under the previous release migrates mechanically."

func TestLegacyHatchTypesQuoted(t *testing.T) {
	TestEffectGlobalsQuoted(t)
	if !strings.Contains(SpecText("../vips/0034-compiler-and-tooling.md"), legacyHatchTypesQuote) {
		t.Fatal("VIP-34 no longer requires the migration oracle")
	}
}

// The old annotation is exactly the compatibility helper's type. Qualifying
// only that type must compile like the explicit reference, with identical
// emitted JavaScript and public declarations. There is no second runtime
// comparator: type-only erasure gives an exact-byte oracle here.
func FuzzLegacyHatchTypes(f *testing.F) {
	startShortBudget(f)
	keys := []string{}
	for _, name := range []string{"sync", "callback"} {
		for _, shape := range []string{"local", "alias", "parameter", "property", "cross-file", "instantiation", "factory", "arrow-factory"} {
			key := name + "/" + shape
			keys = append(keys, key)
			f.Add(key, uint8(7), uint8(len(keys)%3))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, value, mode uint8) {
		TestLegacyHatchTypesQuoted(t)
		known := false
		for _, candidate := range keys {
			if candidate == key {
				known = true
			}
		}
		if !known {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		files, reference := legacyHatchTypesProgram(key, int(value))
		before, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if !HasError(before.Diagnostics) {
			t.Fatalf("invalid regression: native annotation unexpectedly accepts %s", key)
		}
		config := toolsConfig(w, before.Dir)
		options := []vibelang.FixOptions{{}, {MigrationOnly: true}, {VIPOnly: true}}[mode%3]
		var fix *vibelang.FixResult
		within(t, "migrate legacy hatch types", func() {
			fix = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, options)
		})
		if fix.Err != nil {
			t.Fatal(fix.Err)
		}
		fixed := maps.Clone(files)
		for path, change := range fix.Files {
			name := filepath.Base(path.AsString())
			if _, own := files[name]; !own {
				t.Fatalf("edited unowned file %s", name)
			}
			fixed[name] = change.Text
		}
		after, err := w.Compile(t.Context(), Project{Files: fixed})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		control, err := w.Compile(t.Context(), Project{Files: reference})
		if err != nil {
			t.Fatal(err)
		}
		defer control.Remove()
		if HasError(control.Diagnostics) {
			t.Fatalf("invalid legacy API reference: %v", SortedKeys(Keys(control.Dir, control.Diagnostics)))
		}
		if HasError(after.Diagnostics) {
			Gap(t, "FuzzLegacyHatchTypes", key, "VIP-6/VIP-34 migration retains errors %v; refused %+v", SortedKeys(Keys(after.Dir, after.Diagnostics)), fix.Refused)
		}
		for path, text := range control.Outputs {
			if strings.HasSuffix(path, ".js") || strings.HasSuffix(path, ".d.ts") || strings.HasSuffix(path, ".d.vibe.ts") {
				if after.Outputs[path] != text {
					t.Fatalf("%s changed emitted code or API %s\nfixed:\n%s\nreference:\n%s", key, path, after.Outputs[path], text)
				}
			}
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), options)
		if again.Err != nil || len(again.Files) != 0 {
			t.Fatalf("migration is not idempotent: %v %+v", again.Err, again.Files)
		}
	})
}

func legacyHatchTypesProgram(key string, value int) (map[string]string, map[string]string) {
	parts := strings.Split(key, "/")
	name, shape := parts[0], parts[1]
	query := "typeof /* keep */ " + name
	call := fmt.Sprintf("run(%d)", value)
	if name == "callback" {
		call = fmt.Sprintf("run<number>((resume) => resume(%d))", value)
	}
	head := "import * as R from \"vibelang-runtime\"\n"
	binding := "const run: " + query + " = R[\"" + name + "\"]; "
	files := map[string]string{}
	switch shape {
	case "alias":
		binding = "type Run = " + query + "; const run: Run = R[\"" + name + "\"]; "
	case "parameter":
		binding = "export function use(run: " + query + ") { return " + call + " }"
		call = ""
	case "property":
		binding = "const box: { run: " + query + " } = { run: R[\"" + name + "\"] }; "
		call = strings.Replace(call, "run(", "box.run(", 1)
		call = strings.Replace(call, "run<number>", "box.run<number>", 1)
	case "factory":
		binding = "function factory(): " + query + " { return R[\"" + name + "\"] }; const run = factory(); "
	case "arrow-factory":
		binding = "const factory = (): " + query + " => R[\"" + name + "\"]; const run = factory(); "
	case "cross-file":
		files["api.vibe"] = head + "export type Run = " + query + "; export const run: Run = R[\"" + name + "\"];\n"
		head = "import { run } from \"./api.js\"\n"
		binding = ""
	case "instantiation":
		args := "<number, [number]>"
		call = fmt.Sprintf("run((n) => n + 1, %d)", value)
		if name == "callback" {
			args = "<number, never, [], never>"
			call = fmt.Sprintf("run((resume) => resume(%d))", value)
		}
		binding = "type Run = " + query + args + "; const run: Run = R[\"" + name + "\"]" + args + "; "
	}
	tail := ""
	if call != "" {
		tail = "export const value = " + call
	}
	files["main.vibe"] = head + binding + tail + "\n"
	reference := maps.Clone(files)
	for path, text := range reference {
		reference[path] = strings.ReplaceAll(text, query, "typeof /* keep */ import(\"vibelang-runtime\")."+name)
	}
	return files, reference
}
