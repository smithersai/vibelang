package compiler

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
)

// checkoutPreparationLockPath names the lock that serializes patching of one
// TypeScript checkout across every bridge cache.
//
// The preparation lock in preparePinnedForkBridge lives inside the bridge
// cache directory, so two processes that were given different cache
// directories (the conformance runner and its self-test each use a private
// workspace cache) hold different locks while they patch the same shared
// checkout in place. Measured on a cold cache on 2026-09-10: the self-test
// observed the checkout "neither pristine nor fully patched" while a sibling
// test file was half-way through applying the series. The checkout lock is
// keyed by the checkout's canonical path, not by the cache, and it lives in
// the user's cache directory so a read-only or foreign checkout needs no
// write access to its own tree.
func checkoutPreparationLockPath(checkout string) (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	directory := filepath.Join(base, "vibelang", "typescript-bridge", "checkout-locks")
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return "", err
	}
	digest := sha256.Sum256([]byte(checkout))
	return filepath.Join(directory, hex.EncodeToString(digest[:16])+".lock"), nil
}
