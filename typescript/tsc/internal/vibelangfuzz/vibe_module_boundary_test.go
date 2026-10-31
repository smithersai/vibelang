package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const vibeModuleBoundaryQuote = "every source `.vibe` file is an external module before binding and checking, independently of imports and prelude switches"

func TestVibeModuleBoundaryQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), vibeModuleBoundaryQuote) {
		t.Fatalf("missing module rule: %s", vibeModuleBoundaryQuote)
	}
}

func moduleBoundaryConfig(mode string, mask int, names []string, emit bool) string {
	options := map[string]any{"target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "moduleDetection": mode, "strict": true, "skipLibCheck": true, "types": []string{}, "noEmit": !emit, "declaration": emit, "outDir": "out"}
	data, err := json.Marshal(map[string]any{"compilerOptions": options, "vibe": map[string]any{"effectGlobals": mask&1 != 0, "effectModules": mask&2 != 0}, "files": names})
	if err != nil {
		panic(err)
	}
	return string(data)
}

func TestVibeModuleBoundaryRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, mode := range []string{"legacy", "auto", "force"} {
		for mask := 0; mask < 4; mask++ {
			for _, role := range []string{"isolation", "duplicate"} {
				t.Run(fmt.Sprintf("%s/%s/prelude%d", role, mode, mask), func(t *testing.T) {
					files := map[string]string{"package.json": "{\"type\":\"commonjs\"}"}
					if role == "isolation" {
						files["a.vibe"] = "const policySecret = 1\n"
						files["b.vibe"] = "const reader = policySecret\n"
					} else {
						files["a.vibe"] = "const localOnly = 1\n"
						files["b.vibe"] = "const localOnly = 2\n"
					}
					result, err := w.Compile(context.Background(), Project{Files: files, Config: moduleBoundaryConfig(mode, mask, []string{"a.vibe", "b.vibe"}, false)})
					if err != nil {
						t.Fatal(err)
					}
					var codes []int
					for _, diagnostic := range result.Diagnostics {
						codes = append(codes, int(diagnostic.Code()))
					}
					if result.Program == nil {
						t.Fatalf("stage=config: no program, codes=%v", codes)
					}
					for _, file := range result.Program.SourceFiles() {
						name := filepath.Base(file.FileName().AsString())
						if (name == "a.vibe" || name == "b.vibe") && file.ExternalModuleIndicator == nil {
							t.Errorf("stage=classification file=%s kind=%v declaration=%v module=false, expected true; diagnostics=%v", name, file.ScriptKind, file.IsDeclarationFile, codes)
						}
					}
					if role == "isolation" {
						if len(codes) != 1 || codes[0] != 2304 {
							t.Errorf("stage=checking: private source binding leaked: codes=%v, expected [2304]", codes)
						}
					} else if len(codes) != 0 {
						t.Errorf("stage=checking: unrelated module locals conflict: codes=%v, expected []", codes)
					}
				})
			}
		}
	}
	t.Run("ordinary-ts-remains-script", func(t *testing.T) {
		result, err := w.Compile(context.Background(), Project{Files: map[string]string{"a.ts": "const policySecret = 1\n", "b.ts": "const reader = policySecret\n", "package.json": "{\"type\":\"commonjs\"}"}, Config: moduleBoundaryConfig("legacy", 0, []string{"a.ts", "b.ts"}, false)})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Diagnostics) != 0 {
			t.Fatalf("ordinary TypeScript script control changed: %v", result.Diagnostics)
		}
	})
}

func TestVibeModuleBoundaryEmission(t *testing.T) {
	w := NewWorkspace(t)
	result, err := w.Compile(context.Background(), Project{Files: map[string]string{"a.vibe": "const modulePrivate = 1\n", "package.json": "{\"type\":\"module\"}"}, Config: moduleBoundaryConfig("legacy", 0, []string{"a.vibe"}, true)})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Diagnostics) != 0 {
		t.Fatalf("stage=checking: %v", result.Diagnostics)
	}
	var js, decl bool
	for name, text := range result.Outputs {
		if strings.HasSuffix(name, ".js") {
			js = true
			if !strings.Contains(text, "export ") && !strings.Contains(text, "import ") {
				t.Errorf("stage=emit file=%s lost its module marker: %q", name, text)
			}
		}
		if strings.HasSuffix(name, ".d.ts") || strings.HasSuffix(name, ".d.vibe.ts") {
			decl = true
			if !strings.Contains(text, "export ") && !strings.Contains(text, "import ") {
				t.Errorf("stage=declarations file=%s lost its module marker: %q", name, text)
			}
		}
	}
	if !js || !decl {
		t.Fatalf("missing module outputs: js=%v declaration=%v paths=%v", js, decl, result.Outputs)
	}
}
