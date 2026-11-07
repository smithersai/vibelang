package vibelang

import (
	"strings"
	"testing"
)

// VIP-44: a schema field whose type is the TypeScript library's Date, URL,
// RegExp, Uint8Array, ReadonlySet<T> or ReadonlyMap<K, V> has a Schema.
func TestSchemaLibraryTypes(t *testing.T) {
	for _, field := range []string{"Date", "URL", "RegExp", "Uint8Array", "ReadonlySet<string>", "ReadonlyMap<string, number>", "Date | null", "Date[]", "readonly ReadonlySet<Date>[]", "[Date, URL]"} {
		for _, modifier := range []string{"readonly ", "", "readonly opt?: string; readonly "} {
			source := "export schema Order { " + modifier + "at: " + field + " }\nexport schema Alias = " + field + "\n"
			if errors := errorsOf(t, source); len(errors) != 0 {
				for _, d := range errors {
					t.Errorf("TS%d %s\n%s", d.Code(), d.String(), source)
				}
			}
		}
	}
}

// A shadowing type declaration supplies no Schema, and the mutable Set and
// Map keep EK2109 with a note that names the read-only form.
func TestSchemaLibraryTypesRejected(t *testing.T) {
	for _, test := range []struct{ source, note string }{
		{"type Date = { iso: string }\nexport schema Order { readonly at: Date }\n", ""},
		{"export schema Order { readonly tags: Set<string> }\n", "Write ReadonlySet"},
		{"export schema Order { readonly counts: Map<string, number> }\n", "Write ReadonlyMap"},
	} {
		errors := errorsOf(t, test.source)
		if len(errors) != 1 || errors[0].Code() != 2109 {
			t.Errorf("want one EK2109, got %d errors\n%s", len(errors), test.source)
			continue
		}
		if test.note != "" && !strings.Contains(notesOf(errors[0]), test.note) {
			t.Errorf("note %q missing from %q\n%s", test.note, notesOf(errors[0]), test.source)
		}
	}
}
