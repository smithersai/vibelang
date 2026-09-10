package compiler

import (
	"strings"
	"testing"
)

func TestPinnedForkAssetOutputDataGrammar(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	validator := backend.(AssetOutputValidator)
	key := strings.Repeat("a", 64)
	for _, tc := range []struct{ name, source, refusal string }{
		{"literals", `const x = { a: null, b: true, c: false, d: "text", e: 42, f: -1, g: +2 }; export default x;`, ""},
		{"ordered aliases", `const first = 1, next = first; export default [first, next];`, ""},
		{"type erasure", `const value = ((({ a: [1, "x"] } as const) satisfies unknown)!); export default value;`, ""},
		{"computed data names", `const value = { ["__proto__"]: 42, [1]: "one", 2: "two" }; export default value;`, ""},
		{"bytes", `export default new Uint8Array([0, 1, 255]);`, ""},
		{"hex and exponent bytes", `export default new Uint8Array([0xff, 0b11, 0o7, 1e2]);`, ""},
		{"side-effecting call", `const value = (() => 1)(); export default value;`, "executable expression"},
		{"computed access", `const value = [1]; export default value[0];`, "executable expression"},
		{"host reference", `export default process;`, "executable expression"},
		{"future binding", `const first = next; const next = 1; export default first;`, "executable expression"},
		{"duplicate binding", `const a = 1; const a = 2; export default a;`, "unique plain identifiers"},
		{"destructuring", `const { a } = { a: 1 }; export default a;`, "unique plain identifiers"},
		{"missing initializer", `const a: number; export default a;`, "initializers"},
		{"mutable binding", `let value = 1; export default value;`, "must be const"},
		{"var binding", `var value = 1; export default value;`, "must be const"},
		{"using binding", `using value = null; export default value;`, "must be const"},
		{"await using binding", `await using value = null; export default value;`, "must be const"},
		{"generator", `function* value() {} export default value;`, "executable statement"},
		{"class", `class Value {} export default Value;`, "executable statement"},
		{"named re-export", `const value = 1; export { value };`, "executable statement"},
		{"prototype mutation", `export default { "__proto__": { inherited: true } };`, "computed '__proto__'"},
		{"getter", `export default { get value() { return 1 } };`, "static data properties"},
		{"object method", `export default { value() { return 1 } };`, "static data properties"},
		{"object shorthand", `const value = 1; export default { value };`, "static data properties"},
		{"object spread", `const value = {}; export default { ...value };`, "static data properties"},
		{"computed property execution", `export default { [String(1)]: 1 };`, "static data properties"},
		{"array hole", `export default [1, , 2];`, "holes or spreads"},
		{"array spread", `const a = [1]; export default [...a];`, "holes or spreads"},
		{"template interpolation", "export default `hello ${1}`;", "executable expression"},
		{"byte allocation", `export default new Uint8Array(1000000000);`, "literal byte array"},
		{"negative byte", `export default new Uint8Array([-1]);`, "integer bytes"},
		{"fractional byte", `export default new Uint8Array([1.5]);`, "integer bytes"},
		{"large byte", `export default new Uint8Array([256]);`, "integer bytes"},
		{"spread byte", `const a = [1]; export default new Uint8Array([...a]);`, "integer bytes"},
		{"shadowed byte constructor", `const Uint8Array = 1; export default new Uint8Array([1]);`, "unique plain identifiers"},
		{"constructor type arguments", `export default new Uint8Array<never>([1]);`, "executable expression"},
		{"syntax", `const = ;`, "invalid TypeScript"},
		{"raw asset edge", `import x from "./raw.json"; export default x;`, "only import another generated asset module"},
		{"undeclared edge", `import x from "./` + strings.Repeat("b", 64) + `.ts"; export default x;`, "undeclared asset dependency"},
		{"namespace edge", `import * as x from "./` + key + `.ts"; export default x;`, "import namespace"},
		{"type-only edge", `import type x from "./` + key + `.ts"; export default 1;`, "runtime bindings"},
		{"named type-only edge", `import {type x} from "./` + key + `.ts"; export default 1;`, "runtime bindings"},
		{"attributed edge", `import x from "./` + key + `.ts" with {type:"json"}; export default x;`, "import attributes"},
		{"side-effect-only edge", `import "./` + key + `.ts"; export default 1;`, "runtime bindings"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := validator.ValidateAssetOutput(ctx, AssetOutputRequest{Source: tc.source, DeclaredLogicalKeys: []string{key}})
			if err != nil || got.OK != (tc.refusal == "") || (tc.refusal != "" && !strings.Contains(got.Message, tc.refusal)) || len(got.References) != 0 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	first, last := strings.Repeat("0", 64), strings.Repeat("f", 64)
	got, err := validator.ValidateAssetOutput(ctx, AssetOutputRequest{
		Source:              `import last from "./` + last + `.ts"; import { first } from "./` + first + `.ts"; import again from "./` + last + `.ts"; const data = { first: first, last: last, again: again }; export default data;`,
		DeclaredLogicalKeys: []string{last, first},
	})
	if err != nil || !got.OK || strings.Join(got.References, ",") != first+","+last {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}

func TestPinnedForkAssetOutputBudgets(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	validator := backend.(AssetOutputValidator)
	for _, tc := range []struct{ name, source, message string }{
		{"source", strings.Repeat(" ", 2*1024*1024+1), "exceeds 2097152 bytes"},
		{"nesting", "export default " + strings.Repeat("[", 514) + "1" + strings.Repeat("]", 514) + ";", "512-level nesting budget"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := validator.ValidateAssetOutput(ctx, AssetOutputRequest{Source: tc.source})
			if err != nil || got.OK || !strings.Contains(got.Message, tc.message) || len(got.References) != 0 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	for _, keys := range [][]string{{"bad"}, {strings.Repeat("a", 64), strings.Repeat("a", 64)}, {strings.Repeat("A", 64)}, make([]string, 1025)} {
		_, err := validator.ValidateAssetOutput(ctx, AssetOutputRequest{Source: "export default 1", DeclaredLogicalKeys: keys})
		if err == nil {
			t.Fatalf("accepted invalid dependency keys: %d", len(keys))
		}
	}
}
