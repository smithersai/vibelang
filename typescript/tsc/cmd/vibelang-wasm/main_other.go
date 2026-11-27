//go:build !(js && wasm)

// Command vibelang-wasm is intended to be built with GOOS=js GOARCH=wasm.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "vibelang-wasm must be compiled with GOOS=js GOARCH=wasm (see scripts/build-playground-wasm.sh)")
	os.Exit(2)
}
