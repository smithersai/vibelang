package vibelang

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestPlatformImportEquals(t *testing.T) {
	var rows []struct {
		Key, Source, Mode string
		Errors            []string
	}
	data, err := os.ReadFile("../vibelangfuzz/testdata/platform-import-equals.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		t.Run(row.Key, func(t *testing.T) {
			p := platformImportEqualsProgram(t, row.Source, row.Mode)
			var codes []string
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), nil), p.GetSemanticDiagnostics(t.Context(), nil)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				prefix := d.Source()
				if prefix == "" {
					prefix = "TS"
				}
				codes = append(codes, fmt.Sprintf("%s%d", prefix, d.Code()))
			}
			slices.Sort(codes)
			if !slices.Equal(codes, row.Errors) {
				t.Fatalf("import rule wants %v, got %v", row.Errors, codes)
			}
		})
	}
}
func platformImportEqualsProgram(t *testing.T, source, mode string) *compiler.Program {
	t.Helper()
	dir := t.TempDir()
	kind := "module"
	if mode == "cjs" {
		kind = "commonjs"
	}
	modules := []string{"node:fs", "fs", "node:fs/promises", "child_process", "node:test", "node:sqlite", "test", "fs-extra"}
	ambient := ""
	for _, name := range modules {
		ambient += fmt.Sprintf("declare module %q { export const marker:number }\n", name)
	}
	config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe","node.d.ts","node_modules/@types/node/index.d.ts"]}`
	for name, text := range map[string]string{"main.vibe": source, "node.d.ts": ambient, "node_modules/@types/node/package.json": `{"name":"@types/node","types":"index.d.ts"}`, "node_modules/@types/node/index.d.ts": "declare namespace HostRuntime { const value:number; namespace platform { const value:number } }\ndeclare namespace Bun { const value:number; namespace platform { const value:number } }\n", "package.json": fmt.Sprintf(`{"type":%q}`, kind), "tsconfig.json": config} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, name)), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	path := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(path, &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(parsed.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, parsed.Errors)
	}
	return compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
}
