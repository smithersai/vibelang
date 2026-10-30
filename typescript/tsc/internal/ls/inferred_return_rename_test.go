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

type inferredReturnRenameHost struct {
	trustedFixHost
	files map[string]string
}

func (h inferredReturnRenameHost) ReadFile(name tspath.RootedFilePath) (string, bool) {
	text, ok := h.files[string(name)]
	return text, ok
}
func (h inferredReturnRenameHost) CaseSensitivity() tspath.CaseSensitivity {
	return tspath.CaseInsensitive
}

// D500 inference placeholders are syntax, while ordinary infer and generic
// type parameters remain bindings that can be renamed, including in .vibe.
func TestInferredReturnPlaceholderRename(t *testing.T) {
	for _, tc := range []struct {
		ext, source string
		allow       bool
	}{
		{".vibe", "export const result = (): infer _ => 1\n", false},
		{".vibe", "export type Unwrap<T> = T extends Promise<infer _> ? _ : never\n", true},
		{".ts", "export type Unwrap<T> = T extends Promise<infer _> ? _ : never\n", true},
		{".vibe", "export const identity = <_>(value: _) => value\n", true},
	} {
		name := "/project/main" + tc.ext
		files := map[string]string{name: tc.source, "/project/tsconfig.json": `{"compilerOptions":{"target":"esnext"},"files":["main` + tc.ext + `"]}`}
		fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
		parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatal(errors)
		}
		p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
		converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(path tspath.RootedFilePath) *lsconv.LSPLineMap {
			return lsconv.ComputeLSPLineStarts(files[string(path)])
		})
		service := ls.NewLanguageService(nil, p, inferredReturnRenameHost{trustedFixHost: trustedFixHost{converters: converters}, files: files}, name)
		file := p.GetSourceFile(tspath.RootedFilePath(name))
		pos, _ := converters.ToLSPPosition(file, core.TextPos(strings.Index(tc.source, "_")))
		uri := lsconv.FileNameToDocumentURI(file.FileName())
		if info := service.GetRenameInfo(t.Context(), "Fresh", uri, pos); info.CanRename != tc.allow {
			t.Errorf("prepareRename allowed=%v, want %v", info.CanRename, tc.allow)
		}
		response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: "Fresh"}, nil)
		if err != nil {
			t.Fatal(err)
		}
		edits := response.WorkspaceEdit != nil && response.WorkspaceEdit.Changes != nil && len(*response.WorkspaceEdit.Changes) > 0
		if edits != tc.allow {
			t.Errorf("rename edits=%v, want %v", edits, tc.allow)
		}
	}
}
