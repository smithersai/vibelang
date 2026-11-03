package ls_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// VIP-40: each module is an ES module, rather than a merging TypeScript
// namespace. LSP 3.17 documentSymbol lists all symbols in the document.
// An invalid duplicate still needs its own outline entry and name span.
func TestVibeModuleDocumentSymbols(t *testing.T) {
	for _, count := range []int{1, 2, 3, 5} {
		for _, trivia := range []string{" ", " /* name */ ", "\t"} {
			t.Run(fmt.Sprintf("%d/%q", count, trivia), func(t *testing.T) {
				checkVibeModuleSymbols(t, "text", trivia, count)
			})
		}
	}
}

func moduleSymbols(t *testing.T, fileName, source string) ([]*lsproto.DocumentSymbol, *compiler.Program, *lsconv.Converters) {
	t.Helper()
	files := map[string]string{
		fileName:                 source,
		"/project/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","skipLibCheck":true},"files":[%q]}`, strings.TrimPrefix(fileName, "/project/")),
	}
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		return lsconv.ComputeLSPLineStarts(files[string(name)])
	})
	service := ls.NewLanguageService(nil, p, retiredModulesHost{trustedFixHost: trustedFixHost{converters: converters}, files: files}, fileName)
	capabilities := &lsproto.ResolvedClientCapabilities{}
	capabilities.TextDocument.DocumentSymbol.HierarchicalDocumentSymbolSupport = true
	ctx := lsproto.WithClientCapabilities(t.Context(), capabilities)
	response, err := service.ProvideDocumentSymbols(ctx, lsconv.FileNameToDocumentURI(tspath.RootedFilePath(fileName)))
	if err != nil {
		t.Fatal(err)
	}
	if response.DocumentSymbols == nil {
		t.Fatal("no hierarchical document symbols")
	}
	return *response.DocumentSymbols, p, converters
}

func checkVibeModuleSymbols(t *testing.T, name, trivia string, count int) {
	t.Helper()
	source := "/* prefix 雪 */\n"
	var starts []int
	for i := 0; i < count; i++ {
		source += "module" + trivia
		starts = append(starts, len(source))
		source += fmt.Sprintf("%s { export const value%d = %d }\n", name, i, i)
	}
	symbols, p, converters := moduleSymbols(t, "/project/main.vibe", source)
	var modules []*lsproto.DocumentSymbol
	for _, symbol := range symbols {
		if symbol.Name == name {
			modules = append(modules, symbol)
		}
	}
	if len(modules) != count {
		t.Fatalf("%d module entries; want %d independent declarations", len(modules), count)
	}
	file := p.GetSourceFile("/project/main.vibe")
	for i, symbol := range modules {
		if symbol.Kind != lsproto.SymbolKindModule {
			t.Errorf("module kind = %v; want Module", symbol.Kind)
		}
		start, _ := converters.ToLSPPosition(file, core.TextPos(starts[i]))
		end, _ := converters.ToLSPPosition(file, core.TextPos(starts[i]+len(name)))
		want := lsproto.Range{Start: start, End: end}
		if symbol.SelectionRange != want {
			t.Errorf("module %d selects %v; want its own name at %v", i, symbol.SelectionRange, want)
		}
	}
}

func TestTypeScriptNamespacesStillMergeInOutline(t *testing.T) {
	symbols, _, _ := moduleSymbols(t, "/project/main.ts", "namespace text { export const one = 1 }\nnamespace text { export const two = 2 }\n")
	if len(symbols) != 1 || symbols[0].Name != "text" || symbols[0].Kind != lsproto.SymbolKindNamespace {
		t.Fatalf("ordinary TypeScript namespace outline changed: %+v", symbols)
	}
	if symbols[0].Children == nil || len(*symbols[0].Children) != 2 {
		t.Fatal("merged namespace lost members")
	}
}

// Independent ES modules (VIP-40) and the LSP 3.17 all-symbols contract apply
// to repeated names with varied spelling, count and trivia, including errors.
func FuzzVibeModuleDocumentSymbols(f *testing.F) {
	for _, seed := range []string{"text", "Text", "m_0", "long_name"} {
		f.Add(seed, uint8(2), uint8(0))
	}
	f.Fuzz(func(t *testing.T, raw string, n, space uint8) {
		if len(raw) > 24 {
			return
		}
		name := "m"
		for _, b := range []byte(raw) {
			name += string("abcdefghijklmnopqrstuvwxyz_"[int(b)%27])
		}
		trivia := []string{" ", " /* keep */ ", "  /* trivia */  ", "\t"}[int(space)%4]
		checkVibeModuleSymbols(t, name, trivia, 1+int(n)%5)
	})
}
