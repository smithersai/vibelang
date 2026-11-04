package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

const schemaWrittenTypeQuote = "One written, nongeneric `type X = typeof X.Type` in the same scope replaces the synthesized alias of `schema X`, in either order, each declaration keeping its own JSDoc and export status."

const schemaWrittenMutabilityQuote = "Mappings preserve TypeScript mutability: properties are writable unless `readonly`; arrays and tuples are mutable unless `readonly`."

func requireSchemaWrittenTypeQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("006-data.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{schemaWrittenTypeQuote, schemaWrittenMutabilityQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Errorf("chapter 006 is missing schema companion rule: %q", quote)
		}
	}
}

func TestSchemaWrittenTypeQuoted(t *testing.T) { requireSchemaWrittenTypeQuote(t) }

// The chapter's written constant/type pair is printed independently and checked
// by stock tsc. Raw bytes, including JSDoc, declaration order and visibility,
// are the oracle; no migration canonicalization removes those distinctions.
func FuzzSchemaWrittenType(f *testing.F) {
	startShortBudget(f)
	tsc := StockTypeScript(f)
	w := NewWorkspace(f)
	for _, mode := range []uint16{60, 63, 0, 255, 828, 1340, 2367, 4156, 8252, 24636, 24700, 24764, 24892} {
		f.Add("foldkit-documented-schema-type", mode)
	}
	f.Fuzz(func(t *testing.T, key string, mode uint16) {
		// A keyed placement can be replayed even if the list of seeds changes.
		if key != "foldkit-documented-schema-type" {
			key = "foldkit-documented-schema-type"
		}
		value, constant := "schema Message { readonly id: string }", "const Message = Schema.Struct({ id: Schema.String });"
		if mode&4096 != 0 {
			value, constant = "schema Message { id: string }", "const Message = Schema.Struct({ id: Schema.mutableKey(Schema.String) });"
		}
		if mode&1 != 0 {
			value, constant = "schema Message = string;", "const Message = Schema.String;"
		}
		if mode&16384 != 0 && mode&1 == 0 {
			value += ";"
		}
		alias := "type Message = typeof Message.Type;"
		if mode&4 != 0 {
			value, constant = "export "+value, "export "+constant
		}
		if mode&8 != 0 {
			alias = "export " + alias
		}
		valueDoc, typeDoc := "/** Value documentation. */\n", "/** Type documentation. */\n"
		if mode&1024 != 0 {
			valueDoc = "/** @internal Value documentation. */\n"
		}
		if mode&2048 != 0 {
			typeDoc = "/** @internal Type documentation. */\n"
		}
		if mode&8192 != 0 {
			valueDoc = strings.TrimSuffix(valueDoc, "\n") + " "
			typeDoc = strings.TrimSuffix(typeDoc, "\n") + " "
		}
		if mode&16 != 0 {
			value, constant = valueDoc+value, valueDoc+constant
		}
		if mode&32 != 0 {
			alias = typeDoc + alias
		}
		separator := "\n"
		if mode&8192 != 0 {
			separator = " "
		}
		if mode&512 != 0 {
			separator += "export declare const separator: 0;\n"
		}
		vibe, twin := value+separator+alias, constant+separator+alias
		if mode&2 != 0 {
			vibe, twin = alias+separator+value, alias+separator+constant
		}
		suffix := "\nexport declare const witness: Message;\n"
		vibe, twin = vibe+suffix, twin+suffix
		if mode&64 != 0 {
			vibe, twin = "export namespace Model {\n"+vibe+"}\n", "export namespace Model {\n"+twin+"}\n"
		}
		prefix := "import { Schema } from \"effect\";\n"
		vibe, twin = prefix+vibe, prefix+twin
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"emitDeclarationOnly":true,"outDir":"out","removeComments":%t,"stripInternal":%t}}`, mode&128 != 0, mode&256 != 0)
		result, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{"main.vibe": vibe}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		gapKey := fmt.Sprintf("%s:%d", key, mode&32767)
		if HasError(result.Diagnostics) {
			Gap(t, "FuzzSchemaWrittenType", gapKey, "written schema type rejected: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), vibe)
			return
		}
		want := stockDeclaration(t, w, tsc, Project{Config: config, Files: map[string]string{"main.ts": twin}}, "out/main.d.ts")
		got, exists := result.Outputs["out/main.d.ts"]
		if !exists || got != want {
			Gap(t, "FuzzSchemaWrittenType", gapKey, "mode %d\nsource:\n%s\ngot:\n%s\nstock tsc twin:\n%s", mode, vibe, got, want)
		}
		ExpectPending(t, "FuzzSchemaWrittenType", gapKey)
		if name := corpusFile(t, "FuzzSchemaWrittenType"); name != "" {
			ExpectPending(t, "FuzzSchemaWrittenType", "corpus:"+name)
		}
	})
}
