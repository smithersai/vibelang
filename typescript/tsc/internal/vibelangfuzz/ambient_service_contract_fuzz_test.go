package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// FuzzAmbientServiceContract checks a contract's requirement slot against
// chapter 5's per-meaning precedence, for the modules that name a service.
// The neighbourhood of Smithers' agent/fs (migrate-smithers inbox, EK9202
// "needs FileSystem, but its contract says R = FileSystem"): with the DOM lib
// loaded, Effect<string, never, FileSystem> names the DOM's FileSystem while
// the body reads Effect's FileSystem service. Each input is a service, a
// contract form, a lib and a spelling of the requirement:
//
//   - The module's own member (FileSystem.FileSystem) is the service key
//     ("the module FileSystem exports the service key FileSystem"), so a
//     contract that names it compiles.
//   - A bare name that an ambient lib declares as a type keeps that meaning
//     in a type position ("In a type position, a bare name declared as a type
//     by an ambient global declaration (a TypeScript `lib` file or `@types`)
//     keeps that meaning"), so when the body needs the service, the bare
//     contract lets the requirement escape: EK9202, "a requirement escapes
//     the written requirement contract".
//   - VIP-14 changed what that bare contract means, and "Every breaking
//     change ships a `vibelang --fix` codemod, so code that compiled under
//     the previous release migrates mechanically": compared with itself,
//     vibelang --fix and --fix-vip-only on the bare program write the
//     qualified program, which compiles.
//
// Whether the body needs the service at all (Console and Scheduler have
// defaults) is the compiler's answer for the same body under R = never.
var ambientServiceQuotes = []struct{ chapter, quote string }{
	{"005-services.md", "In a type position, a bare name declared as a type by an ambient global declaration (a TypeScript `lib` file or `@types`) keeps that meaning"},
	{"005-services.md", "the module FileSystem exports the service key FileSystem"},
	{"900-appendices.md", "a requirement escapes the written requirement contract"},
	{"007-tooling.md", "Every breaking change ships a `vibelang --fix` codemod, so code that compiled under the previous release migrates mechanically."},
}

// ambientServices are modules whose name names a service (D311), with the
// DOM's types among them (FileSystem, Console, Scheduler) and without.
var ambientServices = []string{"FileSystem", "Path", "Console", "Scheduler", "Terminal", "Stdio"}

// ambientContracts write a contract whose requirement slot is the given text.
var ambientContracts = []struct{ key, format string }{
	{"generic", "Effect<string, never, %s>"},
	{"bang", "string!!%s"},
	{"union", "Effect<string, never, %s | Clock.Clock>"},
}

var ambientLibs = []struct{ key, libs string }{
	{"dom", `["ES2022", "DOM"]`},
	{"es", `["ES2022"]`},
}

func TestAmbientServiceContractQuoted(t *testing.T) { ambientServiceChapters(t) }

func ambientServiceChapters(f testing.TB) {
	for _, q := range ambientServiceQuotes {
		chapter, err := os.ReadFile(SpecPath(q.chapter))
		if err != nil {
			f.Fatal(err)
		}
		if !strings.Contains(string(chapter), q.quote) {
			f.Fatalf("%s no longer says %q", q.chapter, q.quote)
		}
	}
}

type ambientServiceInput struct{ service, contract, lib string }

func (in ambientServiceInput) key() string { return in.service + "/" + in.contract + "/" + in.lib }

// ambientServiceDecode reads a keyed input, service/contract/lib, or picks
// one from the first three bytes of an older or mutated input.
func ambientServiceDecode(data []byte) ambientServiceInput {
	if parts := strings.Split(string(data), "/"); len(parts) == 3 {
		in := ambientServiceInput{parts[0], parts[1], parts[2]}
		known := func(key string, keys []string) bool {
			for _, k := range keys {
				if k == key {
					return true
				}
			}
			return false
		}
		var contracts, libs []string
		for _, c := range ambientContracts {
			contracts = append(contracts, c.key)
		}
		for _, l := range ambientLibs {
			libs = append(libs, l.key)
		}
		if known(in.service, ambientServices) && known(in.contract, contracts) && known(in.lib, libs) {
			return in
		}
	}
	at := func(i, n int) int {
		if i < len(data) {
			return int(data[i]) % n
		}
		return 0
	}
	return ambientServiceInput{ambientServices[at(0, len(ambientServices))], ambientContracts[at(1, len(ambientContracts))].key, ambientLibs[at(2, len(ambientLibs))].key}
}

func FuzzAmbientServiceContract(f *testing.F) {
	startShortBudget(f)
	ambientServiceChapters(f)
	for _, seed := range []string{"FileSystem/generic/dom", "FileSystem/bang/dom", "FileSystem/union/dom", "FileSystem/generic/es", "Path/generic/dom", "Console/generic/dom"} {
		f.Add([]byte(seed))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		in := ambientServiceDecode(data)
		var format, libs string
		for _, c := range ambientContracts {
			if c.key == in.contract {
				format = c.format
			}
		}
		for _, l := range ambientLibs {
			if l.key == in.lib {
				libs = l.libs
			}
		}
		config := strings.Replace(DefaultConfig, "\"strict\": true,", "\"strict\": true,\n    \"lib\": "+libs+",\n    \"types\": [],", 1)
		config = strings.TrimSuffix(config, "\n}") + ",\n  \"files\": [\"main.vibe\"]\n}"
		s := in.service
		program := func(requirement string) string {
			return "export effect function read(): " + fmt.Sprintf(format, requirement) + " {\n  const service = try " + s + "." + s + "\n  return String(typeof service)\n}\n"
		}
		type compiled struct {
			errors []string
			codes  map[int32]bool
			dir    string
		}
		compile := func(source string) compiled {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(r.Remove)
			c := compiled{codes: map[int32]bool{}, dir: r.Dir}
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					c.errors = append(c.errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
					if IsEK(d) {
						c.codes[d.Code()] = true
					}
				}
			}
			return c
		}
		qualified := program(s + "." + s)
		if q := compile(qualified); len(q.errors) > 0 {
			Gap(t, "FuzzAmbientServiceContract", "qualified:"+in.key(), "chapter 5: %q; a contract naming %s.%s does not compile:\n%s\n%s", ambientServiceQuotes[1].quote, s, s, qualified, strings.Join(q.errors, "\n"))
			return
		}
		ambient := in.lib == "dom" && (s == "FileSystem" || s == "Console" || s == "Scheduler")
		bare := program(s)
		b := compile(bare)
		if !ambient {
			return // chapter 5 leaves a bare name with no ambient type to the module's table
		}
		needs := compile(program("never")).codes[9202]
		if !needs {
			return // a service with a default adds no requirement to escape
		}
		if !b.codes[9202] {
			Gap(t, "FuzzAmbientServiceContract", "escape:"+in.key(), "chapter 5: %q, and %q is EK9202; got:\n%s\n%s", ambientServiceQuotes[0].quote, ambientServiceQuotes[2].quote, bare, strings.Join(b.errors, "\n"))
			return
		}
		// --fix writes other rewrites too (the prelude writes Clock.Clock as
		// Clock), so the bare program's fixed text is compared with the
		// qualified program's fixed text: the compiler with itself.
		fixedText := func(source string, options vibelang.FixOptions) string {
			r := compile(source)
			parsed := toolsConfig(w, r.dir)
			if parsed == nil {
				t.Fatal("no configuration")
			}
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), parsed, options)
			for name, file := range result.Files {
				if filepath.Base(name.AsString()) == "main.vibe" {
					return file.Text
				}
			}
			return source
		}
		for _, options := range []vibelang.FixOptions{{}, {VIPOnly: true}} {
			fixed, want := fixedText(bare, options), fixedText(qualified, options)
			if fixed != want {
				Gap(t, "FuzzAmbientServiceContract", "fix:"+in.key(), "chapter 7: %q; --fix %+v on the bare contract (EK9202) should write what it writes for the qualified program, which compiles; wrote:\n%s\nwant:\n%s", ambientServiceQuotes[3].quote, options, fixed, want)
				return
			}
		}
	})
}
