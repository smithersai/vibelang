package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
	"testing"
)

// Keep the established whole-export corpus stable while exercising the
// recovered first-class hatch shapes against their native counterparts.
func FuzzHatchGlobalBindings(f *testing.F) {
	startShortBudget(f)
	for _, name := range []string{"sync", "callback", "never"} {
		for shape := uint8(1); shape <= 5; shape++ {
			f.Add(name, shape)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, name string, shape uint8) {
		if name != "sync" && name != "callback" && name != "never" {
			return
		}
		shape = shape%5 + 1
		for _, native := range []bool{true, false} {
			source := effectHatchBindingProgram(name, shape, native)
			file := "main.vibe"
			if native {
				file = "main.ts"
			}
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source}})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				t.Fatalf("first-class %s shape %d native=%t: %v\n%s", name, shape, native, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
			if !native {
				projected := vibelangmapper.Project(source, vibelangmapper.FileContext{FileName: "/probe/main.vibe", ModuleKey: "probe/main"})
				for _, d := range projected.Diagnostics {
					if d.Code == 4405 {
						t.Fatalf("mapper rejected lexical capture: %s", source)
					}
				}
			}
		}
	})
}
func effectHatchBindingProgram(name string, shape uint8, native bool) string {
	prefix := ""
	if native {
		prefix = "import * as Effect from \"effect/Effect\"; const " + name + " = Effect." + name + ";\n"
	}
	switch shape {
	case 1:
		return prefix + "const alias = " + name + "; export const probe = alias;\n"
	case 2:
		return prefix + "const box = { " + name + " }; export const probe = box." + name + ";\n"
	case 3:
		return prefix + "export const probe = [" + name + "][0];\n"
	case 4:
		return prefix + "export const probe: typeof Effect." + name + " = " + name + ";\n"
	default:
		switch name {
		case "sync":
			return prefix + "const n = 7; export const probe = sync(() => n + 1);\n"
		case "callback":
			return prefix + "const n = 7; const g = callback; export const probe = g<number>((resume) => resume(Effect.succeed(n + 1)));\n"
		default:
			return prefix + "const n = 7; export const probe = () => [n, never];\n"
		}
	}
}
