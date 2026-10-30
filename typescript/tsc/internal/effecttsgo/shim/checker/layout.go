package checker

import (
	"unsafe"

	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VibeLang-owned: sync.sh preserves this guard and layout_test.go. Fail the
// compiler build when either struct grows; TestCheckerLayout checks each field.
const (
	_ = unsafe.Sizeof(extra_Checker{}) - unsafe.Sizeof(checker.Checker{})
	_ = unsafe.Sizeof(checker.Checker{}) - unsafe.Sizeof(extra_Checker{})
)
