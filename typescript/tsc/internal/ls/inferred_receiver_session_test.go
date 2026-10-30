package ls_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/project"
	"github.com/microsoft/TypeScript/tsc/internal/project/logging"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// TestReceiverChoiceDidChange keeps EK9101 on demand for open files and
// invalidates the cached choices when an annotation is applied or removed.
func TestReceiverChoiceDidChange(t *testing.T) {
	const name = "/src/main.vibe"
	const uri = lsproto.DocumentUri("file:///src/main.vibe")
	const source = `import { work } from "./host"; export function fn() { const todos = work(1); return todos.map((n: number): number => n) }`
	files := map[string]string{
		"/src/tsconfig.json": `{"compilerOptions":{"strict":true,"target":"ESNext"},"files":["main.vibe","closed.vibe","host.ts"]}`,
		name:                 source,
		"/src/closed.vibe":   source,
		"/src/host.ts":       `import type { Effect } from "effect/Effect"; export declare function work(x: number): number[]`,
		"/src/node_modules/vibelang-runtime/package.json": `{"name":"vibelang-runtime","types":"index.d.ts"}`,
		"/src/node_modules/vibelang-runtime/index.d.ts":   `export * as Effect from "effect/Effect"`,
		"/src/node_modules/effect/package.json":           `{"name":"effect","types":"index.d.ts"}`,
		"/src/node_modules/effect/index.d.ts":             `export * as Effect from "./Effect"`,
		"/src/node_modules/effect/Effect.d.ts":            `export interface Effect<A,E=never,R=never> { readonly "~effect/Effect": { readonly _A: (_:never)=>A; readonly _E: (_:never)=>E; readonly _R: (_:never)=>R } }`,
	}
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
	session := project.NewSession(&project.SessionInit{BackgroundCtx: t.Context(), Options: &project.SessionOptions{CurrentDirectory: "/src", DefaultLibraryPath: bundled.LibPath(), PositionEncoding: lsproto.PositionEncodingKindUTF16, WatchEnabled: false}, FS: fs, Logger: logging.NewTestLogger()})
	session.DidOpenFile(t.Context(), uri, 1, source, lsproto.LanguageKindTypeScript)
	get := func() *ls.LanguageService {
		s, err := session.GetLanguageService(t.Context(), uri)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	report := func(s *ls.LanguageService, u lsproto.DocumentUri) []*lsproto.Diagnostic {
		r, err := s.ProvideDiagnostics(t.Context(), u)
		if err != nil {
			t.Fatal(err)
		}
		return r.FullDocumentDiagnosticReport.Items
	}
	var diag *lsproto.Diagnostic
	service := get()
	for _, d := range report(service, uri) {
		if d.Code != nil && d.Code.Integer != nil && *d.Code.Integer == 9101 {
			diag = d
		}
	}
	if diag == nil {
		t.Fatal("open file has no EK9101")
	}
	for _, d := range report(service, "file:///src/closed.vibe") {
		if d.Code != nil && d.Code.Integer != nil && *d.Code.Integer == 9101 {
			t.Fatal("resolver ran for a closed file")
		}
	}
	only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
	response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: diag.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diag}, Only: &only}})
	if err != nil {
		t.Fatal(err)
	}
	applied := false
	for _, a := range *response.CommandOrCodeActionArray {
		if a.CodeAction != nil && a.CodeAction.Title == "Annotate as the fork infers" {
			applyTrustedAction(t, files, a.CodeAction)
			applied = true
			break
		}
	}
	if !applied {
		t.Fatal("no annotation action")
	}
	session.DidChangeFile(t.Context(), uri, 2, []lsproto.TextDocumentContentChangePartialOrWholeDocument{{WholeDocument: &lsproto.TextDocumentContentChangeWholeDocument{Text: files[name]}}})
	changed := get()
	for _, d := range report(changed, uri) {
		if d.Code != nil && d.Code.Integer != nil {
			switch *d.Code.Integer {
			case 2503, 9203, 9101:
				t.Errorf("stale diagnostic after didChange: %d %s", *d.Code.Integer, *d.Message.String)
			}
		}
	}
	session.DidChangeFile(t.Context(), uri, 3, []lsproto.TextDocumentContentChangePartialOrWholeDocument{{WholeDocument: &lsproto.TextDocumentContentChangeWholeDocument{Text: source}}})
	count := 0
	for _, d := range report(get(), uri) {
		if d.Code != nil && d.Code.Integer != nil && *d.Code.Integer == 9101 {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("file-version cache did not invalidate: %d choices", count)
	}
}
