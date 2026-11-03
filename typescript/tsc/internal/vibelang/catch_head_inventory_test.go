package vibelang

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// This inventory reports syntax candidates, including intentional failures;
// it does not claim every executed head produces a non-Effect value.
func TestCatchProtectionLaneInventory(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	type counts struct{ files, heads, execution int }
	byRoot := map[string]*counts{}
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			switch entry.Name() {
			case ".git", ".jj", ".cache", "node_modules", "out", "dist":
				return filepath.SkipDir
			}
			if strings.HasPrefix(entry.Name(), ".smthrs-") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(entry.Name(), ".vibe") {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		group := strings.Split(filepath.ToSlash(rel), "/")[0]
		if byRoot[group] == nil {
			byRoot[group] = &counts{}
		}
		result := byRoot[group]
		result.files++
		text, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if !strings.Contains(string(text), "catch") {
			return nil
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/inventory.vibe", PathKey: "/inventory.vibe"}, string(text), core.ScriptKindTS)
		var executes func(*ast.Node) bool
		executes = func(n *ast.Node) bool {
			if isFunctionBoundary(n) && !isCalledInPlace(n) && !isCatchLeftFunction(n) {
				return false
			}
			if isTry(n) || catchExpressionOf(n) != nil || fiberHelper(n) == "$join" {
				return true
			}
			return n.ForEachChild(executes)
		}
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if catchExpressionOf(n) != nil && inEffectCode(n) {
				result.heads++
				if executes(n.Arguments()[0].Body()) {
					result.execution++
				}
			}
			n.ForEachChild(visit)
			return false
		}
		file.AsNode().ForEachChild(visit)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(byRoot))
	for key := range byRoot {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		n := byRoot[key]
		t.Logf("CATCH_HEAD_COUNTS root=%s vibe_files=%d catch_heads=%d execution_heads=%d", key, n.files, n.heads, n.execution)
	}
}
