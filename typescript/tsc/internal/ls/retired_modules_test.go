package ls_test

import (
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

type retiredModulesHost struct {
	trustedFixHost
	files map[string]string
}

func (h retiredModulesHost) ReadFile(name tspath.RootedFilePath) (string, bool) {
	text, ok := h.files[string(name)]
	return text, ok
}

func (h retiredModulesHost) CaseSensitivity() tspath.CaseSensitivity { return tspath.CaseInsensitive }

// VIP-25 denies inline modules. Until their parser recovery is retired, editor
// rewrites must not expose supplemental file paths or partially rename them.
func TestRetiredModuleEdits(t *testing.T) {
	for _, source := range []string{
		"module text { export const n = 1 }\nimport { n } from text\nexport const result = n\n",
		"module text { export const n = 1 }\nimport text\n",
		"error text {}\nmodule text { export const n = 1 }\nimport { n } from text\nexport const result = n\n",
		"module text { export const n = missing }\nimport { n } from text\nexport const result = n\n",
		"module text { error Bad {} }\nimport text\n",
	} {
		files := map[string]string{
			"/project/main.vibe":     source,
			"/project/tsconfig.json": `{"compilerOptions":{"target":"esnext","module":"nodenext","moduleResolution":"nodenext","strict":true,"skipLibCheck":true},"files":["main.vibe"]}`,
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
		service := ls.NewLanguageService(nil, p, retiredModulesHost{trustedFixHost: trustedFixHost{converters: converters}, files: files}, "/project/main.vibe")
		file := p.GetSourceFile("/project/main.vibe")
		for _, kind := range []lsproto.CodeActionKind{lsproto.CodeActionKindSourceOrganizeImportsTs, lsproto.CodeActionKindSourceSortImportsTs, lsproto.CodeActionKindSourceRemoveUnusedImportsTs} {
			if edits := service.OrganizeImports(t.Context(), file, p, kind); len(edits) != 0 {
				t.Errorf("%s rewrites retired module in %q: %v", kind, source, edits)
			}
		}
		offset := strings.Index(source, "text")
		pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
		uri := lsconv.FileNameToDocumentURI(file.FileName())
		if info := service.GetRenameInfo(t.Context(), "fresh", uri, pos); info.CanRename {
			t.Errorf("prepareRename offers an unsafe retired module rename in %q", source)
		}
		response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: "fresh"}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if response.WorkspaceEdit != nil && response.WorkspaceEdit.Changes != nil && len(*response.WorkspaceEdit.Changes) != 0 {
			t.Errorf("rename edits retired module: %v", response.WorkspaceEdit)
		}
		// An unrelated written name still has ordinary TypeScript rename.
		if offset := strings.Index(source, "result"); offset >= 0 {
			pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
			response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: "freshResult"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil || len(*response.WorkspaceEdit.Changes) == 0 {
				t.Error("unrelated rename was blocked")
			}
		}
	}
}

// TypeScript namespaces are unrelated to the retired form.
func TestOrdinaryModuleEdits(t *testing.T) {
	source := "import { unused } from \"./dep\";\nnamespace text { export const n = 1 }\nexport const result = text.n;\n"
	files := map[string]string{
		"/project/main.ts":       source,
		"/project/dep.ts":        "export const unused = 0;\n",
		"/project/tsconfig.json": `{"compilerOptions":{"target":"esnext"},"files":["main.ts","dep.ts"]}`,
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
	service := ls.NewLanguageService(nil, p, retiredModulesHost{trustedFixHost: trustedFixHost{converters: converters}, files: files}, "/project/main.ts")
	file := p.GetSourceFile("/project/main.ts")
	if edits := service.OrganizeImports(t.Context(), file, p, lsproto.CodeActionKindSourceOrganizeImportsTs); len(edits) == 0 {
		t.Error("ordinary organize imports was blocked")
	}
	pos, _ := converters.ToLSPPosition(file, core.TextPos(strings.Index(source, "text")))
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	if info := service.GetRenameInfo(t.Context(), "fresh", uri, pos); !info.CanRename {
		t.Error("ordinary namespace rename was blocked")
	}
	response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: "fresh"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil || len(*response.WorkspaceEdit.Changes) == 0 {
		t.Error("ordinary namespace rename has no edits")
	}
}
