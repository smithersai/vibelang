package vibelang

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// fixOnce runs vibelang --fix on a project of one file, source, and returns
// what it did and the file's name.
func fixOnce(t *testing.T, source string) (*FixResult, tspath.RootedFilePath, vfs.FS) {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	fs := bundled.WrapFS(osvfs.FS())
	return FixProject(t.Context(), fs, bundled.LibPath(), fixConfigOf(t, fs, file.FileName())), file.FileName(), fs
}

// fixConfigOf parses the tsconfig.json beside name.
func fixConfigOf(t *testing.T, fs vfs.FS, name tspath.RootedFilePath) *tsoptions.ParsedCommandLine {
	t.Helper()
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(name.AsString()), "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return config
}

// One vibelang --fix run reaches a fixed point: it repeats its passes, the
// rounds of quick fixes and then the prelude rewrites and the import cleanup,
// until a pass changes nothing, so a second run changes nothing (Chapter 7,
// "One vibelang --fix run applies fixes until none applies"). fuzz-hunt's
// witness: EK4841's fix leaves every import in place, so with a plain
// import { Schema } from "effect" it waits for the prelude rewrite that
// removes the import, which ran once, after the last round; only a second run
// wrote the schema alias.
func TestFixReachesFixedPoint(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"a prelude import removal enables a schema alias", `import { Schema } from "effect"

export const Shape = Schema.Union([Schema.String, Schema.Number])
export type Shape = typeof Shape.Type
`, `
export schema Shape = string | number
`},
		// A chain: EK4830's fix of Bad removes the import of Data, its last
		// use, which stood between Shape's constant and its type alias, so
		// the alias is the statement after the constant, as EK4841 requires;
		// the prelude rewrite then removes the import of Schema, and EK4841's
		// fix applies in the next pass.
		{"two fixes enable each other in a chain", `import { Schema } from "effect"

export const Shape = Schema.Union([Schema.String, Schema.Number])
import { Data } from "effect"
export type Shape = typeof Shape.Type
export class Bad extends Data.TaggedError("Bad")<{ readonly id: string }> {}
`, `
export schema Shape = string | number
export error Bad { id: string }
`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			first, name, fs := fixOnce(t, tc.source)
			fixed := first.Files[name]
			if first.Err != nil || fixed == nil || fixed.Text != tc.want || len(first.Refused) != 0 || len(first.Remaining) != 0 {
				got := ""
				if fixed != nil {
					got = fixed.Text
				}
				t.Fatalf("--fix wrote\n%s\nwant\n%s\nerr %v, refused %+v, remaining %+v", got, tc.want, first.Err, first.Refused, first.Remaining)
			}
			if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0o600); err != nil {
				t.Fatal(err)
			}
			second := FixProject(t.Context(), fs, bundled.LibPath(), fixConfigOf(t, fs, name))
			if second.Err != nil || len(second.Files) > 0 {
				var changed []string
				for _, name := range second.Order {
					changed = append(changed, second.Files[name].Text)
				}
				t.Fatalf("a second --fix changed the fixed project (%v):\n%s", second.Err, strings.Join(changed, "\n"))
			}
		})
	}
}

// A run still applying fixes at the pass limit keeps what it fixed and
// reports the fixes that still apply, instead of stopping silently.
func TestFixReportsFixesLeftAtPassLimit(t *testing.T) {
	defer func(limit int) { fixPassLimit = limit }(fixPassLimit)
	fixPassLimit = 1
	result, name, _ := fixOnce(t, `import { Schema } from "effect"

export const Shape = Schema.Union([Schema.String, Schema.Number])
export type Shape = typeof Shape.Type
`)
	want := `
export const Shape = Schema.Union([Schema.String, Schema.Number])
export type Shape = typeof Shape.Type
`
	fixed := result.Files[name]
	if result.Err != nil || fixed == nil || fixed.Text != want || len(result.Remaining) != 1 || result.Remaining[0] != (FixRemaining{File: name, Line: 2, Fix: "EK4841"}) {
		got := ""
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("--fix wrote\n%s\nwant\n%s\nerr %v, remaining %+v", got, want, result.Err, result.Remaining)
	}
	var report bytes.Buffer
	result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
	for _, line := range []string{
		"vibelang --fix: main.vibe:2: EK4841 still applies after 1 pass\n",
		"vibelang --fix: 1 fix in 1 file; 1 fix still applies.\n",
	} {
		if !strings.Contains(report.String(), line) {
			t.Errorf("the report\n%s\nlacks %q", report.String(), line)
		}
	}
}

// Use the public driver, real project files and captured command streams so
// the pass-limit contract covers exit status and retained partial edits.
type fixLimitSystem struct {
	tsc.System
	fs          vfs.FS
	cwd         tspath.RootedDirectoryPath
	out, errors bytes.Buffer
}

func (s *fixLimitSystem) FS() vfs.FS                                      { return s.fs }
func (s *fixLimitSystem) DefaultLibraryPath() tspath.RootedDirectoryPath  { return bundled.LibPath() }
func (s *fixLimitSystem) GetCurrentDirectory() tspath.RootedDirectoryPath { return s.cwd }
func (s *fixLimitSystem) Writer() io.Writer                               { return &s.out }
func (s *fixLimitSystem) ErrorWriter() io.Writer                          { return &s.errors }

func TestFixPassLimitDriverExit(t *testing.T) {
	defer func(limit int) { fixPassLimit = limit }(fixPassLimit)
	fixPassLimit = 1
	source := `import { Schema } from "effect"

export const Shape = Schema.Union([Schema.String, Schema.Number])
export type Shape = typeof Shape.Type
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	system := &fixLimitSystem{fs: bundled.WrapFS(osvfs.FS()), cwd: tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(dir))}
	code := Fix(t.Context(), system, []string{"-p", dir})
	if code != int(tsc.ExitStatusDiagnosticsPresent_OutputsGenerated) {
		t.Fatalf("incomplete --fix exited %d, want 2; stdout=%s stderr=%s", code, system.out.String(), system.errors.String())
	}
	if !strings.Contains(system.out.String(), "EK4841 still applies after 1 pass") || !strings.Contains(system.errors.String(), "stopped after 1 pass with 1 fix still applying") {
		t.Fatalf("missing actionable incomplete-run report: stdout=%s stderr=%s", system.out.String(), system.errors.String())
	}
	written, err := os.ReadFile(file.FileName().AsString())
	if err != nil {
		t.Fatal(err)
	}
	want := "\nexport const Shape = Schema.Union([Schema.String, Schema.Number])\nexport type Shape = typeof Shape.Type\n"
	if string(written) != want {
		t.Fatalf("partial fixed text=%q, want %q", written, want)
	}
}

// Reading a file into the normalizer's overlay is not an edit. An already
// normalized VIP migration must succeed without reporting a state cycle.
func TestFixVIPOnlyUnchangedOverlay(t *testing.T) {
	for _, source := range []string{
		"function double(n: number) { return n * 2 }\nexport effect function main() { try yieldNow(); return double(2) }\n",
		"function triple(n: number): number { return n * 3 }\nexport effect function main() { try yieldNow(); return triple(2) }\n",
		"const halve = (n: number): number => n / 2\nexport effect function main() { try yieldNow(); return halve(2) }\n",
		"export effect function main() { try yieldNow(); return 1 }\n",
	} {
		_, file, _, _ := editorProgram(t, source)
		fs := bundled.WrapFS(osvfs.FS())
		result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), fixConfigOf(t, fs, file.FileName()), FixOptions{VIPOnly: true})
		if result.Err != nil || len(result.Files) != 0 || len(result.Remaining) != 0 {
			t.Fatalf("unchanged project reported a migration: err=%v files=%v remaining=%v", result.Err, result.Files, result.Remaining)
		}
	}
}

// Fixed-point passes retain main's verified-write contract: writes can happen
// between passes, yet Original keeps the source from before the run.
func TestFixFixedPointKeepsVerifiedWrites(t *testing.T) {
	for _, test := range []struct {
		name string
		each bool
	}{{"batch", false}, {"each", true}} {
		t.Run(test.name, func(t *testing.T) {
			source := "import { Schema } from \"effect\"\n\nexport const Shape = Schema.Union([Schema.String, Schema.Number])\nexport type Shape = typeof Shape.Type\n"
			want := "\nexport schema Shape = string | number\n"
			_, file, _, _ := editorProgram(t, source)
			name := file.FileName()
			fs := bundled.WrapFS(osvfs.FS())
			writes := 0
			options := FixOptions{CheckEachFix: test.each, Verified: func(state map[tspath.RootedFilePath]string) {
				for name, text := range state {
					if err := os.WriteFile(name.AsString(), []byte(text), 0600); err != nil {
						t.Fatal(err)
					}
					writes++
				}
			}}
			first := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), fixConfigOf(t, fs, name), options)
			fixed := first.Files[name]
			if first.Err != nil || len(first.Remaining) > 0 || fixed == nil {
				t.Fatalf("normalization: err=%v remaining=%v file=%v", first.Err, first.Remaining, fixed)
			}
			if writes == 0 || fixed.Original != source || fixed.Text != want {
				t.Fatalf("verified writes=%d original=%q final=%q", writes, fixed.Original, fixed.Text)
			}
			onDisk, err := os.ReadFile(name.AsString())
			if err != nil || string(onDisk) != want {
				t.Fatalf("verified file=%q err=%v", onDisk, err)
			}
			second := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), fixConfigOf(t, fs, name), FixOptions{})
			if second.Err != nil || len(second.Files) > 0 {
				t.Fatalf("second normalization: err=%v files=%v", second.Err, second.Files)
			}
		})
	}
}
