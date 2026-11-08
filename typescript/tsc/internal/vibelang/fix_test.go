package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/wrapvfs"
)

// fixFiles is a project of 32 files with a safe fix each. One fix adds an
// error to another file, which has no fix: try Effect.succeed("fast")
// is a string, while the literal alone has the type "fast", which the
// other file's push of "slow" into the array modes returns does not fit. Each round's fixes together are
// refused, and the error names no file that holds the fix that adds it.
func fixFiles(t *testing.T) (string, *tsoptions.ParsedCommandLine) {
	t.Helper()
	_, file, _, _ := editorProgram(t, "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\nexport type B = Effect.Effect<number>\n")
	dir := filepath.Dir(file.FileName().AsString())
	write := func(name, text string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for i := range 31 {
		write(fmt.Sprintf("f%02d.vibe", i), fmt.Sprintf("export type T%d = Effect.Effect<number>\n", i))
	}
	write("more.vibe", "import { modes } from \"./main.vibe\"\nexport effect function more() {\n  const all = try modes()\n  all.push(\"slow\")\n  return all\n}\n")
	write("plain.ts", "export const plain = 1\n")
	write("tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["*.vibe","*.ts"]}`)
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, bundled.WrapFS(osvfs.FS()), nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return dir, config
}

// countingFS counts the programs FixProject builds, by the reads of a file
// that no fix changes, and calls onRead with the count.
func countingFS(dir string, onRead func(int)) (*int, vfs.FS) {
	fs := bundled.WrapFS(osvfs.FS())
	plain := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "plain.ts")))
	builds := new(int)
	return builds, wrapvfs.Wrap(fs, wrapvfs.Replacements{ReadFile: func(name tspath.RootedFilePath) (string, bool) {
		if name == plain {
			*builds++
			onRead(*builds)
		}
		return fs.ReadFile(name)
	}})
}
