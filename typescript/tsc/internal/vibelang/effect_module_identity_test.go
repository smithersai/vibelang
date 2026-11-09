package vibelang

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestEffectModulePackageIdentity(t *testing.T) {
	t.Parallel()
	for _, module := range []string{"Effect", "Context", "Fiber", "Stream", "Scope", "Cause", "Data", "Option", "Exit", "Result", "Duration"} {
		for _, tc := range []struct {
			name, root, suffix, pkg string
			nestedScope, want       bool
		}{
			{"numbered", "/workspace/x/packages/71", "/dist/", "effect", false, true},
			{"unicode", "/workspace/x/store/效果 space%25", "/dist/", "effect", false, true},
			{"source", "/workspace/x/packages/123", "/src/", "effect", false, true},
			{"nested-type-scope", "/workspace/x/packages/71", "/dist/", "effect", true, true},
			{"other-package", "/workspace/x/packages/71", "/dist/", "unrelated", false, false},
			{"nested-module", "/workspace/x/packages/71", "/nested/dist/", "effect", false, false},
		} {
			t.Run(module+"/"+tc.name, func(t *testing.T) {
				extension := ".d.ts"
				if tc.suffix == "/src/" {
					extension = ".ts"
				}
				name := tc.root + tc.suffix + module + extension
				config, _ := json.Marshal(map[string]any{
					"compilerOptions": map[string]any{"strict": true, "types": []string{}},
					"files":           []string{name},
				})
				files := map[string]string{
					"/workspace/x/src/tsconfig.json": string(config),
					tc.root + "/package.json":        `{"name":"` + tc.pkg + `","type":"module"}`,
					name:                             "export interface Value {}",
				}
				if tc.nestedScope {
					files[tc.root+"/dist/package.json"] = `{"type":"module"}`
				}
				p := computedKeyProgram(t, files)
				var source *ast.SourceFile
				for _, file := range p.SourceFiles() {
					if file.FileName().AsString() == name {
						source = file
						break
					}
				}
				if source == nil {
					t.Fatal("module was not loaded")
				}
				c, done := p.GetTypeCheckerForFile(t.Context(), source)
				defer done()
				if got := isEffectModuleFile(c, source, module); got != tc.want {
					t.Fatalf("module identity: got %v, want %v", got, tc.want)
				}
				if isEffectModuleFile(c, source, "Unrelated") {
					t.Fatal("a different module name matched")
				}
				if isEffectModuleFile(c, nil, strings.ToLower(module)) {
					t.Fatal("a missing source matched")
				}
			})
		}
	}
}
