package vibelangmapper

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSchemaComputedKeyProjection(t *testing.T) {
	for _, row := range []struct{ name, head, key string }{
		{"number", "", "42"},
		{"string", "", "\"value\""},
		{"negative", "", "-42"},
		{"identifier", "const key = \"value\";", "key"},
		{"call", "function key(): string { return \"value\" };", "key()"},
		{"getter", "const keys = { get value(): string { return \"value\" } };", "keys.value"},
		{"element", "const keys = { value: \"value\" };", "keys[\"value\"]"},
		{"symbol", "", "Symbol.iterator"},
		{"parenthesized", "const key = \"value\";", "(key)"},
		{"comment", "const key = \"value\";", "/* key */ key"},
		{"template", "", "`value${1}`"},
		{"unicode", "", "\"λ\""},
		{"proto", "", "\"__proto__\""},
		{"collision", "const Schema = { value: \"value\" };", "Schema.value"},
	} {
		for _, lint := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/lint=%t", row.name, lint), func(t *testing.T) {
				source := row.head + " schema Count { readonly [" + row.key + "]: number }"
				ctx := testContext
				ctx.Lint = lint
				got := Project(source, ctx)
				if len(got.Diagnostics) != 0 {
					t.Fatalf("valid runtime key rejected: %+v\n%s", got.Diagnostics, got.Text)
				}
				if strings.Count(got.Text, "["+row.key+"]") != 1 {
					t.Fatalf("key changed or duplicated:\n%s", got.Text)
				}
				assertValidMap(t, got, source)
				assertParses(t, got.Text)
			})
		}
	}
}

func TestSchemaComputedNativeSuspension(t *testing.T) {
	for name, source := range map[string]string{
		"await": "async function* main() { schema Count { [await Promise.resolve(42)]: number }; yield Count }",
		"yield": "function* main() { schema Count { [yield 42]: number }; return Count }",
	} {
		t.Run(name, func(t *testing.T) {
			got := Project(source, testContext)
			if len(got.Diagnostics) != 0 {
				t.Fatalf("native generator key rejected: %+v\n%s", got.Diagnostics, got.Text)
			}
			assertValidMap(t, got, source)
			assertParses(t, got.Text)
		})
	}
}

func TestSchemaComputedVibeOperationsRequireCompiler(t *testing.T) {
	for name, source := range map[string]string{
		"try":               "import { Effect } from \"effect\"; effect function main() { schema Count { [try Effect.succeed(42)]: number }; return 0 }",
		"match":             "schema Count { [match (1) { when 1: 42; default: 0; }]: number }",
		"is":                "schema Count { [(1 is Number) ? \"value\" : \"other\"]: number }",
		"producer-yield":    "effect function* main() { schema Count { [(yield 42) as any]: number }; yield 0 }",
		"effect-arguments":  "effect function main() { schema Count { [arguments[0] as any]: number }; return 0 }",
		"effect-new-target": "effect function main() { schema Count { [new.target as any]: number }; return 0 }",
	} {
		t.Run(name, func(t *testing.T) {
			got := Project(source, testContext)
			found := false
			for _, d := range got.Diagnostics {
				if d.Code == CodeUnprojectedForm {
					found = true
				}
			}
			if !found {
				t.Fatalf("operation silently copied into the schema: %+v\n%s", got.Diagnostics, got.Text)
			}
		})
	}
}

func TestSchemaComputedKeyKeepsInvalidMemberDiagnostics(t *testing.T) {
	for _, source := range []string{
		"const key = \"run\"; schema Count { [key](): number }",
		"const key = \"value\"; schema Count { [key]: Partial<{ value: string }> }",
	} {
		got := Project(source, testContext)
		if len(got.Diagnostics) != 1 {
			t.Fatalf("lost field recovery diagnostic: %+v\n%s", got.Diagnostics, got.Text)
		}
		if got.Diagnostics[0].Code != 1505 && got.Diagnostics[0].Code != 2109 {
			t.Fatalf("unexpected field diagnostic: %+v", got.Diagnostics)
		}
		assertValidMap(t, got, source)
		assertParses(t, got.Text)
	}
}

func TestSchemaComputedNativeScopes(t *testing.T) {
	for name, source := range map[string]string{
		"effect-this":                 "effect function main(this: { key: string }) { schema Count { [this.key]: number }; return 0 }",
		"effect-this-arrow":           "effect function main(this: { key: string }) { schema Count { [(() => this.key)()]: number }; return 0 }",
		"effect-literal":              "effect function main() { schema Count { [42]: number }; return 0 }",
		"native-this":                 "class Holder { key = \"value\"; main(): number { schema Count { [this.key]: number }; return 0 } }",
		"native-arguments":            "function main(value: string): number { schema Count { [arguments[0] as string]: number }; return 0 }",
		"effect-import-meta":          "effect function main() { schema Count { [import.meta.url]: number }; return 0 }",
		"native-generator-in-effect":  "effect function main() { schema Count { [((function*() { yield \"value\" })().next().value) as string]: number }; return 0 }",
		"class-initializer-in-effect": "effect function main() { schema Count { [(class { static value = this.name }).value]: number }; return 0 }",
	} {
		t.Run(name, func(t *testing.T) {
			got := Project(source, testContext)
			if len(got.Diagnostics) != 0 {
				t.Fatalf("native context rejected: %+v\n%s", got.Diagnostics, got.Text)
			}
			assertValidMap(t, got, source)
			assertParses(t, got.Text)
		})
	}
}

func TestSchemaComputedVibeScopeBoundaries(t *testing.T) {
	for name, source := range map[string]string{
		"class-name-effect-this":    "effect function main(this: { key: string }) { schema Count { [(class { [this.key]() {} }) as any]: number }; return 0 }",
		"nested-producer-yield":     "effect function* main() { schema Count { readonly item: { [(yield 42) as any]: number } }; yield 0 }",
		"class-name-producer-yield": "effect function* main() { schema Count { [(class { [yield 42]() {} }) as any]: number }; yield 0 }",
		"effect-super":              "class Base { key = \"value\" } class Holder extends Base { effect main() { schema Count { [(() => super.key)()]: number }; return 0 } }",
	} {
		t.Run(name, func(t *testing.T) {
			got := Project(source, testContext)
			found := false
			for _, d := range got.Diagnostics {
				if d.Code == CodeUnprojectedForm {
					found = true
				}
			}
			if !found {
				t.Fatalf("Effect context silently copied: %+v\n%s", got.Diagnostics, got.Text)
			}
		})
	}
}

func TestSchemaComputedThisFrame(t *testing.T) {
	source := `import { Schema } from "effect"
export effect function scenario(this: { key: string }) {
 schema Count { [this.key]: number }
 return [Schema.is(Count)({ [this.key]: 7 }), Schema.is(Count)({ [this.key]: "wrong" })]
}`
	_, output, err := catchTagStock(t, source)
	if err != nil {
		t.Fatalf("native checking rejected the receiver: %v\n%s", err, output)
	}
	js, _, diagnostics := Emit(source, testContext)
	if len(diagnostics) != 0 {
		t.Fatalf("receiver diagnostics: %v\n%s", diagnostics, js)
	}
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(node, "--no-warnings", "--input-type=module")
	cmd.Dir = mapperTestScope(t, root)
	cmd.Stdin = strings.NewReader(js + "\nimport * as NativeEffect from 'effect/Effect'; console.log(JSON.stringify(await NativeEffect.runPromise(scenario.call({ key: 'value' }))));")
	result, err := cmd.CombinedOutput()
	if err != nil || strings.TrimSpace(string(result)) != "[true,false]" {
		t.Fatalf("receiver changed: %v\n%s\n%s", err, result, js)
	}
}
