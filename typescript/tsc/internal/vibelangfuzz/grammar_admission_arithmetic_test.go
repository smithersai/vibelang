package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func TestGrammarAdmissionArithmeticQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A's inherited TypeScript grammar changed; review arithmetic expression coverage")
	}
}

// Appendix A inherits TypeScript's multiplicative and exponentiation grammar.
// Exponentiation associates right, binds above multiplication, and requires an
// update expression on the left; grouping permits a unary expression there.
func TestGrammarAdmissionArithmetic(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, expr := range []string{
		"8 / 2", "8 / 2 / 2", "8 / 2 * 3", "8 * 2 / 3", "8 % 3 / 2",
		"2 ** 3", "2 ** 3 ** 2", "2 * 3 ** 2", "2 ** 3 * 2",
		"2 ** 3 / 2", "8 / 2 ** 2", "2 ** -3", "2 ** +3",
		"(-2) ** 3", "(+2) ** 3", "(!2) ** 3", "(typeof 2) ** 3",
		"-(2 ** 3)", "+(2 ** 3)", "2 ** (3 ** 2)", "(2 ** 3) ** 2",
		"2\n** 3", "8\n/ 2", "2 **\n3", "8 /\n2",
	} {
		source := "const n = " + expr + ";"
		t.Run(expr, func(t *testing.T) {
			if ds := parseAs(parseKind{"arithmetic.ts", core.ScriptKindTS}, source).Diagnostics(); len(ds) != 0 {
				t.Fatalf("native parser rejected an arithmetic control: %v", ds)
			}
			for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
				if lab.read(g, grammarLexSource(source), grammarParseMode{}).count == 0 {
					t.Errorf("%s arithmetic expression has no derivation: %s", name, source)
				}
			}
			if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
				t.Errorf("native arithmetic mistaken for undefined syntax: %s", detail)
			}
		})
	}
	for _, source := range []string{
		"const n = 2 **;", "const n = ** 2;", "const n = 2 /;",
		"const n = / 2;", "const n = 2 ** ** 3;", "const n = 2 / / 3;",
		"const n = -2 ** 3;", "const n = +2 ** 3;", "const n = !2 ** 3;",
		"const n = typeof 2 ** 3;", "const n = void 2 ** 3;",
	} {
		for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
			if lab.read(g, grammarLexSource(source), grammarParseMode{}).count != 0 {
				t.Errorf("%s malformed or restricted arithmetic derived: %s", name, source)
			}
		}
	}
}

func TestGrammarAdmissionArithmeticGrouping(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		expr       string
		start, end int
	}{
		{"2 ** 3 ** 2", 5, 8},
		{"2 * 3 ** 2", 5, 8},
		{"2 ** 3 * 2", 3, 6},
	} {
		for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
			source := "const n = " + c.expr + ";"
			r := lab.read(g, grammarLexSource(source), grammarParseMode{})
			if r.count == 0 {
				t.Errorf("%s grouping control has no derivation: %s", name, source)
				continue
			}
			for _, tree := range r.trees {
				found := false
				var visit func(*grammarPtree)
				visit = func(node *grammarPtree) {
					if node.nt >= 0 && g.names[node.nt] == "ExponentiationExpression" && node.i == c.start && node.j == c.end {
						found = true
					}
					for _, child := range node.kids {
						visit(child)
					}
				}
				visit(tree)
				if !found {
					t.Errorf("%s lost right-associative exponentiation above multiplication: %s", name, source)
				}
			}
		}
	}
}

func checkGrammarArithmeticOperators(t *testing.T, data []byte) {
	t.Helper()
	if len(data) == 0 || len(data) > 32 {
		t.Skip("bounded arithmetic operator neighborhood")
	}
	pick := func(at, n int) int { return int(data[at%len(data)]) % n }
	ops := []string{"*", "/", "%", "**"}
	left := []string{"2", "-2", "+2", "!2", "typeof 2", "void 2"}[pick(0, 6)]
	grouped := pick(1, 2) == 1
	unary := left != "2"
	if grouped {
		left = "(" + left + ")"
	}
	first, second := ops[pick(2, len(ops))], ops[pick(3, len(ops))]
	source := fmt.Sprintf("const n = %s %s 3 %s 2;", left, first, second)
	want := first != "**" || !unary || grouped
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
		got := lab.read(g, grammarLexSource(source), grammarParseMode{}).count != 0
		if got != want {
			t.Fatalf("%s arithmetic derivation=%v, want %v: %s", name, got, want, source)
		}
	}
}

func FuzzGrammarArithmeticOperators(f *testing.F) {
	startShortBudget(f)
	for _, data := range [][]byte{{0, 0, 1, 3}, {0, 0, 3, 3}, {1, 0, 3, 0}, {1, 1, 3, 0}} {
		f.Add(data)
	}
	f.Fuzz(func(t *testing.T, data []byte) { checkGrammarArithmeticOperators(t, data) })
}
