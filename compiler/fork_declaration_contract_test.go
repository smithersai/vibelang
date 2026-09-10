package compiler

import (
	"strings"
	"testing"
)

// These declarations are intentionally the only representation of the library
// in the consumer Program. Its implementation cannot rescue a lost row.
const declarationContractHeader = `/** @vibelangModule {"version":2,"runtimes":[],"requirements":"__requirements"} */
import { Context } from "vibelang/context";
export declare abstract class C extends Context { abstract value(): number }
export type __requirements = { readonly "C": typeof C };
`

const declarationContractRow = `{"version":2,"failures":[],"requirements":["C"],"convention":"eager"}`

func TestPinnedForkPublishedCallableContracts(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, probe := range []struct {
		name, declaration, source, code, mentions string
	}{
		{
			name:        "a direct call charges the published requirement",
			declaration: "/** @vibelangEffects " + declarationContractRow + " */\nexport declare function read(): number;",
			source:      "import { read } from './library.mjs'; export const answer = read();",
			code:        "VIBE2102", mentions: "C",
		},
		{
			name:        "a provider satisfies the original nominal constructor",
			declaration: "/** @vibelangEffects " + declarationContractRow + " */\nexport declare function read(): number;",
			source:      "import { C, read } from './library.mjs'; import { Layer } from 'vibelang/provider'; export const answer = Layer.provide(Layer.succeed(C, { value: () => 7 }), () => read());",
		},
		{
			name:        "the declared function itself can be a provided callback",
			declaration: "/** @vibelangEffects " + declarationContractRow + " */\nexport declare function read(): number;",
			source:      "import { C, read } from './library.mjs'; import { Layer } from 'vibelang/provider'; export const answer = Layer.provide(Layer.succeed(C, { value: () => 7 }), read);",
		},
		{
			name:        "a same-spelled local constructor cannot satisfy the library",
			declaration: "/** @vibelangEffects " + declarationContractRow + " */\nexport declare function read(): number;",
			source:      "import { read } from './library.mjs'; import { Context } from 'vibelang/context'; import { Layer } from 'vibelang/provider'; abstract class C extends Context { abstract value(): number } export const answer = Layer.provide(Layer.succeed(C, { value: () => 7 }), () => read());",
			code:        "VIBE2101", mentions: "C",
		},
		{
			name:        "assignment cannot erase a published row",
			declaration: "/** @vibelangEffects " + declarationContractRow + " */\nexport declare function read(): number;",
			source:      "import { read } from './library.mjs'; const slot: () => number = read; export function main() { return slot() }",
			code:        "VIBE1808", mentions: "C",
		},
		{
			name:        "an inline returned callable carries its own row",
			declaration: "export declare function factory(): /** @vibelangEffects " + declarationContractRow + " */ () => number;",
			source:      "import { factory } from './library.mjs'; export const answer = factory()();",
			code:        "VIBE2102", mentions: "C",
		},
		{
			name:        "an inline method carries its own row",
			declaration: "export declare const api: { /** @vibelangEffects " + declarationContractRow + " */ read(): number };",
			source:      "import { api } from './library.mjs'; export const answer = api.read();",
			code:        "VIBE2102", mentions: "C",
		},
		{
			name:        "a missing nominal constructor table entry refuses",
			declaration: "/** @vibelangEffects " + strings.ReplaceAll(declarationContractRow, `"C"`, `"Missing"`) + " */\nexport declare function read(): number;",
			source:      "import { read } from './library.mjs'; export function main() { return read() }",
			code:        "VIBE1810", mentions: "nominal",
		},
		{
			name:        "a published constructor charges its requirement",
			declaration: "export declare class Needs { /** @vibelangEffects " + declarationContractRow + " */ constructor(); }",
			source:      "import { Needs } from './library.mjs'; export const answer = new Needs();",
			code:        "VIBE2102", mentions: "C",
		},
		{
			name:        "a published getter charges its requirement",
			declaration: "export declare const api: { /** @vibelangEffects " + declarationContractRow + " */ get value(): number };",
			source:      "import { api } from './library.mjs'; export const answer = api.value;",
			code:        "VIBE2102", mentions: "C",
		},
		{
			name:        "a published setter charges its requirement",
			declaration: "export declare const api: { /** @vibelangEffects " + declarationContractRow + " */ set value(value: number) };",
			source:      "import { api } from './library.mjs'; export const answer = (api.value = 7);",
			code:        "VIBE2102", mentions: "C",
		},
	} {
		t.Run(probe.name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{
					{Path: "main.vibe", Kind: FileKindVibeLang, Text: probe.source},
					{Path: "library.d.mts", Kind: FileKindTypeScript, Text: declarationContractHeader + probe.declaration},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			if probe.code == "" {
				if result.EmitSkipped || len(result.Diagnostics) != 0 {
					t.Fatalf("published contract refused: %v", ambientChargeMessages(result))
				}
			} else {
				requireCode(t, result, probe.code, probe.mentions)
				if !result.EmitSkipped || len(result.Artifacts) != 0 {
					t.Fatal("a refused contract emitted executable code")
				}
			}
		})
	}
}

func TestPinnedForkPublishedMetadataFailsClosed(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, probe := range []struct{ name, payload string }{
		{"unknown version", strings.ReplaceAll(declarationContractRow, `"version":2`, `"version":999`)},
		{"old version has no calling convention", `{"version":1,"failures":[],"requirements":["C"]}`},
		{"missing convention", `{"version":2,"failures":[],"requirements":["C"]}`},
		{"unknown convention", strings.ReplaceAll(declarationContractRow, `"eager"`, `"guess"`)},
		{"duplicate field", strings.ReplaceAll(declarationContractRow, `"version":2`, `"version":2,"version":2`)},
		{"unknown field", strings.ReplaceAll(declarationContractRow, `"version":2`, `"version":2,"extra":true`)},
		{"unsorted requirements", strings.ReplaceAll(declarationContractRow, `["C"]`, `["Random","Clock"]`)},
		{"duplicate requirement", strings.ReplaceAll(declarationContractRow, `["C"]`, `["C","C"]`)},
		{"non-string requirement", strings.ReplaceAll(declarationContractRow, `["C"]`, `[1]`)},
		{"noncanonical JSON", strings.ReplaceAll(declarationContractRow, `"version":2`, `"version": 2`)},
		{"malformed JSON", `{"version":2`},
	} {
		t.Run(probe.name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{
					{Path: "main.vibe", Kind: FileKindVibeLang, Text: "import { read } from './library.mjs'; export function main() { return read() }"},
					{Path: "library.d.mts", Kind: FileKindTypeScript, Text: declarationContractHeader + "/** @vibelangEffects " + probe.payload + " */\nexport declare function read(): number;"},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			requireCode(t, result, "VIBE1810", "published")
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("a refused contract emitted executable code")
			}
		})
	}
}

func TestPinnedForkPublishedEnvelopeAndSourceAuthority(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	read := "/** @vibelangEffects " + declarationContractRow + " */\nexport declare function read(): number;"
	for _, probe := range []struct{ name, library, source, mentions string }{
		{"duplicate callable tags", declarationContractHeader + "/** @vibelangEffects " + declarationContractRow + " */\n" + read, "", "exactly one"},
		{"missing module envelope", strings.TrimPrefix(declarationContractHeader, strings.SplitAfter(declarationContractHeader, "\n")[0]) + read, "", "versioned module"},
		{"duplicate module envelopes", strings.SplitAfter(declarationContractHeader, "\n")[0] + declarationContractHeader + read, "", "one canonical"},
		{"unsupported runtime ABI", strings.ReplaceAll(declarationContractHeader, `"runtimes":[]`, `"runtimes":["unlinked-runtime"]`) + read, "", "runtime ABI"},
		{"an invalid ambient entry is not an ambient fallback", strings.ReplaceAll(declarationContractHeader, `readonly "C": typeof C`, `readonly "Clock": number`) + strings.ReplaceAll(read, `["C"]`, `["Clock"]`), "", "nominal"},
		{"unsupported resumable ABI", declarationContractHeader + strings.ReplaceAll(read, `"eager"`, `"resumable"`), "", "resumable"},
		{"authored callable metadata", "", "/** @vibelangEffects " + declarationContractRow + " */\nexport function main() { return 1 }", "compiler-owned"},
		{"authored requirement table", "", "/** @vibelangRequirements */\nexport type Table = {};", "compiler-owned"},
		{"authored module metadata", "", "/** @vibelangModule {\"version\":2,\"runtimes\":[]} */\nexport function main() { return 1 }", "compiler-owned"},
		{"authored type bridge import", "", "import type { Result } from 'vibelang:declaration-types';", "compiler-owned"},
		{"authored type bridge reexport", "", "export { Context } from 'vibelang:declaration-types';", "compiler-owned"},
		{"authored type bridge import type", "", "export type R = import('vibelang:declaration-types').Result<number, never>;", "compiler-owned"},
		{"authored dynamic type bridge import", "", "export async function main() { return await import('vibelang:declaration-types') }", "compiler-owned"},
	} {
		t.Run(probe.name, func(t *testing.T) {
			source := probe.source
			if source == "" {
				source = "import { read } from './library.mjs'; export function main() { return read() }"
			}
			files := []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}
			if probe.library != "" {
				files = append(files, SourceFile{Path: "library.d.mts", Kind: FileKindTypeScript, Text: probe.library})
			}
			result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal, Files: files})
			if err != nil {
				t.Fatal(err)
			}
			requireCode(t, result, "VIBE1810", probe.mentions)
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("invalid declaration authority emitted code")
			}
		})
	}
}
