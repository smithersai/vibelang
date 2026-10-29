package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/execute"
	"github.com/microsoft/TypeScript/tsc/internal/osutil"

	// VibeLang registers its compiler hooks from init.
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"

	// Effect's type-aware lint rules (VIP-38) register their checker hooks from init.
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/lint"
)

func main() {
	os.Exit(runMain())
}

func runMain() int {
	core.ApplyDebugStackLimit()
	args := osutil.Args()[1:]
	if len(args) > 0 {
		switch args[0] {
		case "--lsp":
			return runLSP(args[1:])
		case "--api":
			return runAPI(args[1:])
		case "--parent-pid":
			return runDprintPlugin(args) // dprint starts its process plugins so (dprint.go)
		case "--write-dprint-plugin":
			return runWriteDprintPlugin(args[1:])
		case "--estree":
			return runESTree(args[1:]) // VibeLang ESLint parser (estree.go)
		case "lint":
			ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
			defer stop()
			return lint.Command(ctx, newSystem(), args[1:]) // Effect's lint rules on .vibe files (VIP-38)
		}
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	sys := newSystem()
	args, loaderRoot, err := vibelang.LoaderRootArguments(args, sys.GetCurrentDirectory())
	if err != nil {
		fmt.Fprintln(os.Stderr, "vibelang:", err)
		return 1
	}
	if rest, fix := vibelang.FixArguments(args); fix {
		rest, options := vibelang.FixOptionsArguments(rest)
		// vibelang --fix applies the safe quick fixes, then compiles (D291).
		if status := vibelang.FixWithOptions(ctx, sys, rest, options); status != 0 {
			return status
		}
		args = rest
	}
	// After --fix, whose own compile checks the whole project.
	compiler.SetLoaderRoot(loaderRoot)
	result := execute.CommandLine(ctx, sys, args, nil)
	return int(result.Status)
}
