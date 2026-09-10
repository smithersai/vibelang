// vibec-prepare is a build-time tool, not a compiler implementation. It
// prepares and identifies the standalone native executable for host bindings.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/smithersai/vibelang/compiler"
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr, compiler.PreparePinnedFork)) }

func run(args []string, stdout, stderr io.Writer, prepare func(context.Context, compiler.ForkConfig) (compiler.PreparedFork, error)) int {
	flags := flag.NewFlagSet("vibec-prepare", flag.ContinueOnError)
	flags.SetOutput(stderr)
	var config compiler.ForkConfig
	var timeout time.Duration
	flags.StringVar(&config.CheckoutDirectory, "fork-checkout", "", "exact pinned native source checkout")
	flags.StringVar(&config.CacheDirectory, "fork-cache", "", "prepared native executable cache")
	flags.StringVar(&config.GoCommand, "go-command", "", "Go executable used on a cache miss")
	flags.DurationVar(&timeout, "timeout", 5*time.Minute, "preparation deadline")
	if err := flags.Parse(args); err != nil {
		return 64
	}
	if config.CheckoutDirectory == "" || len(flags.Args()) != 0 || timeout <= 0 {
		fmt.Fprintln(stderr, "vibec-prepare requires --fork-checkout, a positive timeout, and no positional arguments")
		return 64
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	prepared, err := prepare(ctx, config)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if err := json.NewEncoder(stdout).Encode(prepared); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}
