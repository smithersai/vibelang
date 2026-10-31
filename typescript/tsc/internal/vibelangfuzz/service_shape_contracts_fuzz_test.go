package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const servicePrivateShapeQuote = "the counterpart is a private named member type and the class (or `const`), without a namespace"
const serviceReferenceTypeQuote = "`Flags.Shape` and no identifier type"
const serviceLocalShapeQuote = "Elsewhere `Users.Shape` is not declared"

func serviceShapeContractsQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{servicePrivateShapeQuote, serviceReferenceTypeQuote, serviceLocalShapeQuote, "`new Users()`", "`class X extends Users {}`"} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
}
func TestServiceShapeContractsQuoted(t *testing.T) { serviceShapeContractsQuoted(t) }

// The object-type and Context.Reference counterparts in chapter 5 provide
// independent TypeScript diagnostic controls. Key construction/extension uses
// the two explicitly assigned VibeLang diagnostic identities.
func FuzzServiceShapeContracts(f *testing.F) {
	startShortBudget(f)
	serviceShapeContractsQuoted(f)
	for _, key := range []string{"plain-return", "identity-members", "this-type", "reference-type", "typed-key-alias", "local-shape", "shape-shadow", "public-shape-dts"} {
		f.Add([]byte(key))
		f.Add([]byte(key + "\x00\x03"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		variant := byte(0)
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		shape := "value: number"
		vibe := "export service Users { static readonly key = \"fuzz/Users\"; " + shape + " }\n"
		native := "import { Context } from 'effect'\ntype UsersShape = { " + shape + " }\nexport class Users extends Context.Service<Users, UsersShape>()('fuzz/Users') {}\n"
		explicit := int32(0)
		publicDts := false
		switch key {
		case "plain-return":
			result, value := "number", "7"
			if variant&1 != 0 {
				result, value = "string", "'ok'"
			}
			shape = "read(): " + result
			vibe = "export service Users { static readonly key = \"fuzz/Users\"; " + shape + " }\nconst impl: Users.Shape = { read: (): " + result + " => " + value + " }\n"
			native = "type UsersShape = { " + shape + " }\nconst impl: UsersShape = { read: (): " + result + " => " + value + " }\nexport {}\n"
		case "identity-members":
			shape = "key: string; defaultValue: number"
			vibe = "export service Users { static readonly key = \"fuzz/Users\"; " + shape + " }\nconst impl: Users.Shape = { key:'value', defaultValue:7 }\n"
			native = "type UsersShape = { " + shape + " }\nconst impl: UsersShape = { key:'value', defaultValue:7 }\nexport {}\n"
		case "this-type":
			shape = "self: this"
			if variant&1 != 0 {
				shape = "read(): this"
			}
			vibe = "export service Users { static readonly key = \"fuzz/Users\"; " + shape + " }\n"
			native = "type UsersShape = { " + shape + " }\nexport {}\n"
		case "reference-type":
			vibe = "export service Flags { static readonly key = \"fuzz/Flags\"; static readonly defaultValue = (): { n: number } => ({n:0}); n: number }\nexport type Bad = Flags\n"
			native = "import { Context } from 'effect'\nexport const Flags = Context.Reference<{n:number}>('fuzz/Flags',{defaultValue:()=>({n:0})})\nexport type Bad = Flags\n"
		case "typed-key-alias":
			vibe += "declare const Alias: typeof Users\n"
			if variant&1 == 0 {
				vibe += "export const bad = new Alias()\n"
				explicit = 3003
			} else {
				vibe += "export class Bad extends Alias {}\n"
				explicit = 3002
			}
		case "local-shape":
			vibe = "export function scope(): void { service Users { static readonly key = \"fuzz/Users\"; value:number }; type Bad = Users.Shape }\n"
			native = "import { Context } from 'effect'\nexport function scope(): void { type UsersShape={value:number}; class Users extends Context.Service<Users,UsersShape>()('fuzz/Users') {}; type Bad=Users.Shape }\n"
		case "shape-shadow":
			// Member signatures keep TypeScript's lexical type-parameter scope.
			shape = "take<Users>(value: Users.Shape): number"
			if variant&1 != 0 {
				shape = "take: <Users>() => Users.Shape"
			}
			vibe = "export service Users { static readonly key = \"fuzz/Users\"; " + shape + " }\n"
			native = "type UsersShape = { " + shape + " }; export {}\n"
		case "public-shape-dts":
			publicDts = true
			native += "export namespace Users { export type Shape = UsersShape }\n"
		default:
			key = "plain-return"
			vibe = "export service Users { static readonly key = \"fuzz/Users\"; read(): number }\n"
			native = "type UsersShape = {read():number}; export {}\n"
		}
		if variant&2 != 0 {
			vibe = strings.ReplaceAll(vibe, "Users", "UsersCafé")
			native = strings.ReplaceAll(native, "Users", "UsersCafé")
			vibe = "/* retained */\n" + vibe
		}
		config := func(file string) string {
			// Static rules check the compiler's --noEmit diagnostics. The
			// public-shape-dts key separately exercises declaration emission
			// and its plain TypeScript consumer. Keep every occurrence and
			// its exact code; do not normalize the harness's emit duplicates.
			emit := `"noEmit":true`
			if publicDts {
				emit = `"declaration":true,"emitDeclarationOnly":true,"noEmitOnError":true,"outDir":"out"`
			}
			return fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],%s},"files":[%q]}`, emit, file)
		}
		compile := func(name, source string) *Result {
			t.Helper()
			r, err := w.Compile(t.Context(), Project{Config: config(name), Files: map[string]string{
				name: source, "package.json": `{"name":"service-shape-contracts","type":"module"}`,
			}})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(r.Remove)
			return r
		}
		identities := func(r *Result) []string {
			var result []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					result = append(result, fmt.Sprintf("%s%d", d.Source(), d.Code()))
				}
			}
			slices.Sort(result)
			return result
		}
		actual := compile("service.vibe", vibe)
		if explicit != 0 {
			got := identities(actual)
			want := []string{fmt.Sprintf("EK%d", explicit)}
			if !slices.Equal(got, want) {
				Gap(t, "FuzzServiceShapeContracts", key, "chapter 5 key misuse: want %v, got %v in:\n%s", want, got, vibe)
				return
			}
		} else {
			reference := compile("service.ts", native)
			got, want := identities(actual), identities(reference)
			if !slices.Equal(got, want) {
				Gap(t, "FuzzServiceShapeContracts", key, "chapter 5: %s; Vibe=%v, native=%v\nVibe:\n%s\nnative:\n%s", servicePrivateShapeQuote, got, want, vibe, native)
				return
			}
			if publicDts {
				dts := func(r *Result) string {
					for name, text := range r.Outputs {
						if name == "service.d.ts" || strings.HasSuffix(name, "/service.d.ts") {
							return text
						}
					}
					t.Fatal("no declaration output for service")
					return ""
				}
				consumer := "import type { Users } from './service.js'\nexport const impl: Users.Shape = {value:7}\ntype IsAny<T> = 0 extends (1 & T) ? true : false\nexport const shapeIsTyped: IsAny<Users.Shape> = false\nexport const fieldIsTyped: IsAny<Users.Shape['value']> = false\nconst value: number = impl.value\nimpl.value = 8\n"
				if variant&2 != 0 {
					consumer = strings.ReplaceAll(consumer, "Users", "UsersCafé")
				}
				check := func(declaration string) *Result {
					r, err := w.Compile(t.Context(), Project{Config: config("consumer.ts"), Files: map[string]string{
						"service.d.ts": declaration, "consumer.ts": consumer, "package.json": `{"name":"service-shape-consumer","type":"module"}`,
					}})
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(r.Remove)
					return r
				}
				got, want = identities(check(dts(actual))), identities(check(dts(reference)))
				if !slices.Equal(got, want) {
					Gap(t, "FuzzServiceShapeContracts", key, "public Shape declaration consumer: Vibe=%v, native=%v", got, want)
					return
				}
			}
		}
		ExpectPending(t, "FuzzServiceShapeContracts", key)
		ExpectPending(t, "FuzzServiceShapeContracts", specCorpusKey(t))
	})
}
