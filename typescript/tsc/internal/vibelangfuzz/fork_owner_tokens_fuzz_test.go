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

const forkOwnerTokensTarget = "FuzzForkOwnerTokens"

func TestForkOwnerTokensQuoted(t *testing.T) {
	if !strings.Contains(SpecText("900-appendices.md"), reviewExecutionSpacingQuote) {
		t.Fatalf("Appendix A no longer says %q", reviewExecutionSpacingQuote)
	}
}

// Any gap between fork, the dot and the owner reads as the written owner: a
// valid owner has that owner's projection, and another name is one EK1705 with
// no TypeScript parse error.
func FuzzForkOwnerTokens(f *testing.F) {
	startShortBudget(f)
	owners := []string{"in", "scoped", "detached", "other", "map"}
	for _, owner := range owners {
		for gap := range forkOwnerTokenGaps {
			f.Add(owner + ":" + strconv.Itoa(gap) + ":" + strconv.Itoa(len(forkOwnerTokenGaps)-1-gap))
		}
	}
	f.Fuzz(func(t *testing.T, key string) {
		parts := strings.Split(key, ":")
		if len(parts) != 3 || !slices.Contains(owners, parts[0]) {
			t.Skip()
		}
		before, err1 := strconv.Atoi(parts[1])
		after, err2 := strconv.Atoi(parts[2])
		if err1 != nil || err2 != nil || before < 0 || after < 0 || before >= len(forkOwnerTokenGaps) || after >= len(forkOwnerTokenGaps) {
			t.Skip()
		}
		owner := parts[0]
		suffix := ""
		if owner == "in" {
			suffix = "(s)"
		}
		template := func(form string) string {
			return "export effect function f(s, e) { return " + form + suffix + " e }\n"
		}
		source := template("fork" + forkOwnerTokenGaps[before] + "." + forkOwnerTokenGaps[after] + owner)
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		valid := owner != "other" && owner != "map"
		var named, other int
		for _, d := range file.Diagnostics() {
			if d.Code() == 1705 {
				named++
			} else {
				other++
			}
		}
		if other != 0 || valid && named != 0 || !valid && named != 1 {
			Gap(t, forkOwnerTokensTarget, "parse:"+owner, "%s; got %d EK1705 and %d other parse errors\n%q", reviewExecutionSpacingQuote, named, other, source)
		}
		if valid {
			context := vibelangmapper.FileContext{}
			got, want := vibelangmapper.Project(source, context), vibelangmapper.Project(template("fork."+owner), context)
			if len(got.Diagnostics) != 0 || got.Text != want.Text {
				Gap(t, forkOwnerTokensTarget, "projection:"+owner, "%s; %v\n%q\n%q", reviewExecutionSpacingQuote, got.Diagnostics, got.Text, want.Text)
			}
		}
		ExpectPending(t, forkOwnerTokensTarget, "parse:"+owner)
		ExpectPending(t, forkOwnerTokensTarget, "projection:"+owner)
	})
}

// forkOwnerTokenGaps are the trivia Appendix A allows between the tokens of
// a named fork owner.
var forkOwnerTokenGaps = []string{"", " ", "\t", "\n", "\r\n", "\u2028", "/* c */", "/*\n*/", "// c\n", " \n /* c */ \n "}
