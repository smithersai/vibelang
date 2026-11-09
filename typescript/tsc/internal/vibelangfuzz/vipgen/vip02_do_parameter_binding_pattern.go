package vipgen

// A destructuring parameter's default closures read and write the parameter
// cells that the function body sees, as in JavaScript, when a later default
// holds an outward return that is not taken.
func init() {
	const taken = "a: number = do { if (false) return -1; 1 }"
	patterns := []struct {
		kind, read, write, nativeWrite, argument string
	}{
		{"object", "{ read = () => a } = {}", "{ write = (n: number) => { a = n }, read = () => a } = {}", "{ write = (n) => { a = n }, read = () => a } = {}", "{ read: () => 7 }"},
		{"array", "[read = () => a] = []", "[write = (n: number) => { a = n }, read = () => a] = []", "[write = (n) => { a = n }, read = () => a] = []", "[() => 7]"},
	}
	for _, pattern := range patterns {
		for _, form := range []string{"read", "write"} {
			for _, home := range []string{"function", "expression", "arrow", "method"} {
				head, native, body := pattern.read, pattern.read, "{ a = 9; return read() }"
				calls := "f(), f(undefined, 5), f(" + pattern.argument + ", 5)"
				if form == "write" {
					head, native, body = pattern.write, pattern.nativeWrite, "{ write(9); return [a, read()] }"
					calls = "f(), f(undefined, 5)"
				}
				callable := func(params, wrapper string) string {
					switch home {
					case "expression":
						return "const f = function(" + params + ") " + body
					case "arrow":
						return "const f = (" + params + ") => " + body
					case "method":
						return "const box = { f(" + params + ") " + body + " }; const f = " + wrapper
					}
					return "function f(" + params + ") " + body
				}
				registerWitness(2, ChapterWitness{
					Key:     "vip02.do-parameter-binding-" + pattern.kind + "-" + form + "-" + home + "-plain",
					Chapter: "../vips/0002-effect-blocks-and-do.md",
					Quote:   "including its temporal-dead-zone exception: JavaScript has none, so VibeLang has none.",
					Vibe:    "function witness() { " + callable(head+", "+taken, "(...args: Parameters<typeof box.f>) => box.f(...args)") + "; return [" + calls + "] }",
					Effect:  "function witness() { " + callable(native+", a = 1", "(...args) => box.f(...args)") + "; return [" + calls + "] }",
					Cite:    Citation{VIP: 2, Template: "return", Quote: "The behavior replaces the moved-default lowering of the amendments above"},
				})
			}
		}
	}
}
