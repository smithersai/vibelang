package vibelangfmt

import (
	"fmt"
	"strings"
	"testing"
)

func TestFormatJSDocOnEmptyStatements(t *testing.T) {
	t.Parallel()
	for _, tag := range []string{"@internal", "@throws {Error}", "documentation"} {
		for _, block := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/block=%v", tag, block), func(t *testing.T) {
				source := "/** " + tag + " */ ;\nfunction visible(): number { return 1 }\n"
				if block {
					source = "export function outer(): number {\n" + source + "return visible()\n}\n"
				} else {
					source = strings.Replace(source, "function visible", "export function visible", 1)
				}
				got, err := Format("main.vibe", source, func(text string) (string, error) {
					// dprint removes a standalone empty statement, while a
					// labelled statement needs its explicit semicolon body.
					return strings.ReplaceAll(text, "*/ ;\n", "*/\n"), nil
				})
				if err != nil {
					t.Fatalf("%s block=%v: %v", tag, block, err)
				}
				if !strings.Contains(got, "*/ ;") {
					t.Fatalf("JSDoc moved from its empty statement: %s", got)
				}
				if strings.Contains(got, "$v") {
					t.Fatalf("label marker survived decoding: %s", got)
				}
			})
		}
	}
}

func TestSameProgramKeepsJSDocEmptyStatements(t *testing.T) {
	t.Parallel()
	before := "/** @internal */ ;\nexport function visible(): number { return 1 }"
	after := "/** @internal */\nexport function visible(): number { return 1 }"
	if err := SameProgram(before, after); err == nil {
		t.Fatal("losing the empty statement changes JSDoc comment attachment")
	}
	if err := SameProgram(";\nexport function visible(): number { return 1 }", "export function visible(): number { return 1 }"); err != nil {
		t.Fatalf("ordinary empty statements remain insignificant: %v", err)
	}
}
