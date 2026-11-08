package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

// VIP-44 follows the library type binding through an import alias. It does
// not expand arbitrary type aliases or infer a schema from a constructor.
func TestSchemaLibraryImportAliases(t *testing.T) {
	for _, name := range []string{"Date", "URL", "RegExp", "Uint8Array", "Error"} {
		for _, written := range []string{"Native", "Date", "Error"} {
			for _, field := range []string{"Native", "readonly Native[]", "ReadonlySet<Native>", "ReadonlyMap<Native, number>"} {
				field = strings.ReplaceAll(field, "Native", written)
				t.Run(fmt.Sprintf("%s/%s/%s", name, written, field), func(t *testing.T) {
					source := "import " + written + " = globalThis." + name + "; export schema Example { readonly value: " + field + " }"
					if ds := errorsOf(t, source); len(ds) != 0 {
						t.Fatalf("%v\n%s", ds, source)
					}
				})
			}
			t.Run(fmt.Sprintf("%s/%s/alias", name, written), func(t *testing.T) {
				source := "import " + written + " = globalThis." + name + "; export schema Example = " + written
				if ds := errorsOf(t, source); len(ds) != 0 {
					t.Fatalf("%v\n%s", ds, source)
				}
			})
		}
	}
}

func TestSchemaLibraryImportAliasControls(t *testing.T) {
	for _, source := range []string{
		"type Native = Date; export schema Example { readonly value: Native }",
		"class Native {} export schema Example { readonly value: Native }",
		"namespace User { export class Date {} } import Native = User.Date; export schema Example { readonly value: Native }",
	} {
		ds := errorsOf(t, source)
		if len(ds) != 1 || ds[0].Code() != EK2109.Code {
			t.Fatalf("want EK2109, got %v\n%s", ds, source)
		}
	}
	for _, source := range []string{
		"const Native = Schema.String; export schema Example { readonly value: Native }",
		"type Native = number; const Native = Schema.Number; export schema Example = Native",
	} {
		if ds := errorsOf(t, source); len(ds) != 0 {
			t.Fatalf("%v\n%s", ds, source)
		}
	}
}

func TestSchemaLibraryImportAliasNamespaces(t *testing.T) {
	for _, name := range []string{"Date", "URL", "RegExp", "Uint8Array", "Error"} {
		for _, home := range []string{"export schema Example { readonly value: Types.Native }", "export schema Example = Types.Native"} {
			source := "namespace Types { export import Native = globalThis." + name + " } " + home
			if ds := errorsOf(t, source); len(ds) != 0 {
				t.Fatalf("%v\n%s", ds, source)
			}
		}
	}
}
