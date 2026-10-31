package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const formatDeclarationQuote = "An unparsable file is reported and left unchanged; formatting is idempotent."

func TestFormatDeclarationRulesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), formatDeclarationQuote) {
		t.Fatalf("chapter 7 no longer says %q; update the formatting oracle", formatDeclarationQuote)
	}
}

var formatDeclarationKeys = []string{"data", "schema", "error", "schema-error"}

// FuzzFormatDeclarationLayout varies both declaration and payload brace lines,
// generics, indentation and blank lines. Its keyed corpus survives rule reordering.
// Chapter 7 (VIP-34): "An unparsable file is reported and left unchanged; formatting is idempotent."
func FuzzFormatDeclarationLayout(f *testing.F) {
	startShortBudget(f)
	for _, key := range formatDeclarationKeys {
		for _, layout := range []uint8{0, 1, 2, 7, 15, 31, 63, 255} {
			f.Add(key, layout)
		}
	}
	formatter := toolsFormatter(f)
	f.Fuzz(func(t *testing.T, key string, layout uint8) {
		index := slices.Index(formatDeclarationKeys, key)
		if index < 0 {
			if len(key) == 0 {
				return
			}
			index = int(key[0]) % len(formatDeclarationKeys)
			key = formatDeclarationKeys[index]
		}
		gap := []string{" ", "\n", "\n\n", "\r\n"}[layout&3]
		indent := []string{"", "  ", "    ", "\t"}[(layout>>2)&3]
		head := strings.ReplaceAll(key, "-", " ") + " Parcel"
		fieldType := "string"
		// Only data declarations accept type parameters (chapters 3 and 6).
		if layout&16 != 0 && key == "data" {
			head += "<A>"
			fieldType = "A"
		}
		body := "value: " + fieldType + ";"
		if key == "data" {
			payloadGap := []string{" ", "\n", "\n\n", "\r\n"}[(layout>>5)&3]
			body = "Waiting;\n" + indent + "Sent" + payloadGap + indent + "{ " + body + " };"
		}
		source := head + gap + "{\n" + indent + body + "\n}\n"
		toolsGuard(t, "FuzzFormatDeclarationLayout", func() {
			once, err := vibelangfmt.Format("layout.vibe", source, formatter)
			if err != nil {
				Gap(t, "FuzzFormatDeclarationLayout", "format:declaration:"+key+":refusal", "valid %s declaration refused: %v\n%s", key, err, source)
			}
			if err := vibelangfmt.SameProgram(source, once); err != nil {
				Gap(t, "FuzzFormatDeclarationLayout", "format:declaration:"+key+":meaning", "%v\n%s\n%s", err, source, once)
			}
			twice, err := vibelangfmt.Format("layout.vibe", once, formatter)
			if err != nil || twice != once {
				Gap(t, "FuzzFormatDeclarationLayout", "format:declaration:"+key+":idempotence", "%s\nlayout %d: %v\nsource:\n%s\nonce:\n%s\ntwice:\n%s", formatDeclarationQuote, layout, err, source, once, twice)
			}
		})
	})
}

// Preserve the post-merge witness independently of CaseSeeds' moving sample.
func TestFormatDeclarationPostmergeWitness(t *testing.T) {
	source := "// compiler-gap: pending VIP-16\ndata Delivery\n{\n  Waiting;\n  Sent\n\n  { tracking: string };\n  Rejected { reason: string };\n}\nconst tracking = \"outer\"\nconst d = Delivery.Sent({ tracking: \"1Z\" })\nconst label = match (d) { when { _tag: \"Sent\", let tracking }: tracking; default: \"none\"; }\n"
	formatter := toolsFormatter(t)
	once, err := vibelangfmt.Format("main.vibe", source, formatter)
	if err != nil {
		t.Fatal(err)
	}
	twice, err := vibelangfmt.Format("main.vibe", once, formatter)
	if err != nil || twice != once {
		t.Fatalf("not idempotent: %v\nonce:\n%s\ntwice:\n%s", err, once, twice)
	}
}
