package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"slices"
	"strings"
	"testing"
)

const patternBindingRenameQuote = "Binding it takes `let tracking`, shorthand for `tracking: let tracking` (VIP-16)."

func TestPatternBindingRenameQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), patternBindingRenameQuote) {
		t.Fatal("VIP-7 shorthand binding rule changed")
	}
}

// VIP-7's shorthand has an independent property key. VIP-34's rename must
// preserve it, just as TypeScript's {value: fresh} destructuring does. Vary
// lexical homes, declaration keywords, trivia, keys and explicit-key controls;
// use the existing reference/rename oracle rather than comparing emit strings.
func FuzzPatternBindingRename(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"variant", "object", "is", "nested", "explicit", "second", "census"} {
		f.Add(key, byte(0), byte(0), byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, keyword, name, trivia byte) {
		kinds := []string{"variant", "object", "is", "nested", "explicit", "second", "census"}
		if !strings.Contains("|"+strings.Join(kinds, "|")+"|", "|"+key+"|") || key == "" {
			key = kinds[int(keyword)%len(kinds)]
		}
		word := []string{"let", "const"}[int(keyword)%2]
		binding := []string{"value", "tracking", "item", "café"}[int(name)%4]
		space := []string{" ", " /* keep */ ", "\n"}[int(trivia)%3]
		field := word + space + binding
		prefix := ""
		pattern := "{" + field + "}"
		shape := "{" + binding + ":number}"
		switch key {
		case "variant", "census":
			prefix = "data D { V { " + binding + ":number } }\n"
			shape = "D"
			pattern = "D.V " + pattern
		case "nested":
			shape = "{inner:" + shape + "}"
			pattern = "{inner:" + pattern + "}"
		case "explicit":
			pattern = "{" + binding + ":" + field + "}"
		case "second":
			shape = "{a:string," + binding + ":number}"
			pattern = `{a:"[",` + field + "}"
		}
		source := fmt.Sprintf("%sfunction pick(x:%s){return match(x){when %s:%s;default:0;}}", prefix, shape, pattern, binding)
		if key == "census" {
			source = fmt.Sprintf("%sexport function main(x:%s){return match(x){when %s:%s;}}", prefix, shape, pattern, binding)
		}
		if key == "is" {
			source = fmt.Sprintf("function pick(x:%s){if(x is %s)return %s;return 0}", shape, pattern, binding)
		}
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, consistencyTarget, files)
		defer r.Remove()
		if HasError(r.Diagnostics) {
			t.Fatalf("generated binding must type-check: %v\n%s", Keys(r.Dir, r.Diagnostics), source)
		}
		c := &consistency{t: t, ctx: t.Context(), w: w, main: "main.vibe", archive: Archive(files)}
		c.before = c.project(r, files)
		for _, symbol := range c.symbols() {
			if symbol.name == binding && symbol.kind == "VariableDeclaration" && len(symbol.refs) > 0 {
				probe := consistencyProbe{consistencySymbol: symbol, consistencyRef: symbol.refs[0]}
				refs := c.checkReferences(probe)
				if refs == nil {
					t.Fatal("pattern binder has no references")
				}
				c.checkRename(probe, refs)
				return
			}
		}
		t.Fatal("pattern binder was not probed")
	})
}

// A pattern rename may replace the binding keyword as well as its name to
// expose the fixed property key. Accept exactly that expansion: the old name
// must be an existing reference, and all original keyword/trivia is retained.
// Diagnostic and new-reference checks still run on the complete edited program.
func consistencyPatternBindingEdit(source, file string, edit toolsEdit, fresh string, refs map[consistencySpan]bool) bool {
	tokens := toolsScan(source[edit.start:edit.end])
	tokens = slices.DeleteFunc(tokens, func(token toolsToken) bool {
		return token.kind == ast.KindSingleLineCommentTrivia || token.kind == ast.KindMultiLineCommentTrivia
	})
	if len(tokens) != 2 || tokens[0].start != 0 || (tokens[0].kind != ast.KindLetKeyword && tokens[0].kind != ast.KindConstKeyword) || tokens[1].end != edit.end-edit.start {
		return false
	}
	nameStart := edit.start + tokens[1].start
	old := source[nameStart:edit.end]
	return refs[consistencySpan{file, nameStart, edit.end}] && edit.text == old+": "+source[edit.start:nameStart]+fresh
}

func TestPatternBindingRenameEditOracle(t *testing.T) {
	source := "let /* retain */ value"
	refs := map[consistencySpan]bool{{"main.vibe", strings.Index(source, "value"), len(source)}: true}
	for _, tc := range []struct {
		text string
		want bool
	}{
		{"value: let /* retain */ fresh", true},
		{"other: let /* retain */ fresh", false},
		{"value: let fresh", false},
		{"value: let /* retain */ fresh; extra()", false},
	} {
		got := consistencyPatternBindingEdit(source, "main.vibe", toolsEdit{start: 0, end: len(source), text: tc.text}, "fresh", refs)
		if got != tc.want {
			t.Errorf("%q accepted=%v want %v", tc.text, got, tc.want)
		}
	}
	if consistencyPatternBindingEdit(source, "main.vibe", toolsEdit{start: 0, end: len(source), text: "value: let /* retain */ fresh"}, "fresh", nil) {
		t.Fatal("accepted edit without a reference")
	}
}
