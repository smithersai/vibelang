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
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// checkInferredDiagnosticEmit checks editor-only advice against the projection
// while ordinary compiler diagnostics and emit stay independent.
func checkInferredDiagnosticEmit(t *testing.T, files map[string]string) {
	t.Helper()
	fs := inferredFileSystem(files)
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
	// Compiler collections must stay free of the editor-only resolver, even
	// when the editor warning is configured as an error.
	for _, d := range append(p.GetSemanticDiagnostics(t.Context(), file), p.GetSuggestionDiagnostics(t.Context(), file)...) {
		if d.Code() == 2345 {
			t.Fatalf("callback form changed: %s", d.MessageText())
		}
		if d.Code() == 9100 {
			t.Fatal("EK9100 ran in the compiler")
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
	if forkChoices != projectorChoices {
		t.Fatalf("fork choices=%d projector choices=%d", forkChoices, projectorChoices)
	}
	var emitted inferredEmit
	p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(string(name), "main.js") {
			emitted.JS = text
		}
		if strings.HasSuffix(string(name), "main.d.ts") {
			emitted.DTS = text
		}
		return nil
	}})
	if emitted.JS == "" || emitted.DTS == "" {
		t.Fatal("no JavaScript emitted")
	}
}

// inferredEmit records declarations and JavaScript from the same program.
type inferredEmit struct{ JS, DTS string }

// inferredFileSystem resolves Effect through its external symlink when present,
// so the same LS transaction and declaration consumer cover linked packages.
func inferredFileSystem(files map[string]string) vfs.FS {
	entries := make(map[string]any, len(files)+1)
	for name, text := range files {
		entries[name] = text
	}
	if _, linked := files["/external/experiments/node_modules/effect/package.json"]; linked {
		entries["/src/node_modules/effect"] = vfstest.Symlink("/external/experiments/node_modules/effect")
		entries["/src/node_modules/vibelang-runtime"] = vfstest.Symlink("/external/runtime")
		entries["/external/runtime/node_modules/effect"] = vfstest.Symlink("/external/experiments/node_modules/effect")
	}
	return bundled.WrapFS(vfstest.FromMap(entries, tspath.CaseInsensitive))
}

// TestInferredFormFixDeclinesPausingPlainCallback checks that the fix offers
// A pausing callback retains its projection choice and compiler diagnostics.
func TestPausingCallbackRetainsProjectionChoice(t *testing.T) {
	files := map[string]string{
		"/src/tsconfig.json": `{"compilerOptions":{"strict":true,"target":"ESNext","declaration":true},"files":["main.vibe","host.ts"]}`,
		"/src/host.ts":       `import type { Effect } from "effect/Effect"; export declare function work(x: number): Effect<number,never,never>; export declare function takesPlain(f: (x: number) => number): number`,
		"/src/main.vibe":     `import { work, takesPlain } from "./host"; export function run() { return takesPlain((x: number) => { try work(x); return x }) }`,
		"/src/node_modules/vibelang-runtime/package.json": `{"name":"vibelang-runtime","types":"index.d.ts"}`,
		"/src/node_modules/vibelang-runtime/index.d.ts":   `export * as Effect from "effect/Effect"`,
		"/src/node_modules/effect/package.json":           `{"name":"effect","types":"index.d.ts"}`,
		"/src/node_modules/effect/index.d.ts":             `export * as Effect from "./Effect"`,
		"/src/node_modules/effect/Effect.d.ts":            `export interface Effect<A,E=never,R=never> { readonly "~effect/Effect": { readonly _A: (_:never)=>A; readonly _E: (_:never)=>E; readonly _R: (_:never)=>R } }`,
	}
	choices := 0
	for _, d := range vibelangmapper.Project(files["/src/main.vibe"], vibelangmapper.FileContext{}).Diagnostics {
		if d.Code == vibelangmapper.CodeFormChoice {
			choices++
		}
	}
	if choices == 0 {
		t.Fatal("the projector asks for no annotation, so this case tests nothing")
	}
	checkInferredDiagnosticEmit(t, files)
}

// VIP-11 denies trailing blocks. Preserve the two historical inference fixtures
// as rejection witnesses; only ordinary Effect arguments participate in the
// successful inference and emit comparisons above.
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
