package vibelang

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func platformImportProgram(t *testing.T, source string, verbatim bool) (*compiler.Program, *ast.SourceFile, *ls.LanguageService, *lsconv.Converters) {
	t.Helper()
	dir := t.TempDir()
	config := map[string]any{"compilerOptions": map[string]any{"strict": true, "target": "ESNext", "module": "NodeNext", "skipLibCheck": true, "noEmit": true, "types": []string{}, "verbatimModuleSyntax": verbatim}, "files": []string{"main.vibe", "node.d.ts"}}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	for name, text := range map[string]string{
		"package.json":  `{"name":"platform-import-tests","type":"module"}`,
		"tsconfig.json": string(encoded),
		"main.vibe":     source,
		"node.d.ts": `declare module "node:fs" {
  export interface Stats { size: number }
  export interface Dirent { name: string }
  export interface type { name: string }
  export function readFile(): void
}
declare module "fs" { export interface Stats { size: number } }
declare module "node:path" {}
declare module "ordinary" { export interface Stats { size: number } }
`,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(parsed.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, parsed.Errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	file := program.GetSourceFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe"))))
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		text, ok := fs.ReadFile(name)
		if !ok {
			t.Fatalf("missing %s", name)
		}
		return lsconv.ComputeLSPLineStarts(text)
	})
	service := ls.NewLanguageService(nil, program, editorTestHost{converters: converters}, string(file.FileName()))
	return program, file, service, converters
}

// Chapter 900: EK4402 diagnostic - spec-rule: docs/design/src/900-appendices.md#e6d5dcb09e498dc2
func TestPlatformInlineTypeImports(t *testing.T) {
	for _, test := range []struct {
		name, source string
		verbatim     bool
		want         int
	}{
		{"preserved inline", `import { type Stats } from "node:fs"; export type T=Stats`, true, 1},
		{"preserved empty", `import {} from "node:path"; export type T=number`, true, 1},
		{"whole type", `import type { Stats } from "node:fs"; export type T=Stats`, true, 0},
		{"elided inline", `import { type Stats } from "node:fs"; export type T=Stats`, false, 0},
		{"elided empty", `import {} from "node:path"; export type T=number`, false, 0},
		{"bare builtin", `import { type Stats } from "fs"; export type T=Stats`, true, 1},
		{"ordinary dependency", `import { type Stats } from "ordinary"; export type T=Stats`, true, 0},
		{"mixed existing error", `import { type Stats, readFile } from "node:fs"; export type T=Stats`, true, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, file, _, _ := platformImportProgram(t, test.source, test.verbatim)
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() != diagnosticSource || d.Code() != 4402 {
					t.Errorf("unexpected diagnostic: %s", d.String())
				} else {
					count++
				}
			}
			if count != test.want {
				t.Fatalf("want %d EK4402, got %d", test.want, count)
			}
		})
	}
}
