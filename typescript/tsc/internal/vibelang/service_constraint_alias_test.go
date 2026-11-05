package vibelang

import (
	"strings"
	"testing"
)

// VIP-9 follows a service key's value identity through generic constraints.
func TestServiceConstraintAlias(t *testing.T) {
	for _, test := range []struct{ name, operation, source string }{
		{"direct-instanceof", "instanceof", "export function test<Key extends typeof S>(key: Key, value: unknown) { return value instanceof key }"},
		{"direct-pattern", "pattern", "export function test<Key extends typeof S>(key: Key, value: unknown) { return match (value) { when key: 1; default: 0; } }"},
		{"direct-extractor", "extractor", "export function test<Key extends typeof S>(key: Key, value: unknown) { return match (value) { when key(): 1; default: 0; } }"},
		{"named-instanceof", "instanceof", "type Bound = typeof S; export function test<Key extends Bound>(key: Key, value: unknown) { return value instanceof key }"},
		{"named-pattern", "pattern", "type Bound = typeof S; export function test<Key extends Bound>(key: Key, value: unknown) { return match (value) { when key: 1; default: 0; } }"},
		{"named-extractor", "extractor", "type Bound = typeof S; export function test<Key extends Bound>(key: Key, value: unknown) { return match (value) { when key(): 1; default: 0; } }"},
		{"chained-instanceof", "instanceof", "export function test<Base extends typeof S, Key extends Base>(key: Key, value: unknown) { return value instanceof key }"},
		{"chained-pattern", "pattern", "export function test<Base extends typeof S, Key extends Base>(key: Key, value: unknown) { return match (value) { when key: 1; default: 0; } }"},
		{"chained-extractor", "extractor", "export function test<Base extends typeof S, Key extends Base>(key: Key, value: unknown) { return match (value) { when key(): 1; default: 0; } }"},
		{"intersection-right-instanceof", "instanceof", "export function test<Key extends typeof S & { readonly extra?: number }>(key: Key, value: unknown) { return value instanceof key }"},
		{"intersection-right-pattern", "pattern", "export function test<Key extends typeof S & { readonly extra?: number }>(key: Key, value: unknown) { return match (value) { when key: 1; default: 0; } }"},
		{"intersection-right-extractor", "extractor", "export function test<Key extends typeof S & { readonly extra?: number }>(key: Key, value: unknown) { return match (value) { when key(): 1; default: 0; } }"},
		{"intersection-left-instanceof", "instanceof", "export function test<Key extends { readonly extra?: number } & typeof S>(key: Key, value: unknown) { return value instanceof key }"},
		{"intersection-left-pattern", "pattern", "export function test<Key extends { readonly extra?: number } & typeof S>(key: Key, value: unknown) { return match (value) { when key: 1; default: 0; } }"},
		{"intersection-left-extractor", "extractor", "export function test<Key extends { readonly extra?: number } & typeof S>(key: Key, value: unknown) { return match (value) { when key(): 1; default: 0; } }"},
		{"generic-alias-instanceof", "instanceof", "type Augmented<U> = U & { readonly extra?: number }; export function test<Key extends Augmented<typeof S>>(key: Key, value: unknown) { return value instanceof key }"},
		{"generic-alias-pattern", "pattern", "type Augmented<U> = U & { readonly extra?: number }; export function test<Key extends Augmented<typeof S>>(key: Key, value: unknown) { return match (value) { when key: 1; default: 0; } }"},
		{"generic-alias-extractor", "extractor", "type Augmented<U> = U & { readonly extra?: number }; export function test<Key extends Augmented<typeof S>>(key: Key, value: unknown) { return match (value) { when key(): 1; default: 0; } }"},
		{"property-instanceof", "instanceof", "export function test<Key extends typeof S>(holder: { key: Key }, value: unknown) { return value instanceof holder.key }"},
		{"property-pattern", "pattern", "export function test<Key extends typeof S>(holder: { key: Key }, value: unknown) { return match (value) { when holder.key: 1; default: 0; } }"},
		{"property-extractor", "extractor", "export function test<Key extends typeof S>(holder: { key: Key }, value: unknown) { return match (value) { when holder.key(): 1; default: 0; } }"},
		{"class-instanceof", "instanceof", "export class Host<Key extends typeof S> { test(key: Key, value: unknown) { return value instanceof key } }"},
		{"class-pattern", "pattern", "export class Host<Key extends typeof S> { test(key: Key, value: unknown) { return match (value) { when key: 1; default: 0; } } }"},
		{"class-extractor", "extractor", "export class Host<Key extends typeof S> { test(key: Key, value: unknown) { return match (value) { when key(): 1; default: 0; } } }"},
	} {
		for _, whole := range []bool{false, true} {
			form := "body"
			prefix := `service S { static readonly key = "constraint/S"; value: number }; `
			if whole {
				form = "whole"
				prefix = `service S: { value: number } { static readonly key = "constraint/S" }; `
			}
			t.Run(test.name+"/"+form, func(t *testing.T) {
				serviceCaptureRecoveryErrors(t, prefix+test.source, map[int32]int{3004: 1})
			})
		}
		t.Run(test.name+"/native", func(t *testing.T) {
			want := map[int32]int{}
			if test.operation == "extractor" {
				want[704] = 1
			}
			serviceCaptureRecoveryErrors(t, "class S {} "+test.source, want)
		})
		if test.operation == "extractor" {
			t.Run(test.name+"/callable", func(t *testing.T) {
				serviceCaptureRecoveryErrors(t, "function S(_value:unknown):unknown[] { return [] }; "+test.source, map[int32]int{})
			})
		}
	}
}

func TestServiceConstraintIdentifierControls(t *testing.T) {
	const prefix = `service S { static readonly key = "constraint/Identifier"; value: number }; `
	for _, source := range []string{
		`export function test<Key extends S & ((value:number)=>number)>(key:Key) { return key(1) }`,
		`export function test<Key extends S & { new(): object }>(key:Key) { return new key() }`,
		`export function test<Key extends S & { new(): object }>(key:Key,value:unknown) { return value instanceof key }`,
		`export function test<Key extends S & { new(): object }>(key:Key,value:unknown) { return match(value){when key:1;default:0;} }`,
		`class Native {}; export function test<Key extends typeof S | typeof Native>(key:Key,value:unknown) { return value instanceof key }`,
		`export function test<Key extends {new():object}>(key:Key,value:unknown) { return value instanceof key }`,
	} {
		t.Run(strings.TrimPrefix(source, "export function "), func(t *testing.T) {
			serviceCaptureRecoveryErrors(t, prefix+source, map[int32]int{})
		})
	}
}

func TestServiceConstraintOtherMisuses(t *testing.T) {
	for _, whole := range []bool{false, true} {
		prefix := `service S { static readonly key = "constraint/Other"; value:number }; `
		form := "body"
		if whole {
			prefix = `service S: {value:number} { static readonly key = "constraint/Other" }; `
			form = "whole"
		}
		for _, use := range []struct {
			name, source string
			code         int32
		}{
			{"new", `export function test<Key extends typeof S>(key:Key) { return new key() }`, 3003},
			{"extends", `export function test<Key extends typeof S>(key:Key) { class Child extends key {}; return Child }`, 3002},
		} {
			t.Run(form+"/"+use.name, func(t *testing.T) { serviceCaptureRecoveryErrors(t, prefix+use.source, map[int32]int{use.code: 1}) })
		}
	}
	serviceCaptureRecoveryErrors(t, `class Native {}; export function test<Key extends typeof Native>(key:Key) { return new key() }`, map[int32]int{})
}
