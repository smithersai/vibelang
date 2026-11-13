package vibelangfuzz

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"testing"
)

func sidecarNode(tb testing.TB) string {
	tb.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		Missing(tb, "node is required for sidecar checks: %v", err)
	}
	return node
}

// A compiler exit is an observation; launch failures and expired contexts
// are infrastructure errors and must never reach the comparison oracle.
func sidecarCommand(parent context.Context, dir, name string, args ...string) (bool, string, error) {
	ctx, cancel := context.WithTimeout(parent, HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		return false, string(output), fmt.Errorf("sidecar command context: %w", ctx.Err())
	}
	var exit *exec.ExitError
	if err != nil && !errors.As(err, &exit) {
		return false, string(output), fmt.Errorf("start sidecar command: %w", err)
	}
	return err == nil, string(output), nil
}
