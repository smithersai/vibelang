package vibelangfuzz

import (
	"os/exec"
	"testing"
)

// Ordinary package builds also run before coverage instruments the fuzz helpers.
func TestFuzzPackageBuildWithoutTestFiles(t *testing.T) {
	cmd := exec.CommandContext(t.Context(), "go", "build", ".")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("standalone fuzz package build failed: %v\n%s", err, output)
	}
}
