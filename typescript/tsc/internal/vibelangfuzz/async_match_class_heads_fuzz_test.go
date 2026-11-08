package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const asyncClassTarget = "FuzzAsyncMatchClassHeads"
const asyncClassQuote = "The rule covers the subject, patterns, guards and arm expressions, including a `do` expression in them."
const asyncClassBoundaryQuote = "Ownership and targets come from the source, not from the generated async function;"

func TestAsyncMatchClassHeadsQuoted(t *testing.T) {
	chapterSays(t, "004-match.md", asyncClassQuote)
	chapterSays(t, "004-match.md", asyncClassBoundaryQuote)
}

func FuzzAsyncMatchClassHeads(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "004-match.md", asyncClassQuote)
	chapterSays(f, "004-match.md", asyncClassBoundaryQuote)
	keys := []string{"method", "field", "getter", "setter", "member-decorator", "class-decorator", "heritage"}
	heads := []string{
		"class C { [do { %; \"m\" }](){} }",
		"class C { [do { %; \"m\" }]=1 }",
		"class C { get [do { %; \"m\" }](){return 1} }",
		"class C { set [do { %; \"m\" }](n:number){} }",
		"class C { @(do { %; ((v:unknown,c:unknown)=>{}) }) m(){} }",
		"@(do { %; ((v:unknown,c:unknown)=>{}) }) class C {}",
		"class C extends do { %; (class {}) } {}",
	}
	for _, key := range keys {
		for mode := uint8(0); mode < 3; mode++ {
			f.Add(key, mode, mode, false)
		}
	}
	f.Fuzz(func(t *testing.T, key string, jump, home uint8, local bool) {
		TestAsyncMatchClassHeadsQuoted(t)
		if key == "" || len(key) > 128 {
			return
		}
		selected := int(key[0]) % len(keys)
		for i, k := range keys {
			if key == k {
				selected = i
			}
		}
		statement := []string{"return 9", "break outer", "continue outer"}[jump%3]
		if local {
			statement = []string{"(()=>{return 9})()", "local:{break local}", "for(let i=0;i<1;i++){continue}"}[jump%3]
		}
		head := strings.Replace(heads[selected], "%", statement, 1)
		expression := "do {" + head + ";1}"
		match := []string{
			"async match(" + expression + "){default:1;}",
			"async match(1){default:" + expression + ";}",
			"async match(1){when let n and if (" + expression + "):1;default:0;}",
		}[home%3]
		source := "function f(){outer:while(true){return " + match + "}}"
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "main.vibe", PathKey: "main.vibe"}, source, core.ScriptKindTS)
		got := file.Diagnostics()
		pass := len(got) == 1 && got[0].Source() == "EK" && got[0].Code() == 706
		if local {
			pass = len(got) == 0
		}
		if !pass {
			Gap(t, asyncClassTarget, fmt.Sprintf("%s/%d/%d/%t", keys[selected], jump%3, home%3, local), asyncClassQuote+" got %v\\n%s", got, source)
		}
	})
}
