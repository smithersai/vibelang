package ls_test

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// A module declaration merges with an imported type of its name, as a
// TypeScript namespace merges with an alias, so renaming the type renames the
// declaration. The specifiers naming the module follow it (VIP-40), or the
// program names a module that no longer exists (EK4006); references return
// them too, since each rename edit is a reference (LSP 3.17).
func TestMergedModuleDeclarationRename(t *testing.T) {
	for _, tail := range []string{
		"import { n } from M\n",
		"import M\n",
		"export { n } from M\nimport { n as k } from M\n",
	} {
		t.Run(strings.TrimSpace(tail), func(t *testing.T) {
			checkMergedModuleRename(t, "import type { M } from \"./other.ts\"\nmodule M { export const n = 0 }\n"+tail)
		})
	}
}

func checkMergedModuleRename(t *testing.T, source string) {
	t.Helper()
	service, p, converters := mergedModuleService(t, source)
	file := p.GetSourceFile("/project/main.vibe")
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	at, _ := converters.ToLSPPosition(file, core.TextPos(strings.Index(source, "M }")))
	response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: at, NewName: "Fresh"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil {
		t.Fatal("rename returned no edits")
	}
	got := applyModuleEdits(source, (*response.WorkspaceEdit.Changes)[uri])
	if !strings.Contains(got, "module Fresh {") {
		t.Fatalf("rename did not reach the merged declaration:\n%s", got)
	}
	if strings.Contains(strings.SplitN(got, "\n", 3)[2], " M") {
		t.Fatalf("rename left a specifier naming the old module:\n%s", got)
	}
	refs, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: at,
		Context: &lsproto.ReferenceContext{IncludeDeclaration: true},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var ranges []string
	if refs.Locations != nil {
		for _, location := range *refs.Locations {
			ranges = append(ranges, fmt.Sprint(location.Uri, location.Range))
		}
	}
	for _, edit := range (*response.WorkspaceEdit.Changes)[uri] {
		if !slices.Contains(ranges, fmt.Sprint(uri, edit.Range)) {
			t.Fatalf("rename edits %v, which references do not return: %v", edit.Range, ranges)
		}
	}
}

// mergedModuleService is moduleEditorService with other.ts, which exports the
// type the module's name merges with.
func mergedModuleService(t *testing.T, source string) (*ls.LanguageService, *compiler.Program, *lsconv.Converters) {
	t.Helper()
	files := map[string]string{
		"/project/main.vibe":     source,
		"/project/other.ts":      "export interface M {}\n",
		"/project/tsconfig.json": `{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","allowImportingTsExtensions":true,"noEmit":true,"strict":true,"skipLibCheck":true},"files":["main.vibe","other.ts"]}`,
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
	return ls.NewLanguageService(nil, p, retiredModulesHost{trustedFixHost: trustedFixHost{converters: converters}, files: files}, "/project/main.vibe"), p, converters
}
