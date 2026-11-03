package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const relicNativeSeparatorQuote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."

func relicNativeSeparatorsQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("000-intro.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), relicNativeSeparatorQuote) {
		t.Fatalf("stale native separator oracle: %q", relicNativeSeparatorQuote)
	}
}

// Retain ordinary punctuation coverage separately from obsolete mixed Control
// fixtures. The native TypeScript parse is the oracle; retirement adds no
// rejection for these classes, default initializers or object literals.
func relicNativeSeparatorSources(kind int, separator, name string) (string, string) {
	switch kind {
	case 0:
		source := fmt.Sprintf("class Ordinary { %s(): number%ssecond(): string }", name, separator)
		return source, source
	case 1:
		source := fmt.Sprintf("service Outer { static readonly key = \"separator/Outer\"; static readonly defaultValue = () => { abstract class Nested { %s(): number%ssecond(): string } return {} } }", name, separator)
		return source, strings.Replace(source, "service Outer", "class Outer", 1)
	default:
		source := fmt.Sprintf("service ObjectFactory { static readonly key = \"separator/ObjectFactory\"; static readonly defaultValue = () => ({ %s(): number%s }); method(): number!! }", name, separator)
		native := strings.Replace(source, "service ObjectFactory", "class ObjectFactory", 1)
		return source, strings.Replace(native, "number!!", "number", 1)
	}
}

func relicNativeSeparatorDiagnostics(source string, vibe bool) []*ast.Diagnostic {
	options := ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}
	if vibe {
		options.FileName, options.PathKey = "/main.vibe", "/main.vibe"
	}
	return parser.ParseSourceFile(options, source, core.ScriptKindTS).Diagnostics()
}

func relicNativeSeparatorCodes(ds []*ast.Diagnostic) []int32 {
	out := make([]int32, len(ds))
	for i, d := range ds {
		out[i] = d.Code()
	}
	return out
}

func checkRelicNativeSeparator(t testing.TB, kind int, separator, name string) {
	t.Helper()
	source, native := relicNativeSeparatorSources(kind, separator, name)
	actual := relicNativeSeparatorDiagnostics(source, true)
	expected := relicNativeSeparatorDiagnostics(native, false)
	if !slices.Equal(relicNativeSeparatorCodes(actual), relicNativeSeparatorCodes(expected)) {
		t.Fatalf("native separator parse differs: Vibe=%v TS=%v\n%s\n%s", relicNativeSeparatorCodes(actual), relicNativeSeparatorCodes(expected), source, native)
	}
	if separator == ", " {
		want := int32(1144)
		if kind == 2 {
			want = 1005
		}
		if len(actual) != 1 || actual[0].Code() != want || actual[0].Pos() != strings.Index(source, ",") {
			t.Fatalf("lost original comma witness: codes=%v, source=%s", relicNativeSeparatorCodes(actual), source)
		}
	}
}

func TestRelicNativeSeparators(t *testing.T) {
	relicNativeSeparatorsQuoted(t)
	for kind := range 3 {
		for _, separator := range []string{", ", "; ", "\n"} {
			checkRelicNativeSeparator(t, kind, separator, "first")
		}
	}
}

func FuzzRelicNativeSeparators(f *testing.F) {
	startShortBudget(f)
	relicNativeSeparatorsQuoted(f)
	contexts := []string{"ordinary", "nested-default", "object-factory"}
	separators := []string{", ", "; ", "\n"}
	keys := []string{"comma", "semicolon", "newline"}
	for _, context := range contexts {
		for _, key := range keys {
			f.Add([]byte(context + ":" + key))
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		kind, separator, name := 0, 0, 0
		if len(data) > 0 {
			kind, separator, name = int(data[0])%3, int(data[len(data)-1])%3, len(data)%6
		}
		for i, context := range contexts {
			for j, key := range keys {
				if string(data) == context+":"+key {
					kind, separator = i, j
				}
			}
		}
		checkRelicNativeSeparator(t, kind, separators[separator], []string{"first", "resume", "handle", "abandon", "select", "Control"}[name])
	})
}
