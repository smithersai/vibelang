package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestCatchHandlerASIQuoted(t *testing.T) {
	r3Quoted(t, "002-running.md", "A block-bodied arrow closes at its `}`;")
	r3Quoted(t, "900-appendices.md", "A complete source parse includes TypeScript’s automatic semicolon insertion.")
	r3Quoted(t, "900-appendices.md", "Any other handler is a closed expression, after which only another `catch` or a lower-precedence operator can follow.")
}

// The static oracle combines Appendix A's inherited TypeScript ASI with the
// closed-handler rule. Statement counts detect a swallowed next statement even
// if a recovery path stops reporting its diagnostic.
func FuzzCatchHandlerASI(f *testing.F) {
	startShortBudget(f)
	handlers := []struct {
		key, source         string
		blockArrow, concise bool
	}{
		{"plain", "(e) => { return e }", true, false},
		{"simple", "e => { return e }", true, false},
		{"generic", "<T,>(e: T) => { return e }", true, false},
		{"effect", "effect (e) => { return e }", true, false},
		{"effect-simple", "effect e => { return e }", true, false},
		{"effect-generic", "effect <T,>(e: T) => { return e }", true, false},
		{"wrapped-plain", "((e) => { return e })", false, false},
		{"wrapped-effect", "(effect (e) => { return e })", false, false},
		{"function", "function (e) { return e }", false, false},
		{"effect-function", "effect function (e) { return e }", false, false},
		{"concise", "(e) => e", false, true},
		{"effect-concise", "effect (e) => e", false, true},
	}
	suffixes := []struct {
		key, source    string
		statementStart bool
	}{
		{"call", "(n = 2)", true},
		{"array", "[1].length", true},
		{"template", "\x60x\x24{n}\x60.length", true},
		{"plus", "+n", true},
		{"minus", "-n", true},
		{"logical", "&& n", false},
		{"multiply", "* n", false},
		{"member", ".length", false},
		{"optional-call", "?.(n)", false},
	}
	separators := []string{" ", " /* same line */ ", "\n", "\r\n", " /*\n*/ ", " // boundary\n", "\u2028", "\u2029"}
	for _, handler := range handlers {
		for _, suffix := range suffixes {
			for separator := range separators {
				for context := byte(0); context < 3; context++ {
					f.Add(append([]byte(handler.key+"/"+suffix.key+":"), byte(separator), context))
				}
			}
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		TestCatchHandlerASIQuoted(t)
		handler, suffix := handlers[0], suffixes[0]
		tail := data
		selected := false
		for _, candidate := range handlers {
			for _, ending := range suffixes {
				if rest, ok := strings.CutPrefix(string(data), candidate.key+"/"+ending.key+":"); ok {
					handler, suffix, tail, selected = candidate, ending, []byte(rest), true
					break
				}
			}
			if selected {
				break
			}
		}
		pick := func(n int) int {
			if len(tail) == 0 {
				return 0
			}
			value := int(tail[0]) % n
			tail = tail[1:]
			return value
		}
		if !selected {
			handler = handlers[pick(len(handlers))]
			suffix = suffixes[pick(len(suffixes))]
		}
		separator := pick(len(separators))
		prefix := []string{"const value = a", "return a", "const value = a |> %"}[pick(3)]
		source := "effect function f(a, n) {\n" + prefix + " catch " + handler.source + separators[separator] + suffix.source + "\nreturn 0\n}"
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "main.vibe", PathKey: "main.vibe"}, source)
		key := handler.key + "/" + suffix.key
		diagnostics := file.Diagnostics()
		separate := handler.blockArrow && separator >= 2 && suffix.statementStart
		wantError := !separate && !handler.concise
		if wantError {
			if len(diagnostics) != 1 || diagnostics[0].Source() != "EK" || diagnostics[0].Code() != 512 {
				Gap(t, "FuzzCatchHandlerASI", key, "closed-handler continuation needs EK0512; got %v:\n%s", diagnostics, source)
			}
		} else if len(diagnostics) != 0 {
			Gap(t, "FuzzCatchHandlerASI", key, "ASI or a concise body admits this source; got %v:\n%s", diagnostics, source)
		}
		statements := file.Statements.Nodes[0].Body().AsBlock().Statements.Nodes
		wantStatements := 2
		if separate {
			wantStatements = 3
		}
		if len(statements) != wantStatements {
			Gap(t, "FuzzCatchHandlerASI", key, "ASI needs %d statements, got %d:\n%s", wantStatements, len(statements), source)
		}
	})
}
