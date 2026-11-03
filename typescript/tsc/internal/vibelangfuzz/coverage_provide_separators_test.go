package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
	"unicode"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const coverageProvideSeparatorQuote = "The formatter does not introduce separator breaks"

func TestCoverageProvideSeparatorsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), coverageProvideSeparatorQuote) {
		t.Fatal("Chapter 005 no longer contains", coverageProvideSeparatorQuote)
	}
}

// Chapter 005: formatter provider separators, including composed providers.
// Spec rule: docs/design/src/005-services.md#0fa9c8ed2c3e5072
// Spec rule: docs/design/src/005-services.md#1723875c9404e482
func FuzzCoverageProvideSeparators(f *testing.F) {
	startShortBudget(f)
	modes := []string{"simple", "mixed", "nested", "multiline", "long", "unicode"}
	for _, mode := range modes {
		f.Add(mode, uint8(0))
		f.Add(mode, uint8(4))
	}
	formatter := toolsFormatter(f)
	f.Fuzz(func(t *testing.T, mode string, size uint8) {
		TestCoverageProvideSeparatorsQuoted(t)
		found := false
		for _, candidate := range modes {
			if mode == candidate {
				found = true
			}
		}
		if !found {
			if mode == "" {
				return
			}
			mode = modes[int(mode[0])%len(modes)]
		}
		count := 2 + int(size%5)
		providers := make([]string, count)
		for i := range providers {
			providers[i] = fmt.Sprintf("Provider%d", i)
			switch mode {
			case "mixed":
				if i%2 == 0 {
					providers[i] = fmt.Sprintf("Key%d = value%d", i, i)
				}
			case "nested":
				providers[i] = fmt.Sprintf("Layer.mergeAll(A%d, B%d)", i, i)
			case "multiline", "unicode":
				newline := "\n"
				if mode == "unicode" {
					newline = "\u2028"
				}
				providers[i] = "Layer.mergeAll(" + newline + "A," + newline + "B)"
			case "long":
				providers[i] = strings.Repeat("LongProvider", 20) + fmt.Sprint(i)
			}
		}
		source := "effect function main() { provide " + strings.Join(providers, ", ") + " { try work() } }\n"
		key := fmt.Sprintf("%s:%d", mode, count)
		formatted, err := vibelangfmt.Format("main.vibe", source, formatter)
		if err != nil {
			Gap(t, "FuzzCoverageProvideSeparators", key, "Chapter 005 %q: valid provider head was refused: %v\n%s", coverageProvideSeparatorQuote, err, source)
			return
		}
		if err := coverageProvideSeparators(formatted); err != nil {
			Gap(t, "FuzzCoverageProvideSeparators", key, "Chapter 005 %q: %v\nsource:\n%s\nformatted:\n%s", coverageProvideSeparatorQuote, err, source, formatted)
			return
		}
		if err := vibelangfmt.SameProgram(source, formatted); err != nil {
			Gap(t, "FuzzCoverageProvideSeparators", key, "Chapter 005 provider formatting changed the program: %v", err)
			return
		}
		ExpectPending(t, "FuzzCoverageProvideSeparators", key)
		ExpectPending(t, "FuzzCoverageProvideSeparators", specCorpusKey(t))
	})
}

// The generated heads contain no object literals or quoted delimiters. Only
// depth-zero commas separate providers; inner call commas may span lines.
func coverageProvideSeparators(source string) error {
	at := strings.Index(source, "provide")
	if at < 0 {
		return fmt.Errorf("provide head disappeared")
	}
	rest := source[at+len("provide"):]
	end := strings.Index(rest, "{")
	if end < 0 {
		return fmt.Errorf("provide body disappeared")
	}
	head := []rune(rest[:end])
	depth := 0
	lineTerminator := func(r rune) bool { return r == '\n' || r == '\r' || r == '\u2028' || r == '\u2029' }
	for i, r := range head {
		switch r {
		case '(', '[':
			depth++
		case ')', ']':
			depth--
		case ',':
			if depth != 0 {
				continue
			}
			for j := i - 1; j >= 0 && unicode.IsSpace(head[j]); j-- {
				if lineTerminator(head[j]) {
					return fmt.Errorf("separator has a preceding line break")
				}
			}
			for j := i + 1; j < len(head) && unicode.IsSpace(head[j]); j++ {
				if lineTerminator(head[j]) {
					return fmt.Errorf("separator has a following line break")
				}
			}
		}
	}
	return nil
}

// The oracle must distinguish list separators from commas inside a provider.
func TestCoverageProvideSeparatorOracle(t *testing.T) {
	for _, source := range []string{
		"provide A, B {}",
		"provide Layer.mergeAll(\nA,\nB), C {}",
	} {
		if err := coverageProvideSeparators(source); err != nil {
			t.Errorf("valid: %s: %v", source, err)
		}
	}
	for _, source := range []string{
		"provide A,\nB {}",
		"provide A\n, B {}",
		"provide A,\u2028B {}",
		"provide A\u2029, B {}",
	} {
		if err := coverageProvideSeparators(source); err == nil {
			t.Errorf("missed separator break: %s", source)
		}
	}
}
