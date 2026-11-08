package vibelang

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// fixSys is the command line's system over fs, writing to buffers.
type fixSys struct {
	fs             vfs.FS
	cwd            string
	stdout, stderr bytes.Buffer
}

func (s *fixSys) Writer() io.Writer                              { return &s.stdout }
func (s *fixSys) ErrorWriter() io.Writer                         { return &s.stderr }
func (s *fixSys) FS() vfs.FS                                     { return s.fs }
func (s *fixSys) DefaultLibraryPath() tspath.RootedDirectoryPath { return bundled.LibPath() }
func (s *fixSys) GetCurrentDirectory() tspath.RootedDirectoryPath {
	return tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(s.cwd))
}
func (s *fixSys) WriteOutputIsTTY() bool                       { return false }
func (s *fixSys) GetWidthOfTerminal() int                      { return 0 }
func (s *fixSys) GetEnvironmentVariable(string) (string, bool) { return "", false }
func (s *fixSys) Spawn([]string, string, io.Writer) (io.ReadWriteCloser, error) {
	return nil, os.ErrInvalid
}
func (s *fixSys) Now() time.Time            { return time.Now() }
func (s *fixSys) SinceStart() time.Duration { return 0 }

// keepProject writes a project with several rounds and returns its
// directory: main.vibe nests Effect.Effect five deep, a round per level,
// and its first round also offers an EK4834 fix that more.vibe's push of
// "slow" refuses, so that round's gate peels it before keeping the rest
// (fixFiles).
func keepProject(t *testing.T) string {
	t.Helper()
	main := "export effect function modes() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\nexport type B = Effect.Effect<number>\nexport type Deep = " + strings.Repeat("Effect.Effect<", 5) + "string" + strings.Repeat(">", 5) + "\n"
	_, file, _, _ := editorProgram(t, main)
	dir := filepath.Dir(file.FileName().AsString())
	files := map[string]string{
		"more.vibe":     "import { modes } from \"./main.vibe\"\nexport effect function more() {\n  const all = try modes()\n  all.push(\"slow\")\n  return all\n}\nexport type C = Effect.Effect<Effect.Effect<boolean>>\n",
		"f00.vibe":      "export type T0 = Effect.Effect<number>\n",
		"f01.vibe":      "export type T1 = Effect.Effect<Effect.Effect<number>>\n",
		"plain.ts":      "export const plain = 1\n",
		"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["*.vibe","*.ts"]}`,
	}
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// vibeFiles reads dir's .vibe files, by base name.
func vibeFiles(t *testing.T, dir string) map[string]string {
	t.Helper()
	names, err := filepath.Glob(filepath.Join(dir, "*.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	texts := map[string]string{}
	for _, name := range names {
		text, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		texts[filepath.Base(name)] = string(text)
	}
	return texts
}

func keepConfig(t *testing.T, dir string) *tsoptions.ParsedCommandLine {
	t.Helper()
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, bundled.WrapFS(osvfs.FS()), nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return config
}

// originalsIn returns texts, by base name, as an overlay of dir's files.
func originalsIn(dir string, texts map[string]string) map[tspath.RootedFilePath]string {
	overlay := map[tspath.RootedFilePath]string{}
	for base, text := range texts {
		overlay[tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, base)))] = text
	}
	return overlay
}
