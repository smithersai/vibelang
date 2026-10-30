package vibelangfmt

import (
	"strings"
	"testing"
)

func TestSameProgramJSDocAttachment(t *testing.T) {
	for _, source := range []string{
		"export error E { /** @internal */ payload: string; value: string }\n",
		"export schema error E { /** @internal */ payload: string; value: string }\n",
		"export class E { /** @internal */ payload!: string; value!: string }\n",
		"export class E { /* @internal */ payload!: string; value!: string }\n",
		"export interface E { /** @deprecated old */ payload: string; value: string }\n",
		"type E = { /** @internal */ payload: string; value: string }\n",
	} {
		t.Run(source, func(t *testing.T) {
			after := strings.Replace(source, "{ /*", "{\n/*", 1)
			for _, pair := range [][2]string{{source, after}, {after, source}} {
				if err := SameProgram(pair[0], pair[1]); err == nil {
					t.Fatal("JSDoc activation or removal can change declarations and must differ")
				}
			}
		})
	}
	for _, pair := range [][2]string{
		{"error E {\n/** @internal */ payload: string\n}", "error E {\n  /** @internal */\n  payload: string;\n}"},
		{"error E { /* ordinary */ payload: string }", "error E {\n/* ordinary */ payload: string\n}"},
	} {
		if err := SameProgram(pair[0], pair[1]); err != nil {
			t.Fatalf("unchanged JSDoc attachment or ordinary comment: %v", err)
		}
	}
}

func TestFormatRejectsJSDocActivation(t *testing.T) {
	for _, source := range []string{
		"export error E { /** @internal */ payload: string; value: string }\n",
		"export schema error E { /** @internal */ payload: string; value: string }\n",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := Format("comments.vibe", source, func(encoded string) (string, error) {
				return strings.Replace(encoded, "{ /**", "{\n/**", 1), nil
			})
			if err == nil || !strings.Contains(err.Error(), "JSDoc attachment") || result != "" {
				t.Fatalf("formatter must reject API-changing JSDoc activation without returning changed text, got %q, %v", result, err)
			}
		})
	}
}
