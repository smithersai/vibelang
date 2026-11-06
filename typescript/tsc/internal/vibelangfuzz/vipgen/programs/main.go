// Command programs prints the fuzz generator's programs, one JSON object a
// line, for tests outside Go: each construct's probe, then -count programs
// from a seeded random source, so a run reproduces. The program's file names
// map to their text.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"maps"
	"math/rand/v2"
	"os"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

func main() {
	count := flag.Int("count", 64, "random programs after the probes")
	seed := flag.Uint64("seed", 20261105, "seed of the random programs")
	flag.Parse()
	out := json.NewEncoder(os.Stdout)
	print := func(key string, program *vipgen.Program) {
		if program == nil {
			return
		}
		files := maps.Clone(program.Files)
		if files == nil {
			files = map[string]string{}
		}
		files["main.vibe"] = vipgen.PrintVibe(program)
		if err := out.Encode(map[string]any{"key": key, "files": files}); err != nil {
			fmt.Fprintln(os.Stderr, "programs:", err)
			os.Exit(1)
		}
	}
	for _, construct := range vipgen.Constructs() {
		print(construct.Key, vipgen.Probe(construct.Key))
	}
	random := rand.New(rand.NewPCG(*seed, 0))
	for i := range *count {
		data := make([]byte, 512)
		for j := range data {
			data[j] = byte(random.UintN(256))
		}
		print(fmt.Sprintf("random-%d", i), vipgen.Generate(data, nil))
	}
}
