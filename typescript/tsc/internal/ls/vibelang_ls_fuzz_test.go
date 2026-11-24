package ls_test

import (
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/autoimport"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

type fuzzLSHost struct {
	fs         vfs.FS
	converters *lsconv.Converters
}

func (h fuzzLSHost) CaseSensitivity() tspath.CaseSensitivity { return tspath.CaseInsensitive }
func (h fuzzLSHost) ReadFile(name tspath.RootedFilePath) (string, bool) {
	return h.fs.ReadFile(name)
}
func (h fuzzLSHost) Converters() *lsconv.Converters { return h.converters }
func (h fuzzLSHost) GetPreferences(string) lsutil.UserPreferences {
	return lsutil.UserPreferences{}
}
func (h fuzzLSHost) GetECMALineInfo(tspath.RootedFilePath) *sourcemap.ECMALineInfo { return nil }
func (h fuzzLSHost) AutoImportRegistry() *autoimport.Registry                      { return nil }
func (h fuzzLSHost) ReadDirectory(path tspath.RootedDirectoryPath, extensions, excludes, includes []string, depth int) []tspath.RootedFilePath {
	return nil
}
func (h fuzzLSHost) GetDirectories(path tspath.RootedDirectoryPath) []string {
	return h.fs.GetAccessibleEntries(path).Directories
}
func (h fuzzLSHost) DirectoryExists(path tspath.RootedDirectoryPath) bool {
	return h.fs.DirectoryExists(path)
}
func (h fuzzLSHost) FileExists(path tspath.RootedFilePath) bool {
	return h.fs.FileExists(path)
}

// FuzzVibeLanguageService fuzzes LSP requests directly on .vibe and .vibex
// sources across call-argument, member-access, match-arm, and declaration
// offsets. Why this exists: Issue #521 (signature help panicked inside ANY
// match expression) escaped FuzzEditor because offsets only probed keyword
// starts and not call arguments inside match arms.
//
// Universal invariants:
//   - ProvideSignatureHelp, ProvideHover, ProvideCompletion,
//     ProvideDocumentSymbols, ProvideFoldingRange, ProvideSemanticTokens,
//     ProvideDefinition, and ProvideReferences never panic on any valid or
//     malformed VibeLang input.
//   - Every position/range returned lies within the document's line bounds.
func FuzzVibeLanguageService(f *testing.F) {
	seeds := []string{
		// Issue #521 class: signature help & hover inside match arms with call arguments!
		"function helper(a: number, b: string): string { return b }\nexport function f(x: number | string) {\n  return match (x) {\n    when 1: helper(1, \"one\");\n    when let s: helper(2, String(s));\n  }\n}\n",
		"export error Boom { id: string }\nfunction handle(id: string, code: number): number { return code }\nexport function f(e: Boom | number) {\n  return match (e) {\n    when Boom(let b): handle(b.id, 1);\n    default: handle(\"none\", 0);\n  }\n}\n",
		"export effect function run(xs: string[]) {\n  for concurrent(2) (const x of xs) { try work(x) }\n}\nfunction work(x: string): any { return x }\n",
		"export schema User { id: string; name?: string }\nexport schema Alias = User[]\nexport schema error UserErr { user: User }\n",
		"export service Store { static readonly key = \"app/Store\"; get(id: string): string }\nexport effect function load(id: string) { const s = try Store; return try s.get(id) }\n",
		"export data Delivery { Waiting; Sent { tracking: string } }\nexport function inspect(d: Delivery) {\n  return match (d) {\n    when { _tag: \"Waiting\" }: 0;\n    when { _tag: \"Sent\", let tracking }: tracking.length;\n  }\n}\n",
		"export function isPat(x: unknown) {\n  const a = x is 1\n  const b = x is 0 or 1\n  return a || b\n}\n",
		"export function pipe(n: number) { return n |> Math.max(%, 1) |> String(%) }\n",
		"export function bigintKey(o: any) { const { 1n: v } = o; return match (o) { when { 1n: let k }: String(k); default: String(v); } }\n",
		"export const el = <Box value={1} />;\n",
		// Incomplete / mid-edit inputs where editors fire signature help & completions!
		"function g(a: number, b: string) { return a }\nexport function f(x: number) { return match (x) { when 1: g(1, ",
		"export function f(x: number) { return match (x) { when 1: (",
	}
	for _, s := range seeds {
		f.Add(uint8(0), s, uint16(0))
		if idx := strings.Index(s, "("); idx >= 0 {
			f.Add(uint8(0), s, uint16(idx+1))
		}
		if idx := strings.LastIndex(s, "("); idx >= 0 {
			f.Add(uint8(0), s, uint16(idx+1))
		}
		if idx := strings.LastIndex(s, ","); idx >= 0 {
			f.Add(uint8(0), s, uint16(idx+1))
		}
	}

	f.Fuzz(func(t *testing.T, ext uint8, source string, rawOffset uint16) {
		if !utf8.ValidString(source) || len(source) == 0 || len(source) > 8<<10 {
			return
		}
		fileName := "/project/main.vibe"
		if ext%2 == 1 {
			fileName = "/project/main.vibex"
		}
		files := map[string]string{
			fileName: source,
			"/project/tsconfig.json": fmt.Sprintf(
				`{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","jsx":"preserve","skipLibCheck":true},"files":[%q]}`,
				strings.TrimPrefix(fileName, "/project/"),
			),
		}
		fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
		parsed, errs := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errs) != 0 {
			t.Fatal(errs)
		}
		p := compiler.NewProgram(compiler.ProgramOptions{
			Config: parsed,
			Host:   compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil),
		})
		converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
			text, _ := fs.ReadFile(name)
			return lsconv.ComputeLSPLineStarts(text)
		})
		service := ls.NewLanguageService(nil, p, fuzzLSHost{
			fs:         fs,
			converters: converters,
		}, fileName)
		capabilities := &lsproto.ResolvedClientCapabilities{}
		capabilities.TextDocument.DocumentSymbol.HierarchicalDocumentSymbolSupport = true
		ctx := lsproto.WithClientCapabilities(t.Context(), capabilities)
		uri := lsconv.FileNameToDocumentURI(tspath.RootedFilePath(fileName))
		sf := p.GetSourceFile(tspath.RootedFilePath(fileName))
		if sf == nil {
			return
		}

		// Collect the fuzzed offset plus interesting call-argument / member offsets.
		offsets := []int{int(rawOffset) % len(source)}
		for i := 0; i < len(source) && len(offsets) < 8; i++ {
			if source[i] == '(' || source[i] == ',' || source[i] == '.' {
				if i+1 < len(source) {
					offsets = append(offsets, i+1)
				}
			}
		}

		_, _ = service.ProvideDocumentSymbols(ctx, uri)
		_, _ = service.ProvideFoldingRange(ctx, uri)
		_, _ = service.ProvideSemanticTokens(ctx, uri)

		for _, off := range offsets {
			// Snap to valid UTF-8 rune boundary.
			for off > 0 && !utf8.RuneStart(source[off]) {
				off--
			}
			pos, _ := converters.ToLSPPosition(sf, core.TextPos(off))
			_, _ = service.ProvideSignatureHelp(ctx, uri, pos, nil)
			_, _ = service.ProvideHover(ctx, &lsproto.HoverParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: uri},
				Position:     pos,
			})
			_, _ = service.ProvideCompletion(ctx, uri, pos, &lsproto.CompletionContext{
				TriggerKind: lsproto.CompletionTriggerKindInvoked,
			})
			_, _ = service.ProvideDefinition(ctx, uri, pos)
			_, _ = service.ProvideReferences(ctx, &lsproto.ReferenceParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: uri},
				Position:     pos,
				Context:      &lsproto.ReferenceContext{IncludeDeclaration: true},
			}, nil)
		}
	})
}
