package vibelangfuzz

import (
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const tryOperationTokensTarget = "FuzzTryOperationTokens"

var tryOperationTokenGaps = []string{"", " ", "\t", "\n", "\r\n", " ", "/* c */", "/*\n*/", "// c\n", " \n /* c */ \n "}

func TestTryOperationTokensQuoted(t *testing.T) {
	if !strings.Contains(SpecText("900-appendices.md"), reviewExecutionSpacingQuote) {
		t.Fatalf("Appendix A no longer says %q", reviewExecutionSpacingQuote)
	}
}

// Any gap between try, the dot and the name reads as the written operation:
// a name of the four has that operation's projection, and another name is
// one EK1803 with no TypeScript parse error.
func FuzzTryOperationTokens(f *testing.F) {
	startShortBudget(f)
	names := []string{"all", "race", "any", "allSettled", "map", "other"}
	for _, name := range names {
		for gap := range tryOperationTokenGaps {
			f.Add(name + ":" + strconv.Itoa(gap) + ":" + strconv.Itoa(len(tryOperationTokenGaps)-1-gap))
		}
	}
	f.Fuzz(func(t *testing.T, key string) {
		parts := strings.Split(key, ":")
		if len(parts) != 3 || !slices.Contains(names, parts[0]) {
			t.Skip()
		}
		before, err1 := strconv.Atoi(parts[1])
		after, err2 := strconv.Atoi(parts[2])
		if err1 != nil || err2 != nil || before < 0 || after < 0 || before >= len(tryOperationTokenGaps) || after >= len(tryOperationTokenGaps) {
			t.Skip()
		}
		name := parts[0]
		template := func(operation string) string {
			return "export effect function f(xs: Array<number!!>) { return " + operation + " xs }\n"
		}
		source := template("try" + tryOperationTokenGaps[before] + "." + tryOperationTokenGaps[after] + name)
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		valid := name != "map" && name != "other"
		var named, other int
		for _, d := range file.Diagnostics() {
			if d.Code() == 1803 {
				named++
			} else {
				other++
			}
		}
		if other != 0 || valid && named != 0 || !valid && named != 1 {
			Gap(t, tryOperationTokensTarget, "parse:"+name, "%s; got %d EK1803 and %d other parse errors\n%q", reviewExecutionSpacingQuote, named, other, source)
		}
		if valid {
			context := vibelangmapper.FileContext{}
			got, want := vibelangmapper.Project(source, context), vibelangmapper.Project(template("try."+name), context)
			if len(got.Diagnostics) != 0 || got.Text != want.Text {
				Gap(t, tryOperationTokensTarget, "projection:"+name, "%s; %v\n%q\n%q", reviewExecutionSpacingQuote, got.Diagnostics, got.Text, want.Text)
			}
		}
		ExpectPending(t, tryOperationTokensTarget, "parse:"+name)
		ExpectPending(t, tryOperationTokensTarget, "projection:"+name)
	})
}
