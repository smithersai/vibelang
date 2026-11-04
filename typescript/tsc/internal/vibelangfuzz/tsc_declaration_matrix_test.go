package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
)

const tscDeclarationQuote = "Ordinary declarations use the native twin's relative specifiers;"

func TestTscDeclarationRulesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), tscDeclarationQuote) {
		t.Fatal(tscDeclarationQuote)
	}
}

type tscDeclarationCell struct {
	Key                                                                         string
	Resolution                                                                  string
	Allow, Rewrite                                                              bool
	PackageType, Form, NativeSpecifier, NativeTarget, VibeSpecifier, VibeTarget string
	Emitted                                                                     []string
	Diagnostics                                                                 []int
}

var declarationOracle struct {
	sync.Once
	cells []tscDeclarationCell
	err   error
}

func tscDeclarationCells(t testing.TB) []tscDeclarationCell {
	t.Helper()
	declarationOracle.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(Root(), "scripts/declaration-matrix.mjs"), "--json")
		out, err := cmd.CombinedOutput()
		if err != nil {
			declarationOracle.err = fmt.Errorf("tsc 5.9.3 declaration oracle (install docs/tools dependencies): %w: %s", err, out)
			return
		}
		var data struct {
			Typescript string
			Rows       []tscDeclarationCell
		}
		if err = json.Unmarshal(out, &data); err != nil {
			declarationOracle.err = err
			return
		}
		if data.Typescript != "5.9.3" || len(data.Rows) != 448 {
			declarationOracle.err = fmt.Errorf("wrong oracle version or table size: TypeScript %s, rows %d, want 5.9.3 and 448", data.Typescript, len(data.Rows))
			return
		}
		declarationOracle.cells = data.Rows
	})
	if declarationOracle.err != nil {
		t.Fatal(declarationOracle.err)
	}
	return declarationOracle.cells
}

func checkTscDeclarationCell(t *testing.T, w *Workspace, cell tscDeclarationCell, style string, variant uint8) {
	t.Helper()
	q := "\""
	if variant&1 != 0 {
		q = "'"
	}
	// The table controls spelling/configuration. Mutation varies quotes and export
	// syntax without changing the referenced module or its public value.
	source := "export { value } from " + q + cell.VibeSpecifier + q + ";\n"
	if variant&2 != 0 {
		source = "export * from " + q + cell.VibeSpecifier + q + ";\n"
	}
	if variant&4 != 0 {
		source = "export type Value = typeof import(" + q + cell.VibeSpecifier + q + ").value;\n"
	}
	module := "esnext"
	if cell.Resolution == "node16" || cell.Resolution == "nodenext" {
		module = cell.Resolution
	}
	config := map[string]any{
		"compilerOptions": map[string]any{"target": "es2022", "module": module, "moduleResolution": cell.Resolution,
			"allowImportingTsExtensions": cell.Allow, "rewriteRelativeImportExtensions": cell.Rewrite,
			"jsx": "preserve", "declaration": true, "emitDeclarationOnly": true, "outDir": "out", "rootDir": ".",
			"types": []string{}, "skipLibCheck": true},
		"vibe":  map[string]any{"effectGlobals": false, "effectModules": false},
		"files": []string{"main.vibe", cell.VibeTarget},
	}
	if style != "" {
		config["vibelang"] = map[string]any{"declarationImportStyle": style}
	}
	text, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	result, err := w.Compile(t.Context(), Project{Config: string(text), Files: map[string]string{
		"main.vibe": source, cell.VibeTarget: "export const value: number = 1;\n",
		"package.json": fmt.Sprintf("{\"type\":%q}", cell.PackageType),
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	output, exists := result.Outputs["out/main.d.ts"]
	if !exists {
		Gap(t, "FuzzTscDeclarationSpelling", cell.Key, "missing declaration; diagnostics %v", result.Diagnostics)
		return
	}
	got := sourceSpecifiers("main.d.ts", output)
	want := map[string]bool{}
	for _, specifier := range cell.Emitted {
		want[specifier] = true
	}
	if !maps.Equal(got, want) {
		Gap(t, "FuzzTscDeclarationSpelling", cell.Key, "style=%q: %s\n%q: tsc emits %v; VibeLang emits %v\n%s", style, tscDeclarationQuote, source, cell.Emitted, got, output)
	}

	ExpectPending(t, "FuzzTscDeclarationSpelling", cell.Key)
}

func TestTscDeclarationSpellingMatrix(t *testing.T) {
	TestTscDeclarationRulesQuoted(t)
	w := NewWorkspace(t)
	for _, cell := range tscDeclarationCells(t) {
		for _, style := range []string{"", ".js", "extensionless", ".ts"} {
			t.Run(cell.Key+"/"+style, func(t *testing.T) { checkTscDeclarationCell(t, w, cell, style, 0) })
		}
	}
}

func FuzzTscDeclarationSpelling(f *testing.F) {
	startShortBudget(f)
	cells := tscDeclarationCells(f)
	for _, key := range []string{"bundler/0/0/module/vibe", "bundler/1/1/module/vibex", "node16/0/0/module/directory", "nodenext/1/1/commonjs/mts", "node10/0/1/commonjs/js"} {
		f.Add(key, uint8(0), uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, options, variant uint8) {
		TestTscDeclarationRulesQuoted(t)
		i := slices.IndexFunc(cells, func(c tscDeclarationCell) bool { return c.Key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = (int(key[0])*256 + int(options)) % len(cells)
		}
		checkTscDeclarationCell(t, w, cells[i], []string{"", ".js", "extensionless", ".ts"}[int(variant>>3)%4], variant)
	})
}
