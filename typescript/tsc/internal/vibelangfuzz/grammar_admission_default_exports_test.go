package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func TestGrammarAdmissionDefaultExportsQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A inherited TypeScript default export authority changed")
	}
}

func TestGrammarAdmissionDefaultExports(t *testing.T) {
	TestGrammarAdmissionDefaultExportsQuoted(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"export default function () { return 1; }",
		"export default function f() { return 1; } const value = 2;",
		"export default async function () { return 1; }",
		"export default async function f() { return 1; } const value = 2;",
		"export default async function* () { yield 1; }",
		"export default async\nfunction f() { return 1; }",
		"export default function* () { yield 1; }",
		"export default class { value = 1; }",
		"export default class Value { value = 1; } const other = 2;",
		"export default {};",
		"export default { value: 1 };",
		"export default { value: 1, };",
		"export default { \"class\": 1 };",
		"const value = 1; export default { value };",
		"export default { nested: { value: 1 } };",
		"export default { values: [1, 2] };",
		"export default ({ value: 1 });",
		"export default [1, 2];",
		"export default 1;",
		"export default () => ({ value: 1 });",
		"export default (function () { return 1; });",
	} {
		t.Run(source, func(t *testing.T) {
			if ds := parseAs(parseKind{"defaults.ts", core.ScriptKindTS}, source).Diagnostics(); len(ds) != 0 {
				t.Fatalf("native parser rejected a default expression: %v", ds)
			}
			for _, g := range []*grammarCfg{lab.ts, lab.g} {
				if r := lab.read(g, grammarLexSource(source), grammarParseMode{}); r.count == 0 {
					t.Errorf("native default expression has no derivation: %s", source)
				}
			}
			if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
				t.Fatalf("native default expression mistaken for undefined syntax: %s", detail)
			}
		})
	}
	for _, source := range []string{
		"export default { value: };",
		"export default {,};",
		"export default { value: 1,, };",
		"export default {",
		"export default [;",
		"export default ;",
	} {
		for _, g := range []*grammarCfg{lab.ts, lab.g} {
			if r := lab.read(g, grammarLexSource(source), grammarParseMode{}); r.count != 0 {
				t.Errorf("malformed default expression has a derivation: %s", source)
			}
		}
	}
}
