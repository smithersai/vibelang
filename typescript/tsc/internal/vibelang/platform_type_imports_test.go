package vibelang

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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

func TestPlatformInlineTypeImportQuickFix(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"aliases", `import { type Stats, type Dirent as Entry } from "node:fs"
export type Both = Stats | Entry
`, `import type { Stats, Dirent as Entry } from "node:fs"
export type Both = Stats | Entry
`},
		{"comments and keyword name", `const café = "😀";
import /* module */ { type /* keep */ type as T } from "node:fs"
export type Both = T
`, `const café = "😀";
import type /* module */ { /* keep */ type as T } from "node:fs"
export type Both = T
`},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, file, service, converters := platformImportProgram(t, test.source, true)
			var found *ast.Diagnostic
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == 4402 {
					found = d
					break
				}
			}
			if found == nil {
				t.Fatal("missing EK4402")
			}
			d := lsconv.DiagnosticToLSPPush(t.Context(), converters, found)
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
			})
			if err != nil {
				t.Fatal(err)
			}
			var chosen *lsproto.CodeAction
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Write import type") {
						chosen = action.CodeAction
					}
				}
			}
			if chosen == nil || chosen.Edit == nil || chosen.Edit.Changes == nil {
				t.Fatal("missing import type action")
			}
			changes := *chosen.Edit.Changes
			fixed := applyEditorEdits(t, file, converters, changes[lsconv.FileNameToDocumentURI(file.FileName())])
			if fixed != test.want {
				t.Fatalf("got:\n%s\nwant:\n%s", fixed, test.want)
			}
			checked, next, _, _ := platformImportProgram(t, fixed, true)
			if got := checked.GetSemanticDiagnostics(t.Context(), next); len(got) != 0 {
				t.Fatalf("fixed source: %v", got)
			}
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
			if got, ok := result.Files[file.FileName()]; !ok || got.Text != test.want {
				t.Fatalf("--fix: %+v", result)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), checked.CommandLine(), FixOptions{})
			if len(again.Files) != 0 {
				t.Fatalf("second --fix: %+v", again)
			}
		})
	}
}
