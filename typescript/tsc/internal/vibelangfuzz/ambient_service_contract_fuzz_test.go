package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
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
