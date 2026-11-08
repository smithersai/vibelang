package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const namespaceSchemaErrorImportTarget = "FuzzNamespaceSchemaErrorImports"
const namespaceSchemaErrorDeclarationQuote = "Declaration output is API-identical to what `tsc` writes for the Effect TypeScript twin"

func namespaceSchemaErrorImportQuotes(tb testing.TB) {
	tb.Helper()
	if !strings.Contains(SpecText("001-functions.md"), namespaceSchemaErrorDeclarationQuote) {
		tb.Fatalf("import retention authority changed: %q", namespaceSchemaErrorDeclarationQuote)
	}
}

func TestNamespaceSchemaErrorImportsQuoted(t *testing.T) { namespaceSchemaErrorImportQuotes(t) }

// A schema error's sidecar writes Schema at every namespace depth, so the
// module's own Schema import is used wherever the declaration sits. The
// TypeScript twin is compiled first, as the comparison's control.
func FuzzNamespaceSchemaErrorImports(f *testing.F) {
	startShortBudget(f)
	namespaceSchemaErrorImportQuotes(f)
	scopes := []struct{ key, wrap, ref string }{
		{"top", "%s", "E"},
		{"namespace", "export namespace N {%s}", "N.E"},
		{"nested", "export namespace N {export namespace M {%s}}", "N.M.E"},
		{"dotted", "export namespace N.M {%s}", "N.M.E"},
	}
	var keys []string
	for _, scope := range scopes {
		keys = append(keys, scope.key)
		for variant := uint8(0); variant < 4; variant++ {
			f.Add(scope.key, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		scope := scopes[slices.Index(keys, key)]
		native := "export class E extends Schema.TaggedError<E>()(\"E\",{id:Schema.String}) {}"
		custom := "export schema error E {id:string}"
		if variant&1 != 0 {
			native = "export class E extends Schema.TaggedError<E>()(\"E\",{id:Schema.String,code:Schema.optional(Schema.Number)}) {}"
			custom = "export schema error E {id:string;code?:number}"
		}
		use := ";export const value=new " + scope.ref + "({id:\"x\"})"
		compile := func(body, file string) []string {
			source := "import * as Schema from \"effect/Schema\";" + fmt.Sprintf(scope.wrap, body) + use
			if variant&2 != 0 {
				source = "// retained trivia\r\n" + strings.ReplaceAll(source, ";", ";\r\n")
			}
			config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noUnusedLocals\":true,\"types\":[]},\"files\":[\"" + file + "\"]}"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var errors []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
				}
			}
			return errors
		}
		if errors := compile(native, "main.ts"); len(errors) != 0 {
			Gap(t, namespaceSchemaErrorImportTarget, "native:"+key, "native counterpart fails: %v", errors)
			return
		}
		if errors := compile(custom, "main.vibe"); len(errors) != 0 {
			Gap(t, namespaceSchemaErrorImportTarget, "custom:"+key, "%s: the Schema import of a schema error is used, but: %v", namespaceSchemaErrorDeclarationQuote, errors)
			return
		}
		ExpectPending(t, namespaceSchemaErrorImportTarget, "native:"+key)
		ExpectPending(t, namespaceSchemaErrorImportTarget, "custom:"+key)
		ExpectPending(t, namespaceSchemaErrorImportTarget, specCorpusKey(t))
	})
}
