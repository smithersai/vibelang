package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const returnedSignatureQuote = "Tags attach to call signatures: each overload and a returned callable's own signature carry their own."

func TestReturnedSignatureThrowsQuoted(t *testing.T) {
	if !strings.Contains(SpecText(failuresChapter), returnedSignatureQuote) {
		t.Fatal("returned callable signature rule changed")
	}
}

func failuresReturnedSignatureCases() []*failCase {
	var out []*failCase
	for _, outer := range []string{"never", "Error", "unknown"} {
		for _, inner := range []string{"never", "string", "unknown"} {
			for _, target := range []string{"never", "string", "unknown"} {
				for _, site := range []string{"assignment", "argument", "implements"} {
					admitted := inner == "never" || target == "unknown" || inner == "string" && target == "string"
					value := "saved"
					code := 0
					if !admitted {
						value = "⟦saved⟧"
						code = 402
					}
					body := "const selected:Target=" + value + ";return 0"
					if site == "argument" {
						body = "return accept(" + value + ")"
					}
					if site == "implements" {
						member := "run"
						if !admitted {
							member = "⟦run⟧"
						}
						body = "class Holder implements Shape {" + member + "=saved};return 0"
					}
					lib := fmt.Sprintf(`export interface Shape {run:Target}
export type Target={
/** @throws {%s} */
():number
}
/** @throws {never} */
export declare function accept(fn:Target):number
/** @throws {%s} */
export declare function create(): (
/** @throws {%s} */
()=>number
)
`, target, outer, inner)
					out = append(out, &failCase{Name: "returned-signature-" + outer + "-" + inner + "-" + target + "-" + site, Quote: returnedSignatureQuote, VIP: 4, Host: "plain", Lib: lib, Body: "try{const saved=create();" + body + "}catch{return 0}", Code: code})
				}
			}
		}
	}
	return out
}
