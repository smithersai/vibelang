package ls_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/project"
	"github.com/microsoft/TypeScript/tsc/internal/project/logging"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func makeBenchSession(b *testing.B, modules int) (*project.Session, lsproto.DocumentUri, string, lsproto.Position) {
	b.Helper()
	files := map[string]string{
		"/src/node_modules/vibelang-runtime/package.json": `{"name":"vibelang-runtime","types":"index.d.ts"}`,
		"/src/node_modules/vibelang-runtime/index.d.ts":   `export * as Effect from "effect/Effect"`,
		"/src/node_modules/effect/package.json":           `{"name":"effect","types":"index.d.ts"}`,
		"/src/node_modules/effect/index.d.ts":             `export * as Effect from "./Effect"`,
		"/src/node_modules/effect/Effect.d.ts":            `export interface Effect<A,E=never,R=never> { readonly "~effect/Effect": { readonly _A: (_:never)=>A; readonly _E: (_:never)=>E; readonly _R: (_:never)=>R } }`,
	}
	names := make([]string, 0, modules)
	var lastSource string
	for i := range modules {
		file := fmt.Sprintf("m%d.vibe", i)
		names = append(names, fmt.Sprintf("%q", file))
		var imp, call string
		if i > 0 {
			imp = fmt.Sprintf("import { step%d } from \"./m%d.vibe\"\n", i-1, i-1)
			call = fmt.Sprintf("step%d(x)", i-1)
		} else {
			call = "x + 1"
		}
		src := fmt.Sprintf(`%sexport interface Item%d { id: string; count: number }
export function step%d(x: number): number {
  const base = %s
  return match (base) {
    when 0: 1;
    when let n: n + %d;
  }
}
`, imp, i, i, call, i+1)
		files["/src/"+file] = src
		lastSource = src
	}
	files["/src/tsconfig.json"] = fmt.Sprintf(
		`{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","moduleResolution":"NodeNext","skipLibCheck":true,"types":[]},"files":[%s]}`,
		strings.Join(names, ","),
	)
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
	session := project.NewSession(&project.SessionInit{
		BackgroundCtx: b.Context(),
		Options: &project.SessionOptions{
			CurrentDirectory:   "/src",
			DefaultLibraryPath: bundled.LibPath(),
			PositionEncoding:   lsproto.PositionEncodingKindUTF16,
			WatchEnabled:       false,
		},
		FS:     fs,
		Logger: logging.NewTestLogger(),
	})
	uri := lsproto.DocumentUri(fmt.Sprintf("file:///src/m%d.vibe", modules-1))
	session.DidOpenFile(b.Context(), uri, 1, lastSource, lsproto.LanguageKindTypeScript)
	pos := lsproto.Position{Line: 2, Character: 18}
	return session, uri, lastSource, pos
}

func BenchmarkLanguageServiceVibeLang(b *testing.B) {
	session, uri, src, pos := makeBenchSession(b, 12)
	svc, err := session.GetLanguageService(b.Context(), uri)
	if err != nil {
		b.Fatal(err)
	}
	// Warm up project graph once.
	if _, err := svc.ProvideDiagnostics(b.Context(), uri); err != nil {
		b.Fatal(err)
	}

	b.Run("Diagnostics_Warm_12mod", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			resp, err := svc.ProvideDiagnostics(b.Context(), uri)
			if err != nil || resp.FullDocumentDiagnosticReport == nil {
				b.Fatalf("ProvideDiagnostics failed: %v", err)
			}
		}
	})

	b.Run("Hover_12mod", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			_, err := svc.ProvideHover(b.Context(), &lsproto.HoverParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos})
			if err != nil {
				b.Fatalf("ProvideHover failed: %v", err)
			}
		}
	})

	b.Run("Completion_12mod", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			_, err := svc.ProvideCompletion(b.Context(), uri, pos, nil)
			if err != nil {
				b.Fatalf("ProvideCompletion failed: %v", err)
			}
		}
	})

	b.Run("DidChange_Diagnostics_12mod", func(b *testing.B) {
		b.ReportAllocs()
		version := int32(2)
		alt := strings.Replace(src, "when 0: 1;", "when 0: 2;", 1)
		for b.Loop() {
			next := alt
			if version%2 == 1 {
				next = src
			}
			session.DidChangeFile(b.Context(), uri, version, []lsproto.TextDocumentContentChangePartialOrWholeDocument{
				{WholeDocument: &lsproto.TextDocumentContentChangeWholeDocument{Text: next}},
			})
			version++
			s, err := session.GetLanguageService(b.Context(), uri)
			if err != nil {
				b.Fatal(err)
			}
			if _, err := s.ProvideDiagnostics(b.Context(), uri); err != nil {
				b.Fatal(err)
			}
		}
	})
}
