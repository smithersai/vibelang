package ls_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/project"
	"github.com/microsoft/TypeScript/tsc/internal/project/logging"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// An arrow returning a cold program stays plain. Editing its return contract
// must refresh the ordinary assignability error without reopening the file.
func TestFormChoiceDidChange(t *testing.T) {
	const name = "/src/main.vibe"
	const uri = lsproto.DocumentUri("file:///src/main.vibe")
	const source = `import { work } from "./host"; export const fn = (x: number) => { const n=work(x); return n }`
	files := map[string]string{
		"/src/tsconfig.json": `{"compilerOptions":{"strict":true,"target":"ESNext","module":"ESNext","moduleResolution":"bundler","skipLibCheck":true},"files":["main.vibe","host.ts"]}`,
		name:                 source,
		"/src/host.ts":       `import type { Effect } from "effect/Effect"; export declare function work(x: number): Effect<number>`,
		"/src/node_modules/vibelang-runtime/package.json": `{"name":"vibelang-runtime","types":"index.d.ts"}`,
		"/src/node_modules/vibelang-runtime/index.d.ts":   `export * as Effect from "effect/Effect"`,
		"/src/node_modules/effect/package.json":           `{"name":"effect","types":"index.d.ts"}`,
		"/src/node_modules/effect/index.d.ts":             `export * as Effect from "./Effect"`,
		"/src/node_modules/effect/Effect.d.ts":            `export interface Effect<A,E=never,R=never> { readonly "~effect/Effect": { readonly _A: (_:never)=>A; readonly _E: (_:never)=>E; readonly _R: (_:never)=>R } }`,
	}
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
	session := project.NewSession(&project.SessionInit{BackgroundCtx: t.Context(), Options: &project.SessionOptions{CurrentDirectory: "/src", DefaultLibraryPath: bundled.LibPath(), PositionEncoding: lsproto.PositionEncodingKindUTF16, WatchEnabled: false}, FS: fs, Logger: logging.NewTestLogger()})
	session.DidOpenFile(t.Context(), uri, 1, source, lsproto.LanguageKindTypeScript)
	check := func(want int32) {
		t.Helper()
		service, err := session.GetLanguageService(t.Context(), uri)
		if err != nil {
			t.Fatal(err)
		}
		report, err := service.ProvideDiagnostics(t.Context(), uri)
		if err != nil {
			t.Fatal(err)
		}
		items := report.FullDocumentDiagnosticReport.Items
		if want == 0 {
			if len(items) != 0 {
				t.Fatalf("unexpected editor diagnostics: %v", items)
			}
		} else if len(items) != 1 || items[0].Code == nil || items[0].Code.Integer == nil || *items[0].Code.Integer != want {
			t.Fatalf("expected TS%d, got %v", want, items)
		}
	}
	check(0)
	annotated := strings.Replace(source, "(x: number) =>", "(x: number): number =>", 1)
	for i, edit := range []string{annotated, source} {
		session.DidChangeFile(t.Context(), uri, int32(i+2), []lsproto.TextDocumentContentChangePartialOrWholeDocument{{WholeDocument: &lsproto.TextDocumentContentChangeWholeDocument{Text: edit}}})
		if i == 0 {
			check(2322)
		} else {
			check(0)
		}
	}
}
