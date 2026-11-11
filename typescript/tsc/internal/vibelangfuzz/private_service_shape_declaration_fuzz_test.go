package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const privateServiceShapeTarget = "FuzzPrivateServiceShapeDeclaration"

// Chapter 5, "Two types": the declaration output of a service declares the
// Shape name that source annotations write.
const privateServiceShapeQuote = "the compiler declares `Users.Shape` as a direct alias of the written member object"

var privateServiceShapeScopes = []string{"private", "namespace", "imported", "type-imported", "exported"}

// Each use writes Port.Shape in one exported declaration that TypeScript
// spells the same way, so one text serves the source and its twin.
var privateServiceShapeUses = []struct{ key, text string }{
	{"const", "export const value: Port.Shape = { v: 1 }"},
	{"parameter", "export function take(port: Port.Shape): number { return port.v }"},
	{"return", "export function make(): Port.Shape { return { v: 1 } }"},
	{"alias", "export type Alias = Port.Shape"},
	{"interface", "export interface Wide extends Port.Shape { extra: number }"},
	{"array", "export const list: ReadonlyArray<Port.Shape> = []"},
	{"property", "export const holder: { inner: Port.Shape } = { inner: { v: 1 } }"},
	{"indexed", "export const count: Port.Shape[\"v\"] = 1"},
	{"class-member", "export class Box { inner: Port.Shape = { v: 1 } }"},
	{"twice", "export function swap(port: Port.Shape): Array<Port.Shape> { return [port] }"},
}

func TestPrivateServiceShapeDeclarationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), privateServiceShapeQuote) {
		t.Fatalf("chapter 5 no longer says %q", privateServiceShapeQuote)
	}
}

// A declaration file that names Port.Shape must declare or import Port,
// whether or not the module exports the service. The oracle is stock tsc's
// declaration output for the Effect TypeScript twin, compared through the
// shared API gate, which also rejects a declaration file that does not check.
func FuzzPrivateServiceShapeDeclaration(f *testing.F) {
	startShortBudget(f)
	w, tsc := NewWorkspace(f), StockTypeScript(f)
	config := strings.Replace(errorTwinConfig, `"skipLibCheck":true`, `"skipLibCheck":false,"types":[]`, 1)
	if testing.Short() {
		f.Add("private", "const")
		f.Add("private", "interface")
		f.Add("namespace", "alias")
		f.Add("imported", "const")
	} else {
		for _, scope := range privateServiceShapeScopes {
			for _, use := range privateServiceShapeUses {
				f.Add(scope, use.key)
			}
		}
	}
	f.Fuzz(func(t *testing.T, scope, use string) {
		defer recoverCompilerPanic(t, privateServiceShapeTarget)
		if !slices.Contains(privateServiceShapeScopes, scope) {
			scope = privateServiceShapeScopes[len(scope)%len(privateServiceShapeScopes)]
		}
		choice := slices.IndexFunc(privateServiceShapeUses, func(u struct{ key, text string }) bool { return u.key == use })
		if choice < 0 {
			choice = len(use) % len(privateServiceShapeUses)
		}
		use, text := privateServiceShapeUses[choice].key, privateServiceShapeUses[choice].text
		const service = "service Port { static readonly key = \"probe/Port\"; v: number }"
		const twin = "type Port_shape = { v: number }\nclass Port extends Context.Service<Port, Port_shape>()(\"probe/Port\") {}\ndeclare namespace Port { type Shape = Port_shape }"
		const context = "import { Context } from \"effect\"\n"
		source := map[string]string{"package.json": servicesPackage}
		counterpart := map[string]string{"package.json": servicesPackage}
		switch scope {
		case "private":
			source["main.vibe"] = service + "\n" + text + "\n"
			counterpart["main.ts"] = context + twin + "\n" + text + "\n"
		case "exported":
			source["main.vibe"] = "export " + service + "\n" + text + "\n"
			counterpart["main.ts"] = context + strings.NewReplacer("class Port", "export class Port", "declare namespace", "export declare namespace").Replace(twin) + "\n" + text + "\n"
		case "namespace":
			source["main.vibe"] = "export namespace Inner {\n" + service + "\n" + text + "\n}\n"
			counterpart["main.ts"] = context + "export namespace Inner {\n" + twin + "\n" + text + "\n}\n"
		default:
			binding := "import { Port } from \"./port.js\"\n"
			if scope == "type-imported" {
				binding = "import type { Port } from \"./port.js\"\n"
			}
			source["port.vibe"] = "export " + service + "\n"
			source["main.vibe"] = binding + text + "\n"
			counterpart["port.ts"] = context + strings.NewReplacer("class Port", "export class Port", "declare namespace", "export declare namespace").Replace(twin) + "\n"
			counterpart["main.ts"] = binding + text + "\n"
		}
		gap := scope + "/" + use
		var c *Compilation
		var err error
		within(t, "compile", func() {
			c, err = w.CompileOrdered(t.Context(), Project{Files: source, Config: fmt.Sprintf(config, "main.vibe")}, OrderTsc, true)
		})
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		if c.Program == nil || HasError(c.Diagnostics) {
			Gap(t, privateServiceShapeTarget, "compile:"+gap, "Chapter 5: %s; got %v\n%s", privateServiceShapeQuote, SortedKeys(Keys(c.Dir, c.Diagnostics)), source["main.vibe"])
			return
		}
		dir := emitDeclarationIdentityStock(t, w, tsc, Project{Files: counterpart, Config: fmt.Sprintf(config, "main.ts")})
		defer os.RemoveAll(dir)
		want, got := map[string]string{}, map[string]string{}
		for file := range counterpart {
			if !strings.HasSuffix(file, ".ts") {
				continue
			}
			name := strings.TrimSuffix(file, ".ts") + ".d.ts"
			text, err := os.ReadFile(filepath.Join(dir, "__identity_out", name))
			if err != nil {
				t.Fatal(err)
			}
			want[name] = string(text)
			output, ok := c.Outputs["__identity_out/"+name]
			if !ok {
				t.Fatal("missing declaration output", name, c.Outputs)
			}
			got[name] = output
		}
		if diff := compareDeclarationOutputs(t, want, got); diff != "" {
			Gap(t, privateServiceShapeTarget, "api:"+gap, "Chapter 5: %s\nAPI comparison:\n%s\nsource:\n%s\ndeclarations:\n%s\ntwin declarations:\n%s", privateServiceShapeQuote, diff, source["main.vibe"], got["main.d.ts"], want["main.d.ts"])
		}
		ExpectPending(t, privateServiceShapeTarget, specCorpusKey(t))
	})
}
