package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const structuredThrowsQuote = "A callable whose thrown type is `T` is assignable to a function type only when that type admits `T`"

func TestStructuredThrowsQuoted(t *testing.T) {
	if !strings.Contains(SpecText(failuresChapter), structuredThrowsQuote) {
		t.Fatal("throws assignability rule changed")
	}
}
func failuresStructuredThrowsCases() []*failCase {
	var out []*failCase
	for _, row := range []struct {
		key, source, target string
		admitted            bool
	}{
		{"primitive", "string", "{readonly code:string}", false},
		{"wrong-property", "{readonly code:number}", "{readonly code:string}", false},
		{"literal-property", `{readonly code:"E"}`, "{readonly code:string}", true},
		{"nested-wrong", "{readonly nested:{readonly code:number}}", "{readonly nested:{readonly code:string}}", false},
		{"nested-right", `{readonly nested:{readonly code:"E"}}`, "{readonly nested:{readonly code:string}}", true},
		{"index-wrong", "{readonly count:string}", "{readonly [key:string]:number}", false},
		{"index-right", "{readonly count:number}", "{readonly [key:string]:number}", true},
		{"function-wrong", "(x:number)=>string", "(x:string)=>number", false},
		{"function-right", "(x:string)=>number", "(x:string)=>number", true},
		{"tuple-wrong", "[number,string]", "[string,number]", false},
		{"tuple-right", "[string,number]", "[string,number]", true},
		{"optional-missing", "{}", "{readonly code?:string}", true},
	} {
		for _, spelling := range []string{"inline", "named"} {
			for _, site := range []string{"assignment", "argument"} {
				src, dst := row.source, row.target
				if spelling == "named" {
					src, dst = "Given", "Wanted"
				}
				lib := fmt.Sprintf(`export type Given=%s
export type Wanted=%s
/** @throws {%s} */
export declare function risky():number
export type Target={
/** @throws {%s} */
():number
}
/** @throws {never} */
export declare function accept(callback:Target):number
`, row.source, row.target, src, dst)
				code, expr := 0, "risky"
				if !row.admitted {
					code, expr = 402, "⟦risky⟧"
				}
				body := "const selected:Target=" + expr
				if site == "argument" {
					body = "accept(" + expr + ")"
				}
				out = append(out, &failCase{Name: "structured-throws-" + row.key + "-" + spelling + "-" + site, Quote: structuredThrowsQuote, VIP: 4, Host: "plain", Lib: lib, Body: body, Code: code, OneDiagnostic: code != 0})
			}
		}
	}
	return out
}
