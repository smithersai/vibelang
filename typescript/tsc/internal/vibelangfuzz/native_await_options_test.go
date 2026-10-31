package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

var nativeAwaitOptionQuotes = []string{
	"Top-level `await` requires a supported module and target configuration",
	"The ordinary TypeScript module emission and host rules still apply, including diagnostics for incompatible options.",
}

func TestNativeAwaitOptionsQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range nativeAwaitOptionQuotes {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("missing configuration rule: %s", quote)
		}
	}
}

type nativeAwaitOptionWitness struct{ key, source, kind string }

var nativeAwaitOptionWitnesses = []nativeAwaitOptionWitness{
	{"unary-minus", "const value = await -1", "module"},
	{"unary-plus", "const value = await +1", "module"},
	{"unary-not", "const value = await !false", "module"},
	{"unary-bitwise", "const value = await ~1", "module"},
	{"newline-scalar", "const value = await\n1", "module"},
	{"newline-promise", "const value = await\nPromise.resolve(1)", "module"},
	{"class-key", "export class Value { [await Promise.resolve(\"key\")]() {} }", "module"},
	{"class-heritage", "export class Value extends (await Promise.resolve(class {})) {}", "module"},
	{"async-body", "async function caller(){ return await Promise.resolve(1) }", "async"},
	{"class-static", "class Value { static { await Promise.resolve(1) } }", "static"},
	{"async-default", "async function caller(value = await Promise.resolve(1)) {}", "parameter"},
}

func nativeAwaitOptionProject(witness nativeAwaitOptionWitness, extension string, module, target uint8) Project {
	modules := []string{"ESNext", "ES2020", "NodeNext", "NodeNext"}
	targets := []string{"ES2016", "ES2017", "ES2022"}
	selected := module % 4
	resolution := "Bundler"
	if selected >= 2 {
		resolution = "NodeNext"
	}
	pkg := "module"
	if selected == 3 {
		pkg = "commonjs"
	}
	options := map[string]any{"target": targets[target%3], "module": modules[selected], "moduleResolution": resolution, "moduleDetection": "force", "strict": false, "skipLibCheck": true, "types": []string{}, "noEmit": true}
	config, err := json.Marshal(map[string]any{"compilerOptions": options, "vibe": map[string]any{"effectGlobals": false, "effectModules": false}, "files": []string{"a." + extension}})
	if err != nil {
		panic(err)
	}
	pkgJSON, err := json.Marshal(map[string]string{"type": pkg})
	if err != nil {
		panic(err)
	}
	return Project{Files: map[string]string{"a." + extension: "export {}\n" + witness.source + "\n", "package.json": string(pkgJSON)}, Config: string(config)}
}
func nativeAwaitOptionCodes(result *Result) []string {
	codes := []string{}
	for _, diagnostic := range result.Diagnostics {
		source := diagnostic.Source()
		if source == "" {
			source = "TS"
		}
		codes = append(codes, fmt.Sprintf("%s%d", source, diagnostic.Code()))
	}
	slices.Sort(codes)
	return codes
}
func nativeAwaitOptionExpected(witness nativeAwaitOptionWitness, module, target uint8) []string {
	switch witness.kind {
	case "async":
		return []string{}
	case "static":
		return []string{"TS18037"}
	case "parameter":
		return []string{"TS2524"}
	}
	if module%4 == 3 {
		return []string{"TS1309"}
	}
	if module%4 == 1 || target%3 == 0 {
		return []string{"TS1378"}
	}
	return []string{}
}

// Only the constructed fixture file is inspected; diagnostics contain no
// user paths or payloads. These flags expose the stage that lost validation.
func nativeAwaitOptionContext(result *Result) []string {
	details := []string{}
	for _, file := range result.Program.SourceFiles() {
		if !strings.HasSuffix(file.FileName().AsString(), "/a.vibe") {
			continue
		}
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsAwaitExpression(node) {
				details = append(details, fmt.Sprintf("module=%v awaitContext=%v topLevel=%v span=%d:%d", file.ExternalModuleIndicator != nil, node.Flags&ast.NodeFlagsAwaitContext != 0, ast.IsInTopLevelContext(node), node.Pos(), node.End()))
			}
			return node.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
	}
	return details
}

func checkNativeAwaitOptions(w *Workspace, witness nativeAwaitOptionWitness, module, target uint8) (string, error) {
	result, err := w.Compile(context.Background(), nativeAwaitOptionProject(witness, "vibe", module, target))
	if err != nil {
		return "", err
	}
	if result.Program == nil {
		return "stage=config: no program", nil
	}
	got, want := nativeAwaitOptionCodes(result), nativeAwaitOptionExpected(witness, module, target)
	if !reflect.DeepEqual(got, want) {
		return fmt.Sprintf("stage=grammar Vibe=%v required=%v context=%v", got, want, nativeAwaitOptionContext(result)), nil
	}
	return "", nil
}
func TestNativeAwaitOptionsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, witness := range nativeAwaitOptionWitnesses {
		for module := uint8(0); module < 4; module++ {
			for target := uint8(0); target < 3; target++ {
				t.Run(fmt.Sprintf("%s/module%d/target%d", witness.key, module, target), func(t *testing.T) {
					message, err := checkNativeAwaitOptions(w, witness, module, target)
					if err != nil {
						t.Fatal(err)
					}
					if message != "" {
						t.Fatal(message)
					}
				})
			}
		}
	}
}
func FuzzNativeAwaitOptions(f *testing.F) {
	startShortBudget(f)
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	for _, quote := range nativeAwaitOptionQuotes {
		if !strings.Contains(string(text), quote) {
			f.Fatalf("missing configuration rule: %s", quote)
		}
	}
	for _, witness := range nativeAwaitOptionWitnesses {
		for module := uint8(0); module < 4; module++ {
			for target := uint8(0); target < 3; target++ {
				f.Add(witness.key, module, target)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, module, target uint8) {
		witness := nativeAwaitOptionWitnesses[int(module)%len(nativeAwaitOptionWitnesses)]
		for _, candidate := range nativeAwaitOptionWitnesses {
			if candidate.key == key {
				witness = candidate
				break
			}
		}
		message, err := checkNativeAwaitOptions(w, witness, module, target)
		if err != nil {
			t.Fatal(err)
		}
		if message != "" {
			Gap(t, "FuzzNativeAwaitOptions", fmt.Sprintf("%s/module%d/target%d", witness.key, module%4, target%3), "%s", message)
		}
	})
}

// VIP-30 keeps the native .ts path. These controls were independently checked
// with stock TypeScript 5.9.3; the reparsed spelling is an upstream quirk.
func TestNativeAwaitOptionsTypeScriptCompatibility(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), "Fields retain their TypeScript meaning with one deliberate file-kind exception") {
		t.Fatal("missing TypeScript compatibility rule")
	}
	w := NewWorkspace(t)
	for _, test := range []struct {
		name, source   string
		module, target uint8
		codes          []string
	}{
		{"supported", "const value = await Promise.resolve(1)", 0, 2, []string{}},
		{"direct-module", "const value = await Promise.resolve(1)", 1, 2, []string{"TS1378"}},
		{"direct-target", "const value = await Promise.resolve(1)", 0, 0, []string{"TS1378"}},
		{"reparsed-module", "const value = await(Promise.resolve(1))", 1, 2, []string{}},
		{"reparsed-target", "const value = await(Promise.resolve(1))", 0, 0, []string{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			result, err := w.Compile(context.Background(), nativeAwaitOptionProject(nativeAwaitOptionWitness{test.name, test.source, "module"}, "ts", test.module, test.target))
			if err != nil {
				t.Fatal(err)
			}
			if got := nativeAwaitOptionCodes(result); !reflect.DeepEqual(got, test.codes) {
				t.Fatalf("native TypeScript path changed: got %v want %v", got, test.codes)
			}
		})
	}
}
