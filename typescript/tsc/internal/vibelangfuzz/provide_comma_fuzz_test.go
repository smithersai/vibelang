package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const provideCommaRecoveryQuote = "a head is recovered as `provide` when it otherwise parses through the body-opening `{` and only a line break immediately before or after one or more top-level provider-separating commas violates the grammar."

func provideCommaRecoveryQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), provideCommaRecoveryQuote) {
		t.Fatalf("chapter 5 no longer says %q", provideCommaRecoveryQuote)
	}
}

func TestProvideCommaRecoveryQuoted(t *testing.T) { provideCommaRecoveryQuoted(t) }

// Detail 237 recovers only separator-adjacent breaks, with one EK1202 per
// broken separator. Newlines within a provider expression stay valid.
func FuzzProvideCommaRecovery(f *testing.F) {
	// Spec rule: docs/design/src/005-services.md#745e677d93811666
	// Chapter 005: bounded keyword classification preserves call and missing-body fallback (FuzzProvideCommaRecovery).

	// Spec rule: docs/design/src/005-services.md#e563939aef5812aa
	// Chapter 005: bounded keyword classification preserves call and missing-body fallback (FuzzProvideCommaRecovery).

	startShortBudget(f)
	provideCommaRecoveryQuoted(f)
	for _, key := range []string{"before", "after", "both", "comment", "inner", "keyword", "body"} {
		f.Add([]byte(key))
		for v := byte(1); v <= 4; v++ {
			f.Add([]byte(key + "\x00" + string([]byte{v + 8})))
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		variant := byte(0)
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		newline := []string{"\n", "\r\n", "\r", "\u2028", "\u2029"}[int(variant)%5]
		providers := 2 + int(variant>>3)%3
		before, after := "", ""
		want := 0
		switch key {
		case "before":
			before = newline
		case "after":
			after = newline
		case "both":
			before, after = newline, newline
		case "comment":
			after = " /* keep" + newline + "comment */ "
		case "inner", "keyword", "body":
		default:
			key, after = "after", newline
		}
		if before != "" || after != "" {
			want = providers - 1
		}
		head := "Layer.empty"
		for i := 1; i < providers; i++ {
			head += before + "," + after + "Layer.empty"
		}
		if key == "inner" {
			head = "Layer.mergeAll(" + newline + "Layer.empty," + newline + "Layer.empty" + newline + "), Layer.empty"
		}
		source := "effect function f() { provide " + head + " {} }"
		if key == "keyword" {
			source = "effect function f() { provide" + newline + head + " {} }"
		}
		if key == "body" {
			source = "effect function f() { provide " + head + newline + "{} }"
		}
		file, syntax := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		recognized := false
		for _, form := range syntax {
			recognized = recognized || form.Kind == parser.VibeSyntaxBlockStatement
		}
		if recognized != (key != "keyword" && key != "body") {
			Gap(t, "FuzzProvideCommaRecovery", key+":classification", "bounded provide recognition=%v in %q", recognized, source)
			return
		}
		got := 0
		for _, d := range file.Diagnostics() {
			if d.Source() == "EK" && d.Code() == 1202 {
				got++
			} else if key != "keyword" && key != "body" {
				Gap(t, "FuzzProvideCommaRecovery", key, "chapter 5: %s; unexpected diagnostic %s in %q", provideCommaRecoveryQuote, d.String(), source)
				return
			}
		}
		if got != want {
			Gap(t, "FuzzProvideCommaRecovery", key, "chapter 5: %s; want %d EK1202, got %d in %q", provideCommaRecoveryQuote, want, got, source)
			return
		}
		ExpectPending(t, "FuzzProvideCommaRecovery", key)
		ExpectPending(t, "FuzzProvideCommaRecovery", specCorpusKey(t))
	})
}

// VIP-12 bounded-head-recognition-and-expression-controls
// rule: docs/design/vips/0012-provide.md#8388b81e530b1bc4
