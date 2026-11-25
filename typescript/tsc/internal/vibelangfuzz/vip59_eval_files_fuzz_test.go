package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

const vip59Observer = `import { Effect } from "effect"
import { basename, join, relative } from "node:path"
import { pathToFileURL } from "node:url"

export function observe(repo, root, file, alias, importer, emitted) {
  return Effect.promise(async () => {
    const { discover, main } = await import(pathToFileURL(join(repo, "packages/compiler/eval.mjs")))
    const { default: vibelang } = await import(pathToFileURL(join(repo, "packages/vite/src/index.js")))
    const plugin = vibelang()
    plugin.configResolved({ root, logger: { warn() {} } })
    try {
      const io = { cwd: root, stdout: () => {}, stderr: () => {} }
      const found = discover([], root).map(path => relative(root, path))
      const explicit = discover([file, ".", file], root).map(path => relative(root, path))
      const invalidFile = await main(["src/ordinary.vibe"], io)
      const paidWithoutLive = await main(["--trials", "2"], io)
      const listLive = await main(["--list", "--live"], io)
      const noFiles = await main([".hidden-empty"], io)
      const listNoFiles = await main(["--list", ".hidden-empty"], io)
      const hook = async (source, from) => {
        try {
          await plugin.resolveId.call({ resolve: async () => null }, source, from, {})
          return "allowed"
        } catch (error) {
          if (error.message.includes("imports the eval file") &&
              error.message.includes(basename(file)) &&
              error.message.includes(from.split("?")[0]) &&
              error.message.includes("(VIP-59)")) return "refused"
          throw error
        }
      }
      const boundary = [
        await hook(alias, join(root, importer)),
        await hook("./" + basename(file), join(root, "src/app.vibe")),
        await hook(alias, join(root, "src/peer.eval.vibe")),
        await hook("./ordinary.vibe", join(root, "src/app.ts")),
        await hook(join(root, file), undefined)
      ]
      const suite = emitted ? await import("./" + emitted) : null
      return {
        found, explicit, invalidFile, paidWithoutLive, listLive, noFiles, listNoFiles, boundary,
        suite: suite && [suite.default.name, suite.default.cases[0].name, suite.calls]
      }
    } finally {
      await plugin.closeBundle()
    }
  })
}
`

func FuzzVIP59EvalFiles(f *testing.F) {
	startShortBudget(f)
	for _, dependency := range []string{"magic-string", "@jridgewell/remapping"} {
		if _, err := os.Stat(filepath.Join(Root(), "packages/vite/node_modules", dependency, "package.json")); err != nil {
			Missing(f, "VIP-59 needs Vite plugin dependencies: run (cd packages/vite && bun install): %v", err)
		}
	}
	for row := uint8(0); row < 10; row++ {
		f.Add(row, uint16(row*17), false)
		f.Add(row, uint16(row*17), true)
	}
	w := NewWorkspace(f)
	node := vipNode(f, w)
	f.Fuzz(func(t *testing.T, variant uint8, id uint16, jsx bool) {
		ext, outputExt := ".vibe", ".js"
		if jsx {
			ext, outputExt = ".vibex", ".jsx"
		}
		stem := fmt.Sprintf("suite.%d.eval", id)
		file := "src/" + stem + ext
		source := fmt.Sprintf(`export let calls = 0
effect function greet(name: string) { calls++; return name + %q }
export default Experimental.Eval.suite(%q, {
  target: greet,
  cases: [{ name: "one", input: ["Ada"], expected: %q }],
  scorers: [Experimental.Scorer.exact]
})
`, fmt.Sprint(id), stem, fmt.Sprintf("Ada%d", id))
		row := variant % 10
		optIn := `,"vibe":{"experimental":["builtins"]}`
		var want []string
		switch row {
		case 6:
			source = strings.Replace(source, `input: ["Ada"]`, "input: [42]", 1)
			want = []string{"TS2322"}
		case 7:
			optIn = ""
			want = []string{"EK3013"}
		case 8:
			source += `export const legacy = eval("1")` + "\n"
			want = []string{"EK0107"}
		case 9:
			// A plain data module has no special compiler requirements, even
			// with the eval suffix. The eval runner owns suite validation.
			source = "export const ordinary = 1\n"
		}
		files := map[string]string{
			file:                               source,
			"src/peer.eval.vibe":               "export {}",
			"src/deep/card.eval.vibex":         "export {}",
			"src/ordinary.vibe":                "export {}",
			"src/ordinary.eval.vibe.ts":        "export {}",
			"src/ordinary.EVAL.vibe":           "export {}",
			"node_modules/demo/skip.eval.vibe": "export {}",
			"dist/skip.eval.vibex":             "export {}",
			".cache/skip.eval.vibe":            "export {}",
			".hidden-empty/README":             "",
			"src/app.ts":                       "export {}",
			"src/app.vibe":                     "export {}",
		}
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,
  "skipLibCheck":true,"declaration":true,"outDir":"out","rootDir":".","jsx":"preserve","noEmitOnError":true},
  "files":[%q]%s}`, file, optIn)
		r := vipCompile(t, w, Project{Files: files, Config: config})
		vipDiagnostics(t, r, want...)
		emitted := ""
		if len(want) > 0 {
			if !r.EmitSkipped || len(r.Outputs) != 0 {
				t.Fatalf("noEmitOnError must refuse all output, got %v", r.Outputs)
			}
		} else {
			if r.EmitSkipped || r.Outputs["out/src/"+stem+outputExt] == "" {
				t.Fatalf("expected emitted %s for %s, got outputs %v", outputExt, file, r.Outputs)
			}
			if row != 9 {
				// The fixture contains no JSX. Node's regular JS loader can
				// import its emitted body and observe suite construction.
				emitted = "suite.mjs"
				r.Outputs["out/"+emitted] = r.Outputs["out/src/"+stem+outputExt]
			}
		}
		alias := []string{"./" + stem + ext, "./" + stem, "./" + stem + outputExt,
			"./" + stem + ext + "?import", filepath.Join(r.Dir, filepath.FromSlash(file)),
			"./" + stem + ext + ".js"}[row%6]
		importer := "src/app.ts"
		if row == 4 {
			importer += "?t=12"
		}
		r.Outputs["out/observe.mjs"] = vip59Observer
		out := node.Run(r, "out/observe.mjs", "observe", Root(), r.Dir, file, alias, importer, emitted)
		var got struct {
			Found, Explicit, Boundary                                    []string
			InvalidFile, PaidWithoutLive, ListLive, NoFiles, ListNoFiles int
			Suite                                                        []any
		}
		if err := json.Unmarshal(out.Value, &got); out.Kind != "success" || err != nil {
			t.Fatalf("expected discovery and bundle observation, got %+v (%v)", out, err)
		}
		found := []string{file, "src/peer.eval.vibe", "src/deep/card.eval.vibex"}
		sort.Strings(found)
		boundary := []string{"refused", "refused", "allowed", "allowed", "allowed"}
		var suite []any
		if emitted != "" {
			suite = []any{stem, "one", float64(0)}
		}
		if !reflect.DeepEqual(got.Found, found) || !reflect.DeepEqual(got.Explicit, found) ||
			!reflect.DeepEqual(got.Boundary, boundary) || !reflect.DeepEqual(got.Suite, suite) ||
			got.InvalidFile != 2 || got.PaidWithoutLive != 2 || got.ListLive != 2 ||
			got.NoFiles != 5 || got.ListNoFiles != 0 {
			t.Fatalf("unexpected VIP-59 behavior for %s via %s:\n%s", file, alias, out.Value)
		}
	})
}
