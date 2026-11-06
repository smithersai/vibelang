package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// TestSourceMapMatchRange holds every Chapter 4 example and mutations of
// parser-created blocks to the existing D34 bounds oracle. A generated brace
// has no source token when scanning the statement-list end reaches outside
// its block. Borrowing that next token's comment duplicated it and recorded
// a mapping at pending indentation beyond the next emitted line. Moving
// the list end inside the last token is also unsafe: a regex closing slash
// followed by /* is then read as //, skipping to EOF.
// Statement-correspondence gaps are owned separately by c9; these assertions
// cover bounds and preservation of the reproduced comments.
func TestSourceMapMatchRange(t *testing.T) {
	w := NewWorkspace(t)
	tests := []struct{ name, source string }{
		{"return-match-trailing-comment", "function f(n: 0 | 1) {\n  return match (n) { when 0: \"a\"; when 1: \"b\"; }\n} // c\n"},
		{"return-match-last-arm-comment", "function f(n: 0 | 1) {\n  return match (n) { when 0: \"a\"; when 1: \"b\" } // c\n}\n"},
		{"match-statement-trailing-comment", "function f(n: 0 | 1) {\n  match (n) { when 0: console.log(\"a\"); default: console.log(\"b\"); }\n} // c\n"},
		{"top-level-match-end", "const answer = match (1) { when 1: 2; default: 0; }\n"},
		{"top-level-match-end-no-newline", "export const answer = match (1) { when 1: 2; default: 0; }"},
		{"regex-adjacent-block-comment", "export function f(n: 0) { return match (n) { when 0: /x//* tail */; } }\n"},
		{"regex-adjacent-line-comment", "export function f(n: 0) {\n  return match (n) { when 0: /x/; // tail\n  } // match tail\n} // function tail\n"},
		{"regex-flags-comment-control", "export function f(n: 0) { return match (n) { when 0: /x/g/* tail */; } }\n"},
		{"regex-space-comment-control", "export function f(n: 0) { return match (n) { when 0: /x/ /* tail */; } }\n"},
		{"provide-at-end", "// fragment\nprovide makeLayer() { makeProgram() }"},
		{"provide-trailing-comment", "// fragment\nfunction f() {\n  provide makeLayer() { makeProgram() }\n} // c\n"},
	}
	for _, seed := range sourceMapBlockSeeds() {
		tests = append(tests, struct{ name, source string }{seed.Name, seed.Files["main.vibe"]})
	}
	chapterCases := 0
	for _, seed := range SnippetSeeds() {
		if strings.HasPrefix(seed.Name, "docs/design/src/004-match.md#") {
			chapterCases++
			tests = append(tests, struct{ name, source string }{seed.Name, seed.Files["main.vibe"]})
		}
	}
	if chapterCases < 15 {
		t.Fatalf("%d Chapter 4 examples; expected at least 15 vibe blocks", chapterCases)
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c, err := w.CompileOrdered(t.Context(), Single(tc.source), OrderTsc, true)
			if err != nil {
				t.Fatal(err)
			}
			defer c.Remove()
			if c.Program == nil {
				t.Fatal("compiler created no program")
			}
			g := &Gaps{Target: "TestSourceMapMatchRange", Input: tc.name}
			oc := &OutputChecker{W: w, G: g, Ctx: t.Context(), Logf: t.Logf}
			maps := 0
			for name, text := range c.Outputs {
				if strings.HasSuffix(name, ".map") {
					maps++
					oc.checkSourceMap(c, name, text)
				}
			}
			if strings.HasPrefix(tc.name, "regex-") {
				for _, comment := range []string{"/* tail */", "// tail", "// match tail", "// function tail"} {
					want := strings.Count(tc.source, comment)
					if want == 0 {
						continue
					}
					got := 0
					for name, text := range c.Outputs {
						if strings.HasSuffix(name, ".js") {
							got += strings.Count(text, comment)
						}
					}
					if got > want {
						t.Errorf("comment %q appears %d times in JavaScript, at most %d", comment, got, want)
					}
				}
			}
			if maps == 0 {
				t.Fatalf("no source map among outputs %v", mapKeys(c.Outputs))
			}
			for _, f := range g.found {
				if strings.HasPrefix(f.key, "feature:source-map-range") {
					t.Errorf("%s: %s", f.key, f.text)
				}
			}
		})
	}
}

// sourceMapBlockSeeds mutates the neighbourhood of the D34 regressions:
// block-producing forms, nesting, trailing comments, line endings and EOF.
// FuzzCompile mutates these archives further and applies its existing D34
// oracle; the table above checks every layout even when a fragment has
// unrelated diagnostics. Names preserve the form and layout as corpus keys.
func sourceMapBlockSeeds() []Seed {
	forms := []struct{ key, modifier, body string }{
		{"return-match-regex-comment", "", "return match (0) { when 0: /x//* arm comment */; }"},
		{"return-match-unicode", "", "const café = n; return match (n) { when 0: café; default: café; }"},
		{"return-match", "", "return match (n) { when 0: 1; default: 2; }"},
		{"statement-match", "", "match (n) { when 0: 1; default: 2; }"},
		{"expression-match", "", "const value = match (n) { when 0: 1; default: 2; }; return value"},
		{"if-binding", "", "if (n is let value) return value; else return n;"},
		{"while-binding", "", "while (n is let value) { return value }"},
		{"provide", "effect ", "provide Layer.empty { return n }"},
		{"concurrent", "effect ", "for concurrent (const value of [n]) { try succeed(value) }"},
	}
	var seeds []Seed
	for _, form := range forms {
		for layout := range 8 {
			body := form.body
			if layout&1 != 0 {
				body = "{\n" + body + "\n}"
			}
			comment := " // comment 😀"
			if layout&2 != 0 {
				comment = " /* comment 😀 */"
			}
			source := form.modifier + "function f(n: 0 | 1) {\n  " + body + "\n}" + comment
			if layout&4 != 0 {
				source = strings.ReplaceAll(source+"\n", "\n", "\r\n")
			}
			seeds = append(seeds, Seed{
				Name:  fmt.Sprintf("source-map-block:%s:layout-%d", form.key, layout),
				Files: map[string]string{"main.vibe": source},
			})
		}
	}
	return seeds
}
