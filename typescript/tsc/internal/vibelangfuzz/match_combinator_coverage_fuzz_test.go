package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const generatedErrorExtractorQuote = "It returns `[subject]` on a match and `false` otherwise"
const guardedCoverageQuote = "Only an unguarded arm covers anything."

const combinatorCoverageQuote = "An irrefutable capture on either side of `and` preserves the other pattern's coverage, including nested conjunctions and captures within a property or extractor argument."

func TestMatchCombinatorCoverageQuoted(t *testing.T) {
	for _, quote := range []string{generatedErrorExtractorQuote, guardedCoverageQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			t.Fatalf("extractor coverage quote changed: %s", quote)
		}
	}
	if !strings.Contains(SpecText("004-match.md"), combinatorCoverageQuote) {
		t.Fatal("VIP-7 coverage quote changed")
	}
}

var combinatorCoverageKeys = []string{"and", "not", "binding-right", "binding-left", "nested-or", "or-alternative", "default", "independent-cover", "plain-or", "open", "field-bindings", "extractor-bindings"}

// The key chooses a rule, the bytes vary finite domains, binding placement,
// parentheses, trivia and source contexts. Irrefutable captures preserve
// coverage; refutable combinators still need independent coverage or a default.
func FuzzMatchCombinatorCoverage(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("004-match.md"), combinatorCoverageQuote) {
		f.Fatal("VIP-7 coverage quote changed")
	}
	for _, key := range combinatorCoverageKeys {
		for domain := uint8(0); domain < 4; domain++ {
			f.Add(key, domain, domain)
		}
	}
	for shape := uint8(0); shape < 80; shape++ {
		if shape < 16 || shape >= 64 || shape == 16 || shape == 32 {
			f.Add("extractor-bindings", uint8(0), shape)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, domain, shape uint8) {
		if !strings.Contains("|"+strings.Join(combinatorCoverageKeys, "|")+"|", "|"+key+"|") {
			key = combinatorCoverageKeys[int(shape)%len(combinatorCoverageKeys)]
		}
		typ, yes, no := "boolean", "true", "false"
		switch domain % 4 {
		case 1:
			typ, yes, no = "1 | 2", "1", "2"
		case 2:
			typ, yes, no = `"a" | "b"`, `"a"`, `"b"`
		case 3:
			typ, yes, no = `{_tag:"A"}|{_tag:"B"}`, `{_tag:"A"}`, `{_tag:"B"}`
		}
		prefix := ""
		pattern := yes + " and " + yes
		switch key {
		case "not":
			pattern = "not " + no
		case "binding-right":
			pattern = yes + " and let value"
		case "binding-left":
			pattern = "const value and " + yes
		case "nested-or":
			pattern = "(" + pattern + ") or (" + no + " and " + no + ")"
		case "or-alternative":
			pattern = "(" + pattern + ") or " + no
		case "plain-or":
			pattern = yes + " or " + no
		case "open":
			typ = "unknown"
		case "field-bindings":
			typ, no, pattern = `{_tag:"A";n:number}|{_tag:"B"}`, `{_tag:"B"}`, `{_tag:"A",n:(let a and let b)}`
		case "extractor-bindings":
			kind, body := "error", ""
			if shape&4 != 0 {
				kind = "schema error"
			}
			if shape&8 != 0 {
				body = "{ value: number }"
			}
			prefix = fmt.Sprintf(`import { Schema } from "effect"; %s A %s; %s B;`, kind, body, kind)
			captures := "let a and const b"
			for depth := uint8(0); depth < (shape>>4)%3; depth++ {
				captures = fmt.Sprintf("(let extra%d and (%s))", depth, captures)
			}
			if shape&64 != 0 {
				captures = "(" + captures + ") and if(flag)"
			}
			typ, no, pattern = "A|B", "B", "A("+captures+")"
		}
		arms := fmt.Sprintf("when (%s): 1;", pattern)
		// These alternatives already accept both values at runtime. Repeating
		// the no arm would test a property of never on tagged subjects, an
		// independent native error unrelated to the coverage rule.
		if key != "nested-or" && key != "or-alternative" && key != "plain-or" {
			arms += fmt.Sprintf(" when %s: 0;", no)
		}
		if key == "default" {
			arms += " default: 2;"
		}
		if key == "independent-cover" {
			arms += " when let remaining: 3;"
		}
		expr := "match(x){" + arms + "}"
		source := fmt.Sprintf("export function f(x:%s,flag:boolean){return %s}", typ, expr)
		switch shape % 4 {
		case 1:
			source = fmt.Sprintf("export const f=(x:%s,flag:boolean)=>%s", typ, expr)
		case 2:
			source = fmt.Sprintf("export effect function f(x:%s,flag:boolean){return %s}", typ, expr)
		case 3:
			source = fmt.Sprintf("export function f(x:%s,flag:boolean){const value=do{%s};return value}", typ, expr)
		}
		source = strings.Repeat("/* coverage */\n", int(shape)%3) + prefix + source
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if diagnosticKey(d) == "EK4701" {
				count++
			} else {
				t.Errorf("unexpected %s\n%s", specDiagnosticText(d), source)
			}
		}
		want := 1
		if key == "default" || key == "independent-cover" || key == "plain-or" || key == "open" || key == "binding-right" || key == "binding-left" || key == "field-bindings" || key == "extractor-bindings" {
			want = 0
		}
		if key == "extractor-bindings" && shape&64 != 0 {
			want = 1
		}
		if count != want {
			Gap(t, "FuzzMatchCombinatorCoverage", "coverage:"+key, "VIP-7 %s: want %d EK4701, got %d\n%s", combinatorCoverageQuote, want, count, source)
		}
	})
}

// Adding an irrefutable capture to any arm never changes exhaustiveness.
// Compare complete and incomplete matches, guards and genuinely refutable
// conjunctions across finite domains, either arm, either side and nesting.
func FuzzMatchCaptureCoverage(f *testing.F) {
	startShortBudget(f)
	for domain := uint8(0); domain < 4; domain++ {
		for shape := uint8(0); shape < 64; shape++ {
			f.Add(domain, shape)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, domain, shape uint8) {
		typ, yes, no := "boolean", "true", "false"
		switch domain % 4 {
		case 1:
			typ, yes, no = "1 | 2", "1", "2"
		case 2:
			typ, yes, no = `"a" | "b"`, `"a"`, `"b"`
		case 3:
			typ, yes, no = `{_tag:"A"}|{_tag:"B"}`, `{_tag:"A"}`, `{_tag:"B"}`
		}
		patterns := []string{yes, no}
		selected := int(shape>>1) % 2
		if shape&4 != 0 {
			patterns = []string{patterns[selected]}
			selected = 0
		}
		if shape&8 != 0 {
			patterns[selected] = "(" + patterns[selected] + " and " + patterns[selected] + ")"
		}
		count := func(capture bool) int {
			arms := ""
			for i, pattern := range patterns {
				if capture && i == selected {
					for depth := uint8(0); depth <= shape>>5; depth++ {
						binding := fmt.Sprintf("let captured%d", depth)
						if shape&1 == 0 {
							pattern = "(" + pattern + ") and " + binding
						} else {
							pattern = "const captured" + fmt.Sprint(depth) + " and (" + pattern + ")"
						}
					}
				}
				if shape&16 != 0 && i == selected {
					pattern += " and if (flag)"
				}
				arms += fmt.Sprintf("when %s: %d;", pattern, i)
			}
			source := fmt.Sprintf("export function f(x:%s,flag:boolean){return match(x){%s}}", typ, arms)
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			gaps := 0
			for _, d := range result.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if diagnosticKey(d) == "EK4701" {
					gaps++
				} else {
					t.Fatalf("unexpected %s\n%s", specDiagnosticText(d), source)
				}
			}
			return gaps
		}
		before, after := count(false), count(true)
		want := 0
		if shape&28 != 0 {
			want = 1
		}
		if before != want || after != before {
			t.Fatalf("domain=%d shape=%d: control=%d captured=%d, want %d", domain, shape, before, after, want)
		}
	})
}
