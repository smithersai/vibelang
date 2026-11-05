package vibelang

import "testing"

// VIP-9 guards the service key's identity through typed constructor aliases.
func TestServiceIntersectionAlias(t *testing.T) {
	for _, alias := range []struct{ name, declaration string }{
		{"right", "const Key: typeof S & { readonly extra?: number } = S;"},
		{"left", "const Key: { readonly extra?: number } & typeof S = S;"},
		{"named", "type Augmented = typeof S & { readonly extra?: number }; const Key: Augmented = S;"},
		{"generic", "type Augmented<U> = U & { readonly extra?: number }; const Key: Augmented<typeof S> = S;"},
		{"nested", "type Augmented<U> = (U & { readonly extra?: number }) & { readonly tag?: string }; const Key: Augmented<typeof S> = S;"},
		{"property", "const holder: { key: typeof S & { readonly extra?: number } } = { key: S }; const Key = holder.key;"},
		{"assertion", "const Key = (S as typeof S & { readonly extra?: number });"},
	} {
		for _, operation := range []struct {
			name, source string
			code         int32
		}{
			{"new", "export const result = new Key();", 3003},
			{"extends", "export class Child extends Key {}", 3002},
			{"instanceof", "export const result = {} instanceof Key;", 3004},
			{"pattern", "export function test(value: unknown) { return match (value) { when Key: 1; default: 0; } }", 3004},
			{"extractor", "export function test(value: unknown) { return match (value) { when Key(): 1; default: 0; } }", 3004},
		} {
			for _, whole := range []bool{false, true} {
				form := "body"
				declaration := `service S { static readonly key = "intersection/S"; value: number }; `
				if whole {
					form = "whole"
					declaration = `service S: {value:number} { static readonly key = "intersection/S" }; `
				}
				t.Run(alias.name+"/"+operation.name+"/"+form, func(t *testing.T) {
					serviceCaptureRecoveryErrors(t, declaration+alias.declaration+operation.source, map[int32]int{operation.code: 1})
				})
			}
			t.Run(alias.name+"/"+operation.name+"/native", func(t *testing.T) {
				want := map[int32]int{}
				if operation.name == "extractor" {
					want[704] = 1 // an ordinary class has no own extractor
				}
				serviceCaptureRecoveryErrors(t, "class S {} "+alias.declaration+operation.source, want)
			})
			if operation.name == "extractor" {
				t.Run(alias.name+"/extractor/callable", func(t *testing.T) {
					serviceCaptureRecoveryErrors(t, "function S(_subject: unknown): unknown[] { return [] }; "+alias.declaration+operation.source, map[int32]int{})
				})
			}
		}
	}
}

// The service identifier in R is distinct from the typeof-key value.
func TestServiceIntersectionIdentifierControls(t *testing.T) {
	const prefix = `service S { static readonly key = "intersection/Identifier"; value: number }; `
	for _, use := range []string{
		`declare const Callable: S & ((value: number) => number); export const value = Callable(1)`,
		`declare const Constructor: S & { new(): object }; export const value = new Constructor()`,
		`declare const Constructor: S & { new(): object }; export const value = {} instanceof Constructor`,
		`declare const Constructor: S & { new(): object }; export function test(value: unknown) { return match (value) { when Constructor: 1; default: 0; } }`,
	} {
		t.Run(use, func(t *testing.T) {
			serviceCaptureRecoveryErrors(t, prefix+use, map[int32]int{})
		})
	}
	serviceCaptureRecoveryErrors(t, `export function outer<T>(value: T) { service S { static readonly key = "intersection/Concrete"; n: number }; const Key: typeof S & { readonly extra?: number } = S; return {} instanceof Key }`, map[int32]int{3004: 1})
}
