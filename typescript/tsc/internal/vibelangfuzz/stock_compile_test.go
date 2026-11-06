package vibelangfuzz

import (
	"context"
	"os"
	"path/filepath"
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
