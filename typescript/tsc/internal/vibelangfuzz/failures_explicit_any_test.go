package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const explicitAnyThrowsQuote = "A callable whose thrown type is `T` is assignable to a function type only when that type admits `T`"

func TestExplicitAnyThrowsQuoted(t *testing.T) {
	if !strings.Contains(SpecText(failuresChapter), explicitAnyThrowsQuote) {
		t.Fatal("throws assignability rule changed")
	}
}
func failuresExplicitAnyCases() []*failCase {
	var out []*failCase
	for _, src := range []string{"any", "unknown", "never", "string"} {
		for _, dst := range []string{"any", "unknown", "never", "string", "number", "Error", "ReadonlyArray<unknown>"} {
			for _, site := range []string{"assignment", "argument", "implements"} {
				admitted := dst == "any" || dst == "unknown" || src == "never" || src == "any" && dst != "never" || src == "string" && dst == "string"
				code, expr := 0, "risky"
				if !admitted {
					code = 402
					expr = "⟦risky⟧"
				}
				lib := fmt.Sprintf(`/** @throws {%s} */
export declare function risky():number
export type Target={
/** @throws {%s} */
():number
}
/** @throws {never} */
export declare function accept(callback:Target):number
export interface Requirement { run:Target }
`, src, dst)
				body := "const value:Target=" + expr
				if site == "argument" {
					body = "accept(" + expr + ")"
				}
				if site == "implements" {
					body = "class Holder implements Requirement { run=risky }"
					if code != 0 {
						body = "class Holder implements Requirement { ⟦run⟧=risky }"
					}
				}
				name := fmt.Sprintf("explicit-any-%s-%s-%s", src, strings.ReplaceAll(dst, "<unknown>", ""), site)
				out = append(out, &failCase{Name: name, Quote: explicitAnyThrowsQuote, VIP: 4, Host: "plain", Lib: lib, Body: body, Code: code, OneDiagnostic: code != 0})
			}
		}
	}
	return out
}
