//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd

package compiler

import (
	"errors"
	"os"
	"runtime"
	"syscall"
)

func tryForkPreparationLock(file *os.File) (bool, error) {
	err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	runtime.KeepAlive(file)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) || errors.Is(err, syscall.EINTR) {
		return false, nil
	}
	return false, err
}
