package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
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

// countFileChecks counts the checks of dir's files whose name starts with
// prefix until the test ends.
func countFileChecks(t *testing.T, dir, prefix string) *atomic.Int64 {
	t.Helper()
	key := filepath.Join(dir, prefix)
	count := &atomic.Int64{}
	fileChecksIn.Store(key, count)
	t.Cleanup(func() { fileChecksIn.Delete(key) })
	return count
}

// changedChecksProject writes a project of main.vibe, whose type nests
// Effect.Effect depth times so that each round of --fix rewrites one level
// (EK4833), and libs TypeScript modules lib00.ts and on, which import
// main.vibe when read is true.
func changedChecksProject(t *testing.T, mainSource string, libs int, read bool) (string, *tsoptions.ParsedCommandLine) {
	t.Helper()
	_, file, _, _ := editorProgram(t, mainSource)
	dir := filepath.Dir(file.FileName().AsString())
	files := map[string]string{
		"plain.ts":      "export const plain = 1\n",
		"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["*.vibe","*.ts"]}`,
	}
	for i := range libs {
		var b strings.Builder
		if read {
			b.WriteString("import type { Deep } from \"./main.vibe\"\nexport type Held = Deep\n")
		}
		fmt.Fprintf(&b, "export interface Row%d { readonly id: number; readonly name: string }\n", i)
		fmt.Fprintf(&b, "export function rows%d(n: number): ReadonlyArray<Row%d> {\n  return Array.from({ length: n }, (_, id) => ({ id, name: `row ${id}` }))\n}\n", i, i)
		files[fmt.Sprintf("lib%02d.ts", i)] = b.String()
	}
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, bundled.WrapFS(osvfs.FS()), nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return dir, config
}

// deepType is a module that exports a type nesting Effect.Effect depth
// times, which --fix rewrites one level a round.
func deepType(depth int) string {
	return "export type Deep = " + strings.Repeat("Effect.Effect<Array<", depth) + "number" + strings.Repeat(">>", depth) + "\n"
}
