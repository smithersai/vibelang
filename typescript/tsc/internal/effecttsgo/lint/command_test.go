package lint

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

type testSys struct {
	out, err bytes.Buffer
	cwd      tspath.RootedDirectoryPath
}

func (s *testSys) Writer() io.Writer                              { return &s.out }
func (s *testSys) ErrorWriter() io.Writer                         { return &s.err }
func (s *testSys) FS() vfs.FS                                     { return bundled.WrapFS(osvfs.FS()) }
func (s *testSys) DefaultLibraryPath() tspath.RootedDirectoryPath { return bundled.LibPath() }
func (s *testSys) GetCurrentDirectory() tspath.RootedDirectoryPath {
	return s.cwd
}
func (s *testSys) WriteOutputIsTTY() bool                       { return false }
func (s *testSys) GetWidthOfTerminal() int                      { return 0 }
func (s *testSys) GetEnvironmentVariable(string) (string, bool) { return "", false }
func (s *testSys) Now() time.Time                               { return time.Now() }
func (s *testSys) SinceStart() time.Duration                    { return 0 }
func (s *testSys) Spawn([]string, string, io.Writer) (io.ReadWriteCloser, error) {
	return nil, errors.New("no processes in tests")
}

// TestCommandLintsVibeFilesWithTheOxlintConfiguration runs `vibelang lint` on a
// project whose Oxlint configuration enables effecttsgo rules (VIP-38): a rule
// that runs as Effect wrote it reports in a .vibe file, an override and an
// ignore pattern silence it, the .ts file is left to Oxlint, a file the project
// leaves out is named, and the error sets the status.
func TestCommandLintsVibeFilesWithTheOxlintConfiguration(t *testing.T) {
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = "../../../../../experiments/node_modules"
	}
	effect, err := filepath.Abs(filepath.Join(modules, "effect"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(effect, "package.json")); err != nil {
		t.Skipf("effect is not installed: %v", err)
	}
	dir := t.TempDir()
	write := func(name, text string) {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(dir, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(effect, filepath.Join(dir, "node_modules", "effect")); err != nil {
		t.Fatal(err)
	}
	write("package.json", `{"private":true,"type":"module"}`)
	write("tsconfig.json", `{"compilerOptions":{"target":"es2022","module":"nodenext","moduleResolution":"nodenext","strict":true,"types":[],"skipLibCheck":true,"noEmit":true},"include":["src"]}`)
	write(".oxlintrc.json", `{
  "rules": { "effecttsgo/effect-sleep-zero-to-yield-now": "error" },
  "overrides": [{ "files": ["src/quiet.vibe"], "rules": { "effecttsgo/effect-sleep-zero-to-yield-now": "off" } }],
  "ignorePatterns": ["src/generated/"]
}`)
	sleep := "import { Effect } from \"effect\"\n\nexport function pause() {\n  Effect.sleep(0)\n  return 1\n}\n"
	write("src/main.vibe", sleep)
	write("src/quiet.vibe", sleep)
	write("src/generated/gen.vibe", sleep)
	write("scripts/stray.vibe", sleep)
	write("src/plain.ts", "import { Effect } from \"effect\"\n\nexport const pause = Effect.sleep(0)\n")

	sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
	status := Command(context.Background(), sys, nil)
	out := sys.out.String()
	if status != 1 {
		t.Fatalf("status %d, want 1\n%s%s", status, out, sys.err.String())
	}
	if !strings.Contains(out, "src/main.vibe(4,3): error TS377142:") || !strings.Contains(out, "effect(effectSleepZeroToYieldNow)") {
		t.Errorf("main.vibe's Effect.sleep(0) is not reported:\n%s", out)
	}
	for _, file := range []string{"quiet.vibe", "gen.vibe", "plain.ts"} {
		if strings.Contains(out, file) {
			t.Errorf("%s is reported:\n%s", file, out)
		}
	}
	if !strings.Contains(out, "1 error(s) and 0 warning(s) in 2 .vibe file(s).") {
		t.Errorf("summary:\n%s", out)
	}
	// A .vibe file that tsconfig.json leaves out would go unchecked: lint says so.
	if !strings.Contains(sys.err.String(), "scripts/stray.vibe: tsconfig.json does not include it; not linted.") {
		t.Errorf("stray.vibe is not reported as unchecked:\n%s", sys.err.String())
	}
}
