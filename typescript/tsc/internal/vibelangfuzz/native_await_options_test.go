package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

var nativeAwaitOptionQuotes = []string{
	"Top-level `await` requires a supported module and target configuration",
	"The ordinary TypeScript module emission and host rules still apply, including diagnostics for incompatible options.",
	// VIP-26: a namespace wrapper is not a module top level. Native syntax
	// keeps TypeScript diagnostics, including TS1308 inside that wrapper.
	"TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their `TS` codes, including independent errors in embedded expressions and types.",
}

func TestNativeAwaitOptionsQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range nativeAwaitOptionQuotes {
		if !strings.Contains(string(text)+SpecText("007-tooling.md"), quote) {
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
	{"namespace-promise", "namespace N { export const x = await Promise.resolve(42) }", "namespace"},
	{"namespace-literal", "namespace N { export const x = await 42 }", "namespace"},
	{"namespace-nested", "namespace N { export namespace Inner { export const x = await Promise.resolve(42) } }", "namespace"},
	{"namespace-dotted", "namespace N.Inner { export const x = await Promise.resolve(42) }", "namespace"},
	{"namespace-if", "namespace N { if (true) { const x = await Promise.resolve(42); void x } }", "namespace"},
	{"namespace-function", "namespace N { export function load(): number { return await Promise.resolve(42) } }", "namespace"},
	{"namespace-async-function", "namespace N { export async function load(): Promise<number> { return await Promise.resolve(42) } }", "async"},
	{"namespace-async-arrow", "namespace N { export const load = async (): Promise<number> => await Promise.resolve(42) }", "async"},
	{"async-body", "async function caller(){ return await Promise.resolve(1) }", "async"},
	{"class-static", "class Value { static { await Promise.resolve(1) } }", "static"},
	{"async-default", "async function caller(value = await Promise.resolve(1)) {}", "parameter"},
}

func nativeAwaitOptionProject(witness nativeAwaitOptionWitness, extension string, module, target uint8) Project {
	modules := []string{"ESNext", "ES2020", "NodeNext", "NodeNext"}
	targets := []string{"ES2016", "ES2017", "ES2022"}
	// Mutate the namespace's nesting depth and await operand independently
	// of module/target options. Keyed corpus inputs retain their shape.
	if strings.HasPrefix(witness.key, "namespace-") {
		operands := []string{"Promise.resolve(42)", "42", "-42"}
		witness.source = strings.ReplaceAll(witness.source, "Promise.resolve(42)", operands[(target/3)%3])
		for depth := uint8(0); depth < (module/4)%3; depth++ {
			witness.source = "namespace Extra" + fmt.Sprint(depth) + " { " + witness.source + " }"
		}
	}
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
		codes = append(codes, diagnosticCodeName(source, diagnostic.Code()))
	}
	slices.Sort(codes)
	return codes
}
func nativeAwaitOptionExpected(witness nativeAwaitOptionWitness, module, target uint8) []string {
	switch witness.kind {
	case "namespace":
		return []string{"TS1308"}
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

func checkNativeAwaitOptions(w *Workspace, witness nativeAwaitOptionWitness, module, target uint8, tsc string) (string, error) {
	result, err := w.Compile(context.Background(), nativeAwaitOptionProject(witness, "vibe", module, target))
	if err != nil {
		return "", err
	}
	defer result.Remove()
	if result.Program == nil {
		return "stage=config: no program", nil
	}
	got, want := nativeAwaitOptionCodes(result), nativeAwaitOptionExpected(witness, module, target)
	if tsc != "" && strings.HasPrefix(witness.key, "namespace-") {
		// Compare the exact generated source and options with stock tsc,
		// not another Vibe compilation or today's inferred Effect behavior.
		twin := nativeAwaitOptionProject(witness, "ts", module, target)
		var config map[string]any
		if err := json.Unmarshal([]byte(twin.Config), &config); err != nil {
			return "", err
		}
		delete(config, "vibe")
		configText, err := json.Marshal(config)
		if err != nil {
			return "", err
		}
		for name, source := range map[string]string{"a.ts": twin.Files["a.ts"], "tsconfig.json": string(configText)} {
			if err := os.WriteFile(filepath.Join(result.Dir, name), []byte(source), 0o600); err != nil {
				return "", err
			}
		}
		ctx, cancel := context.WithTimeout(context.Background(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, tsc, "--pretty", "false", "-p", result.Dir)
		cmd.Dir = result.Dir
		output, runErr := cmd.CombinedOutput()
		want = []string{}
		for _, match := range stockCode.FindAllStringSubmatch(string(output), -1) {
			want = append(want, "TS"+match[1])
		}
		slices.Sort(want)
		if ctx.Err() != nil || runErr != nil && len(want) == 0 {
			return "", fmt.Errorf("stage=stock-tsc: %v: %.600s", runErr, output)
		}
	}
	if !reflect.DeepEqual(got, want) {
		return fmt.Sprintf("stage=grammar Vibe=%v required=%v context=%v", got, want, nativeAwaitOptionContext(result)), nil
	}
	return "", nil
}
func TestNativeAwaitOptionsRegression(t *testing.T) {
	// Spec rule: docs/design/src/001-functions.md#a72f5739ddc13df1
	// Chapter 001: native module/target diagnostics for ordinary, unary and multiline awaits (TestNativeAwaitOptionsRegression).

	// Spec rule: docs/design/src/001-functions.md#0ef87775d59ad819
	// Chapter 001: native module/target diagnostics for ordinary, unary and multiline awaits (TestNativeAwaitOptionsRegression).

	w := NewWorkspace(t)
	for _, witness := range nativeAwaitOptionWitnesses {
		for module := uint8(0); module < 4; module++ {
			for target := uint8(0); target < 3; target++ {
				t.Run(fmt.Sprintf("%s/module%d/target%d", witness.key, module, target), func(t *testing.T) {
					message, err := checkNativeAwaitOptions(w, witness, module, target, "")
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
	tsc := StockTypeScript(f)
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	for _, quote := range nativeAwaitOptionQuotes {
		if !strings.Contains(string(text)+SpecText("007-tooling.md"), quote) {
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
		message, err := checkNativeAwaitOptions(w, witness, module, target, tsc)
		if err != nil {
			t.Fatal(err)
		}
		if message != "" {
			key := fmt.Sprintf("%s/module%d/target%d", witness.key, module%4, target%3)
			if strings.HasPrefix(witness.key, "namespace-") {
				key += fmt.Sprintf("/depth%d/operand%d", (module/4)%3, (target/3)%3)
			}
			Gap(t, "FuzzNativeAwaitOptions", key, "%s", message)
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
