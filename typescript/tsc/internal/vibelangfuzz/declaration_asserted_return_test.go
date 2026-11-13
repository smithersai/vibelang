package vibelangfuzz

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

const assertedReturnQuote = "Declarations are API-identical to `tsc`'s for the Effect TypeScript twin"

func TestDeclarationAssertedReturnQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0027-declaration-output.md"), assertedReturnQuote) {
		t.Fatalf("VIP-27 no longer says %q", assertedReturnQuote)
	}
}

// An inferred return retains a source assertion's utility type and imported
// name. Both counterparts infer the return without a written annotation.
func FuzzDeclarationAssertedReturn(f *testing.F) {
	startShortBudget(f)
	keys := []string{"arrow", "function", "expression", "method"}
	for _, key := range keys {
		f.Add(key, byte(0))
		f.Add(key, byte(7))
	}
	w := NewWorkspace(f)
	tsc := StockTypeScript(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestDeclarationAssertedReturnQuoted(t)
		if !slices.Contains(keys, key) {
			key = keys[int(variant)%len(keys)]
		}
		reference, imported := "make", "import { create as make } from \"./schema.js\";"
		if variant&1 != 0 {
			reference, imported = "Schema.create", "import * as Schema from \"./schema.js\";"
		}
		typ := "ReturnType<typeof " + reference + "<\"schema\">>"
		if variant&2 != 0 {
			typ = "Readonly<" + typ + ">"
		}
		value := "compact(" + reference + "(\"schema\")) as " + typ
		source := func(annotation string) string {
			switch key {
			case "function":
				return "export function advertised()" + annotation + " { return " + value + " }"
			case "expression":
				return "export const advertised = function()" + annotation + " { return " + value + " }"
			case "method":
				return "export const service = { advertised()" + annotation + " { return " + value + " } }"
			default:
				return "export const advertised = ()" + annotation + " => " + value
			}
		}
		project := func(twin bool) Project {
			extension, annotation := "vibe", ""
			if twin {
				extension, annotation = "ts", ""
			}
			body := imported + "\nconst compact = (value: unknown): unknown => value;\n" + source(annotation) + "\n"
			if variant&4 != 0 {
				body = strings.ReplaceAll(body, "\n", "\r\n")
			}
			cfg, _ := json.Marshal(map[string]any{"compilerOptions": map[string]any{"target": "ES2022", "lib": []string{"esnext"}, "module": "NodeNext", "strict": true, "types": []string{}, "skipLibCheck": true, "declaration": true, "emitDeclarationOnly": true, "outDir": "out"}, "files": []string{"main." + extension}})
			return Project{Config: string(cfg), Files: map[string]string{
				"package.json":      servicesPackage,
				"main." + extension: body,
				"schema.ts":         "export interface Shape<T> { readonly kind: T }; export declare function create<T extends string>(value: T): Shape<T>",
			}}
		}
		native := stockDeclaration(t, w, tsc, project(true), "out/main.d.ts")
		if !strings.Contains(native, typ) {
			t.Fatalf("stock control lost %s: %s", typ, native)
		}
		got, err := w.Compile(t.Context(), project(false))
		if err != nil {
			t.Fatal(err)
		}
		defer got.Remove()
		if HasError(got.Diagnostics) {
			t.Fatalf("invalid asserted-return project: %v", SortedKeys(Keys(got.Dir, got.Diagnostics)))
		}
		if !strings.Contains(got.Outputs["out/main.d.ts"], typ) {
			Gap(t, "FuzzDeclarationAssertedReturn", key, "%s: variant %d lost %s\nstock:\n%s\nvibe:\n%s", assertedReturnQuote, variant, typ, native, got.Outputs["out/main.d.ts"])
		}
	})
}
