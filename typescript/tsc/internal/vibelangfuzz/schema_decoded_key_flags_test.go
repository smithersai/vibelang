package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

var decodedKeyQuotes = []string{
	"At every required field, required fixed tuple slot (before or after a rest), and `Record` value, the inferred schema type's `\"~type.optionality\"` must be `\"required\"`.",
	"At every effectively readonly field or readonly `Record` value, `\"~type.mutability\"` must be `\"readonly\"`",
	"A conflicting or unprovable flag is `EK2109`: use an unmodified value schema and write modifiers on the declaration.",
}

func requireDecodedKeyQuotes(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("006-data.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range decodedKeyQuotes {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("chapter 006 no longer contains %q", quote)
		}
	}
}

func TestSchemaDecodedKeyFlagsQuoted(t *testing.T) { requireDecodedKeyQuotes(t) }

// Required and readonly are independent promises: a widened codec may violate
// both at one reference. Vary optionality, readonlyness, aliases and nesting.
func FuzzSchemaDecodedKeyFlags(f *testing.F) {
	startShortBudget(f)
	requireDecodedKeyQuotes(f)
	for _, key := range []string{"required", "readonly", "both", "optional", "writable", "valid"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(3))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		requireDecodedKeyQuotes(t)
		codec, modifier, want := "Schema.Number", "readonly value", 0
		switch key {
		case "required":
			codec, want = "Schema.optionalKey(Schema.Number)", 1
		case "readonly":
			codec, want = "Schema.mutableKey(Schema.Number)", 1
		case "both":
			codec, want = "Schema.Number as Schema.Top", 2
		case "optional":
			codec, modifier = "Schema.optionalKey(Schema.Number)", "readonly value?"
		case "writable":
			codec, modifier = "Schema.mutableKey(Schema.Number)", "value"
		default:
			key = "valid"
		}
		name := "Codec"
		source := "const Codec = " + codec + "\n"
		if mode&1 != 0 {
			source += "const Alias = Codec\n"
			name = "Alias"
		}
		field := modifier + ": " + name
		if mode&2 != 0 {
			field = "readonly nested: { " + field + " }"
		}
		source += "schema S { " + field + " }\nexport {}\n"
		result := toolsCompile(t, w, "FuzzSchemaDecodedKeyFlags", Single(source).Files)
		defer result.Remove()
		got := 0
		for _, d := range result.Diagnostics {
			if d.Code() == 2109 && d.Source() == "EK" {
				got++
			}
		}
		if got != want {
			Gap(t, "FuzzSchemaDecodedKeyFlags", "decoded-key:"+key, "%s: got %d EK2109, want %d:\n%s\n%v", fmt.Sprint(mode), got, want, source, result.Diagnostics)
		}
	})
}
