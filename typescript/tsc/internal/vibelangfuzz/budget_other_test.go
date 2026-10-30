//go:build !linux && !darwin

package vibelangfuzz

import "testing"

// The post-merge CPU budget runs on Linux; Darwin supports local checks too.
func startShortBudget(f *testing.F) {}
