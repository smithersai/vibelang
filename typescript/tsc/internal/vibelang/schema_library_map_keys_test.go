package vibelang

import "testing"

// VIP-44: ReadonlyMap<K, V> maps to Schema.ReadonlyMap(K, V), whose key is any
// schema. The checker checks the selected codec's call, not the visible Record
// candidate's, so a Date, collection, tuple or struct key is admitted.
func TestSchemaLibraryMapKeys(t *testing.T) {
	for _, field := range []string{
		"ReadonlyMap<Date, number>", "ReadonlyMap<ReadonlySet<string>, number>", "ReadonlyMap<ReadonlyArray<string>, number>",
		"ReadonlyMap<readonly string[], number>", "ReadonlyMap<readonly [string, number], number>", "ReadonlyMap<{ readonly k: string }, number>",
		"ReadonlyMap<URL, ReadonlySet<Date>>", "ReadonlyArray<ReadonlyMap<Date, number>>", "ReadonlySet<ReadonlyMap<readonly [string], number>>",
		"Record<string, ReadonlyMap<Date, number>>", "ReadonlyMap<ReadonlyMap<Date, string>, number>",
	} {
		for _, modifier := range []string{"readonly ", "", "readonly opt?: string; "} {
			source := "export schema Order { " + modifier + "at: " + field + " }\nexport schema Alias = " + field + "\n"
			if errors := errorsOf(t, source); len(errors) != 0 {
				for _, d := range errors {
					t.Errorf("TS%d %s\n%s", d.Code(), d.String(), source)
				}
			}
		}
	}
}

// A Record key keeps Effect's Schema.Record.Key constraint, as its twin does.
func TestSchemaLibraryRecordKeyConstraint(t *testing.T) {
	for _, field := range []string{"Record<Date, number>", "Readonly<Record<ReadonlySet<string>, number>>", "ReadonlyArray<Record<Date, number>>"} {
		source := "export schema Order { readonly at: " + field + " }\n"
		errors := errorsOf(t, source)
		if len(errors) != 1 || errors[0].Code() != 2345 {
			t.Errorf("want one TS2345, got %d errors\n%s", len(errors), source)
			for _, d := range errors {
				t.Logf("TS%d %s", d.Code(), d.String())
			}
		}
	}
}
