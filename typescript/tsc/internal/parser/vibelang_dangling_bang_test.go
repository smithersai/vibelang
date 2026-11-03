package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Functions, "The A!E!R type shorthand" (VIP-3): each !, and the slot after
// it, start on the line where the previous slot ends. A ! with no slot on its
// line and no second ! is TypeScript's postfix !, which is TS17019.
func TestVibeLangDanglingBang(t *testing.T) {
	for _, test := range []struct {
		name, text string
		want       int // TS17019 diagnostics
	}{
		{"newline-slot", "declare const loaded: User!NotFound\nconst b: User!\n  NotFound = loaded\n", 1},
		{"equals", "declare const loaded: User!!\nconst e: User! = loaded\n", 1},
		{"return-type", "effect function f(): number!\n{ return 1 }\n", 1},
		{"alias", "type T = string!\n", 1},
		{"double-bang-newline", "declare const loaded: User!!\nconst ok: User!!\n  = loaded\n", 0},
		{"double-bang-equals", "declare const loaded: User!!\nconst ok: User!!= loaded\n", 0},
		{"parenthesized-slot", "declare const loaded: User!(NotFound | Timeout)\nconst ok: User!(\n  NotFound | Timeout) = loaded\n", 0},
		{"slot", "const ok: User!NotFound = loaded\n", 0},
		{"three-slots", "effect function f(): User!NotFound!Users { return loaded }\n", 0},
		{"return-double-bang", "effect function f(): number!! { return 1 }\n", 0},
		{"expression-non-null", "const n = value!\nconst m = other!.length\n", 0},
		{"tuple-optional-double-bang", "type Opt = [A!!?]\n", 0},
		{"tuple-optional-slot", "type Opt = [A!E?]\n", 0},
		{"jsdoc-star-slot", "type S = A!*\n", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, test.text, core.ScriptKindTS)
			got := 0
			for _, d := range file.Diagnostics() {
				if d.Code() != 17019 {
					continue
				}
				got++
				if test.text[d.Pos():d.End()] != "!" {
					t.Errorf("TS17019 covers %q, want the !", test.text[d.Pos():d.End()])
				}
			}
			if test.want == 0 && len(file.Diagnostics()) != 0 {
				t.Fatalf("valid shorthand rejected: %v\n%s", file.Diagnostics(), test.text)
			}
			if got != test.want {
				t.Fatalf("got %d TS17019, want %d: %v\n%s", got, test.want, file.Diagnostics(), test.text)
			}
		})
	}
}

// VIP-3 VIP-3 slot line boundaries and grouped multiline operand; rule: docs/design/vips/0003-effect-type-shorthand.md#e20b7a8d84b7cb50

// VIP-3 VIP-3 slot line boundaries and grouped multiline operand; rule: docs/design/vips/0003-effect-type-shorthand.md#e28967693d877faa

// VIP-3 VIP-3 slot line boundaries and grouped multiline operand; rule: docs/design/vips/0003-effect-type-shorthand.md#1bf4a9f675b4b066
