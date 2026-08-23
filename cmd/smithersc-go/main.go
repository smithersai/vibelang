package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/smithersai/smithers/compiler"
)

const version = "0.0.1"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

type compilerFactory func(context.Context, compiler.ForkConfig) (compiler.Compiler, error)

func run(args []string, stdout io.Writer, stderr io.Writer) int {
	return runWithFactory(args, stdout, stderr, compiler.NewPinnedFork)
}

func runWithFactory(args []string, stdout io.Writer, stderr io.Writer, pinned compilerFactory) int {
	flags := flag.NewFlagSet("smithersc-go", flag.ContinueOnError)
	var flagOutput bytes.Buffer
	flags.SetOutput(&flagOutput)
	var forkCheckout string
	var forkCache string
	var goCommand string
	var requestPath string
	var timeout time.Duration
	var showVersion bool
	var showAPIVersion bool
	flags.BoolVar(&showVersion, "version", false, "print the smithersc-go version")
	flags.BoolVar(&showVersion, "v", false, "print the smithersc-go version")
	flags.BoolVar(&showAPIVersion, "api-version", false, "print the compiler transport API version")
	flags.StringVar(&forkCheckout, "fork-checkout", "", "exact smithersai/TypeScript checkout in either pristine or fully forkpatch-applied state")
	flags.StringVar(&forkCache, "fork-cache", "", "cache directory for the pinned bridge binary")
	flags.StringVar(&goCommand, "go-command", "", "Go executable used on a pinned-bridge cache miss")
	flags.StringVar(&requestPath, "request", "", "path to one CompileRequest JSON value (in-memory files, options, and lowering mode) instead of root names")
	flags.DurationVar(&timeout, "timeout", 5*time.Minute, "compiler preparation and execution deadline")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			if _, writeErr := io.Copy(stdout, &flagOutput); writeErr != nil {
				fmt.Fprintln(stderr, writeErr)
				return 1
			}
			return 0
		}
		_, _ = io.Copy(stderr, &flagOutput)
		return 64
	}
	if showVersion {
		if _, err := fmt.Fprintf(stdout, "smithersc-go %s\n", version); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	}
	if showAPIVersion {
		if _, err := fmt.Fprintln(stdout, compiler.APIVersion); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	}
	if timeout <= 0 {
		fmt.Fprintln(stderr, "smithersc-go: --timeout must be positive")
		return 64
	}
	if forkCheckout == "" && (forkCache != "" || goCommand != "") {
		fmt.Fprintln(stderr, "smithersc-go: --fork-cache and --go-command require --fork-checkout")
		return 64
	}
	var request compiler.CompileRequest
	if requestPath != "" {
		if len(flags.Args()) != 0 {
			fmt.Fprintln(stderr, "smithersc-go: --request and root sources are mutually exclusive")
			return 64
		}
		loaded, err := loadRequest(requestPath)
		if err != nil {
			fmt.Fprintf(stderr, "smithersc-go: --request %s: %v\n", requestPath, err)
			return 64
		}
		request = loaded
	} else {
		if len(flags.Args()) == 0 {
			fmt.Fprintln(stderr, "smithersc-go: at least one root source is required")
			return 64
		}
		request = compiler.CompileRequest{RootNames: flags.Args(), Lowering: compiler.LoweringInternal}
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	var backend compiler.Compiler
	var err error
	if forkCheckout == "" {
		backend = compiler.New()
	} else if pinned == nil {
		err = errors.New("smithersc-go: pinned compiler factory is nil")
	} else {
		backend, err = pinned(ctx, compiler.ForkConfig{
			CheckoutDirectory: forkCheckout,
			CacheDirectory:    forkCache,
			GoCommand:         goCommand,
		})
	}
	if err == nil && backend == nil {
		err = errors.New("smithersc-go: compiler factory returned a nil backend")
	}

	result := compiler.CompileResult{EmitSkipped: true}
	if err == nil {
		result, err = backend.Compile(ctx, request)
	}
	if err != nil && !errors.Is(err, compiler.ErrNotImplemented) {
		code := "SMITHERS_GO_BACKEND"
		message := err.Error()
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			code = "SMITHERS_GO_TIMEOUT"
			if !errors.Is(err, context.DeadlineExceeded) {
				message = context.DeadlineExceeded.Error() + ": " + message
			}
		}
		if !hasDiagnostic(result.Diagnostics, code, message) {
			result.Diagnostics = append(result.Diagnostics, compiler.Diagnostic{
				Code:     code,
				Category: compiler.DiagnosticError,
				Message:  message,
			})
		}
	}
	if result.Diagnostics == nil {
		result.Diagnostics = []compiler.Diagnostic{}
	}
	if result.Artifacts == nil {
		result.Artifacts = []compiler.Artifact{}
	}
	if encodeErr := json.NewEncoder(stdout).Encode(result); encodeErr != nil {
		fmt.Fprintln(stderr, encodeErr)
		return 1
	}
	if err != nil {
		fmt.Fprintln(stderr, err)
		if errors.Is(err, compiler.ErrNotImplemented) {
			return 2
		}
		return 1
	}
	if result.EmitSkipped {
		return 1
	}
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Category == compiler.DiagnosticError {
			return 1
		}
	}
	return 0
}

// loadRequest reads exactly one CompileRequest JSON value. Unknown fields and
// trailing data are usage errors so a malformed producer request never
// silently drops its lowering payload.
func loadRequest(path string) (compiler.CompileRequest, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return compiler.CompileRequest{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.DisallowUnknownFields()
	var request compiler.CompileRequest
	if err := decoder.Decode(&request); err != nil {
		return compiler.CompileRequest{}, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return compiler.CompileRequest{}, errors.New("expected one JSON request value")
	}
	return request, nil
}

func hasDiagnostic(diagnostics []compiler.Diagnostic, code string, message string) bool {
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == code && diagnostic.Message == message {
			return true
		}
	}
	return false
}
