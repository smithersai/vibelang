package vibelang

import "testing"

// VIP-9 checks every resolved part of the callable contract.
func TestServicePredicateCapture(t *testing.T) {
	for _, contract := range []struct {
		name, prefix, shape string
		capture             bool
	}{
		{"guard", "", "(value: unknown) => value is T", true},
		{"assertion", "", "(value: unknown) => asserts value is T", true},
		{"call-signature", "", "{ (value: unknown): value is T }", true},
		{"method", "", "{ check(value: unknown): value is T }", true},
		{"alias", "type Guard = (value: unknown) => value is T; ", "Guard", true},
		{"generic-alias", "type Guard<U> = (value: unknown) => value is U; ", "Guard<T>", true},
		{"interface", "interface Guard<U> { (value: unknown): value is U }; ", "Guard<T>", true},
		{"nested", "", "{ nested: { check(value: unknown): value is T } }", true},
		{"assertion-alias", "type Guard = (value: unknown) => asserts value is T; ", "Guard", true},
		{"assertion-interface", "interface Guard<U> { (value: unknown): asserts value is U }; ", "Guard<T>", true},
		{"concrete", "", "(value: unknown) => value is number", false},
		{"member-local", "", "<U>(value: unknown) => value is U", false},
		{"member-local-assertion", "", "<U>(value: unknown) => asserts value is U", false},
		{"erased", "type Ignore<U> = number; ", "(value: unknown) => value is Ignore<T>", false},
		{"bare-assertion", "", "(value: unknown) => asserts value", false},
	} {
		for _, whole := range []bool{false, true} {
			form := "member"
			declaration := "service S { static readonly key = \"predicate/S\"; check: " + contract.shape + " }"
			if whole {
				form = "whole"
				declaration = "service S: " + contract.shape + " { static readonly key = \"predicate/S\" }"
			}
			t.Run(contract.name+"/"+form, func(t *testing.T) {
				want := map[int32]int{}
				if contract.capture {
					want[3005] = 1
				}
				serviceCaptureRecoveryErrors(t, "export function outer<T>() { "+contract.prefix+declaration+" }", want)
			})
		}
	}
}
func TestServicePredicateCaptureDirectMembers(t *testing.T) {
	for _, returns := range []string{"value is T", "asserts value is T"} {
		t.Run(returns, func(t *testing.T) {
			serviceCaptureRecoveryErrors(t, "export function outer<T>() { service S { static readonly key = \"predicate/S\"; check(value: unknown): "+returns+" } }", map[int32]int{3005: 1})
		})
	}
	serviceCaptureRecoveryErrors(t, "export function outer<T>() { service S { static readonly key = \"predicate/S\"; check<U>(value: unknown): value is U } }", map[int32]int{})
	serviceCaptureRecoveryErrors(t, "export function outer<T>() { service S { static readonly key = \"predicate/S\"; check(value: unknown): asserts value } }", map[int32]int{})
	serviceCaptureRecoveryErrors(t, "export function outer<T>() { class Native { check(value: unknown): value is T { return true } } }", map[int32]int{})
}
