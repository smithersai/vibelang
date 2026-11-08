package vibelang

import (
	"strings"
	"testing"
)

func TestServiceReadonlyConversion(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"named mixed interface", `interface API { readonly id: string; count: number; readonly nested?: { value: number }; read(): string }
export class Store extends Context.Service<Store, API>()("test/Store") {}`, `service Store: API { static readonly key = "test/Store";}`},
		{"inline mixed members", `export class Store extends Context.Service<Store, { readonly id: string; count?: number; readonly nested?: { value: number }; read?(): string; load(): Effect.Effect<number> }>()("test/Store") {}`, `service Store: { readonly id: string; count?: number; readonly nested?: { value: number }; read?(): string; load(): Effect.Effect<number> }`},
		{"local mixed members", `class Store extends Context.Service<Store, { readonly id: string; count?: number; read?(): string; load(): Effect.Effect<number> }>()("test/Store") {}`, `readonly id: string; count?: number; read?(): string; load(): number!!`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := applyQuickFix(t, tc.source, EK4831.Code)
			if !strings.Contains(got, tc.want) {
				t.Fatalf("conversion missing %q:\n%s", tc.want, got)
			}
		})
	}
}
