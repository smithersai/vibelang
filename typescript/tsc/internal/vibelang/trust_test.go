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

// TestTrustedMigrationWarnsAtChangedCalls keeps calls whose lowering does not
// use a failure contract quiet, including plain-contract calls (D263).
func TestTrustedMigrationWarnsAtChangedCalls(t *testing.T) {
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
export function f() { return parse("2") + clean(3) }
export function g() { return JSON.parse("1") }
export function method(ports: Ports) { return ports.offset() }
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
		fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
		parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatalf("tsconfig: %v", errors)
		}
		p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
		var positions []int
		for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile("/main.vibe")) {
			if d.Code() == EK4406.Code {
				if d.Category() != setting.category {
					t.Errorf("migration category = %v", d.Category())
				}
				text := p.GetSourceFile("/main.vibe").Text()
				allowed := []int{
					strings.Index(text, `parse("2")`),
					strings.Index(text, "ports.offset()"),
				}
				if d.Pos() != allowed[0] && d.Pos() != allowed[1] {
					t.Errorf("migration diagnostic for a call whose lowering does not use the tag at %d", d.Pos())
				}
				message := d.MessageText()
				if strings.Contains(text[d.Pos():d.End()], "offset") {
					if !strings.Contains(message, "Ports.offset") || !strings.Contains(message, "write an adapter") || !strings.Contains(message, "[Bad]") {
						t.Errorf("method migration message: %s", message)
					}
				} else if strings.Contains(message, "[Errors]") {
					t.Errorf("missing concrete contract: %s", message)
				}
				positions = append(positions, d.Pos())
			}
		}
		if len(positions) != 2 {
			t.Fatalf("migration warnings at %v; want only the Effect calls whose tags affect emit", positions)
		}
	}

}

// D261 grants trust by package.json name, including TypeScript workspace
// sources reached through paths, and preserves the boundary without a match.
func TestTrustedWorkspacePackageNames(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, patterns string
		want           int
	}{
		{"scope glob", `["@smthrs/*"]`, 0},
		{"exact name", `["@smthrs/keys"]`, 0},
		{"another scope", `["@other/*"]`, 1},
		{"prefix is not a match", `["@smthrs/key"]`, 1},
		{"no trust", `[]`, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := map[string]string{
				"/workspace/keys/package.json": `{"name":"@smthrs/keys"}`,
				"/workspace/keys/index.ts":     `export { key } from "../../foreign"`,
				"/foreign.ts":                  `export function key() { return 42 }`,
				"/main.vibe":                   `import { key } from "@smthrs/keys"; export function use() { return key() }`,
				"/tsconfig.json":               fmt.Sprintf(`{"compilerOptions":{"strict":true,"paths":{"@smthrs/keys":["./workspace/keys/index.ts"]},"vibelang":{"trustedPackages":%s}},"files":["main.vibe"]}`, test.patterns),
			}
			fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
			parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 || len(parsed.Errors) != 0 {
				t.Fatalf("config: %v / %v", errors, parsed.Errors)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile("/main.vibe")) {
				if d.Code() == EK4401.Code {
					count++
				} else if d.Category() == diagnostics.CategoryError && d.Code() != EK1011.Code { // the fixture installs no effect
					t.Errorf("unexpected diagnostic: %v", d)
				}
			}
			if count != test.want {
				t.Fatalf("EK4401 count = %d, want %d", count, test.want)
			}
		})
	}
}

// A package.json without a name, which only sets "type" for a subdirectory as
// zod's v4/classic does, does not end its package: a method declared under it
// keeps the package's D261 trust.
func TestTrustedPackageNameSkipsNamelessManifests(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, patterns string
		want           int
	}{
		{"trusted", `["zodlike"]`, 0},
		{"no trust", `[]`, 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := map[string]string{
				"/node_modules/zodlike/package.json":            `{"name":"zodlike","types":"index.d.ts"}`,
				"/node_modules/zodlike/index.d.ts":              `export * from "./v4/classic/schemas"`,
				"/node_modules/zodlike/v4/classic/package.json": `{"type":"module"}`,
				"/node_modules/zodlike/v4/classic/schemas.d.ts": `export interface Schema { safeParse(value: unknown): { success: boolean } }
export declare function make(): Schema`,
				"/main.vibe":     `import { make } from "zodlike"; export function use(value: unknown) { const schema = make(); return schema.safeParse(value).success }`,
				"/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"strict":true,"vibelang":{"trustedPackages":%s}},"files":["main.vibe"]}`, test.patterns),
			}
			fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
			parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 || len(parsed.Errors) != 0 {
				t.Fatalf("config: %v / %v", errors, parsed.Errors)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile("/main.vibe")) {
				if d.Code() == EK4401.Code {
					count++
				} else if d.Category() == diagnostics.CategoryError && d.Code() != EK1011.Code { // the fixture installs no effect
					t.Errorf("unexpected diagnostic: %v", d)
				}
			}
			if count != test.want {
				t.Fatalf("EK4401 count = %d, want %d", count, test.want)
			}
		})
	}
}

// D22 trusts the values that a trusted call returns, so a method of the spy
// that @effect/vitest's vi.spyOn returns is trusted whether the call is chained
// or its value is held in a const. A let can be reassigned, so it is not.
func TestTrustedValueHeldInConst(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, body string
		want       int
	}{
		{"chained", `vi.spyOn(target, "f").mockRestore()`, 0},
		{"held in a const", `const spy = vi.spyOn(target, "f"); spy.mockRestore()`, 0},
		{"held in a let", `let spy = vi.spyOn(target, "f"); spy.mockRestore()`, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := map[string]string{
				"/node_modules/@effect/vitest/package.json": `{"name":"@effect/vitest","types":"index.d.ts"}`,
				"/node_modules/@effect/vitest/index.d.ts":   `export { vi } from "vitest"`,
				"/node_modules/vitest/package.json":         `{"name":"vitest","types":"index.d.ts"}`,
				"/node_modules/vitest/index.d.ts": `export interface Spy { mockRestore(): void }
export declare const vi: { spyOn(target: object, name: string): Spy }`,
				"/main.vibe":     `import { vi } from "@effect/vitest"; const target = { f: (): number => 1 }; export function use() { ` + test.body + ` }`,
				"/tsconfig.json": `{"compilerOptions":{"strict":true},"files":["main.vibe"]}`,
			}
			fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
			parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 || len(parsed.Errors) != 0 {
				t.Fatalf("config: %v / %v", errors, parsed.Errors)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile("/main.vibe")) {
				if d.Code() == EK4401.Code {
					count++
				} else if d.Category() == diagnostics.CategoryError && d.Code() != EK1011.Code { // the fixture installs no effect
					t.Errorf("unexpected diagnostic: %v", d)
				}
			}
			if count != test.want {
				t.Fatalf("EK4401 count = %d, want %d", count, test.want)
			}
		})
	}
}

// EK4401's note suggests running the call through Effect.try (VIP-5), in
// statements that compile. The function Effect.try wraps is TypeScript, where
// a .vibe function's call is an Effect, so an operand that calls one is bound
// first to a const named after the callee's parameter, under a name the
// function does not use. Each suggestion, written in place of the call's
// statement, compiles without an error.
func TestEK4401SuggestionCompiles(t *testing.T) {
	const prefix = "module util {\n" +
		"  export function shout(s: string): string { return s.toUpperCase() }\n" +
		"  export class Box { constructor(readonly v: string) {} show(prefix: string): string { return prefix + this.v } }\n" +
		"}\n" +
		"import { shout, Box } from util\n" +
		"function hello(name: string) { return `hello ${name}` }\n" +
		"function box() { return new Box(\"b\") }\n" +
		"export function main(s: string) {\n  return "
	suggestion := regexp.MustCompile(`Call it through (.*?\)\)), or `)
	for _, test := range []struct{ call, want string }{
		{`shout(hello("VibeLang"))`, `const s2 = try hello("VibeLang"); try Effect.try(() => shout(s2))`},
		{`shout(s + hello(s))`, `const s2 = s + hello(s); try Effect.try(() => shout(s2))`},
		{`shout(s)`, `try Effect.try(() => shout(s))`},
		{`new Box(s).show(s)`, `try Effect.try(() => new Box(s).show(s))`},
		{`box().show(s + hello(s))`, `const box2 = try box(); const prefix = s + hello(s); try Effect.try(() => box2.show(prefix))`},
		{`shout("hi")`, `try Effect.try(() => shout("hi"))`},
		{`box().show(hello(s))`, `const box2 = try box(); const prefix = try hello(s); try Effect.try(() => box2.show(prefix))`},
	} {
		t.Run(test.call, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, prefix+test.call+"\n}\n")
			got := ""
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK4401.Code {
					if m := suggestion.FindStringSubmatch(diagnosticWithNotes(d)); m != nil {
						got = m[1]
					}
				}
			}
			if got != test.want {
				t.Fatalf("EK4401 suggests %q, want %q", got, test.want)
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
