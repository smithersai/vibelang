package vibelang

import (
	"fmt"
	"testing"
)

func TestServiceRejectedHeaderNativeDiagnostics(t *testing.T) {
	for _, whole := range []bool{false, true} {
		for _, tc := range []struct {
			key, members string
			own          int
			native       int32
			nativeCount  int
		}{
			{"untyped-static", "static helper()", 1, 0, 0},
			{"optional", "static helper?(): void; static helper(): void {}", 2, 0, 0},
			{"accessibility", "private static helper(): void; public static helper(): void {}", 2, 0, 0},
			{"incompatible", "static helper(x: string): string; static helper(x: number): number { return x }", 2, 0, 0},
			{"nested-optional", "static helper = class { f?(): void; f(): void {} }", 1, 2386, 1},
			{"nested-accessibility", "static helper = class { private f(): void; public f(): void {} }", 1, 2385, 1},
			{"nested-incompatible", "static helper = class { f(x: string): string; f(x: number): number { return x } }", 1, 2394, 1},
			{"nested-return", "static helper(): void { interface Inner { read() } }", 1, 7010, 1},
			{"duplicate-static", "static helper(): void {} static helper(): void {}", 2, 0, 0},
			{"duplicate-instance", "helper(): void {} helper(): void {}", 2, 0, 0},
			{"nested-duplicate", "static helper = class { f(): void {} f(): void {} }", 1, 2393, 2},
		} {
			t.Run(fmt.Sprintf("whole%v/%s", whole, tc.key), func(t *testing.T) {
				head, body := "export service S", "n: number; "
				if whole {
					head += ": { n: number }"
					body = ""
				}
				want := map[int32]int{902: tc.own}
				if tc.native != 0 {
					want[tc.native] = tc.nativeCount
				}
				serviceCaptureRecoveryErrors(t, head+" { static readonly key = 'headers/S'; "+body+tc.members+" }", want)
			})
		}
	}
	t.Run("whole-untyped-instance", func(t *testing.T) {
		serviceCaptureRecoveryErrors(t, "export service S: { n: number } { static readonly key = 'headers/Whole'; helper() }", map[int32]int{902: 1})
	})
	t.Run("allowed-untyped-method", func(t *testing.T) {
		serviceCaptureRecoveryErrors(t, "export service S { static readonly key = 'headers/Body'; read() }", map[int32]int{7010: 1})
	})
	t.Run("allowed-overload-signatures", func(t *testing.T) {
		serviceCaptureRecoveryErrors(t, "export service S { static readonly key = 'headers/Overloads'; read(): void; read(): void }", map[int32]int{})
	})
	t.Run("native-duplicate-implementation", func(t *testing.T) {
		serviceCaptureRecoveryErrors(t, "export class Native { f(): void {} f(): void {} }", map[int32]int{2393: 2})
	})

}
