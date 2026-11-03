package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorsUncertainReturns(t *testing.T) {
	for _, test := range []struct {
		name, source string
		actions      int
	}{
		{"any", "async function /*cursor*/load(input: any) { return input }", 0},
		{"unknown", "async function /*cursor*/load(input: unknown) { return input }", 0},
		{"broad-object", "async function /*cursor*/load(input: object) { return input }", 0},
		{"empty-object", "async function /*cursor*/load(input: {}) { return input }", 0},
		{"generic", "async function /*cursor*/load<T>(input: T) { return input }", 0},
		{"generic-object", "async function /*cursor*/load<T extends object>(input: T) { return input }", 0},
		{"generic-empty-object", "async function /*cursor*/load<T extends {}>(input: T) { return input }", 0},
		{"generic-indexed", "async function /*cursor*/load<T, K extends keyof T>(input: T, key: K) { return input[key] }", 0},
		{"generic-union", "async function /*cursor*/load<T>(input: T | number) { return input }", 0},
		{"unknown-branch", "async function /*cursor*/load(input: unknown, flag: boolean) { if (flag) return input; return 1 }", 0},
		{"any-expression-arrow", "const load = async /*cursor*/(input: any) => input", 0},
		{"generic-expression-arrow", "const load = async /*cursor*/<T>(input: T) => input", 0},
		{"record", "async function /*cursor*/load(input: { tag: number }) { return input }", 0},
		{"callable", "async function /*cursor*/load(input: () => number) { return input }", 0},
		{"array", "async function /*cursor*/load(input: number[]) { return input }", 0},
		{"record-intersection", "async function /*cursor*/load(input: { tag: number } & { extra: string }) { return input }", 0},
		{"record-index", "async function /*cursor*/load(input: Record<string, number>) { return input }", 0},
		{"record-expression-arrow", "const load = async /*cursor*/(input: { tag: number }) => input", 0},
		{"awaited-nested-function", "async function /*cursor*/load(input: Promise<number>) { return await Promise.resolve(async () => await await input) }", 0},
		{"awaited-record", "async function /*cursor*/load(input: Promise<{ tag: number }>) { return await input }", 0},
		{"void-call", "async function /*cursor*/load(input: () => void) { return input() }", 0},
		{"void-expression-arrow", "const load = async /*cursor*/(input: () => void) => input()", 0},
		{"generic-void", "async function /*cursor*/load<T extends void>(input: T) { return input }", 0},
		{"awaited-void", "async function /*cursor*/load(input: Promise<void>) { return await input }", 0},
		{"explicit-void", "async function /*cursor*/load(input: () => void) { await Promise.resolve(); return void input() }", 2},
		{"parenthesized-void-await", "async function /*cursor*/load(input: Promise<unknown>) { return (void await input) }", 2},
		{"empty-return", "async function /*cursor*/load() { await Promise.resolve(); return }", 2},
		{"generic-key", "async function /*cursor*/load<T>(input: T, key: keyof T) { return key }", 1},
		{"null", "async function /*cursor*/load() { return null }", 1},
		{"undefined", "async function /*cursor*/load() { return undefined }", 1},
		{"awaited-number", "async function /*cursor*/load(input: Promise<number>) { return await input }", 2},
		{"awaited-string", "async function /*cursor*/load(input: Promise<string>) { return await input }", 2},
		{"awaited-boolean", "async function /*cursor*/load(input: Promise<boolean>) { return await input }", 2},
		{"awaited-null", "async function /*cursor*/load(input: Promise<null>) { return await input }", 2},
		{"awaited-undefined", "async function /*cursor*/load(input: Promise<undefined>) { return await input }", 2},
		{"awaited-unknown-primitive-output", "async function /*cursor*/load(input: Promise<unknown>) { return typeof await input }", 2},
		{"scalar", "async function /*cursor*/load() { return 1 }", 1},
		{"noncallable-then", "async function /*cursor*/load(input: { then: number }) { return input }", 1},
		{"optional-noncallable-then", "async function /*cursor*/load(input: { then?: string }) { return input }", 1},
		{"noncallable-then-intersection", "async function /*cursor*/load(input: { then: number } & { tag: string }) { return input }", 1},
		{"callable-then", "async function /*cursor*/load(input: { then: () => void }) { return input }", 0},
		{"maybe-callable-then", "async function /*cursor*/load(input: { then: number | (() => void) }) { return input }", 0},
		{"unknown-then", "async function /*cursor*/load(input: { then: unknown }) { return input }", 0},
		{"any-then", "async function /*cursor*/load(input: { then: any }) { return input }", 0},
		{"void-then", "async function /*cursor*/load(input: { then: void }) { return input }", 0},
		{"noncallable-then-or-record", "async function /*cursor*/load(input: { then: number } | { tag: number }) { return input }", 0},
		{"narrowed-unknown", "async function /*cursor*/load(input: unknown) { if (typeof input === \"number\") return input; return 0 }", 1},
		{"generic-number", "async function /*cursor*/load<T extends number>(input: T) { return input }", 1},
		{"generic-scalar-union", "async function /*cursor*/load<T extends number | string>(input: T) { return input }", 1},
		{"generic-number-index", "async function /*cursor*/load<T extends Record<string, number>>(input: T, key: keyof T) { return input[key] }", 1},
		{"awaited-unknown", "async function /*cursor*/load(input: Promise<unknown>) { return await input }", 0},
		{"awaited-generic", "async function /*cursor*/load<T>(input: Promise<T>) { return await input }", 0},
		{"nested-function", "async function /*cursor*/load(input: unknown) { function inner() { return input }; return 1 }", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			pos := strings.Index(test.source, "/*cursor*/")
			source := strings.ReplaceAll(test.source, "/*cursor*/", "")
			program, file, service, _ := editorProgram(t, source)
			count := 0
			for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{
				SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service,
			}) {
				if strings.HasPrefix(action.Description, "Convert to a VibeLang function") {
					count++
				}
			}
			if count != test.actions {
				t.Fatalf("offered %d async conversions, want %d: %s", count, test.actions, source)
			}
		})
	}
}
