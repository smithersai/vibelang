package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const aliasedThrowsQuote = "A callable whose thrown type is `T` is assignable to a function type only when that type admits `T`"

func TestAliasedThrowsQuoted(t *testing.T) {
	if !strings.Contains(SpecText(failuresChapter), aliasedThrowsQuote) {
		t.Fatal("throws assignability rule changed")
	}
}
func failuresAliasedThrowsCases() []*failCase {
	var out []*failCase
	for _, src := range []string{"any", "Loose", "unknown", "Opaque", "never", "Nil", "string", "Text"} {
		for _, dst := range []string{"any", "Loose", "unknown", "Opaque", "never", "Nil", "string", "Text"} {
			for _, site := range []string{"assignment", "argument", "implements"} {
				canonical := func(s string) string {
					switch s {
					case "Nil":
						return "never"
					case "Opaque":
						return "unknown"
					case "Loose":
						return "any"
					case "Text":
						return "string"
					}
					return s
				}
				from, to := canonical(src), canonical(dst)
				admitted := to == "any" || to == "unknown" || from == "never" || from == "any" && to != "never" || from == "string" && to == "string"
				code, expr := 0, "risky"
				if !admitted {
					code = 402
					expr = "⟦risky⟧"
				}
				lib := fmt.Sprintf(`export type Nil=never;export type Opaque=unknown;export type Loose=any;export type Text=string;
/** @throws {%s} */
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
				name := fmt.Sprintf("aliased-throws-%s-%s-%s", src, strings.ReplaceAll(dst, "<unknown>", ""), site)
				out = append(out, &failCase{Name: name, Quote: aliasedThrowsQuote, VIP: 4, Host: "plain", Lib: lib, Body: body, Code: code, OneDiagnostic: code != 0})
			}
		}
	}
	return out
}
