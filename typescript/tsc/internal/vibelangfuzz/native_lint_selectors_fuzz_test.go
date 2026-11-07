package vibelangfuzz

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/lint"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

const nativeLintSelectorsTarget = "FuzzNativeLintSelectors"
const nativeLintSelectorsQuote = "It accepts compiler options and files only, never an Oxlint config or lint-specific flags."

type nativeLintSelectorCase struct {
	Key, Selector string
	Args          []string
}
type nativeLintSystem struct {
	out, err bytes.Buffer
	cwd      tspath.RootedDirectoryPath
	fs       vfs.FS
}

func (s *nativeLintSystem) Writer() io.Writer                               { return &s.out }
func (s *nativeLintSystem) ErrorWriter() io.Writer                          { return &s.err }
func (s *nativeLintSystem) FS() vfs.FS                                      { return s.fs }
func (s *nativeLintSystem) DefaultLibraryPath() tspath.RootedDirectoryPath  { return bundled.LibPath() }
func (s *nativeLintSystem) GetCurrentDirectory() tspath.RootedDirectoryPath { return s.cwd }
func (s *nativeLintSystem) WriteOutputIsTTY() bool                          { return false }
func (s *nativeLintSystem) GetWidthOfTerminal() int                         { return 0 }
func (s *nativeLintSystem) GetEnvironmentVariable(string) (string, bool)    { return "", false }
func (s *nativeLintSystem) Now() time.Time                                  { return time.Now() }
func (s *nativeLintSystem) SinceStart() time.Duration                       { return 0 }
func (s *nativeLintSystem) Spawn([]string, string, io.Writer) (io.ReadWriteCloser, error) {
	return nil, errors.New("subprocess not needed")
}

func TestNativeLintSelectorsQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", nativeLintSelectorsQuote)
}

func FuzzNativeLintSelectors(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "007-tooling.md", nativeLintSelectorsQuote)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/native-lint-selectors.json"))
	if err != nil {
		f.Fatal(err)
	}
	var cases []nativeLintSelectorCase
	if err := json.Unmarshal(data, &cases); err != nil {
		f.Fatal(err)
	}
	for _, test := range cases {
		f.Add(test.Key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		at := slices.IndexFunc(cases, func(c nativeLintSelectorCase) bool { return c.Key == key })
		if at < 0 {
			at = len(key) % len(cases)
		}
		test := cases[at]
		config := `{"compilerOptions":{"strict":true,"declaration":true,"incremental":true,"tsBuildInfoFile":"build.tsbuildinfo"},"files":["main.ts"]}`
		files := map[string]string{"main.ts": "export const value = 1\n", "package.json": servicesPackage}
		switch mode % 3 {
		case 1:
			files[".oxlintrc.json"] = "invalid JSON"
		case 2:
			files["oxlint.config.ts"] = "throw new Error('not evaluated')"
		}
		result, err := w.Compile(t.Context(), Project{Config: config, Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		sys := &nativeLintSystem{cwd: tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(result.Dir)), fs: bundled.WrapFS(w.fs)}
		args := append([]string{"-p", "."}, test.Args...)
		if mode&4 != 0 {
			args = append(slices.Clone(test.Args), "-p", ".")
		}
		if mode&16 != 0 {
			args = append(args, "--declaration", "--incremental")
		}
		status := lint.Command(t.Context(), sys, args)
		output := sys.out.String() + sys.err.String()
		if status == 0 || !strings.Contains(output, "error TS5023: Unknown compiler option") || !strings.Contains(output, test.Selector) || strings.Contains(output, "vibelang lint:") {
			Gap(t, nativeLintSelectorsTarget, test.Key, "%s; status=%d output=%s", nativeLintSelectorsQuote, status, output)
			return
		}
		for _, name := range []string{"main.js", "main.d.ts", "build.tsbuildinfo"} {
			if w.fs.FileExists(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(result.Dir, name)))) {
				Gap(t, nativeLintSelectorsTarget, test.Key, "lint emitted %s", name)
				return
			}
		}
		ExpectPending(t, nativeLintSelectorsTarget, test.Key)
		ExpectPending(t, nativeLintSelectorsTarget, specCorpusKey(t))
	})
}
