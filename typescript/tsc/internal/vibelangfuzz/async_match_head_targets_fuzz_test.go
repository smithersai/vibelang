package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"strings"
	"testing"
)

const asyncHeadTarget = "FuzzAsyncMatchHeadTargets"
const asyncHeadTargetQuote = "Ownership and targets come from the source, not from the generated async function;"
const asyncHeadMissingQuote = "a `break` or `continue` with no target anywhere keeps TypeScript's own error."

func TestAsyncMatchHeadTargetsQuoted(t *testing.T) {
	chapterSays(t, "004-match.md", asyncHeadTargetQuote)
	chapterSays(t, "004-match.md", asyncHeadMissingQuote)
}

func FuzzAsyncMatchHeadTargets(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "004-match.md", asyncHeadTargetQuote)
	chapterSays(f, "004-match.md", asyncHeadMissingQuote)
	keys := []string{"method", "static-method", "getter", "setter", "decorator", "object-method", "object-getter", "object-setter"}
	heads := []string{
		"class C { [do{const pending=%;\"m\"}](){} }",
		"class C { static [do{const pending=%;\"m\"}](){} }",
		"class C { get [do{const pending=%;\"m\"}](){return 1} }",
		"class C { set [do{const pending=%;\"m\"}](n:number){} }",
		"class C { @(do{const pending=%;((v:unknown,c:unknown)=>{})}) m(){} }",
		"const object={ [do{const pending=%;\"m\"}](){} }",
		"const object={ get [do{const pending=%;\"m\"}](){return 1} }",
		"const object={ set [do{const pending=%;\"m\"}](n:number){} }",
	}
	for _, key := range keys {
		for control := uint8(0); control < 4; control++ {
			f.Add(key, control, control, control)
		}
	}
	f.Fuzz(func(t *testing.T, key string, jump, home, control uint8) {
		TestAsyncMatchHeadTargetsQuoted(t)
		if key == "" || len(key) > 128 {
			return
		}
		selected := int(key[0]) % len(keys)
		for i, k := range keys {
			if key == k {
				selected = i
			}
		}
		statement := []string{"break outer", "continue outer"}[jump%2]
		if control%4 == 1 {
			statement = []string{"local:while(true){break local}", "for(let i=0;i<1;i++){continue}"}[jump%2]
		}
		match := []string{
			"async match(do{" + statement + ";1}){default:1;}",
			"async match(1){default:do{" + statement + ";1};}",
			"async match(1){when let n and if(do{" + statement + ";true}):1;default:0;}",
		}[home%3]
		if control%4 == 2 {
			match = "(()=>" + match + ")()"
		}
		head := strings.Replace(heads[selected], "%", match, 1)
		source := "function f(){outer:while(true){" + head + "}}"
		if control%4 == 3 {
			source = "function f(){" + head + "}"
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "main.vibe", PathKey: "main.vibe"}, source, core.ScriptKindTS)
		got := file.Diagnostics()
		pass := true
		if control%4 == 0 {
			pass = len(got) == 1 && got[0].Source() == "EK" && got[0].Code() == 706
		} else {
			for _, d := range got {
				if d.Source() == "EK" && d.Code() == 706 {
					pass = false
				}
			}
			if control%4 == 1 {
				pass = pass && len(got) == 0
			}
		}
		if !pass {
			Gap(t, asyncHeadTarget, fmt.Sprintf("%s/%d/%d/%d", keys[selected], jump%2, home%3, control%4), asyncHeadTargetQuote+" got %v\\n%s", got, source)
		}
	})
}
