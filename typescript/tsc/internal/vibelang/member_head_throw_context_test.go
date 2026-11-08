package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const memberHeadThrowLibrary = `/** @throws {RangeError} */
export declare function key(): "value"
/** @throws {RangeError} */
export declare function tag(parts: TemplateStringsArray): "value"
export declare const Key: {
/** @throws {RangeError} */
new(): { readonly value: "value" }
}
/** @throws {RangeError} */
export declare function decorator(): any
`

// Computed names and decorators run while building the class or object.
// Member bodies, defaults, fields and nested functions keep their own homes.
func TestMemberHeadThrowContext(t *testing.T) {
	for _, invocation := range []struct{ name, expr string }{
		{"call", "key()"}, {"tag", "tag`name`"}, {"new", "(new Key()).value"},
	} {
		for _, member := range []struct{ name, source string }{
			{"method", "class Local { [%s]() { return 1 } }"},
			{"static-method", "class Local { static [%s]() { return 1 } }"},
			{"getter", "class Local { get [%s]() { return 1 } }"},
			{"setter", "class Local { set [%s](value: number) {} }"},
			{"effect-method", "class Local { effect [%s]() { return 1 } }"},
			{"async-method", "class Local { async [%s]() { return 1 } }"},
			{"object-method", "const local = { [%s]() { return 1 } }"},
			{"object-getter", "const local = { get [%s]() { return 1 } }"},
			{"object-setter", "const local = { set [%s](value: number) {} }"},
			{"error-method", "error Local { [%s]() { return 1 } }"},
			{"schema-error-method", "schema error Local { [%s]() { return 1 } }"},
		} {
			operation := fmt.Sprintf(member.source, invocation.expr)
			for _, context := range []struct {
				name, prefix, suffix string
				code                 int
			}{
				{"effect", "export effect function probe() {", "}", 403},
				{"plain", "export function probe() {", "}", 401},
				{"caught", "export function probe() { try {", "} catch {} }", 0},
				{"wrapped", "export effect function probe() { return try Effect.try(() => {", "}) }", 0},
				{"async", "export async function probe() {", "}", 0},
				{"nested-plain", "export effect function probe() { function nested() {", "} }", 401},
			} {
				for _, ext := range []string{"ts", "d.ts"} {
					t.Run(invocation.name+"/"+member.name+"/"+context.name+"/"+ext, func(t *testing.T) {
						source := "import { key, tag, Key } from \"./lib.js\"\n" + context.prefix + operation + context.suffix
						checkMemberHeadDiagnostics(t, source, ext, context.code)
					})
				}
			}
		}
	}
}

func TestMemberDecoratorThrowContext(t *testing.T) {
	for _, member := range []struct{ name, source string }{
		{"method", "class Local { @(decorator()) method() {} }"},
		{"static-method", "class Local { @(decorator()) static method() {} }"},
		{"getter", "class Local { @(decorator()) get value() { return 1 } }"},
		{"field", "class Local { @(decorator()) value = 1 }"},
		{"class", "@(decorator()) class Local {}"},
	} {
		for _, context := range []struct {
			name, prefix, suffix string
			code                 int
		}{
			{"effect", "export effect function probe() {", "}", 403},
			{"plain", "export function probe() {", "}", 401},
			{"caught", "export function probe() { try {", "} catch {} }", 0},
			{"wrapped", "export effect function probe() { return try Effect.try(() => {", "}) }", 0},
			{"async", "export async function probe() {", "}", 0},
		} {
			for _, ext := range []string{"ts", "d.ts"} {
				t.Run(member.name+"/"+context.name+"/"+ext, func(t *testing.T) {
					checkMemberHeadDiagnostics(t, "import { decorator } from \"./lib.js\"\n"+context.prefix+member.source+context.suffix, ext, context.code)
				})
			}
		}
	}
}

func checkMemberHeadDiagnostics(t *testing.T, source, ext string, code int) {
	t.Helper()
	p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: memberHeadThrowLibrary})
	count := 0
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		count++
		if code == 0 || d.Source() != diagnosticSource || d.Code() != int32(code) {
			t.Errorf("unexpected: %s", d.String())
		}
	}
	want := 0
	if code != 0 {
		want = 1
	}
	if count != want {
		t.Errorf("got %d errors, want %d (EK%04d)", count, want, code)
	}
}

func TestMemberHeadKeepsNestedBoundaries(t *testing.T) {
	for _, row := range []struct {
		name, source string
		code         int
	}{
		{"body", "class Local { method() { return key() } }", 401},
		{"getter-body", "class Local { get value() { return key() } }", 401},
		{"method-default", "class Local { method(value = key()) {} }", 401},
		{"field-initializer", "class Local { value = key() }", 401},
		{"static-block", "class Local { static { key() } }", 401},
		{"nested-key-arrow", "class Local { [(() => key())()]() {} }", 401},
		{"nested-decorator-arrow", "class Local { @((() => decorator())()) method() {} }", 401},
		{"effect-parameter", "effect function nested(value = { [key()]() {} }) {}", 401},
		{"async-body", "class Local { async method() { return key() } }", 0},
		{"caught-body", "class Local { method() { try { return key() } catch {} } }", 0},
	} {
		for _, ext := range []string{"ts", "d.ts"} {
			t.Run(row.name+"/"+ext, func(t *testing.T) {
				source := "import { key, decorator } from \"./lib.js\"\nexport effect function probe() {" + row.source + "}"
				checkMemberHeadDiagnostics(t, source, ext, row.code)
			})
		}
	}
}
