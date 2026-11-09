package vibelang

import (
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// fileChecksIn counts, by directory, the checks of the files in it whose
// name starts with a prefix; a test registers its directory and prefix
// (countFileChecks), so tests that run at once count apart.
var fileChecksIn sync.Map // directory + "/" + prefix -> *atomic.Int64

func init() {
	checker.RegisterSourceFileCheckHook(func(_ *checker.Checker, file *ast.SourceFile) {
		name := file.FileName().AsString()
		dir, base := filepath.Dir(name), filepath.Base(name)
		fileChecksIn.Range(func(key, value any) bool {
			at := key.(string)
			if prefixDir, prefix := filepath.Dir(at), filepath.Base(at); prefixDir == dir && strings.HasPrefix(base, prefix) {
				value.(*atomic.Int64).Add(1)
			}
			return true
		})
	})
}
