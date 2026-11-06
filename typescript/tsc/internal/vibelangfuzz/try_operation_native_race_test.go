package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestTryOperationNativeRaceCall(t *testing.T) {
	for _, method := range []string{"raceAllFirst", "raceAll"} {
		for _, lazy := range []bool{false, true} {
			element := "a(1)"
			if lazy {
				element = "FX.suspend(() => a(1))"
			}
			call := "FX." + method + "([" + element + ", a(2)])"
			js := "import * as FX from \"effect/Effect\"; function* f() { return yield* " + call + "; }"
			t.Run(method+"/"+element, func(t *testing.T) {
				got := tryOperationCall(js)
				if got != call || strings.Contains(got, "suspend(") != lazy {
					t.Fatalf("must inspect the native operation and its elements: got %q; want %q", got, call)
				}
			})
		}
		for _, js := range []string{
			"import * as FX from \"other\"; function* f() { return yield* FX." + method + "([a(1)]); }",
			"import * as FX from \"effect/Effect\";",
		} {
			if got := tryOperationCall(js); got != "" {
				t.Fatalf("no admitted operation call, got %q", got)
			}
		}
	}
}
