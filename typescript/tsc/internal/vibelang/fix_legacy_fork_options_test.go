package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func fixVIPForkSource(t *testing.T, source string) (*FixResult, string) {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	if fixed := result.Files[file.FileName()]; fixed != nil {
		return result, fixed.Text
	}
	return result, source
}

// A legacy fork(program, options) in a function --fix-vip-only marks effect
// was a call of the prelude's fork. fork is reserved in effect code (VIP-17),
// so the same text reads as fork over the comma expression (program, options),
// EK1703, and the file's tries were all refused (Smithers agent/fs
// CommandSurface.test.vibe:66, FileRouter.test.vibe:82). No fork form takes
// options; fork e is Effect.forkChild(e), which does.
func TestFixVIPForkWithOptions(t *testing.T) {
	prelude := "import { Effect } from \"effect\"\n\nconst call = effect (n: number): number!! => n + 1\n\n"
	for _, test := range []struct{ name, legacy, want string }{
		{
			"initializer",
			"export const go = (): number!! => {\n  const source = { n: 1 }\n  const pending = fork(call(source.n), { startImmediately: true })\n  source.n = 2\n  return join pending\n}\n",
			"export const go = effect (): number!! => {\n  const source = { n: 1 }\n  const pending = try Effect.forkChild(call(source.n), { startImmediately: true })\n  source.n = 2\n  return join pending\n}\n",
		},
		{
			"statement",
			"export const go = (): number!! => {\n  fork(call(1), { startImmediately: true })\n  return 0\n}\n",
			"export const go = effect (): number!! => {\n  try Effect.forkChild(call(1), { startImmediately: true })\n  return 0\n}\n",
		},
		{
			"member of the fiber",
			"export const go = (): string!! => {\n  const id = fork(call(1), { startImmediately: true }).id\n  return String(id)\n}\n",
			"export const go = effect (): string!! => {\n  const id = (try Effect.forkChild(call(1), { startImmediately: true })).id\n  return String(id)\n}\n",
		},
		{
			"options by name",
			"const options = { startImmediately: true }\nexport const go = (): number!! => {\n  const pending = fork(call(1), options)\n  return join pending\n}\n",
			"const options = { startImmediately: true }\nexport const go = effect (): number!! => {\n  const pending = try Effect.forkChild(call(1), options)\n  return join pending\n}\n",
		},
		{
			"keyword without options stays",
			"export const go = (): number!! => {\n  const pending = fork(call(1))\n  return join pending\n}\n",
			"export const go = effect (): number!! => {\n  const pending = fork(call(1))\n  return join pending\n}\n",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			result, got := fixVIPForkSource(t, prelude+test.legacy)
			if got != prelude+test.want || len(result.Refused) != 0 {
				t.Fatalf("--fix-vip-only wrote\n%s\nwant\n%s\nrefused %+v", got, prelude+test.want, result.Refused)
			}
		})
	}
}

// A local function named fork is not the prelude's: its call stays.
func TestFixVIPLocalForkStays(t *testing.T) {
	source := "function fork(a: number, b: number): number {\n  return a + b\n}\n\nexport const f = (n: number): number => fork(n, 2)\n"
	result, got := fixVIPForkSource(t, source)
	if got != source || strings.Contains(got, "forkChild") || len(result.Refused) != 0 {
		t.Fatalf("--fix-vip-only wrote\n%s\nrefused %+v", got, result.Refused)
	}
}
