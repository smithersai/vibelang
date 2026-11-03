package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const lintNoEmitQuote = "The lint command emits no files"

var lintNoEmitKeys = []string{"sidecar", "existing-sidecar", "incremental-ts", "incremental-vibe", "existing-buildinfo", "error"}

func lintNoEmitQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), lintNoEmitQuote) {
		t.Fatalf("chapter 7 no longer says %q", lintNoEmitQuote)
	}
}

func TestLintNoEmitQuoted(t *testing.T) { lintNoEmitQuoted(t) }

// These are output contracts, independent of how the driver suppresses emit:
// successful and erroneous lint runs leave sources and existing artifacts intact.
func TestLintLeavesProjectUnchanged(t *testing.T) {
	lintNoEmitQuoted(t)
	binary := cliBuild(t, t.TempDir())
	for _, key := range lintNoEmitKeys {
		for _, variant := range []byte{0, 31} {
			t.Run(fmt.Sprintf("%s/%d", key, variant), func(t *testing.T) {
				lintNoEmitCheck(t, binary, key, variant)
			})
		}
	}
}

// Normal compile and --noEmit keep VIP-27 compatibility output. Suppression
// belongs to the lint command, rather than the compiler's ordinary noEmit flag.
func TestCompileKeepsCompatibilitySidecars(t *testing.T) {
	binary := cliBuild(t, t.TempDir())
	for _, noEmit := range []bool{false, true} {
		t.Run(fmt.Sprint(noEmit), func(t *testing.T) {
			dir := t.TempDir()
			for name, text := range map[string]string{
				"package.json":  "{\"name\":\"compile-sidecar-control\",\"type\":\"module\"}",
				"main.vibe":     "export const n: number = 1",
				"tsconfig.json": fmt.Sprintf("{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[],\"noEmit\":%t},\"files\":[\"main.vibe\"]}", noEmit),
			} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0644); err != nil {
					t.Fatal(err)
				}
			}
			cmd := exec.CommandContext(t.Context(), binary, "-p", dir, "--pretty", "false")
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("compile: %v\n%s", err, output)
			}
			if _, err := os.Stat(filepath.Join(dir, "main.d.vibe.ts")); err != nil {
				t.Fatalf("missing compatibility declaration: %v", err)
			}
			_, jsErr := os.Stat(filepath.Join(dir, "main.js"))
			if (!noEmit && jsErr != nil) || (noEmit && !os.IsNotExist(jsErr)) {
				t.Fatalf("noEmit=%t, JavaScript stat: %v", noEmit, jsErr)
			}
		})
	}
}

// Chapter 007 / lint takes project and file arguments without emitting: docs/design/src/007-tooling.md#ce6b930ccbda8788
func FuzzLintNoEmit(f *testing.F) {
	startShortBudget(f)
	lintNoEmitQuoted(f)
	for _, key := range lintNoEmitKeys {
		f.Add([]byte(key))
		f.Add(append([]byte(key+"\x00"), 31))
	}
	binary := cliBuild(f, f.TempDir())
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key, variant := parts[0], byte(0)
		known := false
		for _, candidate := range lintNoEmitKeys {
			known = known || key == candidate
		}
		if !known {
			index := byte(0)
			if len(data) != 0 {
				index = data[0]
			}
			key = lintNoEmitKeys[int(index)%len(lintNoEmitKeys)]
		}
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		lintNoEmitCheck(t, binary, key, variant)
	})
}

type lintNoEmitFile struct {
	Text    string
	ModTime int64
	Mode    fs.FileMode
}

func lintNoEmitSnapshot(t testing.TB, dir string) map[string]lintNoEmitFile {
	t.Helper()
	files := map[string]lintNoEmitFile{}
	err := filepath.WalkDir(dir, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		text, err := os.ReadFile(name)
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(dir, name)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(relative)] = lintNoEmitFile{string(text), info.ModTime().UnixNano(), info.Mode()}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func lintNoEmitCheck(t *testing.T, binary, key string, variant byte) {
	t.Helper()
	dir := t.TempDir()
	write := func(name, text string) {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	extension := ".vibe"
	if key == "incremental-ts" {
		extension = ".ts"
	}
	name := "main" + extension
	if variant&1 != 0 {
		name = "sub/café file" + extension
	}
	source := "export const n: number = 1\n"
	if key == "error" {
		source = "export const n: number = 'bad'\n"
	}
	write(name, source)
	write("package.json", "{\"name\":\"lint-no-emit\",\"type\":\"module\"}")
	options := map[string]any{"target": "ES2022", "module": "NodeNext", "strict": true, "skipLibCheck": true, "types": []string{}, "outDir": "out"}
	if strings.Contains(key, "incremental") || key == "existing-buildinfo" || variant&16 != 0 {
		options["incremental"] = true
		options["tsBuildInfoFile"] = "cache/project.tsbuildinfo"
	}
	if variant&8 != 0 {
		options["declaration"], options["declarationMap"], options["sourceMap"] = true, true, true
	}
	configName := "tsconfig.json"
	if variant&2 != 0 {
		configName = "vibe.config.json"
	}
	config, err := json.Marshal(map[string]any{"compilerOptions": options, "files": []string{name}})
	if err != nil {
		t.Fatal(err)
	}
	write(configName, string(config))
	if key == "existing-sidecar" {
		write(strings.TrimSuffix(name, extension)+".d.vibe.ts", "// preserve this artifact\nexport declare const n: 99\n")
	}
	if key == "existing-buildinfo" {
		write("cache/project.tsbuildinfo", "preserve existing build metadata\n")
	}
	before := lintNoEmitSnapshot(t, dir)
	project := configName
	if variant&4 != 0 {
		project = "."
	}
	ctx, cancel := context.WithTimeout(t.Context(), cliDeadline)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "lint", "-p", project, "--pretty", "false")
	cmd.Dir = dir
	cliIsolate(cmd)
	output, runErr := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatalf("lint exceeded its deadline: %v", ctx.Err())
	}
	if key == "error" {
		if runErr == nil || !strings.Contains(string(output), "TS2322") {
			t.Fatalf("missing source error: %v\n%s", runErr, output)
		}
	} else if runErr != nil {
		t.Fatalf("valid project failed lint: %v\n%s", runErr, output)
	}
	after := lintNoEmitSnapshot(t, dir)
	if !reflect.DeepEqual(before, after) {
		Gap(t, "FuzzLintNoEmit", key, "chapter 7: %s; before=%v after=%v", lintNoEmitQuote, before, after)
		return
	}
	ExpectPending(t, "FuzzLintNoEmit", key)
	ExpectPending(t, "FuzzLintNoEmit", specCorpusKey(t))
}
