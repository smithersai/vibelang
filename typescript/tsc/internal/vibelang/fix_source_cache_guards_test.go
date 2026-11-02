package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

type fixCountingSourceHost struct {
	compiler.CompilerHost
	parses int
}

func (h *fixCountingSourceHost) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	h.parses++
	return h.CompilerHost.GetSourceFile(opts)
}

// A cache hit is valid only for current bytes and every parse option. In
// particular, a same-text tree from another path or module mode is stale.
func TestFixSourceCacheGuards(t *testing.T) {
	for _, mode := range []string{"hit", "miss", "text", "file", "path", "module", "jsx"} {
		t.Run(mode, func(t *testing.T) {
			name := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(t.TempDir(), "main.ts")))
			text := "const value = 42\n"
			if err := os.WriteFile(name.AsString(), []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
			opts := ast.SourceFileParseOptions{FileName: name, PathKey: tspath.CaseSensitive.PathKey(tspath.RootedPath(name))}
			cachedOpts, cachedText := opts, text
			switch mode {
			case "text":
				cachedText = "const value = 99\n"
			case "file":
				cachedOpts.FileName = tspath.RootedFilePathFromAbsolute(name.AsString() + ".other.ts")
			case "path":
				cachedOpts.PathKey = tspath.CaseSensitive.PathKey(tspath.RootedPath(tspath.RootedFilePathFromAbsolute(name.AsString() + ".other.ts")))
			case "module":
				cachedOpts.ExternalModuleIndicatorOptions.Force = true
			case "jsx":
				cachedOpts.ExternalModuleIndicatorOptions.JSX = true
			}
			cached := parser.ParseSourceFile(cachedOpts, cachedText, core.ScriptKindTS)
			fs := &fixCachedSourceFS{FS: bundled.WrapFS(osvfs.FS()), files: map[ast.SourceFileParseOptions]*ast.SourceFile{}}
			if mode != "miss" {
				fs.files[opts] = cached
			}
			base := &fixCountingSourceHost{CompilerHost: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)}
			host := fixCompilerHost{CompilerHost: base, parsed: &fixParsedFiles{sourceFiles: fs}}
			got := host.GetSourceFile(opts)
			if got == nil || got.Text() != text || got.ParseOptions() != opts {
				t.Fatalf("stale source reused: mode=%s file=%v", mode, got)
			}
			wantParses := 1
			if mode == "hit" {
				wantParses = 0
				if got != cached {
					t.Fatal("a current cached tree was parsed again")
				}
			} else if got == cached {
				t.Fatal("an incompatible cached tree was reused")
			}
			if base.parses != wantParses {
				t.Fatalf("parsed %d times, want %d", base.parses, wantParses)
			}
			if again := host.GetSourceFile(opts); again != got || base.parses != wantParses {
				t.Fatal("the per-run cache did not retain the verified tree")
			}
		})
	}
}
