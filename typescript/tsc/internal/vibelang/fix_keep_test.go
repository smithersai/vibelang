package vibelang

import (
	"bytes"
	"io"
	stdmaps "maps"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
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
	main := "export function modes() {\n  const mode = Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\nexport type B = Effect.Effect<number>\nexport type Deep = " + strings.Repeat("Effect.Effect<", 5) + "string" + strings.Repeat(">", 5) + "\n"
	_, file, _, _ := editorProgram(t, main)
	dir := filepath.Dir(file.FileName().AsString())
	files := map[string]string{
		"more.vibe":     "import { modes } from \"./main.vibe\"\nexport function more() {\n  const all = modes()\n  all.push(\"slow\")\n  return all\n}\nexport type C = Effect.Effect<Effect.Effect<boolean>>\n",
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

// A --fix run stopped by SIGTERM or SIGINT in the middle of its gate keeps
// the fixes it verified, as the files the gate last verified together, and
// a second run then writes what a run never stopped writes. Stopped while
// the gate looked for the fix an error traces to, it also panicked.
func TestFixKeepsVerifiedFixesWhenSignaled(t *testing.T) {
	// The texts the gate verifies in a run never stopped, in order.
	whole := keepProject(t)
	original := vibeFiles(t, whole)
	var states []map[string]string
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), keepConfig(t, whole), FixOptions{Verified: func(texts map[tspath.RootedFilePath]string) {
		state := stdmaps.Clone(original)
		for name, text := range texts {
			state[filepath.Base(name.AsString())] = text
		}
		states = append(states, state)
	}})
	if len(result.Refused) != 1 || result.Refused[0].Code != 4834 {
		t.Fatalf("refused %+v; want the EK4834 fix refused", result.Refused)
	}
	final := stdmaps.Clone(original)
	for name, file := range result.Files {
		final[filepath.Base(name.AsString())] = file.Text
	}
	if len(states) < 4 || !stdmaps.Equal(states[len(states)-1], final) {
		t.Fatalf("verified %d states, the last %v; want several, ending in the result %v", len(states), states[len(states)-1:], final)
	}

	for _, sig := range []syscall.Signal{syscall.SIGTERM, syscall.SIGINT} {
		t.Run(sig.String(), func(t *testing.T) {
			dir := keepProject(t)
			ctx, stop := signal.NotifyContext(t.Context(), sig)
			defer stop()
			// Signal the process as the gate builds its first program after
			// it wrote a set of fixes, in the first round's peeling, and
			// let the build go on once the signal has arrived.
			signaled := false
			builds, fs := countingFS(dir, func(n int) {
				if !signaled && !stdmaps.Equal(vibeFiles(t, dir), original) {
					signaled = true
					if err := syscall.Kill(os.Getpid(), sig); err != nil {
						t.Error(err)
					}
					select {
					case <-ctx.Done():
					case <-time.After(10 * time.Second):
						t.Error("the signal did not arrive")
					}
				}
			})
			sys := &fixSys{fs: fs, cwd: dir}
			status := FixWithOptions(ctx, sys, []string{"-p", dir}, FixOptions{})
			stop()
			if status == 0 || !strings.Contains(sys.stderr.String(), "interrupted; kept the fixes it verified") || sys.stdout.Len() != 0 {
				t.Fatalf("status %d, stdout %q, stderr %q; want the run stopped, keeping its fixes", status, sys.stdout.String(), sys.stderr.String())
			}
			kept := vibeFiles(t, dir)
			if stdmaps.Equal(kept, original) || stdmaps.Equal(kept, final) {
				t.Fatalf("after %d programs the files are %v; want some fixes kept and some not made", *builds, kept)
			}
			// Exactly a set of fixes the gate verified: no file holds a
			// fix it had not verified, or part of one.
			if !slices.ContainsFunc(states, func(s map[string]string) bool { return stdmaps.Equal(s, kept) }) {
				t.Fatalf("the files hold %v, which the gate never verified", kept)
			}
			// And independently of the gate, the kept program adds no error.
			disk := bundled.WrapFS(osvfs.FS())
			baseline := baselineOf(t.Context(), fixProgram(disk, bundled.LibPath(), keepConfig(t, dir), &fixParsedFiles{}, originalsIn(dir, original)))
			if added := addedErrors(t.Context(), fixProgram(disk, bundled.LibPath(), keepConfig(t, dir), &fixParsedFiles{}, nil), baseline); len(added) > 0 {
				t.Fatalf("the kept files add %v", added)
			}
			if matches, _ := filepath.Glob(filepath.Join(dir, ".*.fix-*")); len(matches) > 0 {
				t.Fatalf("left %v", matches)
			}
			rerun := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: dir}
			if status := FixWithOptions(t.Context(), rerun, []string{"-p", dir}, FixOptions{}); status != 0 {
				t.Fatalf("the second run: status %d, %s", status, rerun.stderr.String())
			}
			if again := vibeFiles(t, dir); !stdmaps.Equal(again, final) {
				t.Fatalf("the second run wrote %v; a run never stopped writes %v", again, final)
			}
		})
	}
}

// originalsIn returns texts, by base name, as an overlay of dir's files.
func originalsIn(dir string, texts map[string]string) map[tspath.RootedFilePath]string {
	overlay := map[tspath.RootedFilePath]string{}
	for base, text := range texts {
		overlay[tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, base)))] = text
	}
	return overlay
}

// A run that finishes writes its files with their permissions and prints
// its report, and nothing else, as before it kept its work as it went.
func TestFixRunThatFinishesReports(t *testing.T) {
	dir := keepProject(t)
	sys := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: dir}
	if status := FixWithOptions(t.Context(), sys, []string{"-p", dir}, FixOptions{ProgressEvery: time.Hour}); status != 0 {
		t.Fatalf("status %d, %s", status, sys.stderr.String())
	}
	if !strings.HasPrefix(sys.stdout.String(), "vibelang --fix: f00.vibe: ") || !strings.HasSuffix(sys.stdout.String(), "1 fix refused.\n") || sys.stderr.Len() != 0 {
		t.Fatalf("stdout %q, stderr %q", sys.stdout.String(), sys.stderr.String())
	}
	info, err := os.Stat(filepath.Join(dir, "main.vibe"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("main.vibe: %v, %v; want its permissions kept", info, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "plain.ts")); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(vibeFiles(t, dir)["main.vibe"], "Effect.Effect") {
		t.Fatalf("main.vibe: %q", vibeFiles(t, dir)["main.vibe"])
	}
}
