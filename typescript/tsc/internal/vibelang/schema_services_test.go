package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// vip57Project compiles files, a project whose entry is main.vibe, with
// effect and the runtime installed, and returns its diagnostics as
// "file(line): EKcode" or "file(line): TScode", sorted, and the JavaScript
// and declarations it emits by file name.
func vip57Project(t *testing.T, files map[string]string) (codes []string, emitted map[string]string) {
	t.Helper()
	dir := t.TempDir()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "node_modules"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, target := range editorPackages {
		target = filepath.Join(root, target)
		if _, err := os.Stat(target); err != nil {
			t.Fatalf("fixture package %q is unavailable at %s: %v; run sh scripts/setup.sh", name, target, err)
		}
		if err := os.Symlink(target, filepath.Join(dir, "node_modules", name)); err != nil {
			t.Fatal(err)
		}
	}
	all := map[string]string{
		"package.json":  `{"name":"vip57","type":"module"}`,
		"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"rewriteRelativeImportExtensions":true,"outDir":"out"},"include":["*.vibe"]}`,
	}
	for name, text := range files {
		all[name] = text
	}
	for name, text := range all {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	for _, file := range program.GetSourceFiles() {
		if !strings.HasSuffix(string(file.FileName()), ".vibe") {
			continue
		}
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			line, _ := scanner.GetECMALineAndUTF16CharacterOfPosition(file, d.Pos())
			prefix := "TS"
			if d.Source() == diagnosticSource {
				prefix = "EK"
			}
			codes = append(codes, fmt.Sprintf("%s(%d): %s%d", filepath.Base(string(file.FileName())), line+1, prefix, d.Code()))
		}
	}
	slices.Sort(codes)
	emitted = map[string]string{}
	program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		emitted[filepath.Base(string(name))] = text
		return nil
	}})
	return codes, emitted
}

const vip57Stats = `schema Summary { mean: number; max: number }
schema error EmptySample {}

export schema service Stats {
  summarize(values: readonly number[]): Summary!EmptySample
  count(values: readonly number[], floor?: number): number!!
  ticks(upTo: number): Stream<number, EmptySample>
  remote(id: string): number!(EmptySample | RpcClientError)
}

export default Layer.succeed(Stats, {
  summarize: effect (values) => {
    if (values.length === 0) throw new EmptySample()
    return { mean: 1, max: Math.max(...values) }
  },
  count: effect (values, floor) => values.length + (floor ?? 0),
  ticks: (upTo) => Stream.fromIterable([upTo]),
  remote: effect (id) => id.length
})
`

// TestSchemaServiceLowersToKeyClassAndGroup pins what VIP-57's schema
// service emits: the Rpc group, written as Effect's Rpc and RpcGroup, and
// the service's key class holding it.
func TestSchemaServiceLowersToKeyClassAndGroup(t *testing.T) {
	t.Parallel()
	codes, emitted := vip57Project(t, map[string]string{"main.vibe": vip57Stats})
	if len(codes) != 0 {
		t.Fatalf("unexpected diagnostics: %v", codes)
	}
	js := emitted["main.js"]
	for _, want := range []string{
		`import * as Rpc from "effect/rpc/Rpc";`,
		`import * as RpcGroup from "effect/rpc/RpcGroup";`,
		`export class StatsRpcs extends RpcGroup.make(`,
		`Rpc.make("summarize", { payload: { values: Schema.Array(Schema.Number) }, success: Summary, error: EmptySample })`,
		`Rpc.make("count", { payload: { values: Schema.Array(Schema.Number), floor: Schema.optional(Schema.Number) }, success: Schema.Number })`,
		`Rpc.make("ticks", { payload: { upTo: Schema.Number }, success: Schema.Number, error: EmptySample, stream: true })`,
		`Rpc.make("remote", { payload: { id: Schema.String }, success: Schema.Number, error: EmptySample })`,
		`export class Stats extends runtime.$schemaService("vip57/main#Stats", () => StatsRpcs, ["remote"]) {`,
	} {
		if !strings.Contains(js, want) {
			t.Errorf("main.js lacks %q:\n%s", want, js)
		}
	}
	if strings.Index(js, "class StatsRpcs") > strings.Index(js, "class Stats extends") {
		t.Errorf("the group is declared before the service:\n%s", js)
	}
	dts := emitted["main.d.ts"]
	for _, want := range []string{"StatsRpcs", "class Stats extends"} {
		if !strings.Contains(dts, want) {
			t.Errorf("main.d.ts lacks %q:\n%s", want, dts)
		}
	}
}

// TestSchemaServiceIsAService checks that a schema service is still a normal
// service: the same key, Stats.Shape, and Layer.succeed(Stats, …).
func TestSchemaServiceIsAService(t *testing.T) {
	t.Parallel()
	source := func(word string) string {
		return word + ` Users { find(id: string): string!! }
const shape: Users.Shape = { find: effect (id) => id }
export const UsersLive = Layer.succeed(Users, shape)
export const key: string = Users.key
export effect function main() {
  provide UsersLive { return try (try Users).find("a") }
}
`
	}
	for _, word := range []string{"service", "schema service"} {
		codes, emitted := vip57Project(t, map[string]string{"main.vibe": source(word)})
		if len(codes) != 0 {
			t.Errorf("%s: unexpected diagnostics: %v", word, codes)
		}
		if !strings.Contains(emitted["main.js"], `ervice("vip57/main#Users"`) {
			t.Errorf("%s: the key is vip57/main#Users:\n%s", word, emitted["main.js"])
		}
		if got, want := strings.Contains(emitted["main.js"], "$schemaService("), word == "schema service"; got != want {
			t.Errorf("%s: emits $schemaService: %v, want %v", word, got, want)
		}
	}
}

// TestSchemaServiceGroupReachesShadowedModules checks hygiene: the group
// names effect/rpc's Rpc and RpcGroup whatever the file declares.
func TestSchemaServiceGroupReachesShadowedModules(t *testing.T) {
	t.Parallel()
	codes, emitted := vip57Project(t, map[string]string{"main.vibe": `const Rpc = 1
const RpcGroup = 2
export schema service Echo { say(text: string): string!! }
export const mine = [Rpc, RpcGroup]
`})
	if len(codes) != 0 {
		t.Fatalf("unexpected diagnostics: %v", codes)
	}
	js := emitted["main.js"]
	if strings.Contains(js, "extends RpcGroup.make(") || strings.Contains(js, " Rpc.make(") {
		t.Errorf("the group calls the file's own bindings:\n%s", js)
	}
	for _, want := range []string{`from "effect/rpc/Rpc"`, `from "effect/rpc/RpcGroup"`, `.make("say", {`} {
		if !strings.Contains(js, want) {
			t.Errorf("main.js lacks %q:\n%s", want, js)
		}
	}
}

// TestSchemaServiceMemberDiagnostics checks EK5701 (schema-service-member),
// one for each member with no Rpc, and none for a member that has one.
func TestSchemaServiceMemberDiagnostics(t *testing.T) {
	t.Parallel()
	codes, _ := vip57Project(t, map[string]string{"main.vibe": `schema Point { x: number; y: number }
type Later = number!!
export schema service Bad {
  readonly region: string
  get size(): number
  find(id: string): Point!!
  find(id: number): Point!!
  pick<T>(value: T): T!!
  plain(id: string): string
  aliased(id: string): Later
  needs(id: string): Point!!Clock
  rest(...ids: string[]): number!!
  spread({ id }: { id: string }): number!!
  ok(id: string): Point!!
}
export schema service Whole: { run(): void!! } {}
`})
	want := []string{
		"main.vibe(4): EK5701", "main.vibe(5): EK5701", "main.vibe(6): EK5701", "main.vibe(7): EK5701", "main.vibe(8): EK5701",
		"main.vibe(9): EK5701", "main.vibe(10): EK5701", "main.vibe(11): EK5701", "main.vibe(12): EK5701", "main.vibe(13): EK5701",
		"main.vibe(16): EK5701",
	}
	slices.Sort(want)
	if !slices.Equal(codes, want) {
		t.Fatalf("diagnostics are\n%v\nwant\n%v", codes, want)
	}
}

// TestSchemaServiceBoundaryTypes checks EK2109 for a parameter, success or
// error type with no schema form, and that a plain service has no such rule.
func TestSchemaServiceBoundaryTypes(t *testing.T) {
	t.Parallel()
	body := ` Geometry {
  measure(shape: Shape): number!!
  callback(run: () => void): void!!
  fails(at: Point): Point!Plain
  anything(value: unknown): Point!!
  each(at: Point): Stream<Shape>
  ok(at: Point, label?: string): readonly Point[]!!
}
`
	prelude := "schema Point { x: number; y: number }\nerror Plain { reason: string }\ninterface Shape { area: number }\n"
	codes, _ := vip57Project(t, map[string]string{"main.vibe": prelude + "export schema service" + body})
	want := []string{"main.vibe(5): EK2109", "main.vibe(6): EK2109", "main.vibe(7): EK2109", "main.vibe(8): EK2109", "main.vibe(9): EK2109"}
	if !slices.Equal(codes, want) {
		t.Fatalf("diagnostics are\n%v\nwant\n%v", codes, want)
	}
	if codes, _ := vip57Project(t, map[string]string{"main.vibe": prelude + "export service" + body}); len(codes) != 0 {
		t.Fatalf("a plain service has no boundary rule, got %v", codes)
	}
}

// TestWorkerImportLowersToHandle pins what a worker import emits: the
// module's schema services imported by name, and a handle made from the
// module's URL. The handle's type is not the module's Layer.
func TestWorkerImportLowersToHandle(t *testing.T) {
	t.Parallel()
	codes, emitted := vip57Project(t, map[string]string{
		"stats.vibe": vip57Stats,
		"main.vibe": `import { Stats } from "./stats.vibe"
import statsWorker from "./stats.vibe" with { type: "worker" }

export const pool: Layer.Layer<Stats, never, Experimental.Rpc.WorkerHost> = Experimental.Rpc.workers(statsWorker, { size: 2 })
export const handle: Experimental.Rpc.WorkerHandle<Layer.Layer<Stats>> = statsWorker
`,
	})
	if len(codes) != 0 {
		t.Fatalf("unexpected diagnostics: %v", codes)
	}
	js := emitted["main.js"]
	for _, want := range []string{
		`import { Stats as statsWorker$Stats } from "./stats.js";`,
		`const statsWorker = runtime.$worker(new URL("./stats.js", import.meta.url), [statsWorker$Stats]);`,
	} {
		if !strings.Contains(js, want) {
			t.Errorf("main.js lacks %q:\n%s", want, js)
		}
	}
	if strings.Contains(js, `type: "worker"`) || strings.Contains(js, "import statsWorker") {
		t.Errorf("the worker import itself is not emitted:\n%s", js)
	}
}

// TestWorkerHandleIsNotALayer checks the binding's type: the handle cannot
// be provided as the module's Layer.
func TestWorkerHandleIsNotALayer(t *testing.T) {
	t.Parallel()
	codes, _ := vip57Project(t, map[string]string{
		"stats.vibe": vip57Stats,
		"main.vibe": `import { Stats } from "./stats.vibe"
import statsWorker from "./stats.vibe" with { type: "worker" }
export const direct: Layer.Layer<Stats> = statsWorker
`,
	})
	if want := []string{"main.vibe(3): TS2739"}; !slices.Equal(codes, want) {
		t.Fatalf("diagnostics are %v, want %v", codes, want)
	}
}

// TestWorkerImportDiagnostics checks EK5703 (worker-binding) and EK5702
// (worker-default-export).
func TestWorkerImportDiagnostics(t *testing.T) {
	t.Parallel()
	good := "export schema service Stats { double(value: number): number!! }\nexport default Layer.succeed(Stats, { double: effect (value) => value * 2 })\n"
	codes, _ := vip57Project(t, map[string]string{
		"good.vibe":       good,
		"named-only.vibe": "export schema service Stats { double(value: number): number!! }\nexport const StatsLive = Layer.succeed(Stats, { double: effect (value) => value * 2 })\n",
		"not-layer.vibe":  "export default { double: (value: number) => value * 2 }\n",
		"plain.vibe":      "export service Plain { double(value: number): number!! }\nexport default Layer.succeed(Plain, { double: effect (value) => value * 2 })\n",
		"unexported.vibe": "schema service Hidden { double(value: number): number!! }\nexport default Layer.succeed(Hidden, { double: effect (value) => value * 2 })\n",
		"main.vibe": `import { Stats } from "./good.vibe" with { type: "worker" }
import * as stats from "./good.vibe" with { type: "worker" }
import worker, { Stats as Again } from "./good.vibe" with { type: "worker" }
import "./good.vibe" with { type: "worker" }
import namedOnly from "./named-only.vibe" with { type: "worker" }
import notLayer from "./not-layer.vibe" with { type: "worker" }
import plain from "./plain.vibe" with { type: "worker" }
import unexported from "./unexported.vibe" with { type: "worker" }
import good from "./good.vibe" with { type: "worker" }
export const used = [Stats, stats, worker, Again, namedOnly, notLayer, plain, unexported, good]
`,
	})
	want := []string{
		"main.vibe(1): EK5703", "main.vibe(2): EK5703", "main.vibe(3): EK5703", "main.vibe(4): EK5703",
		"main.vibe(5): EK5702", "main.vibe(6): EK5702", "main.vibe(7): EK5702", "main.vibe(8): EK5702",
	}
	slices.Sort(want)
	if !slices.Equal(codes, want) {
		t.Fatalf("diagnostics are\n%v\nwant\n%v", codes, want)
	}
}

// TestWorkerImportSeparateContractModule checks that a worker module whose
// default export provides a schema service declared in another module (api.vibe)
// imports the service key from api.js without requiring impl.vibe to re-export it.
func TestWorkerImportSeparateContractModule(t *testing.T) {
	t.Parallel()
	codes, emitted := vip57Project(t, map[string]string{
		"api.vibe":  "export schema service Api { double(value: number): number!! }\n",
		"impl.vibe": "import { Api } from \"./api.vibe\"\nexport default Layer.succeed(Api, { double: effect (value) => value * 2 })\n",
		"main.vibe": `import { Api } from "./api.vibe"
import implWorker from "./impl.vibe" with { type: "worker" }
export effect function run(n: number) {
  provide Experimental.Rpc.workers(implWorker, { size: 1 }) {
    const api = try Api
    return try api.double(n)
  }
}
`,
	})
	if len(codes) != 0 {
		t.Fatalf("unexpected diagnostics: %v", codes)
	}
	js := emitted["main.js"]
	for _, want := range []string{
		`import { Api as implWorker$Api } from "./api.js";`,
		`const implWorker = runtime.$worker(new URL("./impl.js", import.meta.url), [implWorker$Api]);`,
	} {
		if !strings.Contains(js, want) {
			t.Errorf("main.js lacks %q:\n%s", want, js)
		}
	}
}

// TestSchemaServiceCodesAreRegistered checks the EK57xx block.
func TestSchemaServiceCodesAreRegistered(t *testing.T) {
	t.Parallel()
	for code, m := range map[int32]*Message{5701: EK5701, 5702: EK5702, 5703: EK5703} {
		if registry[code] != m {
			t.Errorf("EK%d is not registered", code)
		}
	}
}
