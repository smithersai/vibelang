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

const estreeThrowCommaQuote = "The invalid-punctuator lookahead also applies to comma separators."

func estreeThrowCommaQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText(grammarAppendix), estreeThrowCommaQuote) {
		t.Fatalf("%s no longer says %q", grammarAppendix, estreeThrowCommaQuote)
	}
}
func TestESTreeThrowCommaQuoted(t *testing.T) { estreeThrowCommaQuoted(t) }

//go:embed testdata/corpus/t3code-crypto-throw-comma.vibe
var t3codeCryptoThrowComma string

func TestT3CodeCryptoThrowCommaESTree(t *testing.T) {
	estreeThrowCommaQuoted(t)
	tree, failure := vibelangestree.Parse("crypto.vibe", strings.ReplaceAll(t3codeCryptoThrowComma, "throw badArgument()", "(throw badArgument())"))
	if failure != nil {
		t.Fatalf("parenthesized minimized source: %v", failure)
	}
	var program map[string]any
	if err := json.Unmarshal([]byte(tree), &program); err != nil || program["type"] != "Program" {
		t.Fatalf("invalid ESTree Program: %v", err)
	}
}

// Grouping admits the throw expression; ungrouped commas and unrelated
// syntax failures keep their own UTF-16 diagnostic locations.
func FuzzESTreeThrowComma(f *testing.F) {
	startShortBudget(f)
	keys := []string{"t3code-crypto-property", "array-element", "call-argument", "object-property", "join-operand"}
	for _, key := range keys {
		for mode := uint8(0); mode < 16; mode++ {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		estreeThrowCommaQuoted(t)
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
		grouped := mode&8 != 0
		if grouped {
			source = strings.ReplaceAll(source, "throw badArgument()", "(throw badArgument())")
			source = strings.ReplaceAll(source, "throw e", "(throw e)")
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
		gapKey := fmt.Sprintf("%s/%d", key, mode&15)
		if !grouped {
			offset := strings.Index(source, "throw ")
			want := len(utf16.Encode([]rune(source[:offset])))
			if failure == nil || failure.Index != want || !strings.Contains(failure.Message, "can't be followed by ,") {
				Gap(t, "FuzzESTreeThrowComma", gapKey, "want throw-comma rejection at %d, got %v", want, failure)
			}
		} else if suffix == "" {
			if failure != nil {
				Gap(t, "FuzzESTreeThrowComma", gapKey, "parenthesized source must produce an AST: %v", failure)
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
				Gap(t, "FuzzESTreeThrowComma", gapKey, "want actual expression error at UTF-16 offset %d, got %v", want, failure)
			}
		}
	})
}
