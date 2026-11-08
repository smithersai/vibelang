package vibelangfuzz

import (
	"os/exec"
	"testing"
)

// Ordinary package builds also run before coverage instruments the fuzz helpers.
// The build passes -trimpath like every go test target, so it reuses the units the
// test binary's build just compiled: without it the whole package tree compiled
// again from cold on a box (395.6 s, and a 6.1 GB build cache; 9.0 s and 3.2 GB with it).
func TestFuzzPackageBuildWithoutTestFiles(t *testing.T) {
	cmd := exec.CommandContext(t.Context(), "go", "build", "-trimpath", ".")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("standalone fuzz package build failed: %v\n%s", err, output)
	}
}
