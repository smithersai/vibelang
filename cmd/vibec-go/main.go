package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/smithersai/vibelang/compiler"
)

const version = "0.0.1"

func main() {
	for _, arg := range os.Args[1:] {
		switch arg {
		case "--version", "-v":
			fmt.Printf("vibec-go %s\n", version)
			return
		case "--api-version":
			fmt.Println(compiler.APIVersion)
			return
		}
	}

	request := compiler.CompileRequest{RootNames: os.Args[1:]}
	result, err := compiler.New().Compile(context.Background(), request)
	if encodeErr := json.NewEncoder(os.Stdout).Encode(result); encodeErr != nil {
		fmt.Fprintln(os.Stderr, encodeErr)
		os.Exit(1)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		if errors.Is(err, compiler.ErrNotImplemented) {
			os.Exit(2)
		}
		os.Exit(1)
	}
}
