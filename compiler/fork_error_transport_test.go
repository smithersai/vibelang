package compiler

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Nominal Error identity and cross-realm transport, measured through the pinned
// fork's own lowering, prelude, and emitted JavaScript.
//
// specification/failures.mdx, "Error Classes", puts four obligations on the
// compiler for any named class extending Error: "stable nominal identity,
// matching metadata, serialization evidence, and cross-realm transport metadata
// while preserving ordinary Error behavior." Matching metadata was already
// provided by constructor-keyed dispatch, which needs no runtime registry. The
// other three are what these tests measure.
//
// Every claim here is proven by what the emitted JavaScript actually does. The
// transport tests deliberately run TWO separate node processes: transport is
// about a value leaving one realm and arriving in another, and a same-process
// encode/decode proves only that a function round-trips its own object. Only the
// wire string crosses between the two processes.

const transportSource = `export class InvalidPath extends Error {
    constructor(readonly path: string, readonly reason: string) {
        super("invalid path " + path + ": " + reason);
    }
}

export class Fieldless extends Error {}

export class Structured extends Error {
    constructor(readonly code: number, readonly tags: readonly string[], readonly detail: { readonly kind: string }) {
        super("structured");
    }
}

export class Ephemeral extends Error {
    constructor(readonly close: () => void) {
        super("ephemeral");
    }
}

export class Base extends Error {
    constructor(readonly resource: string) {
        super("base " + resource);
    }
}

export class Sub extends Base {}

export function describe(error: InvalidPath): string {
    return error.match({ InvalidPath: (failure) => "invalid:" + failure.path });
}

export function main(): string[] {
    return [new Fieldless().message];
}
`

// stageEmitted writes the emitted artifacts into one directory and returns it,
// so several separate processes can be run against the same emitted program.
func stageEmitted(t *testing.T, artifacts []Artifact) string {
	t.Helper()
	directory := t.TempDir()
	for _, item := range artifacts {
		path := filepath.Join(directory, filepath.FromSlash(item.Path))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, item.Content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, "package.json"), []byte(`{"type":"module"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	return directory
}

// runRealm executes one probe module in its own node process against a staged
// emitted program and decodes the single JSON object it prints. A fresh process
// per call is the point: nothing but `argument` crosses between two calls.
func runRealm(t *testing.T, directory string, name string, probe string, argument string) map[string]any {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is required to execute the emitted JavaScript")
	}
	file := filepath.Join(directory, name)
	if err := os.WriteFile(file, []byte(probe), 0o644); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(node, name, argument)
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("realm %s failed: %v\n%s", name, err, output)
	}
	observed := map[string]any{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(output))), &observed); err != nil {
		t.Fatalf("realm %s printed %q: %v", name, output, err)
	}
	return observed
}

func expectString(t *testing.T, observed map[string]any, key string, want string) {
	t.Helper()
	got, ok := observed[key]
	if !ok {
		t.Fatalf("no %q in %#v", key, observed)
	}
	if got != any(want) {
		t.Fatalf("%s = %#v, want %q", key, got, want)
	}
}

func expectBool(t *testing.T, observed map[string]any, key string, want bool) {
	t.Helper()
	got, ok := observed[key]
	if !ok {
		t.Fatalf("no %q in %#v", key, observed)
	}
	if got != any(want) {
		t.Fatalf("%s = %#v, want %v", key, got, want)
	}
}

// The identity is minted by the compiler from the module path and the class
// name. specification/failures.mdx, "Error Classes": authors "MUST NOT need a
// TaggedError("Name") factory, _tag declaration, or separate error-declaration
// syntax", and "Error Prototype" forbids selection on "a forgeable user _tag or
// minifier-sensitive constructor name", so there is no author-facing spelling
// for it at all.
func TestPinnedForkMintsNominalErrorIdentityFromTheModulePath(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "pkg/deep/service.sm", Kind: FileKindSmithers, Text: transportSource},
	})
	texts := requireCleanCompile(t, result)
	emitted, ok := texts["pkg/deep/service.js"]
	if !ok {
		t.Fatalf("missing emitted module: %v", artifactPaths(result.Artifacts))
	}
	for _, want := range []string{
		`__smithersRegisterError(InvalidPath, "smithers:pkg/deep/service.sm:InvalidPath");`,
		`__smithersRegisterError(Fieldless, "smithers:pkg/deep/service.sm:Fieldless");`,
		`__smithersRegisterError(Sub, "smithers:pkg/deep/service.sm:Sub");`,
		`__smithersRegisterError(Base, "smithers:pkg/deep/service.sm:Base");`,
	} {
		if !strings.Contains(emitted, want) {
			t.Fatalf("missing registration %q:\n%s", want, emitted)
		}
	}
	// The class declaration itself is untouched: "while preserving ordinary
	// Error behavior" is literal, so the registration is a separate statement
	// rather than a rewrite of the class.
	if !strings.Contains(emitted, "export class InvalidPath extends Error {") {
		t.Fatalf("the authored class must be emitted unchanged:\n%s", emitted)
	}
	// The declaration file is a type surface and carries no registration.
	if declaration := texts["pkg/deep/service.d.sm.ts"]; strings.Contains(declaration, "RegisterError") {
		t.Fatalf("declarations must not carry the runtime registration: %q", declaration)
	}
}

// The identity is per module, so two modules may declare same-named Errors and
// they may never collapse into one another.
func TestPinnedForkSameNamedErrorsInTwoModulesStayDistinct(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: `import { charge, Missing as PaymentsMissing } from "./payments.sm"

export class Missing extends Error {
    constructor(readonly key: string) { super("directory has no " + key); }
}

export { PaymentsMissing, charge };

export function main(): string[] {
    return [charge("zoe").match({ ok: (value) => value, error: (error) => error.message })];
}
`},
		{Path: "payments.sm", Kind: FileKindSmithers, Text: `export class Missing extends Error {
    constructor(readonly key: string) { super("payments has no " + key); }
}

export function charge(key: string): Result<string, Missing> {
    if (key !== "ada") throw new Missing(key);
    return "charged";
}
`},
	})
	texts := requireCleanCompile(t, result)
	if !strings.Contains(texts["main.js"], `__smithersRegisterError(Missing, "smithers:main.sm:Missing");`) {
		t.Fatalf("main.sm identity is wrong:\n%s", texts["main.js"])
	}
	if !strings.Contains(texts["payments.js"], `__smithersRegisterError(Missing, "smithers:payments.sm:Missing");`) {
		t.Fatalf("payments.sm identity is wrong:\n%s", texts["payments.js"])
	}

	// Registration of two same-named classes must not collide, and each wire
	// must decode back to its own class and only its own class.
	directory := stageEmitted(t, result.Artifacts)
	observed := runRealm(t, directory, "distinct.mjs", `import { smithersEncodeError, smithersDecodeError, smithersErrorIdentity } from "./__smithers_prelude.js";
import { Missing, PaymentsMissing } from "./main.js";
const local = new Missing("zoe");
const remote = new PaymentsMissing("zoe");
const localWire = smithersEncodeError(local);
const remoteWire = smithersEncodeError(remote);
const backLocal = smithersDecodeError(localWire);
const backRemote = smithersDecodeError(remoteWire);
console.log(JSON.stringify({
  localIdentity: smithersErrorIdentity(local),
  remoteIdentity: smithersErrorIdentity(remote),
  localWire,
  remoteWire,
  localIsLocal: backLocal instanceof Missing,
  localIsRemote: backLocal instanceof PaymentsMissing,
  remoteIsRemote: backRemote instanceof PaymentsMissing,
  remoteIsLocal: backRemote instanceof Missing,
  localMessage: backLocal.message,
  remoteMessage: backRemote.message,
}));
`, "")
	expectString(t, observed, "localIdentity", "smithers:main.sm:Missing")
	expectString(t, observed, "remoteIdentity", "smithers:payments.sm:Missing")
	expectString(t, observed, "localWire", `{"version":1,"identity":"smithers:main.sm:Missing","payload":{"key":"zoe","message":"directory has no zoe"}}`)
	expectString(t, observed, "remoteWire", `{"version":1,"identity":"smithers:payments.sm:Missing","payload":{"key":"zoe","message":"payments has no zoe"}}`)
	expectBool(t, observed, "localIsLocal", true)
	expectBool(t, observed, "localIsRemote", false)
	expectBool(t, observed, "remoteIsRemote", true)
	expectBool(t, observed, "remoteIsLocal", false)
	expectString(t, observed, "localMessage", "directory has no zoe")
	expectString(t, observed, "remoteMessage", "payments has no zoe")
}

// specification/durable-execution.mdx, "Durable Boundary": "Plain data SHOULD
// derive the contract automatically. Functions, capabilities, process handles,
// and other ephemeral values MUST be rejected unless they define an explicit
// durable representation."
func TestPinnedForkDerivesTheErrorCodecFromPlainData(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: transportSource},
	})
	directory := stageEmitted(t, requireCleanCompileArtifacts(t, result))
	observed := runRealm(t, directory, "derive.mjs", `import { smithersEncodeError } from "./__smithers_prelude.js";
import { InvalidPath, Fieldless, Structured, Ephemeral, Base, Sub } from "./main.js";
const out = {};
const attempt = (label, make) => {
  try { out[label] = smithersEncodeError(make()); }
  catch (failure) { out[label] = failure.name + ": " + failure.message; }
};
attempt("fields", () => new InvalidPath("/etc", "not a directory"));
attempt("fieldless", () => new Fieldless());
attempt("structured", () => new Structured(7, ["a", "b"], { kind: "io" }));
attempt("ephemeral", () => new Ephemeral(() => {}));
attempt("cycle", () => { const e = new Fieldless(); e.self = e; return e; });
attempt("nonFinite", () => { const e = new Fieldless(); e.ratio = Infinity; return e; });
attempt("symbolKey", () => { const e = new Fieldless(); e.holder = { [Symbol("s")]: 1 }; return e; });
attempt("base", () => new Base("disk"));
attempt("sub", () => new Sub("disk"));
attempt("cause", () => new Fieldless("m", { cause: new Error("root") }));
console.log(JSON.stringify(out));
`, "")
	// Plain data derives: message plus every own enumerable data property, with
	// object keys canonically sorted.
	expectString(t, observed, "fields", `{"version":1,"identity":"smithers:main.sm:InvalidPath","payload":{"message":"invalid path /etc: not a directory","path":"/etc","reason":"not a directory"}}`)
	expectString(t, observed, "fieldless", `{"version":1,"identity":"smithers:main.sm:Fieldless","payload":{"message":""}}`)
	expectString(t, observed, "structured", `{"version":1,"identity":"smithers:main.sm:Structured","payload":{"code":7,"detail":{"kind":"io"},"message":"structured","tags":["a","b"]}}`)
	// A subclass carries its own identity, and its inherited fields still derive.
	expectString(t, observed, "base", `{"version":1,"identity":"smithers:main.sm:Base","payload":{"message":"base disk","resource":"disk"}}`)
	expectString(t, observed, "sub", `{"version":1,"identity":"smithers:main.sm:Sub","payload":{"message":"base disk","resource":"disk"}}`)
	// `cause` supplied through the Error options bag is non-enumerable, so it is
	// host state rather than payload and never reaches the wire.
	expectString(t, observed, "cause", `{"version":1,"identity":"smithers:main.sm:Fieldless","payload":{"message":"m"}}`)
	// Ephemeral and non-data values are REJECTED, and the refusal names the
	// exact path rather than dropping the field silently.
	expectString(t, observed, "ephemeral", "ErrorCodecError: $.payload.close is not JSON data")
	expectString(t, observed, "cycle", "ErrorCodecError: $.payload.self is not a plain JSON object")
	expectString(t, observed, "nonFinite", "ErrorCodecError: $.payload.ratio contains a non-finite number")
	expectString(t, observed, "symbolKey", "ErrorCodecError: $.payload.holder has a symbol key")
}

// Transport means the value LEAVES one realm and ARRIVES in another, so the two
// halves run in two separate node processes and only the wire string crosses.
func TestPinnedForkErrorCrossesARealmBoundary(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: transportSource},
	})
	directory := stageEmitted(t, requireCleanCompileArtifacts(t, result))

	sender := runRealm(t, directory, "sender.mjs", `import { smithersEncodeError } from "./__smithers_prelude.js";
import { InvalidPath } from "./main.js";
console.log(JSON.stringify({ wire: smithersEncodeError(new InvalidPath("/etc", "not a directory")) }));
`, "")
	wire, ok := sender["wire"].(string)
	if !ok {
		t.Fatalf("sender realm produced no wire: %#v", sender)
	}

	receiver := runRealm(t, directory, "receiver.mjs", `import { smithersDecodeError, smithersErrorIdentity } from "./__smithers_prelude.js";
import { InvalidPath, describe } from "./main.js";
const back = smithersDecodeError(process.argv[2]);
console.log(JSON.stringify({
  message: back.message,
  path: back.path,
  reason: back.reason,
  identity: smithersErrorIdentity(back),
  isError: back instanceof Error,
  isInvalidPath: back instanceof InvalidPath,
  prototypeExact: Object.getPrototypeOf(back) === InvalidPath.prototype,
  stackIsString: typeof back.stack === "string",
  nominalIs: back.is(InvalidPath),
  farSideMatch: describe(back),
}));
`, wire)
	expectString(t, receiver, "message", "invalid path /etc: not a directory")
	expectString(t, receiver, "path", "/etc")
	expectString(t, receiver, "reason", "not a directory")
	expectString(t, receiver, "identity", "smithers:main.sm:InvalidPath")
	// "while preserving ordinary Error behavior" — on the far side too.
	expectBool(t, receiver, "isError", true)
	expectBool(t, receiver, "isInvalidPath", true)
	expectBool(t, receiver, "prototypeExact", true)
	expectBool(t, receiver, "stackIsString", true)
	expectBool(t, receiver, "nominalIs", true)
	// The arrived error reaches nominal matching on the far side.
	expectString(t, receiver, "farSideMatch", "invalid:/etc")
}

// The other direction. Nothing that is not a genuine instance may be given a
// nominal identity, and no hand-written wire may be decoded into one.
func TestPinnedForkErrorTransportRefusesForgeries(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: transportSource},
	})
	directory := stageEmitted(t, requireCleanCompileArtifacts(t, result))
	observed := runRealm(t, directory, "forgery.mjs", `import { smithersEncodeError, smithersDecodeError, smithersErrorIdentity } from "./__smithers_prelude.js";
import { InvalidPath } from "./main.js";
const out = {};
const attempt = (label, body) => {
  try { out[label] = { ok: body() }; }
  catch (failure) { out[label] = { refused: failure.name + ": " + failure.message }; }
};
attempt("lookAlikeObject", () => smithersEncodeError({ name: "InvalidPath", message: "m", path: "/x", reason: "r" }));
attempt("lookAlikeError", () => { const e = new Error("m"); e.name = "InvalidPath"; e.path = "/x"; return smithersEncodeError(e); });
attempt("runtimeSubclass", () => { class Sneaky extends InvalidPath {}; return smithersEncodeError(new Sneaky("/x", "r")); });
attempt("unregisteredClass", () => { class Impostor extends Error {}; return smithersEncodeError(new Impostor("m")); });
attempt("hasInstanceLiar", () => { class Liar extends Error { static [Symbol.hasInstance]() { return true; } } return smithersEncodeError(new Liar("m")); });
attempt("unknownIdentity", () => smithersDecodeError('{"version":1,"identity":"smithers:other.sm:InvalidPath","payload":{"message":"m"}}'));
attempt("nonCanonicalOrder", () => smithersDecodeError('{"version":1,"identity":"smithers:main.sm:InvalidPath","payload":{"path":"/x","message":"m"}}'));
attempt("prettyPrinted", () => smithersDecodeError('{\n  "version": 1,\n  "identity": "smithers:main.sm:InvalidPath",\n  "payload": { "message": "m" }\n}'));
attempt("wrongVersion", () => smithersDecodeError('{"version":2,"identity":"smithers:main.sm:InvalidPath","payload":{"message":"m"}}'));
attempt("extraEnvelopeField", () => smithersDecodeError('{"version":1,"identity":"smithers:main.sm:InvalidPath","payload":{"message":"m"},"extra":1}'));
attempt("notJson", () => smithersDecodeError("not json"));
attempt("notAString", () => smithersDecodeError(17));
attempt("stealARegisteredIdentity", () => { class Impostor extends Error {}; return String(smithersErrorIdentity(new Impostor("m"))); });
out.lookAlikeHasNoIdentity = smithersErrorIdentity({ name: "InvalidPath", message: "m" }) === undefined;
out.lookAlikeErrorIsNotNominal = (() => { const e = new Error("m"); e.name = "InvalidPath"; return e.is(InvalidPath); })();
out.genuineIsNotALiar = (() => { class Liar extends Error {} Object.defineProperty(Liar, Symbol.hasInstance, { value: () => true }); return new InvalidPath("/x", "r").is(Liar); })();
console.log(JSON.stringify(out));
`, "")

	refusals := map[string]string{
		"lookAlikeObject":   "ErrorCodecError: only local Error instances can be encoded",
		"runtimeSubclass":   "ErrorCodecError: Error has no registered transport codec",
		"unregisteredClass": "ErrorCodecError: Error has no registered transport codec",
		"hasInstanceLiar":   "ErrorCodecError: Error has no registered transport codec",
		"unknownIdentity":   "ErrorCodecError: unknown Error identity smithers:other.sm:InvalidPath",
		"nonCanonicalOrder": "ErrorCodecError: encoded Error is not canonical JSON",
		"prettyPrinted":     "ErrorCodecError: encoded Error is not canonical JSON",
		"wrongVersion":      "ErrorCodecError: encoded Error has an unsupported envelope",
		"notJson":           "ErrorCodecError: encoded Error is not valid JSON",
		"notAString":        "ErrorCodecError: encoded Error must be a string",
	}
	for label, want := range refusals {
		entry, ok := observed[label].(map[string]any)
		if !ok {
			t.Fatalf("no %q in %#v", label, observed)
		}
		if entry["refused"] != any(want) {
			t.Fatalf("%s = %#v, want refusal %q", label, entry, want)
		}
	}
	// An ordinary Error that merely renames itself is transported as an ordinary
	// Error, never as the class whose name it borrowed.
	lookAlike, _ := observed["lookAlikeError"].(map[string]any)
	if lookAlike["ok"] != any(`{"version":1,"identity":"javascript:Error@1","payload":{"message":"m"}}`) {
		t.Fatalf("a renamed Error must keep the builtin identity: %#v", lookAlike)
	}
	stolen, _ := observed["stealARegisteredIdentity"].(map[string]any)
	if stolen["ok"] != any("undefined") {
		t.Fatalf("an unregistered class must have no identity: %#v", stolen)
	}
	expectBool(t, observed, "lookAlikeHasNoIdentity", true)
	expectBool(t, observed, "lookAlikeErrorIsNotNominal", false)
	// specification/failures.mdx, "Error Prototype": handler selection may not
	// run on a forgeable hook. A class that installs its own Symbol.hasInstance
	// must not be able to claim another class's instances.
	expectBool(t, observed, "genuineIsNotALiar", false)
}

// An identity may be claimed once. Two classes cannot share one, and a class
// cannot be given two.
func TestPinnedForkNominalIdentityCannotBeClaimedTwice(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: transportSource},
	})
	directory := stageEmitted(t, requireCleanCompileArtifacts(t, result))
	observed := runRealm(t, directory, "claims.mjs", `import { smithersRegisterError } from "./__smithers_prelude.js";
import { InvalidPath, Fieldless } from "./main.js";
const out = {};
const attempt = (label, body) => {
  try { out[label] = { ok: String(body()) }; }
  catch (failure) { out[label] = { refused: failure.name + ": " + failure.message }; }
};
attempt("stealAnotherClassIdentity", () => { class Impostor extends Error {} return smithersRegisterError(Impostor, "smithers:main.sm:InvalidPath"); });
attempt("secondIdentityForOneClass", () => smithersRegisterError(InvalidPath, "smithers:main.sm:Other"));
attempt("reRegisterSameIdentity", () => { smithersRegisterError(Fieldless, "smithers:main.sm:Fieldless"); return "idempotent"; });
attempt("notAnErrorClass", () => smithersRegisterError(class NotAnError {}, "smithers:main.sm:NotAnError"));
attempt("invalidIdentity", () => { class Other extends Error {} return smithersRegisterError(Other, "has a space"); });
console.log(JSON.stringify(out));
`, "")
	for label, want := range map[string]string{
		"stealAnotherClassIdentity": "TypeError: stable Error identity smithers:main.sm:InvalidPath is already registered",
		"secondIdentityForOneClass": "TypeError: Error constructor is already registered as smithers:main.sm:InvalidPath",
		"notAnErrorClass":           "TypeError: Error identity requires a class extending Error",
		"invalidIdentity":           `TypeError: invalid stable Error identity: "has a space"`,
	} {
		entry, ok := observed[label].(map[string]any)
		if !ok {
			t.Fatalf("no %q in %#v", label, observed)
		}
		if entry["refused"] != any(want) {
			t.Fatalf("%s = %#v, want refusal %q", label, entry, want)
		}
	}
	idempotent, _ := observed["reRegisterSameIdentity"].(map[string]any)
	if idempotent["ok"] != any("idempotent") {
		t.Fatalf("re-registering the same class with the same identity must be idempotent: %#v", idempotent)
	}
}

// A `declare class X extends Error {}` reserves an identity but emits no
// binding, so there is nothing to register. The reference frontend does emit a
// registration there and the program it accepts dies on load with
// "ReferenceError: X is not defined"; the fork deliberately does not reproduce
// that, because a clean compile that cannot run is not an acceptance.
func TestPinnedForkDoesNotRegisterAnAmbientErrorDeclaration(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: `declare class Ambient extends Error {
    readonly key: string;
}

export function describe(error: Ambient): string {
    return error.key;
}

export function main(): string[] {
    return ["ok"];
}
`},
	})
	texts := requireCleanCompile(t, result)
	if strings.Contains(texts["main.js"], "RegisterError") {
		t.Fatalf("an ambient Error declaration must not be registered:\n%s", texts["main.js"])
	}
	directory := stageEmitted(t, result.Artifacts)
	observed := runRealm(t, directory, "ambient.mjs", `import { main } from "./main.js";
console.log(JSON.stringify({ ran: main().join(",") }));
`, "")
	expectString(t, observed, "ran", "ok")
}

func requireCleanCompileArtifacts(t *testing.T, result CompileResult) []Artifact {
	t.Helper()
	requireCleanCompile(t, result)
	return result.Artifacts
}
