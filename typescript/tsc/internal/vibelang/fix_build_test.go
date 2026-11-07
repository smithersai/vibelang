package vibelang

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func buildFixFixture(t *testing.T) (string, *fixSys) {
	t.Helper()
	_, file, _, _ := editorProgram(t, "export const n = 1\n")
	dir := filepath.Dir(file.FileName().AsString())
	writeBuildFixProject(t, dir, "leaf", nil, false)
	writeBuildFixProject(t, dir, "left", []string{"../leaf"}, false)
	writeBuildFixProject(t, dir, "right", []string{"../leaf"}, false)
	writeBuildFixProject(t, dir, ".", []string{"./left", "./right", "./leaf"}, true)
	writeBuildFixProject(t, dir, "unrelated", nil, false)
	return dir, &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: dir}
}

func writeBuildFixProject(t *testing.T, root, name string, refs []string, solution bool) {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	references := make([]map[string]string, 0, len(refs))
	for _, ref := range refs {
		references = append(references, map[string]string{"path": ref})
	}
	files := []string{"main.vibe"}
	if solution {
		files = []string{}
	}
	config := map[string]any{
		"compilerOptions": map[string]any{"composite": true, "target": "ES2022", "module": "NodeNext", "strict": true, "skipLibCheck": true, "types": []string{}, "outDir": "out"},
		"files":           files, "references": references,
		"vibelang": map[string]any{"diagnostics": map[string]string{"EK4609": "off", "EK0801": "off"}},
	}
	data, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	for name, text := range map[string]string{"tsconfig.json": string(data), "main.vibe": "export type N = Effect.Effect<number>\n", "native.ts": "export type Native = Effect.Effect<number>\n"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func readBuildFix(t *testing.T, dir, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// VIP-34 / chapter 007: each project repairs only its files, in dependency order.
func TestFixBuildProjectsInOrder(t *testing.T) {
	for _, flag := range []string{"--build", "-b", "--b", "-build", "--BUILD"} {
		t.Run(flag, func(t *testing.T) {
			dir, sys := buildFixFixture(t)
			unrelated := readBuildFix(t, dir, "unrelated/tsconfig.json")
			if status := FixWithOptions(t.Context(), sys, []string{flag, "tsconfig.json", "--pretty", "false"}, FixOptions{}); status != 0 {
				t.Fatalf("build fixes failed: %d\n%s\n%s", status, sys.stdout.String(), sys.stderr.String())
			}
			// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#4f5596f6f7f2a3e4 | In `-b`, each project fixes its own files in build order.
			// rule-evidence: docs/design/src/007-tooling.md#fix-ownership-and-preservation | With `-b`, each project fixes its own files in build order.
			previous := -1
			for _, name := range []string{"leaf/tsconfig.json", "left/tsconfig.json", "right/tsconfig.json", "tsconfig.json"} {
				needle := "vibelang --fix: " + name + ": migrated"
				at := strings.Index(sys.stdout.String(), needle)
				if at < previous || at < 0 || strings.Count(sys.stdout.String(), needle) != 1 {
					t.Fatalf("wrong/duplicate build order at %s:\n%s", name, sys.stdout.String())
				}
				previous = at
				text := readBuildFix(t, dir, name)
				if strings.Contains(text, "\"vibelang\"") || !strings.Contains(text, "\"severities\"") {
					t.Errorf("config not migrated: %s", text)
				}
			}
			for _, name := range []string{"leaf", "left", "right"} {
				text := readBuildFix(t, dir, name+"/main.vibe")
				if !strings.Contains(text, "number!!") {
					t.Errorf("%s source was not repaired: %s", name, text)
				}
				if text := readBuildFix(t, dir, name+"/native.ts"); text != "export type Native = Effect.Effect<number>\n" {
					t.Errorf("foreign TypeScript changed: %s", text)
				}
			}
			if got := readBuildFix(t, dir, "unrelated/tsconfig.json"); got != unrelated {
				t.Fatal("unreferenced project was edited")
			}
			before := projectBytes(t, dir)
			sys.stdout.Reset()
			sys.stderr.Reset()
			if status := FixWithOptions(t.Context(), sys, []string{flag}, FixOptions{}); status != 0 {
				t.Fatalf("second run: %d %s", status, sys.stderr.String())
			}
			expectChanged(t, before, projectBytes(t, dir))
		})
	}
}

func TestFixBuildDoesNotWriteForNonBuildingInvocations(t *testing.T) {
	for _, args := range [][]string{{"--build", "--dry"}, {"--build", "--clean"}, {"--build", "--help"}, {"--build", "--unknown"}, {"--build", "--watch"}} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			dir, sys := buildFixFixture(t)
			before := readBuildFix(t, dir, "leaf/tsconfig.json")
			FixWithOptions(t.Context(), sys, args, FixOptions{})
			if got := readBuildFix(t, dir, "leaf/tsconfig.json"); got != before {
				t.Fatalf("non-build invocation edited config: %s", got)
			}
		})
	}
}

func TestFixBuildRejectsCycleBeforeRepair(t *testing.T) {
	dir, sys := buildFixFixture(t)
	writeBuildFixProject(t, dir, "leaf", []string{"../left"}, false)
	before := readBuildFix(t, dir, "right/tsconfig.json")
	// The normal compilation reports TS6202; no repair writes into the cycle.
	FixWithOptions(t.Context(), sys, []string{"--build"}, FixOptions{})
	if got := readBuildFix(t, dir, "right/tsconfig.json"); got != before {
		t.Fatal("cyclic build edited files")
	}
}

func TestFixBuildOnlyPartitionsProjects(t *testing.T) {
	dir, sys := buildFixFixture(t)
	leafConfig := readBuildFix(t, dir, "leaf/tsconfig.json")
	right := readBuildFix(t, dir, "right/main.vibe")
	only := []tspath.RootedFilePath{
		tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "leaf/main.vibe"))),
		tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "left/main.vibe"))),
	}
	if status := FixWithOptions(t.Context(), sys, []string{"--build"}, FixOptions{Only: only}); status != 0 {
		t.Fatalf("listed build fixes: %d %s", status, sys.stderr.String())
	}
	if got := readBuildFix(t, dir, "leaf/tsconfig.json"); got != leafConfig {
		t.Fatal("listed build wrote a config")
	}
	if got := readBuildFix(t, dir, "right/main.vibe"); got != right {
		t.Fatal("listed build wrote an unlisted source")
	}
	for _, name := range []string{"leaf/main.vibe", "left/main.vibe"} {
		if got := readBuildFix(t, dir, name); !strings.Contains(got, "number!!") {
			t.Fatalf("listed source not repaired: %s", got)
		}
	}
}

func TestFixBuildOnlyValidatesAllProjectsBeforeWriting(t *testing.T) {
	for _, invalid := range []string{"unrelated/main.vibe", "leaf/native.ts", "missing.vibe", ""} {
		t.Run(invalid, func(t *testing.T) {
			dir, sys := buildFixFixture(t)
			before := readBuildFix(t, dir, "leaf/main.vibe")
			only := []tspath.RootedFilePath{}
			if invalid != "" {
				only = append(only, tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "leaf/main.vibe"))), tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, invalid))))
			}
			if status := FixWithOptions(t.Context(), sys, []string{"--build"}, FixOptions{Only: only}); status == 0 {
				t.Fatal("invalid build scope passed")
			}
			if got := readBuildFix(t, dir, "leaf/main.vibe"); got != before {
				t.Fatal("invalid scope caused a partial write")
			}
		})
	}
}

func TestFixBuildCanceledBeforeRepair(t *testing.T) {
	dir, sys := buildFixFixture(t)
	before := readBuildFix(t, dir, "leaf/tsconfig.json")
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if status := FixWithOptions(ctx, sys, []string{"--build"}, FixOptions{}); status == 0 {
		t.Fatal("canceled build passed")
	}
	if got := readBuildFix(t, dir, "leaf/tsconfig.json"); got != before {
		t.Fatal("canceled build edited config")
	}
}

func TestFixBuildFlagMustBeFirst(t *testing.T) {
	dir, sys := buildFixFixture(t)
	before := readBuildFix(t, dir, "leaf/tsconfig.json")
	// Like tsc, the later compilation reports TS6369. Repairs must not run.
	if status := FixWithOptions(t.Context(), sys, []string{"--pretty", "false", "--build"}, FixOptions{}); status != 0 {
		t.Fatalf("invalid options should be reported by compilation: %d", status)
	}
	if got := readBuildFix(t, dir, "leaf/tsconfig.json"); got != before {
		t.Fatal("misplaced build flag edited config")
	}
}

// A minimal safe version of the census witness needs no Effect program.
// EK4609 exercises the same migration as the original EK0801 witness.
func TestFixBuildConfigWitness(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "leaf"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, text := range map[string]string{
		"tsconfig.json":      `{"files":[],"references":[{"path":"./leaf"}],"vibe":{"effectGlobals":false,"effectModules":false}}`,
		"leaf/tsconfig.json": `{"compilerOptions":{"composite":true,"types":[]},"files":["main.vibe"],"vibe":{"effectGlobals":false,"effectModules":false},"vibelang":{"diagnostics":{"EK4609":"off"}}}`,
		"leaf/main.vibe":     "export const n = 1\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	sys := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: dir}
	if status := FixWithOptions(t.Context(), sys, []string{"--build", "tsconfig.json"}, FixOptions{}); status != 0 {
		t.Fatalf("build config witness failed: status=%d %s", status, sys.stderr.String())
	}
	config := readBuildFix(t, dir, "leaf/tsconfig.json")
	if strings.Contains(config, `"vibelang"`) || !strings.Contains(config, `"severities"`) {
		t.Fatalf("leaf config not migrated: %s", config)
	}
}
