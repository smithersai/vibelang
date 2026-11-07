package vibelangfuzz

const promiseExecutorAdmissionQuote = "The " + "\x60Promise\x60" + " executor also admits " + "\x60@throws {unknown}\x60" + ", and the constructor itself throws " + "\x60never\x60" + "."

func failuresPromiseExecutorCases() []*failCase {
	const library = "/** @throws {RangeError} */\nexport declare function risky(): number\n/** @throws {RangeError} */\nexport declare function executor(resolve: (value: number) => void): void\n"
	var cases []*failCase
	for _, ref := range []struct{ key, setup, constructor string }{
		{"direct", "", "Promise"},
		{"parenthesized", "", "(Promise)"},
		{"global", "", "globalThis.Promise"},
		{"computed", "", "globalThis[\"Promise\"]"},
		{"alias", "const P = Promise\n", "P"},
		{"typed", "const P: PromiseConstructor = Promise\n", "P"},
		{"holder", "const holder = {P:Promise}\n", "holder.P"},
		{"super", "", "super"},
	} {
		for _, callback := range []struct {
			key, text string
			code      int
		}{
			{"literal", "resolve => resolve(risky())", 0},
			{"foreign", "executor", 0},
			{"nested", "resolve => { const nested = () => ⟦risky()⟧; resolve(1) }", 401},
			{"throw", "resolve => { ⟦throw 7⟧ }", 401},
			{"generator", "function*(resolve) { ⟦risky()⟧; resolve(1) }", 401},
		} {
			body := "new " + ref.constructor + "<number>(" + callback.text + ")"
			decls := ref.setup
			host := "plain"
			if ref.key == "super" {
				host = "none"
				decls += "class P extends Promise<number> { constructor() { super(" + callback.text + ") } }"
				body = ""
			}
			cases = append(cases, &failCase{Name: "promise-executor-" + ref.key + "-" + callback.key, Quote: promiseExecutorAdmissionQuote, VIP: 4, Host: host, Lib: library, Decls: decls, Body: body, Code: callback.code, OneDiagnostic: callback.code != 0})
		}
	}
	for _, foreign := range []bool{false, true} {
		lib := library
		decls := "class Promise<T> { constructor(executor: (resolve: (value:T) => void) => void) {} }"
		key := "local-shadow"
		if foreign {
			lib += "export declare class Promise<T> { constructor(executor: (resolve: (value:T) => void) => void) }"
			decls = ""
			key = "foreign-shadow"
		}
		cases = append(cases, &failCase{Name: "promise-executor-" + key, Quote: promiseExecutorAdmissionQuote, VIP: 4, Host: "plain", Lib: lib, Decls: decls, Body: "new Promise<number>(resolve => resolve(⟦risky()⟧))", Code: 401, OneDiagnostic: true})
	}
	return cases
}
