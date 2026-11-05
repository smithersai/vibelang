package vibelang

import "testing"

// VIP-9 checks the complete resolved contract, including an explicit receiver.
func TestServiceThisParameterCapture(t *testing.T) {
	for _, contract := range []struct {
		name, prefix, shape string
		capture             bool
	}{
		{"function", "", "(this: T) => number", true},
		{"object-receiver", "", "(this: { value: T }) => number", true},
		{"call-signature", "", "{ (this: T): number }", true},
		{"method", "", "{ read(this: T): number }", true},
		{"alias", "type Receiver = (this: T) => number; ", "Receiver", true},
		{"generic-alias", "type Receiver<U> = (this: U) => number; ", "Receiver<T>", true},
		{"interface", "interface Receiver<U> { (this: U): number }; ", "Receiver<T>", true},
		{"interface-method", "interface Receiver<U> { read(this: U): number }; ", "Receiver<T>", true},
		{"overloads", "", "{ (this: { id: number }): number; (this: T): number }", true},
		{"nested", "", "{ nested: { read(this: T): number } }", true},
		{"concrete", "", "(this: { id: number }) => number", false},
		{"member-local", "", "<U>(this: U) => number", false},
		{"member-local-constraint", "", "<U extends { id: number }>(this: U) => number", false},
		{"phantom", "type Receiver<U> = (this: { id: number }) => number; ", "Receiver<T>", false},
	} {
		for _, whole := range []bool{false, true} {
			form := "member"
			declaration := "service S { static readonly key = \"receiver/S\"; read: " + contract.shape + " }"
			if whole {
				form = "whole"
				declaration = "service S: " + contract.shape + " { static readonly key = \"receiver/S\" }"
			}
			t.Run(contract.name+"/"+form, func(t *testing.T) {
				want := map[int32]int{}
				if contract.capture {
					want[3005] = 1
				}
				source := "export function outer<T>() { " + contract.prefix + declaration + " }"
				serviceCaptureRecoveryErrors(t, source, want)
			})
		}
	}
}

func TestServiceThisParameterCaptureControls(t *testing.T) {
	serviceCaptureRecoveryErrors(t, "export function outer<T>() { service S { static readonly key = \"receiver/S\"; read(this: T): number } }", map[int32]int{3005: 1})
	serviceCaptureRecoveryErrors(t, "export function outer<T>() { service S { static readonly key = \"receiver/S\"; read<U>(this: U): number } }", map[int32]int{})
	serviceCaptureRecoveryErrors(t, "export function outer<T>() { class Native { read(this: T): number { return 1 } } }", map[int32]int{})
}
