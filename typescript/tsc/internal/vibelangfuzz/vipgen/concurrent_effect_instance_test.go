package vipgen

import (
	"os/exec"
	"strings"
	"testing"
)

func TestConcurrentProjectEffectReferenceSyntax(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js is required to parse the reference module")
	}
	source := PrintEffect(Probe("vip19.project-effect-instance"))
	cmd := exec.CommandContext(t.Context(), node, "--check", "--input-type=module")
	cmd.Stdin = strings.NewReader(source)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("reference must be executable JavaScript: %v\n%s\n%s", err, output, source)
	}
}
