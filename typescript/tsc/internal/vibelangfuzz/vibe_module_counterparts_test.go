package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"
)

func moduleCounterpartConfig(mode, extension string, cjs, emit bool) string {
	var config map[string]any
	if err := json.Unmarshal([]byte(moduleBoundaryConfig(mode, 0, []string{"a." + extension}, emit)), &config); err != nil {
		panic(err)
	}
	options := config["compilerOptions"].(map[string]any)
	options["strict"] = false
	if cjs {
		options["module"] = "NodeNext"
		options["moduleResolution"] = "NodeNext"
	}
	data, err := json.Marshal(config)
	if err != nil {
		panic(err)
	}
	return string(data)
}

// VIP-30's file-kind exception makes a source Vibe unit a module even when
// the selected option is legacy. For ordinary native syntax it therefore
// has TypeScript's forced-module context. This is an explicitly spec-backed
// compiler-self comparison, not an oracle derived from current Vibe output.
func TestVibeModuleNativeCounterparts(t *testing.T) {
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{
		"Its declarations are module-scoped and its source is checked as strict module code.",
		"including an effective empty module marker when needed",
	} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("missing module rule: %s", quote)
		}
	}
	w := NewWorkspace(t)
	for _, test := range []struct {
		name, source string
		cjs, emit    bool
	}{
		{"strict-arguments", "const arguments = 1\n", false, false},
		{"cjs-module-markers", "const modulePrivate = 1\n", true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := func(extension string) map[string]string {
				return map[string]string{"a." + extension: test.source, "package.json": "{\"type\":\"commonjs\"}"}
			}
			actual, err := w.Compile(context.Background(), Project{Files: files("vibe"), Config: moduleCounterpartConfig("legacy", "vibe", test.cjs, test.emit)})
			if err != nil {
				t.Fatal(err)
			}
			reference, err := w.Compile(context.Background(), Project{Files: files("ts"), Config: moduleCounterpartConfig("force", "ts", test.cjs, test.emit)})
			if err != nil {
				t.Fatal(err)
			}
			codes := func(result *Result) []int {
				out := []int{}
				for _, diagnostic := range result.Diagnostics {
					out = append(out, int(diagnostic.Code()))
				}
				slices.Sort(out)
				return out
			}
			wantCodes := []int{}
			if test.name == "strict-arguments" {
				wantCodes = []int{1215}
			}
			if !reflect.DeepEqual(codes(reference), wantCodes) {
				t.Fatalf("invalid native reference: codes=%v, want %v", codes(reference), wantCodes)
			}
			if test.emit {
				for _, name := range []string{"out/a.js", "out/a.d.ts"} {
					if _, ok := reference.Outputs[name]; !ok {
						t.Fatalf("native reference did not emit %s", name)
					}
				}
			}
			if !reflect.DeepEqual(codes(actual), codes(reference)) {
				t.Fatalf("native module context differs: Vibe=%v TypeScript=%v", codes(actual), codes(reference))
			}
			for name, want := range reference.Outputs {
				if strings.HasSuffix(name, ".js") || strings.HasSuffix(name, ".d.ts") {
					if got := actual.Outputs[name]; got != want {
						t.Errorf("module output %s differs from native forced-module reference:\nVibe: %s\nTypeScript: %s", name, got, want)
					}
				}
			}
		})
	}
}
