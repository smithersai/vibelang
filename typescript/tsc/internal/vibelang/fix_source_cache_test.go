package vibelang

import (
	"sync/atomic"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
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
