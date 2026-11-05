package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func TestGrammarAdmissionBitwiseQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A's inherited TypeScript grammar changed; review bitwise expression coverage")
	}
}

// Appendix A inherits TypeScript's expression grammar. Bitwise AND and XOR
// sit between equality and bitwise OR, below the relational is expression.
func TestGrammarAdmissionBitwise(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"const n = a & b;",
		"const n = a ^ b;",
		"const n = a | b;",
		"const n = a | b ^ c & d;",
		"const n = a & b ^ c | d;",
		"const n = a + b & c * d;",
		"const n = a & b == c;",
		"const n = a < b & c > d;",
		"const n = a & b && c ^ d;",
		"const n = a ?? b & c;",
		"const n = (a ^ b) & c;",
		"const n = a ? b & c : d ^ e;",
		"const f = () => a & b;",
		"const n = f(a & b, c ^ d);",
	} {
		t.Run(source, func(t *testing.T) {
			if ds := parseAs(parseKind{"bitwise.ts", core.ScriptKindTS}, source).Diagnostics(); len(ds) != 0 {
				t.Fatalf("native compiler rejected a bitwise control: %v", ds)
			}
			for _, g := range []*grammarCfg{lab.ts, lab.g} {
				if r := lab.read(g, grammarLexSource(source), grammarParseMode{}); r.count == 0 {
					t.Fatalf("inherited bitwise expression has no derivation: %s", source)
				}
			}
			if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
				t.Fatalf("native bitwise expression mistaken for undefined syntax: %s", detail)
			}
		})
	}
	for _, source := range []string{
		"const b = x is > 1 & 2 + 3;",
		"const b = x is > 1 ^ 2 + 3;",
		"const b = x is > 1 | 2 + 3;",
		"const b = x is not -1 & 2;",
		"const b = x is 1 ^ y is 2;",
		"const b = (x is > 1) & 2;",
	} {
		t.Run(source, func(t *testing.T) {
			if r := lab.read(lab.g, grammarLexSource(source), grammarParseMode{}); r.count == 0 {
				t.Fatalf("bitwise continuation of an is test has no derivation: %s", source)
			}
			if grammarIsOperandPrecedence(grammarLexSource(source)) {
				t.Fatal("lower-precedence bitwise continuation entered the arithmetic gap")
			}
			if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
				t.Fatalf("valid is continuation mistaken for undefined syntax: %s", detail)
			}
		})
	}
	for _, source := range []string{
		"const n = a &;",
		"const n = a ^;",
		"const n = & a;",
		"const n = a & & b;",
		"const n = a ^ ^ b;",
		"const n = a ?? b && c;",
	} {
		for _, g := range []*grammarCfg{lab.ts, lab.g} {
			if r := lab.read(g, grammarLexSource(source), grammarParseMode{}); r.count != 0 {
				t.Errorf("invalid expression has a derivation: %s", source)
			}
		}
	}
}
