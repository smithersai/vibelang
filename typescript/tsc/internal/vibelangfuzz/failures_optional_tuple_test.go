package vibelangfuzz

const optionalTupleRethrowsQuote = "| `/** @rethrows p */` | its own thrown type, plus the thrown type of the callback passed for `p`; `@throws {never}` does not erase it |"

func failuresOptionalTupleCases() []*failCase {
	const lib = `/** @throws {RangeError} */
export declare function risky(n:number):number
/** @throws {never} */
export declare function safe(n:number):number
/** @throws {unknown} */
export declare function mystery(n:number):number
/** @throws {never}
 * @rethrows cb
 */
export declare function invoke(cb?:((n:number)=>number)):number
/** @throws {never}
 * @rethrows cb
 */
export declare function prefixed(prefix:number,cb?:((n:number)=>number)):number
`
	var cases []*failCase
	for _, callback := range []struct {
		key, name string
		risk      bool
	}{
		{"range", "risky", true}, {"never", "safe", false}, {"unknown", "mystery", true},
	} {
		cb := callback.name
		for _, shape := range []struct{ key, prefix, call string }{
			{"optional", "const args=[" + cb + "] as [cb?:typeof " + cb + "];", "invoke(...args)"},
			{"readonly", "const args=[" + cb + "] as readonly[cb?:typeof " + cb + "];", "invoke(...args)"},
			{"prefix", "const args=[" + cb + "] as [cb?:typeof " + cb + "];", "prefixed(1,...args)"},
			{"tuple-prefix", "const args=[1," + cb + "] as [prefix:number,cb?:typeof " + cb + "];", "prefixed(...args)"},
			{"nullable", "const args=[" + cb + "] as [cb:typeof " + cb + "|undefined];", "invoke(...args)"},
			{"required", "const args=[" + cb + "] as const;", "invoke(...args)"},
		} {
			for _, context := range []string{"effect", "plain", "caught", "wrapped"} {
				host, body, code := "effect", shape.call, 0
				if context == "plain" || context == "caught" {
					host = "plain"
				}
				if context == "caught" {
					body = "try{return " + body + "}catch{return 0}"
				} else if context == "wrapped" {
					body = "try Effect.try(()=>" + body + ")"
				} else if callback.risk {
					code = 403
					if host == "plain" {
						code = 401
					}
					body = "⟦" + body + "⟧"
				}
				cases = append(cases, &failCase{Name: "rethrows-optional-tuple-" + shape.key + "-" + callback.key + "-" + context, Quote: optionalTupleRethrowsQuote, VIP: 4, Host: host, Lib: lib, Decls: shape.prefix, Body: body, Code: code, OneDiagnostic: code != 0})
			}
		}
	}
	return cases
}
