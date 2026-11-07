package vibelangfuzz

import (
	"context"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func stockDeclarationFiles(t *testing.T, dir string) map[string]string {
	t.Helper()
	files := map[string]string{}
	err := filepath.WalkDir(filepath.Join(dir, "out"), func(name string, entry fs.DirEntry, err error) error {
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		data, err := os.ReadFile(name)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, name)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(rel)] = string(data)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}
func stockDeclarationDiagnostics(text, dir string) []string {
	var result []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(strings.ReplaceAll(line, filepath.ToSlash(dir)+"/", ""))
		if line != "" {
			result = append(result, line)
		}
	}
	slices.Sort(result)
	return slices.Compact(result)
}

func TestStockDeclarationWorkerCLIParity(t *testing.T) {
	tsc := StockTypeScript(t)
	worker := newStockDeclarationWorker(tsc, t.Name())
	if worker.module == "" {
		t.Fatal("pinned native compiler API missing")
	}
	t.Cleanup(func() {
		if err := worker.Close(); err != nil {
			t.Error(err)
		}
	})
	dir := t.TempDir()
	// Reuse the exact paths, changing declarations, source text, module mode,
	// options and a referenced configuration. A stale snapshot must not pass.
	for i := range 32 {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			typ := "number"
			value := "1"
			extension := "ts"
			extra := ""
			if i%2 != 0 {
				typ = "string"
			}
			if i%3 == 0 {
				value = `"text"`
			}
			if i%4 == 0 {
				extension = "tsx"
				extra = `,"jsx":"preserve"`
			}
			if i%5 == 0 {
				extra += `,"noEmitOnError":true`
			}
			moduleType := "module"
			if i%7 == 0 {
				moduleType = "commonjs"
			}
			source := fmt.Sprintf("import type {Value} from './dependency.js';\n/** version %d */\nexport const value:Value=%s;\n", i, value)
			for _, name := range []string{"main.ts", "main.tsx"} {
				_ = os.Remove(filepath.Join(dir, name))
			}
			files := map[string]string{
				"main." + extension: source,
				"dependency.d.ts":   "export type Value=" + typ + ";\n",
				"package.json":      fmt.Sprintf(`{"type":%q}`, moduleType),
				"base.json":         fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","types":[],"declaration":true,"emitDeclarationOnly":true,"skipLibCheck":true,"outDir":"out"%s}}`, extra),
				"tsconfig.json":     fmt.Sprintf(`{"extends":"./base.json","files":["main.%s"]}`, extension),
			}
			if i == 30 {
				files["tsconfig.json"] = `{"compilerOptions":{"unknownOption":true},"files":["main.ts"]}`
			}
			for name, text := range files {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
					t.Fatal(err)
				}
			}
			_ = os.RemoveAll(filepath.Join(dir, "out"))
			warm, err := worker.Compile(t.Context(), dir)
			if err != nil {
				t.Fatal(err)
			}
			warmFiles := stockDeclarationFiles(t, dir)
			_ = os.RemoveAll(filepath.Join(dir, "out"))
			cold, err := runStockDeclarationCLI(t.Context(), t, tsc, dir)
			if err != nil {
				t.Fatal(err)
			}
			coldFiles := stockDeclarationFiles(t, dir)
			if warm.Rejected != cold.Rejected || !slices.Equal(stockDeclarationDiagnostics(warm.Output, dir), stockDeclarationDiagnostics(cold.Output, dir)) || !maps.Equal(warmFiles, coldFiles) {
				t.Fatalf("warm/cold differs: rejected %v/%v\ndiagnostics %q/%q\nfiles %v/%v", warm.Rejected, cold.Rejected, stockDeclarationDiagnostics(warm.Output, dir), stockDeclarationDiagnostics(cold.Output, dir), warmFiles, coldFiles)
			}
		})
	}
	if worker.starts != 1 || worker.requests != 32 {
		t.Fatalf("expected 32 fresh compilations in one worker: starts=%d requests=%d", worker.starts, worker.requests)
	}
}
func TestStockDeclarationWorkerCancellation(t *testing.T) {
	worker := newStockDeclarationWorker(StockTypeScript(t), t.Name())
	t.Cleanup(func() {
		if err := worker.Close(); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := worker.Compile(ctx, t.TempDir()); err == nil {
		t.Fatal("cancelled compilation was accepted")
	}
	if worker.starts != 0 || worker.requests != 0 {
		t.Fatal("cancelled request started a compiler")
	}
}
