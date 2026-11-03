package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const effectLoopHeadsTarget = "FuzzEffectLoopHeadRecovery"
const effectLoopHeadsQuote = "`var`, `using`, `await using` and an assignment head are syntax errors (`EK1906` in `for concurrent`, `EK2005` in `for try`)"

func TestEffectLoopHeadsQuoted(t *testing.T) { effectLoopHeadsChapter(t) }

func effectLoopHeadsChapter(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), effectLoopHeadsQuote) {
		t.Fatalf("Appendix A no longer says %q", effectLoopHeadsQuote)
	}
}

// The owning grammar error must replace native recovery cascades. Valid
// declarations remain valid; ordinary TypeScript loops retain native diagnostics.
func FuzzEffectLoopHeadRecovery(f *testing.F) {
	startShortBudget(f)
	effectLoopHeadsChapter(f)
	heads := []struct{ key, text string }{{"var", "var x"}, {"using", "using x"}, {"await-using", "await using x"}, {"assignment", "x"}, {"property", "target.x"}, {"var-object", "var { x }"}, {"using-array", "using [x]"}, {"const", "const x"}, {"let-object", "let { x }"}}
	loops := []struct{ key, text string }{{"concurrent", "concurrent"}, {"bounded", "concurrent(2)"}, {"stream", "try"}, {"native", ""}}
	keys := []string{}
	for li := range loops {
		for hi := range heads {
			key := loops[li].key + "-" + heads[hi].key
			keys = append(keys, key)
			f.Add([]byte(key))
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		i := concurrentHeadChoice(keys, data)
		li, hi := i/len(heads), i%len(heads)
		gap := " "
		if len(data) > len(keys[i]) {
			gap = []string{" ", "\n", " /* head */ "}[int(data[len(data)-1])%3]
		}
		source := "effect function f() { for " + loops[li].text + gap + "(" + heads[hi].text + " of xs) { void x } }"
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		ds := file.Diagnostics()
		var want int32
		if hi < 7 && li < 3 {
			want = 1906
			if li == 2 {
				want = 2005
			}
		}
		if li == 3 {
			for _, d := range ds {
				if d.Code() == 1906 || d.Code() == 2005 {
					Gap(t, effectLoopHeadsTarget, keys[i], "ordinary TypeScript loop received an Effect head diagnostic: %s", source)
				}
			}
		} else if want == 0 && len(ds) != 0 || want != 0 && (len(ds) != 1 || ds[0].Code() != want) {
			var codes []int32
			for _, d := range ds {
				codes = append(codes, d.Code())
			}
			Gap(t, effectLoopHeadsTarget, keys[i], "%s: want only %d, got %v\n%s", effectLoopHeadsQuote, want, codes, source)
		}
		ExpectPending(t, effectLoopHeadsTarget, keys[i])
		ExpectPending(t, effectLoopHeadsTarget, specCorpusKey(t))
	})
}
