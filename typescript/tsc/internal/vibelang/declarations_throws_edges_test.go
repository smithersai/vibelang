package vibelang

import (
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestVIP27AdditionalExportForms(t *testing.T) {
	for _, test := range []struct {
		name, source string
		count        int
	}{
		{"parenthesized arrow", "export const sample = (() => 1)", 1},
		{"erased callable annotation", "export const sample: unknown = () => 1", 0},
		{"erased callable assertion", "export const sample = (() => 1) as unknown", 0},
		{"asserted arrow", "export const sample = (() => 1) as () => number", 1},
		{"parenthesized property", "export class Sample { callback = (() => 1) }", 1},
		{"default arrow", "export default () => 1", 1},
		{"default expression", "export default function () { return 1 }", 1},
		{"multiple const arrows", "export const first = () => 1, second = () => 2", 2},
		{"object arrow", "export const object = { callback: () => 1 }", 1},
		{"constructor", "export class Sample { constructor(readonly value: number) {} }", 1},
		{"method overloads", "export class Sample { method(n: string): number; method(n: number): number; method(n: string | number) { return 1 } }", 2},
		{"generator", "export function* sample() { yield 1 }", 1},
		{"mixed overload returns", "export function sample(n: string): number; export function sample(n: number): Effect.Effect<number>; export function sample(n: string | number): number | Effect.Effect<number> { return 1 }", 1},
		{"effect factory", "export function sample(): Effect.Effect<number> { return {} as Effect.Effect<number> }", 0},
		{"returned arrow", "export function make() { return () => 1 }", 2},
		{"callback parameter", "export function call(callback: () => number) { return callback() }", 2},
		{"opaque private callables", "export class Sample { private method() { return 1 } private arrow = () => 1; protected kept() { return 1 } exposed() { return this.method() } }", 2},
		{"accessors", "export class Sample { get value() { return 1 } set value(n: number) {} }", 0},
		{"effect signatures", "export interface Sample { method(): Effect.Effect<number> }; export type Fn = () => Effect.Effect<number>", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = test.source
			dts := emitDeclarations(t, files)
			if n := strings.Count(dts, "@throws {never}"); n != test.count {
				t.Fatalf("got %d, want %d:\n%s", n, test.count, dts)
			}
		})
	}
}

func TestVIP27NeverOverwritesAuthoredContract(t *testing.T) {
	// Source validation rejects these in .vibe. Test emit independently as well:
	// even error-recovery declaration output cannot overwrite authored contracts.
	for _, tag := range []string{"@throws {unknown}", "@throws on failure", "@rethrows callback", "@exception {Error}"} {
		doc := "/** Authored.\n * " + tag + "\n */\n"
		for _, source := range []string{
			doc + "export function sample() { return 1 }",
			doc + "export const sample = () => 1",
			doc + "export declare const sample: () => number",
			doc + "export const sample = (() => 1)",
			doc + "export const sample = (() => 1) as () => number",
			"export class Sample {\n" + doc + "callback = (() => 1) }",
			"export interface Sample {\n" + doc + "callback: () => number }",
			doc + "export const first = () => 1, second = () => 2",
			"export class Sample {\n" + doc + "method() { return 1 } }",
			doc + "export type Sample = () => number",
		} {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = source
			p := computedKeyProgram(t, files)
			var dts string
			p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
				if strings.HasSuffix(string(name), "main.d.ts") {
					dts = text
				}
				return nil
			}})
			if strings.Contains(dts, "@throws {never}") || !strings.Contains(dts, tag) {
				t.Fatalf("changed authored contract %q in %s:\n%s", tag, source, dts)
			}
		}
	}
}

// Regression from Foldkit's emitted selector/rule declarations: JSDoc.Pos()
// includes preceding ordinary comments, which are not part of the doc block.
func TestVIP27PreservesDocsAfterSectionComments(t *testing.T) {
	for _, heading := range []string{"// SELECTORS\n\n", "/* Section heading. */\n", "// First.\n/* Second. */\n"} {
		files := computedKeyFiles(false)
		files["/workspace/x/src/main.vibe"] = heading + "/** Keeps its prose.\n * @deprecated old\n */\nexport const sample = () => 1"
		dts := emitDeclarations(t, files)
		if strings.Contains(dts, "/*//") || strings.Contains(dts, "/*/*") || !strings.Contains(dts, "/** Keeps its prose.") && !strings.Contains(dts, "/**\n * Keeps its prose.") || strings.Count(dts, "@throws {never}") != 1 || !strings.Contains(dts, "@deprecated old") {
			t.Fatalf("corrupted published documentation:\n%s", dts)
		}
	}
}

func TestVIP27CallablePropertyKeepsOneDocBlock(t *testing.T) {
	for _, source := range []string{
		"export interface Shape {\n/** Keeps one authored block. */\ncallback: () => number }",
		"export type Shape = Readonly<{\n/** Keeps one authored block. */\ncallback: () => number }>",
		"export class Shape {\n/** Keeps one authored block. */\ncallback = () => 1 }",
	} {
		files := computedKeyFiles(false)
		files["/workspace/x/src/main.vibe"] = source
		dts := emitDeclarations(t, files)
		if strings.Count(dts, "Keeps one authored block.") != 1 || strings.Count(dts, "@throws {never}") != 1 {
			t.Fatalf("duplicated authored documentation in %s:\n%s", source, dts)
		}
	}
}

// Only native-emitted docs belong on the declaration. A private body comment
// must not be copied out merely because its callback needs a generated tag.
func TestVIP27GeneratedContractDoesNotPublishBodyDocumentation(t *testing.T) {
	source := "export function make() { return /** Body-only callback documentation. */ function () { return 1 } }"
	files := computedKeyFiles(false)
	files["/workspace/x/src/main.ts"] = source
	files["/workspace/x/src/tsconfig.json"] = strings.ReplaceAll(files["/workspace/x/src/tsconfig.json"], "main.vibe", "main.ts")
	twin := emitDeclarations(t, files)
	delete(files, "/workspace/x/src/main.ts")
	files["/workspace/x/src/main.vibe"] = source
	files["/workspace/x/src/tsconfig.json"] = strings.ReplaceAll(files["/workspace/x/src/tsconfig.json"], "main.ts", "main.vibe")
	emitted := emitDeclarations(t, files)
	if strings.Count(emitted, "Body-only callback documentation.") != strings.Count(twin, "Body-only callback documentation.") || strings.Count(emitted, "@throws {never}") != 2 {
		t.Fatalf("published new authored documentation:\ntwin:\n%s\nemitted:\n%s", twin, emitted)
	}
}

// Foldkit and Smithers declarations showed the generated contract split from
// authored docs. TypeScript then reads only the generated block, so hovers,
// TypeDoc and API identity lose the prose and its other tags.
func TestVIP27GeneratedContractJoinsAuthoredBlock(t *testing.T) {
	for _, source := range []string{
		"/** Prose.\n * @example x\n */\nexport function sample() { return 1 }",
		"/** Prose. */\nexport const sample = <A>(a: A) => a",
		"// Section.\n/** Prose. */\nexport const sample = () => 1",
		"export interface Shape {\n  /** Prose. */\n  list: () => number\n  /** Other. */\n  parse: (s: string) => number }",
		"export type Shape = Readonly<{\n  /** Prose. */\n  list: () => number }>",
		"export class Shape {\n  /** Prose. */\n  method() { return 1 }\n  /** Prose. */\n  callback = () => 1 }",
		"export const shape = {\n  /** Prose. */\n  method() { return 1 } }",
		"/** Prose. */\nexport function sample(n: string): number\n/** Prose. */\nexport function sample(n: number): number\nexport function sample(n: string | number) { return 1 }",
		"export namespace N {\n  /** Prose. */\n  export function sample() { return 1 } }",
	} {
		files := computedKeyFiles(false)
		files["/workspace/x/src/main.vibe"] = source
		dts := emitDeclarations(t, files)
		if adjacentDocBlocks.MatchString(dts) || !strings.Contains(dts, "@throws {never}") {
			t.Fatalf("generated contract is not in the authored block for %q:\n%s", source, dts)
		}
		for _, block := range regexp.MustCompile(`(?s)/\*\*.*?\*/`).FindAllString(dts, -1) {
			if strings.Contains(block, "Prose.") && !strings.Contains(block, "@throws {never}") {
				t.Fatalf("authored block lacks the generated contract for %q:\n%s", source, dts)
			}
		}
		if strings.Count(dts, "Prose.") != strings.Count(source, "Prose.") || strings.Contains(dts, "Section.") {
			t.Fatalf("documentation duplicated, lost or published from a non-JSDoc comment for %q:\n%s", source, dts)
		}
	}
}
