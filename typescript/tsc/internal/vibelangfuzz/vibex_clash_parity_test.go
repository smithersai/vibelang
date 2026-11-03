package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const vibexClashQuote = "Every JSX production, and its scanning, checking and emit, is exactly `.tsx`'s."

func TestVibexClashParityQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0039-vibex.md"), vibexClashQuote) {
		t.Fatalf("VIP-39 no longer says %q", vibexClashQuote)
	}
}

// Keyed native clash rows exercise the JSX rename oracle across trivia and
// line-ending mutations. No compiler output supplies the expected grammar.
func FuzzVibexClashParity(f *testing.F) {
	startShortBudget(f)
	paths, err := filepath.Glob("../../../vibelang/cases/vibex-clash/*.tsx")
	if err != nil || len(paths) < 15 {
		f.Fatalf("missing clash controls: %v (%d)", err, len(paths))
	}
	sources := map[string]string{}
	var keys []string
	for _, path := range paths {
		key := strings.TrimSuffix(filepath.Base(path), ".tsx")
		data, err := os.ReadFile(path)
		if err != nil {
			f.Fatal(err)
		}
		sources[key] = string(data)
		keys = append(keys, key)
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
		f.Add(key, uint8(2))
	}
	slices.Sort(keys)
	f.Fuzz(func(t *testing.T, key string, trivia uint8) {
		TestVibexClashParityQuoted(t)
		if _, ok := sources[key]; !ok {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		source := sources[key]
		switch trivia % 3 {
		case 1:
			source = "/* JSX boundary */\n" + source + "\n// end\n"
		case 2:
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		parse := func(ext string) []string {
			name := tspath.RootedFilePath("/clash." + ext)
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: name, PathKey: tspath.PathKey(name)}, source, core.ScriptKindTSX)
			result := []string{}
			for _, d := range file.Diagnostics() {
				result = append(result, fmt.Sprintf("diagnostic:%d:%d:%d", d.Code(), d.Pos(), d.Len()))
			}
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				result = append(result, fmt.Sprintf("%s:%d:%d", n.Kind, n.Pos(), n.End()))
				n.ForEachChild(visit)
				return false
			}
			visit(file.AsNode())
			return result
		}
		want, got := parse("tsx"), parse("vibex")
		if !reflect.DeepEqual(got, want) {
			Gap(t, "FuzzVibexClashParity", key, "VIP-39 native JSX rename diverged: tsx=%v vibex=%v", want, got)
		}
	})
}
