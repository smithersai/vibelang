package vibelangfuzz

import "testing"

// Graduated witnesses must never regain pending waivers.
func TestGraduatedRegistryWitnessesStayStrict(t *testing.T) {
	for _, code := range []int32{4301, 4406, 4611, 4612, 4704} {
		for _, target := range []string{"FuzzCompile", "FuzzSplice"} {
			for _, key := range []string{"registry:" + specCodeName(code), "corpus:registry-" + specCodeName(code)} {
				if _, ok := Pending(target, key); ok {
					t.Errorf("%s %s: graduated witness must not waive emissions", target, key)
				}
			}
		}
	}
}
