package compiler

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestForkHostRejectsInvalidUTF8BeforeJSONEncoding(t *testing.T) {
	// The executable must never be invoked for malformed in-memory data.
	backend := &forkCompiler{executable: filepath.Join(t.TempDir(), "not-an-executable")}
	for name, mutate := range map[string]func(*CompileRequest){
		"source":        func(r *CompileRequest) { r.Files[0].Text = "const x = '\xff'" },
		"path":          func(r *CompileRequest) { r.Files[0].Path = "bad\xff.ts" },
		"root":          func(r *CompileRequest) { r.RootNames[0] = "bad\xff.ts" },
		"option value":  func(r *CompileRequest) { r.Options = Options{"module": "\xff"} },
		"option key":    func(r *CompileRequest) { r.Options = Options{"\xff": true} },
		"nested option": func(r *CompileRequest) { r.Options = Options{"paths": map[string]any{"name": []string{"\xff"}}} },
		"config":        func(r *CompileRequest) { r.ConfigFile = &ConfigFile{Path: "tsconfig.json", Text: "\xff"} },
		"policy":        func(r *CompileRequest) { r.SourcePolicy = &SourcePolicy{MessagePrefix: "\xff"} },
	} {
		t.Run(name, func(t *testing.T) {
			request := CompileRequest{RootNames: []string{"main.ts"}, Files: []SourceFile{{Path: "main.ts", Kind: FileKindTypeScript, Text: "export const x = 42"}}, Lowering: LoweringTypeScript}
			mutate(&request)
			result, err := backend.Compile(context.Background(), request)
			if !errors.Is(err, ErrForkProtocol) || !strings.Contains(err.Error(), "invalid UTF-8") || !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatalf("result=%+v error=%v", result, err)
			}
		})
	}
	t.Run("disk source", func(t *testing.T) {
		root := t.TempDir()
		if err := os.WriteFile(filepath.Join(root, "main.ts"), []byte("const x = '\xff'"), 0o600); err != nil {
			t.Fatal(err)
		}
		result, err := backend.Compile(context.Background(), CompileRequest{RootDir: root, RootNames: []string{"main.ts"}, Lowering: LoweringTypeScript})
		if !errors.Is(err, ErrForkProtocol) || !strings.Contains(err.Error(), "invalid UTF-8") || !result.EmitSkipped {
			t.Fatalf("result=%+v error=%v", result, err)
		}
	})
	for _, field := range []string{"path", "source"} {
		t.Run("inspection "+field, func(t *testing.T) {
			file := InspectionSource{Path: "main.ts", Text: "export const x = 42", ScriptKind: "typescript"}
			if field == "path" {
				file.Path = "bad\xff.ts"
			} else {
				file.Text = "\xff"
			}
			result, err := backend.Inspect(context.Background(), InspectionRequest{Files: []InspectionSource{file}})
			if !errors.Is(err, ErrForkProtocol) || !strings.Contains(err.Error(), "invalid UTF-8") || len(result.Files) != 0 {
				t.Fatalf("result=%+v error=%v", result, err)
			}
		})
	}
}
