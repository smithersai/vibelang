package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"sort"
	"testing"
)

func classFieldAwaitCodes(t *testing.T, source string) []string {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	var codes []string
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		prefix := d.Source()
		if prefix == "" {
			prefix = "TS"
		}
		codes = append(codes, fmt.Sprintf("%s%d", prefix, d.Code()))
	}
	sort.Strings(codes)
	return codes
}

func TestNativeClassFieldAwaitContext(t *testing.T) {
	operands := []struct {
		name, text string
		missing    bool
	}{
		{"promise", "promiseValue", false},
		{"scalar", "1", false},
		{"any", "(undefined as any)", false},
		{"unknown", "(undefined as unknown)", false},
		{"never", "(undefined as never)", false},
		{"thenable", "(undefined as unknown as PromiseLike<number>)", false},
		{"union", "(undefined as unknown as number | Promise<number>)", false},
		{"effect", "Effect.succeed(1)", false},
		{"missing", "missingValue", true},
	}
	homes := []struct {
		name, text string
		parameter  bool
	}{
		{"module", "export class Value { %s }", false},
		{"plain-body", "export function f() { class Value { %s }; return Value }", false},
		{"async-body", "export async function f() { class Value { %s }; return Value }", false},
		{"effect-body", "export effect function f() { class Value { %s }; return Value }", false},
		{"plain-parameter", "export function f(value = class { %s }) {}", true},
		{"async-parameter", "export async function f(value = class { %s }) {}", true},
		{"effect-parameter", "export effect function f(value = class { %s }) {}", true},
		{"effect-arrow-parameter", "export const f = effect (value = class { %s }) => 1", true},
		{"effect-method-parameter", "export class Holder { effect f(value = class { %s }) { return 1 } }", true},
		{"producer-parameter", "export effect function* f(value = class { %s }) { yield 1 }", true},
	}
	for _, home := range homes {
		for _, operand := range operands {
			for _, modifier := range []string{"", "static "} {
				label := home.name + "/" + operand.name + "/" + fmt.Sprintf("static%t", modifier != "")
				t.Run(label, func(t *testing.T) {
					source := "import { Effect } from \"effect\";\ndeclare const promiseValue: Promise<number>;\n" + fmt.Sprintf(home.text, modifier+"value = await "+operand.text)
					want := []string{"TS1308"}
					if operand.text[0] == '(' {
						want = []string{"TS2311"}
					} else if home.parameter {
						want = append(want, "TS2524")
					}
					if operand.missing {
						want = append(want, "TS2304")
					}
					sort.Strings(want)
					got := classFieldAwaitCodes(t, source)
					if !slices.Equal(got, want) {
						t.Fatalf("want %v; got %v\n%s", want, got, source)
					}
				})
			}
		}
	}
}

func TestNativeClassFieldAwaitControls(t *testing.T) {
	controls := []struct {
		name, source string
		want         []string
	}{

		{"module-effect-value", "await Effect.succeed(1)", []string{"EK103"}},
		{"async-effect-value-outside-field", "export async function f(){return await Effect.succeed(1)}", []string{"EK103"}},
		{"namespace-plain-effect-value", "namespace Place {export function f(){return await Effect.succeed(1)}}", []string{"TS1308"}},
		{"namespace-async-effect-value", "namespace Place {export async function f(){return await Effect.succeed(1)}}", []string{"EK103"}},

		{"plain-effect-function", "export class Value { value = function() { return await Effect.succeed(1) } }", []string{"TS1308"}},
		{"plain-effect-method", "export class Value { value = { read() { return await Effect.succeed(1) } } }", []string{"TS1308"}},
		{"async-arrow", "export class Value { value = async () => await Promise.resolve(1) }", nil},
		{"async-function", "export class Value { value = async function() { return await Promise.resolve(1) } }", nil},
		{"plain-function", "export class Value { value = function() { return await 1 } }", []string{"TS1308"}},
		{"async-effect-value", "export class Value { value = async () => await Effect.succeed(1) }", []string{"EK103"}},
		{"effect-arrow", "export class Value { value = effect () => { await 1 } }", []string{"EK102"}},
		{"later-effect-await", "export effect function f() { class Value { value = 1 }; await 1 }", []string{"EK102"}},
		{"computed-method-name", "export effect function f() { class Value { [await 1]() {} } }", []string{"EK102"}},
		{"later-async-await", "export async function f() { class Value { value = 1 }; return await Promise.resolve(1) }", nil},
	}
	for _, control := range controls {
		t.Run(control.name, func(t *testing.T) {
			got := classFieldAwaitCodes(t, "import { Effect } from \"effect\";\n"+control.source)
			if !slices.Equal(got, control.want) {
				t.Fatalf("want %v; got %v\n%s", control.want, got, control.source)
			}
		})
	}
}
