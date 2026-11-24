package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
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

const stockCLICompatibilityFixture = `#!/bin/sh
set -eu
project=$2
out=$4
shift 4
case "${0##*/}: $*" in
  legacy*:*--singleThreaded*) exit 2 ;;
  native*:*--singleThreaded*) ;;
  native*:*) exit 3 ;;
esac
mkdir -p "$out"
printf '%s\n' "$project" > "$out/project"
printf 'export const answer = 42;\n' > "$out/main.js"
printf 'export declare const answer = 42;\n' > "$out/main.d.ts"
`

// Exercise argument order and output paths using a fake compiler with legacy
// and native flag handling. The real baseline compilers are tested above.
func TestStockCompileCLICompatibility(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the fake compiler uses a POSIX shell")
	}
	dir := t.TempDir()
	for _, mode := range []string{"legacy", "native"} {
		t.Run(mode, func(t *testing.T) {
			install := filepath.Join(dir, mode)
			compiler := filepath.Join(install, "node_modules", ".bin", mode+"-stock")
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
			if err := os.WriteFile(compiler, []byte(stockCLICompatibilityFixture), 0o700); err != nil {
				t.Fatal(err)
			}
			for variant := range 4 {
				output := filepath.Join(install, fmt.Sprintf("output %d 雪 'quoted'", variant))
				project := fmt.Sprintf("project %d.json", variant)
				args := []string{"-p", project, "--outDir", output}
				if variant&1 != 0 {
					args = append(args, "--pretty", "false")
				}
				if variant&2 != 0 {
					args = append(args, "--declaration")
				}
				wantArgs := slices.Clone(args)
				if mode == "native" {
					wantArgs = append(wantArgs, "--singleThreaded")
				}
				ctx, cancel := newOracleContext(t)
				cmd := stockCompile(ctx, compiler, args...)
				if !slices.Equal(cmd.Args[1:], wantArgs) {
					t.Errorf("variant %d arguments: got %v want %v", variant, cmd.Args[1:], wantArgs)
				}
				out, err := cmd.CombinedOutput()
				contextErr := ctx.Err()
				cancel()
				if contextErr != nil {
					Missing(t, "stock compiler fixture infrastructure: %v", contextErr)
				}
				if err != nil {
					t.Fatalf("variant %d compile: %v\n%s", variant, err, out)
				}
				for file, want := range map[string]string{
					"project":   project + "\n",
					"main.js":   "export const answer = 42;\n",
					"main.d.ts": "export declare const answer = 42;\n",
				} {
					got, err := os.ReadFile(filepath.Join(output, file))
					if err != nil || string(got) != want {
						t.Errorf("variant %d %s: got %q, error %v", variant, file, got, err)
					}
				}
			}
		})
	}
}
