//go:build !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !windows

package compiler

import (
	"errors"
	"fmt"
	"os"
	"runtime"
)

func tryForkPreparationLock(_ *os.File) (bool, error) {
	return false, fmt.Errorf("%w: native compiler preparation locking on %s", errors.ErrUnsupported, runtime.GOOS)
}
