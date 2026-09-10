package compiler

import (
	"errors"
	"os"
	"runtime"
	"syscall"
	"unsafe"
)

var forkLockFileEx = syscall.NewLazyDLL("kernel32.dll").NewProc("LockFileEx")

func tryForkPreparationLock(file *os.File) (bool, error) {
	if err := forkLockFileEx.Find(); err != nil {
		return false, err
	}
	// Lock one byte at offset zero, including in an empty file. Requesting an
	// immediate result keeps all waits cancellable in the shared Go loop.
	// The os.File owns a synchronous, non-inheritable handle. Closing it or
	// terminating its process releases the byte-range lock.
	const exclusive, failImmediately = 2, 1
	const lockViolation syscall.Errno = 33
	var overlapped syscall.Overlapped
	result, _, err := forkLockFileEx.Call(file.Fd(), exclusive|failImmediately, 0, 1, 0, uintptr(unsafe.Pointer(&overlapped)))
	runtime.KeepAlive(file)
	if result != 0 {
		return true, nil
	}
	if errors.Is(err, lockViolation) {
		return false, nil
	}
	return false, err
}
