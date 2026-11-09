package vibelangfuzz

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const provideCompoundTarget = "FuzzProvideCompoundAssignments"
const provideCompoundGrammar = "Provider = LeftHandSideExpression \"=\" AssignmentExpression   (Key = value)\n         | ConditionalExpression                             (a Layer)"
const provideCompoundFallback = "otherwise it is an identifier, in any code."

func TestProvideCompoundAssignmentsQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", provideCompoundGrammar)
	chapterSays(t, "005-services.md", provideCompoundFallback)
}

// The Provider production excludes an outer compound assignment. Its head
// retains the identifier reading and native syntax diagnostics; parentheses,
// conditional branches and a Key = value right side admit assignments.
func FuzzProvideCompoundAssignments(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "900-appendices.md", provideCompoundGrammar)
	chapterSays(f, "005-services.md", provideCompoundFallback)
	data, err := os.ReadFile("testdata/provider-compound-assignments.json")
	if err != nil {
		f.Fatal(err)
	}
	var rows []struct {
		Key, Head string
		Provide   bool
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		f.Fatal(err)
	}
	for _, row := range rows {
		for _, mode := range []byte{0, 3, 15} {
			f.Add(row.Key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		at := slices.IndexFunc(rows, func(row struct {
			Key, Head string
			Provide   bool
		}) bool {
			return row.Key == key
		})
		if at < 0 {
			at = len(key) % len(rows)
		}
		row := rows[at]
		ext, nativeExt, kind := "vibe", "ts", core.ScriptKindTS
		if mode&1 != 0 {
			ext, nativeExt, kind = "vibex", "tsx", core.ScriptKindTSX
		}
		prefix := "effect function"
		if mode&8 != 0 {
			prefix = "function"
		}
		source := prefix + " f(){\n provide " + row.Head + " {}\n}"
		if mode&4 != 0 {
			source = strings.ReplaceAll(source, "layer", "capacité")
			source = strings.Replace(source, "provide ", "provide /* trivia */ ", 1)
		}
		if mode&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		name := "/main." + ext
		file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, source)
		count := 0
		for _, form := range forms {
			if form.Kind == parser.VibeSyntaxBlockStatement && source[form.Word.Pos():form.Word.End()] == "provide" {
				count++
			}
		}
		if (count == 1) != row.Provide || count > 1 {
			Gap(t, provideCompoundTarget, row.Key+":classification", "%s; want provide=%t, got %d recorded forms; source=%s", provideCompoundGrammar, row.Provide, count, source)
			return
		}
		codes := func(f *ast.SourceFile) []int32 {
			var values []int32
			for _, d := range f.Diagnostics() {
				values = append(values, d.Code())
			}
			slices.Sort(values)
			return values
		}
		got := codes(file)
		if row.Provide {
			if len(got) != 0 {
				Gap(t, provideCompoundTarget, row.Key+":diagnostics", "%s; valid provider rejected: %v; source=%s", provideCompoundGrammar, got, source)
				return
			}
		} else {
			nativeName := "/main." + nativeExt
			nativeSource := strings.Replace(source, "effect function", "function", 1)
			native := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(nativeName), PathKey: tspath.PathKey(nativeName)}, nativeSource, kind)
			want := codes(native)
			if len(want) == 0 || !slices.Equal(got, want) {
				Gap(t, provideCompoundTarget, row.Key+":native", "%s; identifier syntax got %v, native %v; source=%s", provideCompoundFallback, got, want, source)
				return
			}
		}
		ExpectPending(t, provideCompoundTarget, row.Key)
		ExpectPending(t, provideCompoundTarget, specCorpusKey(t))
	})
}
