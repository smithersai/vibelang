package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

// VIP-15/21/18/19/20/14 and decided details 286-289. These expectations
// follow the named binding/container/assignability rules; the native controls
// check the bounded TypeScript operand domains independently of Vibe lowering.
type reviewContractCase struct {
	key, source, native, config string
	code                        int32
	nativeReject                bool
	extras                      map[string]string
}

func TestReviewBindingContractsQuoted(t *testing.T) {
	quotes := map[string]string{
		"006-data.md":     "A reference names a Schema value, not an expanded TypeScript type alias, interface, enum or class.",
		"002-running.md":  "a written return type incompatible with the producer's Stream result",
		"005-services.md": "A local declaration or import shadows one, as with any global.",
	}
	for chapter, quote := range quotes {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q; re-read the VIP and binding contract", chapter, quote)
		}
	}
}

func reviewContractCases(target string) []reviewContractCase {
	switch target {
	case "FuzzCollectionOperandDomain":
		return []reviewContractCase{
			{key: "all-any-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: any) { return try.all input; }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: any;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "all-any-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: any) { { return try.all input; } }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: any;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "all-never-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: never) { return try.all input; }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: never;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "all-never-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: never) { { return try.all input; } }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: never;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "all-unknown-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: unknown) { return try.all input; }\n", code: 1801, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: unknown;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "all-unknown-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: unknown) { { return try.all input; } }\n", code: 1801, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: unknown;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "all-exact-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: ReadonlyArray<Effect.Effect<number>>) { return try.all input; }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: ReadonlyArray<Effect.Effect<number>>;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "all-exact-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: ReadonlyArray<Effect.Effect<number>>) { { return try.all input; } }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: ReadonlyArray<Effect.Effect<number>>;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "all-optional-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: ReadonlyArray<Effect.Effect<number>> | undefined) { return try.all input; }\n", code: 1801, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: ReadonlyArray<Effect.Effect<number>> | undefined;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "all-optional-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: ReadonlyArray<Effect.Effect<number>> | undefined) { { return try.all input; } }\n", code: 1801, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: ReadonlyArray<Effect.Effect<number>> | undefined;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "all-alias-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ntype Input = ReadonlyArray<Effect.Effect<number>>;\nexport effect function probe(input: Input) { return try.all input; }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ntype Input = ReadonlyArray<Effect.Effect<number>>;\ndeclare const input: Input;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "all-alias-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ntype Input = ReadonlyArray<Effect.Effect<number>>;\nexport effect function probe(input: Input) { { return try.all input; } }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ntype Input = ReadonlyArray<Effect.Effect<number>>;\ndeclare const input: Input;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "all-number-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: number) { return try.all input; }\n", code: 1801, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: number;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "all-number-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: number) { { return try.all input; } }\n", code: 1801, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: number;\nconst check: ReadonlyArray<Effect.Effect<any, any, any>> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "concurrent-any-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: any) { for concurrent (const item of input) { } return 0; }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: any;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "concurrent-any-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: any) { { for concurrent (const item of input) { } return 0; } }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: any;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "concurrent-never-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: never) { for concurrent (const item of input) { } return 0; }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: never;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "concurrent-never-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: never) { { for concurrent (const item of input) { } return 0; } }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: never;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "concurrent-unknown-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: unknown) { for concurrent (const item of input) { } return 0; }\n", code: 1901, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: unknown;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "concurrent-unknown-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: unknown) { { for concurrent (const item of input) { } return 0; } }\n", code: 1901, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: unknown;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "concurrent-exact-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: ReadonlyArray<number>) { for concurrent (const item of input) { } return 0; }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: ReadonlyArray<number>;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "concurrent-exact-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: ReadonlyArray<number>) { { for concurrent (const item of input) { } return 0; } }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: ReadonlyArray<number>;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "concurrent-optional-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: ReadonlyArray<number> | undefined) { for concurrent (const item of input) { } return 0; }\n", code: 1901, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: ReadonlyArray<number> | undefined;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "concurrent-optional-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: ReadonlyArray<number> | undefined) { { for concurrent (const item of input) { } return 0; } }\n", code: 1901, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: ReadonlyArray<number> | undefined;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "concurrent-alias-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ntype Input = ReadonlyArray<number>;\nexport effect function probe(input: Input) { for concurrent (const item of input) { } return 0; }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ntype Input = ReadonlyArray<number>;\ndeclare const input: Input;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "concurrent-alias-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ntype Input = ReadonlyArray<number>;\nexport effect function probe(input: Input) { { for concurrent (const item of input) { } return 0; } }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ntype Input = ReadonlyArray<number>;\ndeclare const input: Input;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "concurrent-number-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: number) { for concurrent (const item of input) { } return 0; }\n", code: 1901, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: number;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "concurrent-number-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: number) { { for concurrent (const item of input) { } return 0; } }\n", code: 1901, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: number;\nconst check: Iterable<unknown> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "stream-any-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: any) { for try (const item of input) { } return 0; }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: any;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "stream-any-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: any) { { for try (const item of input) { } return 0; } }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: any;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "stream-never-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: never) { for try (const item of input) { } return 0; }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: never;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "stream-never-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: never) { { for try (const item of input) { } return 0; } }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: never;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "stream-unknown-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: unknown) { for try (const item of input) { } return 0; }\n", code: 2004, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: unknown;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "stream-unknown-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: unknown) { { for try (const item of input) { } return 0; } }\n", code: 2004, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: unknown;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "stream-exact-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: Stream.Stream<number>) { for try (const item of input) { } return 0; }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: Stream.Stream<number>;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "stream-exact-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: Stream.Stream<number>) { { for try (const item of input) { } return 0; } }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: Stream.Stream<number>;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "stream-optional-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: Stream.Stream<number> | undefined) { for try (const item of input) { } return 0; }\n", code: 2004, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: Stream.Stream<number> | undefined;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "stream-optional-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: Stream.Stream<number> | undefined) { { for try (const item of input) { } return 0; } }\n", code: 2004, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: Stream.Stream<number> | undefined;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "stream-alias-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ntype Input = Stream.Stream<number>;\nexport effect function probe(input: Input) { for try (const item of input) { } return 0; }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ntype Input = Stream.Stream<number>;\ndeclare const input: Input;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "stream-alias-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ntype Input = Stream.Stream<number>;\nexport effect function probe(input: Input) { { for try (const item of input) { } return 0; } }\n", code: 0, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ntype Input = Stream.Stream<number>;\ndeclare const input: Input;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "stream-number-direct", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: number) { for try (const item of input) { } return 0; }\n", code: 2004, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: number;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "stream-number-nested-block", source: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\nexport effect function probe(input: number) { { for try (const item of input) { } return 0; } }\n", code: 2004, native: "import * as Effect from \"effect/Effect\";\nimport * as Stream from \"effect/Stream\";\ndeclare const input: number;\nconst check: Stream.Stream<any, any, any> = input;\nexport {check};\n", nativeReject: true, config: "", extras: map[string]string{}},
		}
	case "FuzzEffectQualifierBinding":
		return []reviewContractCase{
			{key: "array-implicit", source: "export const value = Effect.Array.head([1, 2]);\n", code: 0, native: "import * as M from \"effect/Array\";\nexport const value = M.head([1, 2]);\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "array-root", source: "import { Effect } from \"effect\";\nexport const value = Effect.Array;\n", code: 2339, native: "import { Effect } from \"effect\";\nexport const value = Effect.Array;\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "array-subpath", source: "import * as Effect from \"effect/Effect\";\nexport const value = Effect.Array;\n", code: 2339, native: "import * as Effect from \"effect/Effect\";\nexport const value = Effect.Array;\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "array-renamed", source: "import { Effect as Fx } from \"effect\";\nexport const value = Fx.Array;\n", code: 2339, native: "import { Effect as Fx } from \"effect\";\nexport const value = Fx.Array;\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "array-local-member", source: "const Effect = { Array: { value: 1 } }; export const value = Effect.Array.value;\n", code: 0, native: "const Effect = { Array: { value: 1 } }; export const value = Effect.Array.value;\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "array-explicit-option-off", source: "import { Array as M } from \"effect\";\nexport const value = M.head([1, 2]);\n", code: 0, native: "import { Array as M } from \"effect\";\nexport const value = M.head([1, 2]);\n", nativeReject: false, config: "{\"compilerOptions\":{\"strict\":true,\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"skipLibCheck\":true,\"types\":[]},\"vibe\":{\"effectModules\":false}}", extras: map[string]string{}},
			{key: "string-implicit", source: "export const value = Effect.String.toUpperCase(\"x\");\n", code: 0, native: "import * as M from \"effect/String\";\nexport const value = M.toUpperCase(\"x\");\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "string-root", source: "import { Effect } from \"effect\";\nexport const value = Effect.String;\n", code: 2339, native: "import { Effect } from \"effect\";\nexport const value = Effect.String;\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "string-subpath", source: "import * as Effect from \"effect/Effect\";\nexport const value = Effect.String;\n", code: 2339, native: "import * as Effect from \"effect/Effect\";\nexport const value = Effect.String;\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "string-renamed", source: "import { Effect as Fx } from \"effect\";\nexport const value = Fx.String;\n", code: 2339, native: "import { Effect as Fx } from \"effect\";\nexport const value = Fx.String;\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "string-local-member", source: "const Effect = { String: { value: 1 } }; export const value = Effect.String.value;\n", code: 0, native: "const Effect = { String: { value: 1 } }; export const value = Effect.String.value;\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "string-explicit-option-off", source: "import { String as M } from \"effect\";\nexport const value = M.toUpperCase(\"x\");\n", code: 0, native: "import { String as M } from \"effect\";\nexport const value = M.toUpperCase(\"x\");\n", nativeReject: false, config: "{\"compilerOptions\":{\"strict\":true,\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"skipLibCheck\":true,\"types\":[]},\"vibe\":{\"effectModules\":false}}", extras: map[string]string{}},
			{key: "number-implicit", source: "export const value = Effect.Number.sum(1, 2);\n", code: 0, native: "import * as M from \"effect/Number\";\nexport const value = M.sum(1, 2);\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "number-root", source: "import { Effect } from \"effect\";\nexport const value = Effect.Number;\n", code: 2339, native: "import { Effect } from \"effect\";\nexport const value = Effect.Number;\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "number-subpath", source: "import * as Effect from \"effect/Effect\";\nexport const value = Effect.Number;\n", code: 2339, native: "import * as Effect from \"effect/Effect\";\nexport const value = Effect.Number;\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "number-renamed", source: "import { Effect as Fx } from \"effect\";\nexport const value = Fx.Number;\n", code: 2339, native: "import { Effect as Fx } from \"effect\";\nexport const value = Fx.Number;\n", nativeReject: true, config: "", extras: map[string]string{}},
			{key: "number-local-member", source: "const Effect = { Number: { value: 1 } }; export const value = Effect.Number.value;\n", code: 0, native: "const Effect = { Number: { value: 1 } }; export const value = Effect.Number.value;\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "number-explicit-option-off", source: "import { Number as M } from \"effect\";\nexport const value = M.sum(1, 2);\n", code: 0, native: "import { Number as M } from \"effect\";\nexport const value = M.sum(1, 2);\n", nativeReject: false, config: "{\"compilerOptions\":{\"strict\":true,\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"skipLibCheck\":true,\"types\":[]},\"vibe\":{\"effectModules\":false}}", extras: map[string]string{}},
		}
	case "FuzzProducerWrittenContract":
		return []reviewContractCase{
			{key: "inferred-export", source: "import * as Stream from \"effect/Stream\";\nexport effect function* values() { yield 1 }\n", code: 0, native: "import * as Stream from \"effect/Stream\";\nexport const values = (): Stream.Stream<number> => Stream.make(1);\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "inferred-nested", source: "import * as Stream from \"effect/Stream\";\nexport function factory() { effect function* values() { yield 1 }\nreturn values; }\n", code: 0, native: "import * as Stream from \"effect/Stream\";\nexport const values = (): Stream.Stream<number> => Stream.make(1);\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "stream-export", source: "import * as Stream from \"effect/Stream\";\nexport effect function* values(): Stream.Stream<number> { yield 1 }\n", code: 0, native: "import * as Stream from \"effect/Stream\";\nexport const values = (): Stream.Stream<number> => Stream.make(1);\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "stream-nested", source: "import * as Stream from \"effect/Stream\";\nexport function factory() { effect function* values(): Stream.Stream<number> { yield 1 }\nreturn values; }\n", code: 0, native: "import * as Stream from \"effect/Stream\";\nexport const values = (): Stream.Stream<number> => Stream.make(1);\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "alias-export", source: "import * as Stream from \"effect/Stream\";\ntype Numbers = Stream.Stream<number>;\nexport effect function* values(): Numbers { yield 1 }\n", code: 0, native: "import * as Stream from \"effect/Stream\";\ntype Numbers = Stream.Stream<number>;\nexport const values = (): Numbers => Stream.make(1);\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "alias-nested", source: "import * as Stream from \"effect/Stream\";\ntype Numbers = Stream.Stream<number>;\nexport function factory() { effect function* values(): Numbers { yield 1 }\nreturn values; }\n", code: 0, native: "import * as Stream from \"effect/Stream\";\ntype Numbers = Stream.Stream<number>;\nexport const values = (): Numbers => Stream.make(1);\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "normalized-union-export", source: "import * as Stream from \"effect/Stream\";\nexport effect function* values(): Stream.Stream<number> | never { yield 1 }\n", code: 0, native: "import * as Stream from \"effect/Stream\";\nexport const values = (): Stream.Stream<number> | never => Stream.make(1);\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "normalized-union-nested", source: "import * as Stream from \"effect/Stream\";\nexport function factory() { effect function* values(): Stream.Stream<number> | never { yield 1 }\nreturn values; }\n", code: 0, native: "import * as Stream from \"effect/Stream\";\nexport const values = (): Stream.Stream<number> | never => Stream.make(1);\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "channel-union-export", source: "import * as Stream from \"effect/Stream\";\nexport effect function* values(): Stream.Stream<number | string> { yield 1 }\n", code: 0, native: "import * as Stream from \"effect/Stream\";\nexport const values = (): Stream.Stream<number | string> => Stream.make(1);\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "channel-union-nested", source: "import * as Stream from \"effect/Stream\";\nexport function factory() { effect function* values(): Stream.Stream<number | string> { yield 1 }\nreturn values; }\n", code: 0, native: "import * as Stream from \"effect/Stream\";\nexport const values = (): Stream.Stream<number | string> => Stream.make(1);\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "any-export", source: "import * as Stream from \"effect/Stream\";\nexport effect function* values(): any { yield 1 }\n", code: 2102, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "any-nested", source: "import * as Stream from \"effect/Stream\";\nexport function factory() { effect function* values(): any { yield 1 }\nreturn values; }\n", code: 2102, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "unknown-export", source: "import * as Stream from \"effect/Stream\";\nexport effect function* values(): unknown { yield 1 }\n", code: 2102, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "unknown-nested", source: "import * as Stream from \"effect/Stream\";\nexport function factory() { effect function* values(): unknown { yield 1 }\nreturn values; }\n", code: 2102, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "never-export", source: "import * as Stream from \"effect/Stream\";\nexport effect function* values(): never { yield 1 }\n", code: 2102, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "never-nested", source: "import * as Stream from \"effect/Stream\";\nexport function factory() { effect function* values(): never { yield 1 }\nreturn values; }\n", code: 2102, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "optional-export", source: "import * as Stream from \"effect/Stream\";\nexport effect function* values(): Stream.Stream<number> | undefined { yield 1 }\n", code: 2102, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "optional-nested", source: "import * as Stream from \"effect/Stream\";\nexport function factory() { effect function* values(): Stream.Stream<number> | undefined { yield 1 }\nreturn values; }\n", code: 2102, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "alias-any-export", source: "import * as Stream from \"effect/Stream\";\ntype Erased = any;\nexport effect function* values(): Erased { yield 1 }\n", code: 2102, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "alias-any-nested", source: "import * as Stream from \"effect/Stream\";\ntype Erased = any;\nexport function factory() { effect function* values(): Erased { yield 1 }\nreturn values; }\n", code: 2102, native: "", nativeReject: false, config: "", extras: map[string]string{}},
		}
	case "FuzzSchemaMappedBinding":
		return []reviewContractCase{
			{key: "array-local", source: "export {};\ntype Array<T> = { value: T };\nschema S { item: Array<number> }\n", code: 2109, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "array-imported", source: "import type { Array } from \"./types.js\";\nschema S { item: Array<number> }\n", code: 2109, native: "", nativeReject: false, config: "", extras: map[string]string{"types.ts": "export type Array<T> = { value: T };\n"}},
			{key: "array-qualified", source: "import type * as Types from \"./types.js\";\nschema S { item: Types.Array<number> }\n", code: 2109, native: "", nativeReject: false, config: "", extras: map[string]string{"types.ts": "export type Array<T> = { value: T };\n"}},
			{key: "array-library", source: "export {};\nschema S { item: Array<number> }\n", code: 0, native: "import * as Schema from \"effect/Schema\";\nexport const S = Schema.Struct({ item: Schema.Array(Schema.Number) });\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "array-value-shadow", source: "export {}; const Array = 1;\nschema S { item: Array<number> }\n", code: 0, native: "import * as Schema from \"effect/Schema\";\nexport const S = Schema.Struct({ item: Schema.Array(Schema.Number) });\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "readonlyarray-local", source: "export {};\ntype ReadonlyArray<T> = { value: T };\nschema S { item: ReadonlyArray<number> }\n", code: 2109, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "readonlyarray-imported", source: "import type { ReadonlyArray } from \"./types.js\";\nschema S { item: ReadonlyArray<number> }\n", code: 2109, native: "", nativeReject: false, config: "", extras: map[string]string{"types.ts": "export type ReadonlyArray<T> = { value: T };\n"}},
			{key: "readonlyarray-qualified", source: "import type * as Types from \"./types.js\";\nschema S { item: Types.ReadonlyArray<number> }\n", code: 2109, native: "", nativeReject: false, config: "", extras: map[string]string{"types.ts": "export type ReadonlyArray<T> = { value: T };\n"}},
			{key: "readonlyarray-library", source: "export {};\nschema S { item: ReadonlyArray<number> }\n", code: 0, native: "import * as Schema from \"effect/Schema\";\nexport const S = Schema.Struct({ item: Schema.Array(Schema.Number) });\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "readonlyarray-value-shadow", source: "export {}; const ReadonlyArray = 1;\nschema S { item: ReadonlyArray<number> }\n", code: 0, native: "import * as Schema from \"effect/Schema\";\nexport const S = Schema.Struct({ item: Schema.Array(Schema.Number) });\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "record-local", source: "export {};\ntype Record<K, V> = { key: K; value: V };\nschema S { item: Record<string, number> }\n", code: 2109, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "record-imported", source: "import type { Record } from \"./types.js\";\nschema S { item: Record<string, number> }\n", code: 2109, native: "", nativeReject: false, config: "", extras: map[string]string{"types.ts": "export type Record<K, V> = { key: K; value: V };\n"}},
			{key: "record-qualified", source: "import type * as Types from \"./types.js\";\nschema S { item: Types.Record<string, number> }\n", code: 2109, native: "", nativeReject: false, config: "", extras: map[string]string{"types.ts": "export type Record<K, V> = { key: K; value: V };\n"}},
			{key: "record-library", source: "export {};\nschema S { item: Record<string, number> }\n", code: 0, native: "import * as Schema from \"effect/Schema\";\nexport const S = Schema.Struct({ item: Schema.Record(Schema.String, Schema.Number) });\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "record-value-shadow", source: "export {}; const Record = 1;\nschema S { item: Record<string, number> }\n", code: 0, native: "import * as Schema from \"effect/Schema\";\nexport const S = Schema.Struct({ item: Schema.Record(Schema.String, Schema.Number) });\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "readonly-local", source: "export {};\ntype Readonly<T> = { wrapped: T };\nschema S { item: Readonly<Record<string, number>> }\n", code: 2109, native: "", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "readonly-imported", source: "import type { Readonly } from \"./types.js\";\nschema S { item: Readonly<Record<string, number>> }\n", code: 2109, native: "", nativeReject: false, config: "", extras: map[string]string{"types.ts": "export type Readonly<T> = { wrapped: T };\n"}},
			{key: "readonly-qualified", source: "import type * as Types from \"./types.js\";\nschema S { item: Types.Readonly<Record<string, number>> }\n", code: 2109, native: "", nativeReject: false, config: "", extras: map[string]string{"types.ts": "export type Readonly<T> = { wrapped: T };\n"}},
			{key: "readonly-library", source: "export {};\nschema S { item: Readonly<Record<string, number>> }\n", code: 0, native: "import * as Schema from \"effect/Schema\";\nexport const S = Schema.Struct({ item: Schema.Record(Schema.String, Schema.Number) });\n", nativeReject: false, config: "", extras: map[string]string{}},
			{key: "readonly-value-shadow", source: "export {}; const Readonly = 1;\nschema S { item: Readonly<Record<string, number>> }\n", code: 0, native: "import * as Schema from \"effect/Schema\";\nexport const S = Schema.Struct({ item: Schema.Record(Schema.String, Schema.Number) });\n", nativeReject: false, config: "", extras: map[string]string{}},
		}
	}
	panic("unknown review contract target: " + target)
}

func fuzzReviewContract(f *testing.F, target string) {
	rows := reviewContractCases(target)
	for _, row := range rows {
		f.Add(row.key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestReviewBindingContractsQuoted(t)
		index := slices.IndexFunc(rows, func(row reviewContractCase) bool { return row.key == key })
		if index < 0 {
			if len(key) == 0 {
				return
			}
			index = int(key[0]) % len(rows)
		}
		row := rows[index]
		compile := func(file, source string) *Result {
			files := map[string]string{file: source, "package.json": "{\"type\":\"module\"}"}
			for name, text := range row.extras {
				files[name] = text
			}
			var result *Result
			var err error
			within(t, "check reviewed binding contract", func() {
				result, err = w.Compile(t.Context(), Project{Files: files, Config: row.config})
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(result.Remove)
			return result
		}
		if row.native != "" {
			control := compile("main.ts", row.native)
			if HasError(control.Diagnostics) != row.nativeReject {
				t.Fatalf("invalid native control for %s: reject=%t diagnostics=%v\n%s",
					row.key, row.nativeReject, SortedKeys(Keys(control.Dir, control.Diagnostics)), row.native)
			}
			if row.nativeReject {
				want := int32(2322) // Assignment to the explicitly named operand domain.
				if row.code == 2339 {
					want = 2339
				} // Ordinary namespace member lookup.
				for _, diag := range control.Diagnostics {
					if diag.Category() == diagnostics.CategoryError &&
						(cmp(diag.Source(), "TS") != "TS" || diag.Code() != want) {
						t.Fatalf("native control %s rejected for an unrelated reason, want TS%d: %v",
							row.key, want, SortedKeys(Keys(control.Dir, control.Diagnostics)))
					}
				}
			}
		}
		result := compile("main.vibe", row.source)
		matched := false
		source := "EK"
		if row.code == 2339 {
			source = "TS"
		}
		for _, diag := range result.Diagnostics {
			if diag.Category() == diagnostics.CategoryError && cmp(diag.Source(), "TS") == source && diag.Code() == row.code {
				matched = true
			}
		}
		broken := row.code == 0 && HasError(result.Diagnostics) || row.code != 0 && !matched
		gaps := &Gaps{Target: target, Input: row.source}
		if broken {
			gaps.Add(row.key, "VIP binding/container contract wants %s%d (0 means no error), got %v\n%s",
				source, row.code, SortedKeys(Keys(result.Dir, result.Diagnostics)), row.source)
		} else {
			ExpectPending(t, target, row.key)
		}
		gaps.FinishInput(t, specCorpusKey(t))
	})
}
func FuzzCollectionOperandDomain(f *testing.F) {
	startShortBudget(f)
	fuzzReviewContract(f, "FuzzCollectionOperandDomain")
}
func FuzzEffectQualifierBinding(f *testing.F) {
	// Spec rule: docs/design/src/005-services.md#22506de5cba441ad
	// Chapter 005: implicit collision qualifiers, explicit Effect imports, aliases, local bindings and disabled mode (FuzzEffectQualifierBinding).

	// Spec rule: docs/design/src/005-services.md#58d48c3ed3c2a1f5
	// Chapter 005: implicit collision qualifiers, explicit Effect imports, aliases, local bindings and disabled mode (FuzzEffectQualifierBinding).

	// Spec rule: docs/design/src/005-services.md#8db38a56e912a92a
	// Chapter 005: implicit collision qualifiers, explicit Effect imports, aliases, local bindings and disabled mode (FuzzEffectQualifierBinding).

	// Spec rule: docs/design/src/005-services.md#9ec3a580e5a86654
	// Chapter 005: implicit collision qualifiers, explicit Effect imports, aliases, local bindings and disabled mode (FuzzEffectQualifierBinding).

	// Spec rule: docs/design/src/005-services.md#110a22c985f232cd
	// Chapter 005: implicit collision qualifiers, explicit Effect imports, aliases, local bindings and disabled mode (FuzzEffectQualifierBinding).

	// Spec rule: docs/design/src/005-services.md#504be02c19e42f12
	// Chapter 005: implicit collision qualifiers, explicit Effect imports, aliases, local bindings and disabled mode (FuzzEffectQualifierBinding).

	// Spec rule: docs/design/src/005-services.md#c624b110bd90860e
	// Chapter 005: implicit collision qualifiers, explicit Effect imports, aliases, local bindings and disabled mode (FuzzEffectQualifierBinding).

	// Spec rule: docs/design/src/005-services.md#92d8a5059f33ee1e
	// Chapter 005: implicit collision qualifiers, explicit Effect imports, aliases, local bindings and disabled mode (FuzzEffectQualifierBinding).

	startShortBudget(f)
	fuzzReviewContract(f, "FuzzEffectQualifierBinding")
}
func FuzzProducerWrittenContract(f *testing.F) {
	startShortBudget(f)
	fuzzReviewContract(f, "FuzzProducerWrittenContract")
}
func FuzzSchemaMappedBinding(f *testing.F) {
	startShortBudget(f)
	fuzzReviewContract(f, "FuzzSchemaMappedBinding")
}
