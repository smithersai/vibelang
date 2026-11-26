package ls_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// checkInferredDiagnosticEmit checks a plain arrow returning an unrun Effect
// in the compiler, the editor and the stock-TypeScript projection.
func checkInferredDiagnosticEmit(t *testing.T, files map[string]string) {
	t.Helper()
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		return lsconv.ComputeLSPLineStarts(files[string(name)])
	})
	service := ls.NewLanguageService(nil, p, snapshotTestHost{converters: converters}, "/src/main.vibe")
	file := p.GetSourceFile("/src/main.vibe")
	if file == nil {
		t.Fatal("main.vibe was not loaded")
	}
	for _, diagnostics := range [][]*ast.Diagnostic{
		p.GetProgramDiagnostics(), p.GetGlobalDiagnostics(t.Context()), p.GetSyntacticDiagnostics(t.Context(), nil),
		p.GetSemanticDiagnostics(t.Context(), nil), p.GetDeclarationDiagnostics(t.Context(), nil),
		p.GetSuggestionDiagnostics(t.Context(), file),
	} {
		for _, d := range diagnostics {
			t.Errorf("unexpected compiler diagnostic %d: %s", d.Code(), d.MessageText())
		}
	}
	editor, err := service.ProvideDiagnostics(t.Context(), lsconv.FileNameToDocumentURI(file.FileName()))
	if err != nil {
		t.Fatal(err)
	}
	forkChoices := 0
	for _, diag := range editor.FullDocumentDiagnosticReport.Items {
		if diag.Code == nil || diag.Code.Integer == nil || *diag.Code.Integer != 9100 {
			continue
		}
		forkChoices++
		if diag.Severity == nil || *diag.Severity != lsproto.DiagnosticSeverityWarning {
			t.Fatal("EK9100 is not an editor warning")
		}
	}
	projectorChoices := 0
	for _, d := range vibelangmapper.Project(file.Text(), vibelangmapper.FileContext{}).Diagnostics {
		if d.Code == vibelangmapper.CodeFormChoice {
			projectorChoices++
		}
	}
	if projectorChoices != 0 || forkChoices != 0 {
		t.Fatalf("fork choices=%d projector choices=%d", forkChoices, projectorChoices)
	}
	var emitted inferredEmit
	result := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(string(name), "main.js") {
			emitted.JS = text
		}
		if strings.HasSuffix(string(name), "main.d.ts") {
			emitted.DTS = text
		}
		return nil
	}})
	if result.EmitSkipped || len(result.Diagnostics) != 0 || !strings.Contains(emitted.JS, "work(x)") || !strings.Contains(emitted.DTS, "Effect<number") {
		t.Fatalf("expected JavaScript and declarations, emit result: %+v", result)
	}
}

// inferredEmit records declarations and JavaScript from the same program.
type inferredEmit struct{ JS, DTS string }

func TestReturnedEffectNeedsNoFormChoice(t *testing.T) {
	files := map[string]string{
		"/src/tsconfig.json": `{"compilerOptions":{"strict":true,"target":"ESNext","module":"esnext","moduleResolution":"bundler","skipLibCheck":true,"declaration":true},"files":["main.vibe","host.ts"]}`,
		"/src/host.ts":       `import type { Effect } from "effect/Effect"; export declare function work(x: number): Effect<number,never,never>`,
		"/src/main.vibe":     `import { work } from "./host"; export const run = (x: number) => { const program = work(x); return program }`,
		"/src/node_modules/vibelang-runtime/package.json": `{"name":"vibelang-runtime","types":"index.d.ts"}`,
		"/src/node_modules/vibelang-runtime/index.d.ts":   `export * as Effect from "effect/Effect"`,
		"/src/node_modules/effect/package.json":           `{"name":"effect","types":"index.d.ts"}`,
		"/src/node_modules/effect/index.d.ts":             `export * as Effect from "./Effect"`,
		"/src/node_modules/effect/Effect.d.ts":            `export interface Effect<A,E=never,R=never> { readonly "~effect/Effect": { readonly _A: (_:never)=>A; readonly _E: (_:never)=>E; readonly _R: (_:never)=>R } }`,
	}
	checkInferredDiagnosticEmit(t, files)
}

// VIP-11 denies trailing blocks. Preserve the two historical inference fixtures
// as rejection witnesses alongside the ordinary Effect value above.
func TestInferredFormRejectsRetiredTrailingBlocks(t *testing.T) {
	for _, head := range []string{"host", "host()", "host(1)", "api.host", "api.host(1)"} {
		for _, gap := range []string{" ", "  ", "\t"} {
			for _, body := range []string{"return 1", "try work(1); return 1", "return try work(1)"} {
				source := "export function run() { return " + head + gap + "{ " + body + " } }"
				t.Run(head+gap+body, func(t *testing.T) {
					file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/src/main.vibe")}, source, core.ScriptKindTS)
					if len(file.Diagnostics()) == 0 {
						t.Fatal("retired trailing block parsed without a native rejection")
					}
					for _, d := range vibelangmapper.Project(source, vibelangmapper.FileContext{}).Diagnostics {
						if d.Code == vibelangmapper.CodeFormChoice {
							t.Fatalf("retired trailing block received a form-inference choice: %+v", d)
						}
					}
				})
			}
		}
	}
}
