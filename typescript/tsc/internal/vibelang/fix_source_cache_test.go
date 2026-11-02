package vibelang

import (
	"sync/atomic"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

type fixCachedSourceFS struct {
	vfs.FS
	files map[ast.SourceFileParseOptions]*ast.SourceFile
	hits  atomic.Int64
}

func (fs *fixCachedSourceFS) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	file := fs.files[opts]
	if file != nil {
		fs.hits.Add(1)
	}
	return file
}

// FuzzFix checks a project, fixes it, then checks the fixed point with another
// real --fix run. All these programs read identical dependency declarations.
// Reusing syntax must not reuse a checker, diagnostics or a fix-gate result.
func TestFixProjectReusesParsedSources(t *testing.T) {
	for _, source := range []string{
		"export effect function main() { return 1 }\n",
		"export type Value = number!!\n",
		"import { Option } from \"effect\"\nexport const value = Option.some(1)\n",
	} {
		t.Run(source, func(t *testing.T) {
			first, file, _, _ := editorProgram(t, source)
			fs := &fixCachedSourceFS{
				FS:    bundled.WrapFS(osvfs.FS()),
				files: map[ast.SourceFileParseOptions]*ast.SourceFile{},
			}
			for _, parsed := range first.SourceFiles() {
				// Match the workspace: share only unchanged declaration dependencies.
				if parsed.IsDeclarationFile {
					fs.files[parsed.ParseOptions()] = parsed
				}
			}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), fixConfigOf(t, fs, file.FileName()), FixOptions{})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			if fs.hits.Load() == 0 {
				t.Fatal("--fix reparsed dependencies instead of consulting the caller's source cache")
			}
		})
	}
}
