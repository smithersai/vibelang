package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const concurrentBodyProjectionTarget = "FuzzConcurrentBodyProjection"
const concurrentBodyProjectionQuote = "The head is a `const` or `let` declaration, destructuring included: ECMAScript's `ForDeclaration`, `LetOrConst ForBinding` (VIP-19, amended)."

func TestConcurrentBodyProjectionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), concurrentBodyProjectionQuote) {
		t.Fatal("stale concurrent head admission quote")
	}
}

func FuzzConcurrentBodyProjection(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("002-running.md"), concurrentBodyProjectionQuote) {
		f.Fatal("stale concurrent head admission quote")
	}
	keys := []string{"simple", "object", "array", "default", "nested", "is-binding"}
	for _, key := range keys {
		for _, kind := range []string{"const", "let"} {
			for _, form := range []string{"block", "statement"} {
				f.Add(key+":"+kind+":"+form, " ")
				f.Add(key+":"+kind+":"+form+":collision", " /* body */ ")
			}
		}
	}
	f.Fuzz(func(t *testing.T, key, gap string) {
		parts := strings.Split(key, ":")
		choice := parts[0]
		index := 0
		for i, k := range keys {
			if k == choice {
				index = i
			}
		}
		if choice == "" {
			choice = keys[0]
		} else {
			found := false
			for _, k := range keys {
				found = found || choice == k
			}
			if !found {
				index = int(choice[0]) % len(keys)
				choice = keys[index]
			}
		}
		kind := "const"
		if len(parts) > 1 && parts[1] == "let" {
			kind = "let"
		}
		block := len(parts) > 2 && parts[2] == "block"
		if gap != " " && gap != "\n" && gap != " /* body */ " {
			gap = " "
		}
		heads := []string{"item", "{ n }", "[n]", "{ n = 1 }", "{ pair: [n] }", "item"}
		rows := []string{"[1,2]", "[{n:1},{n:2}]", "[[1],[2]]", "[{}, {n:2}]", "[{pair:[1]},{pair:[2]}]", "[{n:1},{n:2}]"}
		bodies := []string{"total += item;", "total += n;", "total += n;", "total += n;", "total += n;", "if (item is {n:let value}) total += value;"}
		body := bodies[index]
		if block {
			body = "{ " + body + " }"
		}
		prefix := ""
		if len(parts) > 3 && parts[3] == "collision" {
			prefix = "const $concurrentItem=9; const $concurrentItem_1=8;"
		}
		source := fmt.Sprintf("export effect function sample() { %s let total=0; for concurrent(1) (%s %s of %s)%s%s return total }", prefix, kind, heads[index], rows[index], gap, body)
		ctx := vibelangmapper.FileContext{}
		for name, p := range map[string]vibelangmapper.Projection{"checking": vibelangmapper.Project(source, ctx), "executable": vibelangmapper.Executable(source, ctx)} {
			for _, d := range p.Diagnostics {
				Gap(t, concurrentBodyProjectionTarget, choice+":"+kind, "%s rejects admitted head/body: %s\n%s", name, d.Message, p.Text)
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/virtual.ts")}, p.Text, core.ScriptKindTS)
			if len(file.Diagnostics()) != 0 {
				Gap(t, concurrentBodyProjectionTarget, choice+":"+kind, "%s emits invalid TypeScript: %v\n%s", name, file.Diagnostics(), p.Text)
			}
		}
	})
}
