package vibelangfuzz

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangestree"
)

const estreeWarningQuote = "A warning does not itself rewrite code, and a warning-only run exits zero."
const estreeThrowWarningQuote = "Its new punctuator-only comma case temporarily reports warning `EK1010` until the parenthesizing `vibelang --fix` ships"

func estreeWarningsQuoted(t testing.TB) {
	t.Helper()
	for chapter, quote := range map[string]string{"007-tooling.md": estreeWarningQuote, grammarAppendix: estreeThrowWarningQuote} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}
func TestESTreeWarningsQuoted(t *testing.T) { estreeWarningsQuoted(t) }

//go:embed testdata/corpus/t3code-crypto-throw-comma.vibe
var t3codeCryptoThrowComma string

func TestT3CodeCryptoWarningESTree(t *testing.T) {
	estreeWarningsQuoted(t)
	tree, failure := vibelangestree.Parse("crypto.vibe", t3codeCryptoThrowComma)
	if failure != nil {
		t.Fatalf("warning-only minimized source: %v", failure)
	}
	var program map[string]any
	if err := json.Unmarshal([]byte(tree), &program); err != nil || program["type"] != "Program" {
		t.Fatalf("invalid ESTree Program: %v", err)
	}
}

// The admitted migration spelling warns; it remains parseable. An actual
// syntax error after that warning still fails at its own UTF-16 location.
func FuzzESTreeWarningSeverity(f *testing.F) {
	startShortBudget(f)
	keys := []string{"t3code-crypto-property", "array-element", "call-argument", "object-property", "join-operand"}
	for _, key := range keys {
		for mode := uint8(0); mode < 8; mode++ {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		estreeWarningsQuoted(t)
		var expression string
		switch key {
		case "t3code-crypto-property":
			expression = ""
		case "array-element":
			expression = "[throw e, 1]"
		case "call-argument":
			expression = "g(throw e, 1)"
		case "object-property":
			expression = "{ a: throw e, b: 1 }"
		case "join-operand":
			expression = "[join throw e, 1]"
		default:
			expression = "[throw e, 1]"
			key = "array-element"
		}
		source := "effect function f(e, g) { return " + expression + "; }\n"
		if key == "t3code-crypto-property" {
			source = t3codeCryptoThrowComma
		}
		if mode&1 != 0 {
			source = "const symbol = \"😀\";\r\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		suffix := ""
		if mode&2 != 0 {
			suffix = "const broken = ;\n"
		}
		if mode&4 != 0 && suffix != "" {
			suffix = "module embedded { " + strings.TrimSpace(suffix) + " }\n"
		}
		source += suffix
		file := "main.vibe"
		if mode&4 != 0 {
			file = "main.vibex"
		}
		tree, failure := vibelangestree.Parse(file, source)
		gapKey := fmt.Sprintf("%s/%d", key, mode&7)
		if suffix == "" {
			if failure != nil {
				Gap(t, "FuzzESTreeWarningSeverity", gapKey, "warning-only source must produce an AST: %v", failure)
				return
			}
			var program map[string]any
			if err := json.Unmarshal([]byte(tree), &program); err != nil || program["type"] != "Program" {
				t.Fatalf("invalid ESTree Program: %v %s", err, tree)
			}
		} else {
			offset := strings.Index(source, "broken = ") + len("broken = ")
			want := len(utf16.Encode([]rune(source[:offset])))
			if failure == nil || failure.Index != want || !strings.Contains(failure.Message, "Expression expected") {
				Gap(t, "FuzzESTreeWarningSeverity", gapKey, "want actual expression error at UTF-16 offset %d, got %v", want, failure)
			}
		}
	})
}
