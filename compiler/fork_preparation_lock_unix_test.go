//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd

package compiler

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestForkPreparationLockRefusesSpecialFiles(t *testing.T) {
	for _, kind := range []string{"symlink", "fifo"} {
		t.Run(kind, func(t *testing.T) {
			directory := t.TempDir()
			name := filepath.Join(directory, "prepare.lock")
			target := filepath.Join(directory, "target")
			if err := os.WriteFile(target, []byte("preserve"), 0o600); err != nil {
				t.Fatal(err)
			}
			var err error
			if kind == "symlink" {
				err = os.Symlink(target, name)
			} else {
				err = syscall.Mkfifo(name, 0o600)
			}
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
			defer cancel()
			release, err := acquireForkPreparationLock(ctx, name)
			if release != nil {
				release()
			}
			if err == nil || errors.Is(err, context.DeadlineExceeded) || release != nil {
				t.Fatalf("special file was treated as a live lock: %v", err)
			}
			if _, err := os.Lstat(name); err != nil {
				t.Fatalf("special file was removed: %v", err)
			}
			if content, err := os.ReadFile(target); err != nil || string(content) != "preserve" {
				t.Fatalf("symlink target changed: %q, %v", content, err)
			}
		})
	}
}
