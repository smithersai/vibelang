package vibelangfmt

import (
	"strings"
	"testing"
)

func TestFormatErrorFieldCommas(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"error", "schema error"} {
		for _, body := range []string{
			"id: string, code: number",
			"id: string /* keep */, code: number",
			"id: string, /* keep */ get label(): string { return this.id }",
			";; id: string, get label(): string { return this.id } ;;",
		} {
			t.Run(kind+"/"+body, func(t *testing.T) {
				source := kind + " E { " + body + " }\n"
				got, err := Format("main.vibe", source, func(text string) (string, error) {
					return strings.ReplaceAll(text, "string,", "string;"), nil
				})
				if err != nil {
					t.Fatal(err)
				}
				if strings.Contains(source, "/* keep */") && !strings.Contains(got, "/* keep */") {
					t.Fatalf("lost separator comment: %s", got)
				}
				if err := SameProgram(source, got); err != nil {
					t.Fatal(err)
				}
				if strings.Count(got, ",") != 1 {
					t.Fatalf("payload comma not preserved: %s", got)
				}
			})
		}
		t.Run(kind+"/ordinary commas", func(t *testing.T) {
			source := kind + " E { pair: [string, number], get label() { return [\"a\", \"b\"].join(\",\") } }\n"
			got, err := Format("main.vibe", source, func(text string) (string, error) {
				for _, part := range []string{"[string, number]", "[\"a\", \"b\"].join(\",\")"} {
					if !strings.Contains(text, part) {
						t.Errorf("changed ordinary comma %q in proxy: %s", part, text)
					}
				}
				return text, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			for _, part := range []string{"[string, number]", "[\"a\", \"b\"].join(\",\")"} {
				if !strings.Contains(got, part) {
					t.Errorf("changed ordinary comma %q in output: %s", part, got)
				}
			}
		})
	}
	for _, source := range []string{
		"class E { id: string, code: number }",
		"error E { get value() { return [1,,2,, } }",
		"schema error E { get value() { return [1,,2,, } }",
	} {
		if _, err := Format("main.vibe", source, func(text string) (string, error) { return text, nil }); err == nil {
			t.Errorf("accepted invalid ordinary TypeScript: %s", source)
		}
	}
}

// A separator can own a comment independently of the next payload member.
// Formatting must retain both, or leave the input unchanged with a clear refusal.
func TestFormatErrorFieldCommaComments(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"error", "schema error"} {
		for _, comment := range []string{"/** @internal */", "/** @throws {Error} */", "/* @internal */"} {
			for _, member := range []string{"code: number", "get label(): string { return this.id }"} {
				source := kind + " E { id: string\n" + comment + ",\n" + member + " }\n"
				t.Run(kind+"/"+comment+"/"+member, func(t *testing.T) {
					got, err := Format("main.vibe", source, func(text string) (string, error) { return text, nil })
					if err != nil {
						if !strings.Contains(err.Error(), "JSDoc attachment") {
							t.Fatal(err)
						}
						return
					}
					if !strings.Contains(got, comment) {
						t.Fatalf("lost separator comment %q: %s", comment, got)
					}
					if strings.Count(got, ",") != 1 {
						t.Fatalf("changed payload separator: %s", got)
					}
					if err := SameProgram(source, got); err != nil {
						t.Fatal(err)
					}
				})
			}
		}
	}
}
