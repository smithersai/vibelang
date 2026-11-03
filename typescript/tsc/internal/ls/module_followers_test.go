package ls

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// TypeScript's references and rename can answer with a file outside the
// program, such as a library source a declaration map points to
// (effect/src/Tracer.ts in FuzzEditor). Following module declarations through
// such an answer must leave that location alone, not look the file up and
// panic.
func TestModuleFollowersSkipFilesOutsideProgram(t *testing.T) {
	source := "module text { export const n = 1 }\nimport { n } from text\nexport const result = n\n"
	fs := bundled.WrapFS(vfstest.FromMap(map[string]string{
		"/project/main.vibe":     source,
		"/project/tsconfig.json": `{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","strict":true,"skipLibCheck":true},"files":["main.vibe"]}`,
	}, tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(tspath.RootedFilePath) *lsconv.LSPLineMap {
		return lsconv.ComputeLSPLineStarts(source)
	})
	l := &LanguageService{program: program, converters: converters}
	outside := lsproto.DocumentUri("file:///project/node_modules/effect/src/Tracer.ts")
	at := lsproto.Range{Start: lsproto.Position{Line: 0, Character: 7}, End: lsproto.Position{Line: 0, Character: 11}}
	locations := []lsproto.Location{{Uri: outside, Range: at}}
	l.followModuleDeclarationReferences(lsproto.LocationsOrNull{Locations: &locations})
	if len(locations) != 1 {
		t.Fatalf("references outside the program gained locations: %v", locations)
	}
	changes := map[lsproto.DocumentUri][]*lsproto.TextEdit{outside: {{Range: at, NewText: "fresh"}}}
	l.followModuleDeclarationRenames(lsproto.WorkspaceEditOrNull{WorkspaceEdit: &lsproto.WorkspaceEdit{Changes: &changes}})
	if len(changes[outside]) != 1 {
		t.Fatalf("a rename outside the program gained edits: %v", changes[outside])
	}
	// The same range in the program's own file still follows the module.
	inside := lsproto.DocumentUri("file:///project/main.vibe")
	locations = []lsproto.Location{{Uri: inside, Range: at}}
	response := lsproto.LocationsOrNull{Locations: &locations}
	l.followModuleDeclarationReferences(response)
	if len(*response.Locations) != 2 {
		t.Fatalf("the module declaration's specifier did not follow: %v", *response.Locations)
	}
}
