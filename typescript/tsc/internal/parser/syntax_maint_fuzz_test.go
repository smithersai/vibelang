package parser_test

import (
	"fmt"
	"math/bits"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Generate trivia from whole tokens so every mutation still exercises the
// ambiguous grammar, including comments with a line terminator inside them.
func maintTrivia(input []byte) string {
	tokens := [...]string{" ", "\t", "/**/", "/* x */", "\n", "\r\n", "/*\n*/", "\u00a0"}
	var s strings.Builder
	for _, b := range input[:min(len(input), 16)] {
		s.WriteString(tokens[int(b)%len(tokens)])
	}
	return s.String()
}

func maintWalk(n *ast.Node, check func(*ast.Node)) {
	check(n)
	n.ForEachChild(func(c *ast.Node) bool { maintWalk(c, check); return false })
}

func maintParse(t *testing.T, src string) *ast.SourceFile {
	t.Helper()
	file := parseVibe(t, src)
	if ds := file.Diagnostics(); len(ds) != 0 {
		t.Fatalf("%s\n%s", src, ds[0].String())
	}
	return file
}

// The same token stream is an element access in a plain function and an
// operation on an array operand in an effect function.
func FuzzJoinBracketContext(f *testing.F) {
	for _, gap := range [][]byte{nil, {0}, {2}, {3, 1}, {4}, {6, 7}} {
		f.Add(gap, uint16(0))
	}
	f.Fuzz(func(t *testing.T, data []byte, index uint16) {
		operand := fmt.Sprintf("join%s[%d]", maintTrivia(data), index)
		for _, effect := range []bool{false, true} {
			head := "function first(join: number[])"
			if effect {
				head = "effect function first()"
			}
			src := head + " { return " + operand + " }"
			file := maintParse(t, src)
			accesses, joins := 0, 0
			maintWalk(file.AsNode(), func(n *ast.Node) {
				if ast.IsElementAccessExpression(n) && ast.IsIdentifier(n.Expression()) && n.Expression().Text() == "join" {
					if n.AsElementAccessExpression().ArgumentExpression.Text() != fmt.Sprint(index) {
						t.Fatalf("wrong index: %s", src)
					}
					accesses++
				}
				if ast.IsCallExpression(n) && ast.IsIdentifier(n.Expression()) && n.Expression().Text() == "$join" {
					args := n.Arguments()
					if len(args) != 1 || args[0].Kind != ast.KindArrayLiteralExpression {
						t.Fatalf("wrong join operand: %s", src)
					}
					joins++
				}
			})
			if effect && (joins != 1 || accesses != 0) || !effect && (accesses != 1 || joins != 0) {
				t.Fatalf("%s: %d joins, %d accesses", src, joins, accesses)
			}
		}
	})
}

func FuzzPrivateBrandDo(f *testing.F) {
	f.Add(uint32(0), []byte{}, uint8(0))
	f.Add(uint32(42), []byte{4, 2}, uint8(2))
	f.Fuzz(func(t *testing.T, id uint32, data []byte, depth uint8) {
		name := fmt.Sprintf("#field%d", id)
		rhs := "o"
		for range 1 + int(depth%4) {
			rhs = "do { (" + rhs + ") }"
		}
		src := "class C { " + name + " = 1; static has(o: object) { return " + name + maintTrivia(data) + " in " + rhs + " } }"
		file := maintParse(t, src)
		checks := 0
		maintWalk(file.AsNode(), func(n *ast.Node) {
			if n.Kind != ast.KindPrivateIdentifier {
				return
			}
			if n.Text() != name {
				t.Fatalf("unexpected private name %q in %s", n.Text(), src)
			}
			switch n.Parent.Kind {
			case ast.KindPropertyDeclaration:
				if n.Parent.Name() == n {
					return
				}
			case ast.KindBinaryExpression:
				b := n.Parent.AsBinaryExpression()
				if b.Left == n && b.OperatorToken.Kind == ast.KindInKeyword {
					checks++
					return
				}
			}
			t.Fatalf("private name used as a value under %v in %s", n.Parent.Kind, src)
		})
		if checks != 1 {
			t.Fatalf("got %d brand checks in %s", checks, src)
		}
	})
}

func FuzzEffectAssertionConditional(f *testing.F) {
	branches := []string{"+1", "~1", "++n", "--n", "/re/", "function () {}", "class {}", "delete obj.k", "try Effect.succeed(1)", "1"}
	types := []string{"number!string", "number!!", "number!string!R"}
	for i := range branches {
		f.Add(uint8(i), uint8(i%len(types)), []byte{0})
	}
	f.Fuzz(func(t *testing.T, branch, typ uint8, data []byte) {
		ty := types[int(typ)%len(types)]
		gap := maintTrivia(data)
		src := "type T = [" + ty + "?]; effect function f() { return x as " + ty + gap + "?" + gap + branches[int(branch)%len(branches)] + " : 2 }"
		file := maintParse(t, src)
		conditionals, optionals := 0, 0
		maintWalk(file.AsNode(), func(n *ast.Node) {
			switch n.Kind {
			case ast.KindConditionalExpression:
				if n.AsConditionalExpression().Condition.Kind != ast.KindAsExpression {
					t.Fatalf("lost type assertion: %s", src)
				}
				conditionals++
			case ast.KindOptionalType:
				optionals++
			}
		})
		if conditionals != 1 || optionals != 1 {
			t.Fatalf("%d conditionals, %d optional tuple elements: %s", conditionals, optionals, src)
		}
	})
}

func FuzzConcurrentIsHeadContinue(f *testing.F) {
	for _, nested := range []bool{false, true} {
		f.Add(uint16(0), uint8(0), nested)
		f.Add(uint16(5), uint8(7), nested)
	}
	f.Fuzz(func(t *testing.T, id uint16, layers uint8, crossesItem bool) {
		label := fmt.Sprintf("outer%d", id)
		body := "continue " + label + ";"
		for i := 0; i < int(layers%5); i++ {
			body = "for (const y of [1]) { if (y) { " + body + " } }"
		}
		if crossesItem {
			body = "for concurrent (const z of [1]) { " + body + " }"
		}
		limit := ""
		if layers&1 != 0 {
			limit = fmt.Sprintf("(%d)", 1+id%8)
		}
		src := "effect function f(xs: unknown) { " + label + ": for concurrent" + limit + " (const x of (xs is Array(...let ys) ? ys : [])) { " + body + " } }"
		file := maintParse(t, src)
		start := strings.Index(src, "continue ")
		labels, returns, continues := 0, 0, 0
		maintWalk(file.AsNode(), func(n *ast.Node) {
			if n.Kind == ast.KindLabeledStatement && n.Label().Text() == label {
				labels++
				if parser.VibeLangConcurrentCall(n.Statement()) == nil {
					t.Fatalf("lost loop through head declarations: %s", src)
				}
			}
			if n.Kind == ast.KindContinueStatement && n.Label() != nil && n.Label().Text() == label {
				continues++
			}
			if n.Kind == ast.KindReturnStatement && n.End() == start+len("continue") {
				returns++
			}
		})
		if labels != 1 || crossesItem && (continues != 1 || returns != 0) || !crossesItem && (returns != 1 || continues != 0) {
			t.Fatalf("%d labels, %d item returns, %d source continues: %s", labels, returns, continues, src)
		}
	})
}

func FuzzNamelessSchemaKeys(f *testing.F) {
	for _, fields := range [][]byte{{0, 1}, {2, 3, 4, 1}, {3, 3, 0, 0, 1, 2}} {
		f.Add(fields)
	}
	f.Fuzz(func(t *testing.T, fields []byte) {
		members := []string{"[k: string]: number", "(x: number): string"}
		explicit := map[string]bool{}
		for i, b := range fields[:min(24, len(fields))] {
			switch b % 5 {
			case 0:
				members = append(members, "[k: string]: number")
			case 1:
				members = append(members, "(x: number): string")
			case 2:
				members = append(members, "new (): object")
			default:
				key := fmt.Sprintf("#%d", i)
				if len(explicit) == 0 && b%2 == 0 {
					key = ""
				}
				explicit[key] = true
				members = append(members, fmt.Sprintf("%q: number", key))
			}
		}
		src := "export schema S { " + strings.Join(members, "; ") + " }"
		file := maintParse(t, src)
		found := map[string]bool{}
		maintWalk(file.AsNode(), func(n *ast.Node) {
			if n.Kind != ast.KindPropertyAssignment {
				return
			}
			key := n.Name().Text()
			if found[key] {
				t.Fatalf("duplicate lowered key %q in %s", key, src)
			}
			found[key] = true
		})
		if len(found) != len(members) {
			t.Fatalf("%d lowered fields, want %d: %s", len(found), len(members), src)
		}
		for key := range explicit {
			if !found[key] {
				t.Fatalf("lost source field %q in %s", key, src)
			}
		}
	})
}

// Check the flag bits where the parser actually writes them. Each source
// exercises a different consumer of the three formerly overlapping flags.
func TestMaintPatternAndMethodFlags(t *testing.T) {
	const mask = ast.NodeFlagsVibeLangShorthandBinding | ast.NodeFlagsVibeLangDoMethodBind | ast.NodeFlagsVibeLangUncountedPattern
	if bits.OnesCount64(uint64(mask)) != 3 {
		t.Fatalf("shorthand, method bind and uncounted pattern share flag bits: %#x", mask)
	}
	for _, tc := range []struct {
		src  string
		want ast.NodeFlags
	}{
		{"function f(o: unknown) { return match (o) { when { let x }: x; default: 0; } }", ast.NodeFlagsVibeLangShorthandBinding},
		{"function f(o: unknown) { return match (o) { when not 0: 1; default: 0; } }", ast.NodeFlagsVibeLangUncountedPattern},
		{"function f(o: any) { return o.m(do { 1 }) }", ast.NodeFlagsVibeLangDoMethodBind},
	} {
		var seen int
		maintWalk(maintParse(t, tc.src).AsNode(), func(n *ast.Node) {
			flags := n.Flags & mask
			if flags == 0 {
				return
			}
			if flags != tc.want {
				t.Fatalf("%v has flags %#x, want %#x: %s", n.Kind, flags, tc.want, tc.src)
			}
			seen++
		})
		if seen == 0 {
			t.Errorf("missing flag %#x: %s", tc.want, tc.src)
		}
	}
}
