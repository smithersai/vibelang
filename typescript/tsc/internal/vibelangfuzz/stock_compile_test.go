package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestStockCompileSupportsBothBaselines(t *testing.T) {
	legacy := alchemyUnionPipeStock(t)
	native, err := stockTypeScript()
	if err != nil {
		Missing(t, "install the mapper's stock TypeScript baseline: %v", err)
		return
	}
	for _, row := range []struct {
		name   string
		tsc    string
		native bool
	}{
		{"JavaScript", legacy, false},
		{"native", native, true},
	} {
		t.Run(row.name, func(t *testing.T) {
			dir := t.TempDir()
			for name, text := range map[string]string{
				"package.json":  "{\"type\":\"module\"}",
				"tsconfig.json": "{\"compilerOptions\":{\"strict\":true,\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"types\":[],\"noEmit\":true},\"files\":[\"main.ts\"]}",
				"main.ts":       "export const answer: number = 42;\n",
			} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
			defer cancel()
			cmd := stockCompile(ctx, row.tsc, "-p", ".", "--pretty", "false")
			cmd.Dir = dir
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("stock compiler rejected an ordinary TypeScript project: %v\n%s", err, out)
			}
			if got := slices.Contains(cmd.Args, "--singleThreaded"); got != row.native {
				t.Fatalf("native-only option present=%v, want %v", got, row.native)
			}
			if row.native {
				for _, setting := range []string{"GOGC=off", "GOMEMLIMIT=1GiB"} {
					if !slices.Contains(cmd.Env, setting) {
						t.Errorf("native stock compiler lost CPU setting %s", setting)
					}
				}
			}
			if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte("export const answer: number = \"invalid\";\n"), 0600); err != nil {
				t.Fatal(err)
			}
			cmd = stockCompile(ctx, row.tsc, "-p", ".", "--pretty", "false")
			cmd.Dir = dir
			out, err := cmd.CombinedOutput()
			if err == nil || !strings.Contains(string(out), "error TS2322") {
				t.Fatalf("stock compiler lost the selected project's type error: %v\n%s", err, out)
			}
		})
	}
}

const stockCLICompatibilityFixture = `package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

func main() {
	args := os.Args[1:]
	legacy := strings.HasPrefix(filepath.Base(os.Args[0]), "legacy")
	event, _ := json.Marshal(struct {
		Args []string
	}{args})
	journal, err := os.OpenFile(os.Args[0]+".events", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil { panic(err) }
	if _, err := journal.Write(append(event, '\n')); err != nil { panic(err) }
	journal.Close()
	if legacy && slices.Contains(args, "--singleThreaded") {
		fmt.Fprintln(os.Stderr, "error TS5023: Unknown compiler option '--singleThreaded'.")
		os.Exit(1)
	}
	i := slices.Index(args, "--outDir")
	if i < 0 || i+1 == len(args) { panic("missing output directory") }
	dir := args[i+1]
	if err := os.MkdirAll(dir, 0700); err != nil { panic(err) }
	if err := os.WriteFile(filepath.Join(dir, "main.js"), []byte("export const answer = 42;\n"), 0600); err != nil { panic(err) }
	if err := os.WriteFile(filepath.Join(dir, "main.d.ts"), []byte("export declare const answer = 42;\n"), 0600); err != nil { panic(err) }
}
`

// The CLI is independent of the adapter: legacy executables reject the native
// flag, while either executable emits the same complete output for its inputs.
func TestStockCompileCLICompatibility(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "stock.go")
	if err := os.WriteFile(source, []byte(stockCLICompatibilityFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	suffix := ""
	if runtime.GOOS == "windows" {
		suffix = ".exe"
	}
	built := filepath.Join(dir, "fixture"+suffix)
	build := exec.Command("go", "build", "-p", "8", "-trimpath", "-o", built, source)
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build compiler fixture: %v\n%s", err, out)
	}
	executable, err := os.ReadFile(built)
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"legacy", "native"} {
		t.Run(mode, func(t *testing.T) {
			install := filepath.Join(dir, mode)
			compiler := filepath.Join(install, "node_modules", ".bin", mode+"-stock"+suffix)
			if err := os.MkdirAll(filepath.Dir(compiler), 0o700); err != nil {
				t.Fatal(err)
			}
			if mode == "legacy" {
				api := filepath.Join(install, "node_modules", "typescript", "lib", "typescript.js")
				if err := os.MkdirAll(filepath.Dir(api), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(api, []byte("// JavaScript compiler API fixture.\n"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(compiler, executable, 0o700); err != nil {
				t.Fatal(err)
			}
			var wg sync.WaitGroup
			for worker := range 8 {
				wg.Go(func() {
					for variant := range 4 {
						n := worker*4 + variant
						output := filepath.Join(dir, fmt.Sprintf("%s-%d 雪 'quoted'", mode, n))
						args := []string{"-p", fmt.Sprintf("project %d.json", n), "--outDir", output}
						if variant&1 != 0 {
							args = append(args, "--pretty", "false")
						}
						if variant&2 != 0 {
							args = append(args, "--declaration")
						}
						ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
						wantArgs := slices.Clone(args)
						if mode == "native" {
							wantArgs = append(wantArgs, "--singleThreaded")
						}
						cmd := stockCompile(ctx, compiler, args...)
						if !slices.Equal(cmd.Args[1:], wantArgs) {
							t.Errorf("variant %d arguments: got %v want %v", n, cmd.Args[1:], wantArgs)
						}
						cmd.Dir = dir
						out, err := cmd.CombinedOutput()
						cancel()
						if err != nil {
							t.Errorf("variant %d compile: %v\n%s", n, err, out)
							continue
						}
						for file, want := range map[string]string{
							"main.js":   "export const answer = 42;\n",
							"main.d.ts": "export declare const answer = 42;\n",
						} {
							got, err := os.ReadFile(filepath.Join(output, file))
							if err != nil || string(got) != want {
								t.Errorf("variant %d %s: got %q, error %v", n, file, got, err)
							}
						}
					}
				})
			}
			wg.Wait()
			events, err := os.ReadFile(compiler + ".events")
			if err != nil {
				t.Fatal(err)
			}
			compiles := 0
			for line := range strings.SplitSeq(strings.TrimSpace(string(events)), "\n") {
				var event struct {
					Args []string
				}
				if err := json.Unmarshal([]byte(line), &event); err != nil {
					t.Fatal(err)
				}
				compiles++
				if got := slices.Contains(event.Args, "--singleThreaded"); got != (mode == "native") {
					t.Errorf("%s native flag: %v", mode, event.Args)
				}
				if len(event.Args) < 4 || event.Args[0] != "-p" || event.Args[2] != "--outDir" {
					t.Errorf("project and output arguments moved: %v", event.Args)
				}
			}
			if compiles != 32 {
				t.Errorf("CLI calls: compiles=%d, want all 32 compiles", compiles)
			}
		})
	}
}
