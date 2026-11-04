package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const namedServiceClassFixTarget = "FuzzNamedServiceClassFix"
const namedServiceClassFixQuote = "the TypeScript type annotation supplies the exact Shape"
const namedServiceClassFixIdentityQuote = "This form adds no shape helper and no namespace"

const namedServiceClassFixAPIQuote = "the same exported names, each export's type identical to \x60tsc\x60's in both directions (a type-level check), and the same doc comment on each export, with one exception:"

func TestNamedServiceClassFixQuoted(t *testing.T) {
	for _, quote := range []string{namedServiceClassFixQuote, namedServiceClassFixIdentityQuote} {
		if !strings.Contains(SpecText("005-services.md"), quote) {
			t.Fatalf("VIP-9 whole-shape authority no longer says %q", quote)
		}
	}
	if !strings.Contains(SpecText("001-functions.md"), namedServiceClassFixAPIQuote) {
		t.Fatal("API identity authority changed")
	}
}

func FuzzNamedServiceClassFix(f *testing.F) {
	startShortBudget(f)
	keys := []string{"interface", "alias", "generic", "intersection", "union", "optional", "qualified", "function", "primitive", "query", "unknown", "empty"}
	for _, key := range keys {
		for _, variant := range []uint8{0, 1, 2, 3} {
			f.Add(key, variant)
		}
	}
	f.Add("alchemy-database-named-shape", uint8(0))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestNamedServiceClassFixQuoted(t)
		source := ""
		if key == "alchemy-database-named-shape" {
			bytes, err := os.ReadFile(filepath.Join("testdata", "named-service-class-fix", "alchemy-database-named-shape.vibe"))
			if err != nil {
				t.Fatal(err)
			}
			source = string(bytes)
		} else {
			if !slices.Contains(keys, key) {
				if key == "" {
					return
				}
				key = keys[int(key[0])%len(keys)]
			}
			variant %= 4
			alias := "Context"
			if variant&1 != 0 {
				alias = "Ctx"
			}
			head, shape := "", "Shape"
			switch key {
			case "interface":
				head = "interface Shape { readonly value: string }"
			case "alias":
				head = "type Shape = { readonly value: string }"
			case "generic":
				head = "type Shape<A> = { readonly value: A }"
				shape = "Shape<number>"
			case "intersection":
				head = "type A = { readonly a: string }; type B = { readonly b: number }"
				shape = "A & B"
			case "union":
				head = "type Shape = { readonly a: string } | { readonly b: number }"
			case "optional":
				head = "interface Shape { readonly value?: string; readonly nested: { readonly n: number } }"
			case "qualified":
				head = "namespace Types { export interface Shape { readonly value: string } }"
				shape = "Types.Shape"
			case "function":
				head = "type Shape = () => number"
			case "primitive":
				shape = "number"
			case "query":
				head = "declare const value: { readonly n: number }"
				shape = "typeof value"
				// Compare implementation types in both directions. Native TypeScript
				// inlines this private const's type; the written whole shape keeps
				// typeof value. The public API, not those private bytes, is the rule.
				head += "\ntype WholeEqual<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2) ? ((<T>()=>T extends B?1:2) extends (<T>()=>T extends A?1:2) ? true : false) : false\ntype WholeAssert<T extends true> = T\ntype WholeProof = WholeAssert<WholeEqual<" + alias + ".Service.Shape<typeof Database>, typeof value>>"

			case "unknown":
				shape = "unknown"
			case "empty":
				head = "type Shape = {}"
			}
			body := "{}"
			if variant&2 != 0 {
				body = "{ /* retain the class body */ }"
			}
			source = "import * as " + alias + " from \"effect/Context\"\n" + head + "\n/** Public database. */\nexport class Database extends " + alias + ".Service<Database, " + shape + ">()(\"alchemy/Database\") " + body + "\n"
		}
		label := fmt.Sprintf("%s/%d", key, variant)
		before, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if !toolsErrorFree(before) {
			Gap(t, namedServiceClassFixTarget, "source:"+label, "VIP-9: %s; valid class failed:\n%s", namedServiceClassFixQuote, source)
			return
		}
		config := toolsConfig(w, before.Dir)
		if config == nil || len(config.Errors) != 0 {
			t.Fatal("invalid fixture configuration")
		}
		fixed := vibelang.FixProject(t.Context(), w.fs, bundled.LibPath(), config)
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		rewritten := source
		for name, file := range fixed.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				rewritten = file.Text
			}
		}
		if len(fixed.Refused) != 0 || !strings.Contains(rewritten, "service Database:") || strings.Contains(rewritten, "class Database extends") {
			Gap(t, namedServiceClassFixTarget, "canonical:"+label, "VIP-9: %s; whole-shape fix missing or refused: %+v\n%s", namedServiceClassFixQuote, fixed.Refused, rewritten)
			return
		}
		after, err := w.Compile(t.Context(), Single(rewritten))
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, namedServiceClassFixTarget, "fixed:"+label, "VIP-9 whole-shape rewrite adds errors:\n%s", rewritten)
			return
		}
		beforeDeclaration, ok := before.Outputs["out/main.d.ts"]
		if !ok {
			t.Fatal("baseline emitted no declaration")
		}
		// Named-shape fixtures also keep the stronger byte check where expected.
		// Query shapes carry the type-level proof above and the official rewrite
		// API case below; private declaration serialization need not match.
		if strings.Contains(after.Outputs["out/main.d.ts"], "namespace Database") || strings.Contains(after.Outputs["out/main.d.ts"], "Database_shape") {
			Gap(t, namedServiceClassFixTarget, "namespace:"+label, "VIP-9: %s", namedServiceClassFixIdentityQuote)
		}
		if key != "query" && beforeDeclaration != after.Outputs["out/main.d.ts"] {
			Gap(t, namedServiceClassFixTarget, "declaration:"+label, "VIP-9: %s; before:\n%s\nafter:\n%s", namedServiceClassFixIdentityQuote, beforeDeclaration, after.Outputs["out/main.d.ts"])
		}
	})
}
