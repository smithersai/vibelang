package vibelang

import (
	"strings"
	"testing"
)

// VIP-15 and VIP-44 recursively map the arguments of library collections.
func TestSchemaNestedLibraryTypes(t *testing.T) {
	for _, field := range []string{
		"ReadonlyArray<ReadonlyMap<string, number>>", "Array<ReadonlyMap<string, Date>>",
		"ReadonlySet<Record<string, number>>", "ReadonlySet<ReadonlyMap<string, URL>>",
		"ReadonlyArray<(ReadonlyMap<string, number>)>", "ReadonlyMap<string, ReadonlySet<Date>>",
	} {
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

// Unsupported wrappers and shadowed names retain their binding checks.
func TestSchemaNestedLibraryTypesRejected(t *testing.T) {
	for _, test := range []struct{ source, note string }{
		{"export schema Order { readonly counts: ReadonlyArray<Map<string, number>> }\n", "Write ReadonlyMap"},
		{"export schema Order { readonly counts: Set<Record<string, number>> }\n", "Write ReadonlySet"},
		{"export schema Order { readonly counts: Readonly<ReadonlyMap<string, number>> }\n", "Readonly<T> maps only a Record"},
		{"export schema Order { readonly counts: Readonly<Map<string, number>> }\n", "Write ReadonlyMap"},
		{"type ReadonlyMap<K, V> = { k: K; v: V }\nexport schema Order { readonly counts: ReadonlyArray<ReadonlyMap<string, number>> }\n", ""},
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
