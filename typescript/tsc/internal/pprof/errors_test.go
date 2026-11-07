package pprof

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProfileStopReportsMemoryOutputFailure(t *testing.T) {
	root := t.TempDir()
	session, err := BeginProfiling(root, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	blocker := filepath.Join(root, "blocker")
	if err := os.WriteFile(blocker, []byte("preserve"), 0o600); err != nil {
		session.Stop()
		t.Fatal(err)
	}
	session.memFilePath = filepath.Join(blocker, "memory.pb.gz")
	err = session.Stop()
	if err == nil || !strings.Contains(err.Error(), "memory profile") {
		t.Fatalf("missing memory output diagnostic: %v", err)
	}
	data, err := os.ReadFile(blocker)
	if err != nil || string(data) != "preserve" {
		t.Fatalf("the blocking file changed: %q, %v", data, err)
	}
}
