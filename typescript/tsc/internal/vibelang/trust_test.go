package vibelang

import (
	"fmt"
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// TestForeignThrowsGateReplacesLegacyTrustWarning requires the bridge in
// effect code even when an old trust tag is present. The legacy warning's
// severity cannot suppress or promote the VIP-4 error; plain calls stay plain.
func TestForeignThrowsGateReplacesLegacyTrustWarning(t *testing.T) {
	t.Parallel()
	files := map[string]string{
		"/node_modules/effect/package.json": `{"name":"effect","types":"index.d.ts"}`,
		"/node_modules/effect/index.d.ts":   `export * as Effect from "./Effect"`,
		"/node_modules/effect/Effect.d.ts":  `export declare function sync<A>(thunk: () => A): A`,
		"/helpers.ts": `export class Bad extends Error {}
/** @vibelang trusted
 * @throws {Bad}
 */
export function parse(x: string): number { return Number(x) }
/** @vibelang trusted */
export const clean = (x: number) => x
export function plain() { return 1 }
export class Ports {
 /** @vibelang trusted
  * @throws {Bad}
  */
 offset(): number { return 1 }
}
`,
		"/main.vibe": `import { parse, clean, plain, Ports } from "./helpers"
import { Effect } from "effect"
const top = parse("1")
const callback = ["1"].map(text => parse(text))
export function boundary() { return Effect.sync(() => parse("boundary")) }
export effect function f() { return parse("2") + clean(3) }
export function g() { return JSON.parse("1") }
export effect function method(ports: Ports) { return ports.offset() }
export function mapped(values: ReadonlyArray<string>) {
  return values.map((v) => parse(v))
}
export function withoutThrows() { return clean(3) }
export function recovered(text: string): number {
  try { return parse(text) } catch { return 0 }
}
`,
		"/tsconfig.json": `{ "compilerOptions": { "strict": true }, "files": ["main.vibe", "helpers.ts"] }`,
	}
	for _, setting := range []struct {
		name     string
		category diagnostics.Category
	}{
		{"warning", diagnostics.CategoryWarning}, {"error", diagnostics.CategoryError},
	} {
		files["/tsconfig.json"] = fmt.Sprintf(`{"compilerOptions":{"strict":true,"vibelang":{"diagnostics":{"EK4406":%q}}},"files":["main.vibe","helpers.ts"]}`, setting.name)
		fs := bundled.WrapFS(vfstest.FromMap(fixtureRuntime(files), tspath.CaseInsensitive))
		parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatalf("tsconfig: %v", errors)
		}
		p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
		var positions []int
		for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile("/main.vibe")) {
			if d.Code() == EK4406.Code {
				t.Errorf("obsolete trust warning beside the required bridge: %v", d)
			}
			if d.Code() == EK0403.Code {
				if d.Category() != diagnostics.CategoryError {
					t.Errorf("bridge category = %v", d.Category())
				}
				text := p.GetSourceFile("/main.vibe").Text()
				allowed := []int{
					strings.Index(text, `parse("2")`),
					strings.Index(text, "ports.offset()"),
				}
				if d.Pos() != allowed[0] && d.Pos() != allowed[1] {
					t.Errorf("bridge diagnostic outside effect code at %d", d.Pos())
				}
				message := d.MessageText()
				if !strings.Contains(message, "Bad") || !strings.Contains(message, "Effect.try") {
					t.Errorf("bridge diagnostic omits contract or repair: %s", message)
				}
				positions = append(positions, d.Pos())
			}
		}
		if len(positions) != 2 {
			t.Fatalf("bridge errors at %v; want only the effect calls", positions)
		}
	}

}

// VIP-4 and VIP-30 retire package-name trust, including TypeScript workspace
// sources reached through paths. Matching names and globs remain untrusted.
func TestTrustedWorkspacePackageNames(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, patterns string
		want           int
	}{
		{"scope glob", `["@smthrs/*"]`, 1},
		{"exact name", `["@smthrs/keys"]`, 1},
		{"another scope", `["@other/*"]`, 1},
		{"prefix is not a match", `["@smthrs/key"]`, 1},
		{"no trust", `[]`, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := map[string]string{
				"/workspace/keys/package.json": `{"name":"@smthrs/keys"}`,
				"/workspace/keys/index.ts":     `export { key } from "../../foreign"`,
				"/foreign.ts":                  `export function key() { return 42 }`,
				"/main.vibe":                   `import { key } from "@smthrs/keys"; export effect function use() { return key() }`,
				"/tsconfig.json":               fmt.Sprintf(`{"compilerOptions":{"strict":true,"paths":{"@smthrs/keys":["./workspace/keys/index.ts"]},"vibelang":{"trustedPackages":%s}},"files":["main.vibe"]}`, test.patterns),
			}
			fs := bundled.WrapFS(vfstest.FromMap(fixtureRuntime(files), tspath.CaseSensitive))
			parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 || len(parsed.Errors) != 0 {
				t.Fatalf("config: %v / %v", errors, parsed.Errors)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile("/main.vibe")) {
				if d.Code() == EK0403.Code {
					count++
					if strings.Contains(notesOf(d), "trustedPackages") {
						t.Errorf("foreign-call advice recommends retired package trust: %s", notesOf(d))
					}
				} else if d.Category() == diagnostics.CategoryError && d.Code() != EK1011.Code { // the fixture installs no effect
					t.Errorf("unexpected diagnostic: %v", d)
				}
			}
			if count != test.want {
				t.Fatalf("EK0403 count = %d, want %d", count, test.want)
			}
		})
	}
}

// Nameless nested manifests cannot restore a retired package-trust exemption:
// both the factory and the returned object's foreign method retain boundaries.
func TestTrustedPackageNameSkipsNamelessManifests(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, patterns string
		want           int
	}{
		{"retired trust", `["zodlike"]`, 2},
		{"no trust", `[]`, 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := map[string]string{
				"/node_modules/zodlike/package.json":            `{"name":"zodlike","types":"index.d.ts"}`,
				"/node_modules/zodlike/index.d.ts":              `export * from "./v4/classic/schemas"`,
				"/node_modules/zodlike/v4/classic/package.json": `{"type":"module"}`,
				"/node_modules/zodlike/v4/classic/schemas.d.ts": `export interface Schema { safeParse(value: unknown): { success: boolean } }
export declare function make(): Schema`,
				"/main.vibe":     `import { make } from "zodlike"; export effect function use(value: unknown) { const schema = make(); return schema.safeParse(value).success }`,
				"/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"strict":true,"vibelang":{"trustedPackages":%s}},"files":["main.vibe"]}`, test.patterns),
			}
			fs := bundled.WrapFS(vfstest.FromMap(fixtureRuntime(files), tspath.CaseSensitive))
			parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 || len(parsed.Errors) != 0 {
				t.Fatalf("config: %v / %v", errors, parsed.Errors)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile("/main.vibe")) {
				if d.Code() == EK0403.Code {
					count++
					if strings.Contains(notesOf(d), "trustedPackages") {
						t.Errorf("foreign-call advice recommends retired package trust: %s", notesOf(d))
					}
				} else if d.Category() == diagnostics.CategoryError && d.Code() != EK1011.Code { // the fixture installs no effect
					t.Errorf("unexpected diagnostic: %v", d)
				}
			}
			if count != test.want {
				t.Fatalf("EK0403 count = %d, want %d", count, test.want)
			}
		})
	}
}

// A re-export through an Effect package grants no thrown-type contract:
// @effect/vitest re-exports vitest, and vitest's expect, assert and vi carry
// no @throws, so each call of one, and of a method of what one returned,
// throws unknown in effect code (VIP-4, amended 2026-11-02, clarified
// 2026-11-10). Only the pinned Effect packages in effectThrowsTable carry
// shipped contracts; an unpinned package such as @effect/vitest follows the
// plain external-package rule (no @throws means unknown), while a written
// @throws {never} keeps its contract.
func TestReexportedForeignCallsThrowUnknown(t *testing.T) {
	t.Parallel()
	const vitest = `export interface Assertion<T> { toBe(expected: T): void }
export interface Spy { mockRestore(): void }
export declare const expect: <T>(actual: T) => Assertion<T>
export declare const assert: { strictEqual<T>(actual: T, expected: T): void }
export declare const vi: { spyOn(target: object, name: string): Spy }
/** @throws {never} */
export declare function annotated(): void
`
	for _, test := range []struct {
		name, imports, reexport, body string
		want                          int
	}{
		{"expect and its matcher", `import { expect } from "@effect/vitest"`, `export * from "vitest"`, `expect(1).toBe(1)`, 2},
		{"assert member", `import { assert } from "@effect/vitest"`, `export * from "vitest"`, `assert.strictEqual(1, 1)`, 1},
		{"namespace import", `import * as V from "@effect/vitest"`, `export * from "vitest"`, `V.expect(1).toBe(1)`, 2},
		{"named re-export", `import { expect } from "@effect/vitest"`, `export { expect } from "vitest"`, `expect(1).toBe(1)`, 2},
		{"renamed re-export", `import { check } from "@effect/vitest"`, `export { expect as check } from "vitest"`, `check(1).toBe(1)`, 2},
		{"const held matcher", `import { expect } from "@effect/vitest"`, `export * from "vitest"`, `const e = expect(1); e.toBe(1)`, 2},
		{"chained spy", `import { vi } from "@effect/vitest"`, `export { vi } from "vitest"`, `vi.spyOn(target, "f").mockRestore()`, 2},
		{"spy held in a const", `import { vi } from "@effect/vitest"`, `export { vi } from "vitest"`, `const spy = vi.spyOn(target, "f"); spy.mockRestore()`, 2},
		{"spy held in a let", `import { vi } from "@effect/vitest"`, `export { vi } from "vitest"`, `let spy = vi.spyOn(target, "f"); spy.mockRestore()`, 2},
		{"written never contract", `import { annotated } from "@effect/vitest"`, `export * from "vitest"`, `annotated()`, 0},
		{"own declaration", `import { own } from "@effect/vitest"`, `export * from "vitest"; export declare function own(): void`, `own()`, 1},
		{"own declaration with never", `import { own } from "@effect/vitest"`, `export * from "vitest"
/** @throws {never} */
export declare function own(): void`, `own()`, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := map[string]string{
				"/node_modules/@effect/vitest/package.json": `{"name":"@effect/vitest","types":"index.d.ts"}`,
				"/node_modules/@effect/vitest/index.d.ts":   test.reexport,
				"/node_modules/vitest/package.json":         `{"name":"vitest","types":"index.d.ts"}`,
				"/node_modules/vitest/index.d.ts":           vitest,
				"/main.vibe":                                test.imports + `; const target = { f: (): number => 1 }; export effect function use() { ` + test.body + ` }`,
				"/tsconfig.json":                            `{"compilerOptions":{"strict":true},"files":["main.vibe"]}`,
			}
			fs := bundled.WrapFS(vfstest.FromMap(fixtureRuntime(files), tspath.CaseSensitive))
			parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 || len(parsed.Errors) != 0 {
				t.Fatalf("config: %v / %v", errors, parsed.Errors)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile("/main.vibe")) {
				if d.Code() == EK0403.Code {
					count++
				} else if d.Category() == diagnostics.CategoryError && d.Code() != EK1011.Code { // the fixture installs no effect
					t.Errorf("unexpected diagnostic: %v", d)
				}
			}
			if count != test.want {
				t.Fatalf("EK0403 count = %d, want %d", count, test.want)
			}
		})
	}
}

// EK0403's note suggests running the call through Effect.try (VIP-5), in
// statements that compile. The function Effect.try wraps is TypeScript, where
// a .vibe function's call is an Effect, so an operand that calls one is bound
// first to a const named after the callee's parameter, under a name the
// function does not use. Each suggestion, written in place of the call's
// statement, compiles without an error.
func TestForeignCallSuggestionCompiles(t *testing.T) {
	const prefix = "module util {\n" +
		"  export function shout(s: string): string { return s.toUpperCase() }\n" +
		"  export class Box {\n    /** @throws {never} */\n    constructor(readonly v: string) {}\n    show(prefix: string): string { return prefix + this.v } }\n" +
		"}\n" +
		"import { shout, Box } from util\n" +
		"effect function hello(name: string) { return `hello ${name}` }\n" +
		"effect function box() { return new Box(\"b\") }\n" +
		"export effect function main(s: string) {\n  return "
	suggestion := regexp.MustCompile(`Call it through (.*?\)\)), or `)
	for _, test := range []struct{ call, want string }{
		{`shout(try hello("VibeLang"))`, `const s2 = try hello("VibeLang"); try Effect.try(() => shout(s2))`},
		{`shout(s + (try hello(s)))`, `const s2 = s + (try hello(s)); try Effect.try(() => shout(s2))`},
		{`shout(s)`, `try Effect.try(() => shout(s))`},
		{`new Box(s).show(s)`, `try Effect.try(() => new Box(s).show(s))`},
		{`(try box()).show(s + (try hello(s)))`, `const box2 = try box(); const prefix = s + (try hello(s)); try Effect.try(() => box2.show(prefix))`},
		{`shout("hi")`, `try Effect.try(() => shout("hi"))`},
		{`(try box()).show(try hello(s))`, `const box2 = try box(); const prefix = try hello(s); try Effect.try(() => box2.show(prefix))`},
	} {
		t.Run(test.call, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, prefix+test.call+"\n}\n")
			got := ""
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK0403.Code {
					if m := suggestion.FindStringSubmatch(diagnosticWithNotes(d)); m != nil {
						got = m[1]
					}
				}
			}
			if got != test.want {
				t.Fatalf("EK0403 suggests %q, want %q", got, test.want)
			}
			// The suggestion is statements: the consts it binds, then the run.
			fixed, fixedFile, _, _ := editorProgram(t, strings.TrimSuffix(prefix, "return ")+got+"\n}\n")
			for _, d := range append(fixed.GetSyntacticDiagnostics(t.Context(), fixedFile), fixed.GetSemanticDiagnostics(t.Context(), fixedFile)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("the suggestion %s does not compile: %s", got, diagnosticWithNotes(d))
				}
			}
		})
	}
}

// VIP-4's foreign unknown default has the same diagnostic for every callable
// declaration shape. A written never contract must remain callable directly.
func TestForeignCallUnknownDiagnostic(t *testing.T) {
	const declarations = `export declare function plain(s: string): string
/** @throws {unknown} */
export declare function anything(s: string): string
/** @throws {never} */
export declare function safe(s: string): string
export declare const callable: (s: string) => string
export interface Reader { read(s: string): string }
export declare const reader: Reader
export declare class Client { read(s: string): string; field: (s: string) => string }
export declare const client: Client
export declare function overloaded(s: string): string
export declare function overloaded(n: number): number
export declare const property: { read: (s: string) => string }
`
	for _, extension := range []string{".ts", ".d.ts"} {
		t.Run(extension, func(t *testing.T) {
			files := map[string]string{
				"/lib" + extension: declarations,
				"/main.vibe": `import { plain, anything, safe, callable, reader, client, overloaded, property } from "./lib"
export effect function probe(s: string) {
  plain(s)
  anything(s)
  callable(s)
  reader.read(s)
  client.read(s)
  client.field(s)
  overloaded(s)
  overloaded(1)
  property.read(s)
  safe(s)
  return 0
}`,
				"/tsconfig.json": `{"compilerOptions":{"strict":true,"types":[]},"files":["main.vibe"]}`,
			}
			if got := untrustedCalls(t, files, "/tsconfig.json", "/main.vibe"); got[0] != 9 {
				t.Fatalf("unknown calls: %v; want nine EK0403 diagnostics and none for safe", got)
			}
		})
	}
}

// VIP-4: erased callable types retain an unknown thrown contract.
func TestForeignDynamicCallGate(t *testing.T) {
	for _, typ := range []string{"any", "Function"} {
		for _, shape := range []string{
			"export effect function probe(read: %s) { return read() }",
			"declare const read: %s; export effect function probe() { return read() }",
			"export effect function probe(read: %s) { return read?.() }",
		} {
			source := fmt.Sprintf(shape, typ)
			files := map[string]string{
				"/main.vibe":     source,
				"/tsconfig.json": `{"compilerOptions":{"strict":true,"types":[]},"files":["main.vibe"]}`,
			}
			if got := untrustedCalls(t, files, "/tsconfig.json", "/main.vibe"); got[0] != 1 {
				t.Errorf("%s: got %v; want one EK0403", source, got)
			}
		}
	}
}

// Invalid calls keep their native TypeScript diagnostic, without a bridge cascade.
func TestForeignDynamicCallNativeErrors(t *testing.T) {
	for _, tc := range []struct {
		source string
		code   int32
	}{
		{"export effect function probe() { return missing() }", 2304},
		{"export effect function probe(read: number) { return read() }", 2349},
		{"export effect function probe(read: unknown) { return read() }", 18046},
	} {
		p, file, _, _ := editorProgram(t, tc.source)
		ds := p.GetSemanticDiagnostics(t.Context(), file)
		if len(ds) != 1 || ds[0].Code() != tc.code {
			t.Errorf("native call diagnostic: %v; want only TS%d", ds, tc.code)
		}
	}
}

// Synthesized default constructor signatures return objects, not intrinsic types.
func TestForeignDynamicSignaturelessConstructor(t *testing.T) {
	for _, source := range []string{
		"class Item {} export effect function probe() { return new Item() }",
		"export effect function probe() { return new class { value = 1 }() }",
	} {
		p, file, _, _ := editorProgram(t, source)
		if ds := p.GetSemanticDiagnostics(t.Context(), file); len(ds) != 0 {
			t.Errorf("constructor: %v", ds)
		}
	}
}
