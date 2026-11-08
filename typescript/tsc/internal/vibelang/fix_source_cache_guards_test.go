package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
)

type fixCountingSourceHost struct {
	compiler.CompilerHost
	parses int
}

func (h *fixCountingSourceHost) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	h.parses++
	return h.CompilerHost.GetSourceFile(opts)
}
