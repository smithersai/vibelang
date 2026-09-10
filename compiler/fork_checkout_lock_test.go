package compiler

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCheckoutPreparationLockPathIsKeyedByCheckoutNotCache(t *testing.T) {
	first, err := checkoutPreparationLockPath("/checkouts/one")
	if err != nil {
		t.Fatal(err)
	}
	again, err := checkoutPreparationLockPath("/checkouts/one")
	if err != nil {
		t.Fatal(err)
	}
	other, err := checkoutPreparationLockPath("/checkouts/two")
	if err != nil {
		t.Fatal(err)
	}
	if first != again {
		t.Fatalf("the same checkout must map to one lock path: %q vs %q", first, again)
	}
	if first == other {
		t.Fatalf("different checkouts must not share a lock path: %q", first)
	}
	if !strings.HasSuffix(first, ".lock") || filepath.Base(filepath.Dir(first)) != "checkout-locks" {
		t.Fatalf("unexpected lock path shape: %q", first)
	}
	if info, err := os.Stat(filepath.Dir(first)); err != nil || !info.IsDir() {
		t.Fatalf("lock directory must exist after the path is derived: %v", err)
	}
}

func TestCheckoutPreparationLockSerializesAcrossCaches(t *testing.T) {
	checkout := filepath.Join(t.TempDir(), "checkout")
	name, err := checkoutPreparationLockPath(checkout)
	if err != nil {
		t.Fatal(err)
	}
	release, err := acquireForkPreparationLock(t.Context(), name)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	// A second preparation of the same checkout, regardless of which bridge
	// cache it was given, must wait rather than patch concurrently.
	ctx, cancel := context.WithTimeout(t.Context(), 150*time.Millisecond)
	defer cancel()
	second, err := acquireForkPreparationLock(ctx, name)
	if second != nil {
		defer second()
	}
	if !errors.Is(err, context.DeadlineExceeded) || second != nil {
		t.Fatalf("a second owner acquired the checkout lock while the first held it: granted=%v error=%v", second != nil, err)
	}
	release()
	third, err := acquireForkPreparationLock(t.Context(), name)
	if err != nil {
		t.Fatalf("the lock must be reacquirable after release: %v", err)
	}
	third()
}
