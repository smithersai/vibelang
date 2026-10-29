---
lifecycle: artifact
date: 2026-10-26
---

# Native compilation and a Zig effect runtime for VibeLang servers

Research for VibeLang, observed 2026-10-26. Machine: Apple M3 Max, 16 cores, shared with other agents (load average 6 to 11). Software: Bun 1.4.1, Node 26.10.0, Go 1.26, `effect@4.0.5`, `@effect/platform-bun@4.0.5`, scriptc 0.4.5, Perry 0.5.1520, and Bun's CI build of PR #45631 at `d0b27e98`. Numbers without a citation come from the scripts in [Reproduce](#reproduce). MB means 10^6 bytes.

## Summary

Do not build a native backend or a Zig effect runtime now. In this benchmark, Effect's runtime costs 3.1 µs of a 10.9 µs request, and every native compiler that exists today runs Effect code slower than Bun's JIT.

"Native" covers three different projects. Design A, a native runtime under JavaScript code, pays 22.8 ns each time native code calls a JavaScript continuation, and Effect does that on every step. Design B, compiling VibeLang's TypeScript output ahead of time, costs VibeLang no work and already exists. On it, Bun's `--aot` ran an Effect program 1.46x slower than its own JIT, Vercel's scriptc ran it 22x slower, and Perry crashed. Design C, a VibeLang backend with its own runtime in Zig, must replace Effect's 483,531 lines, gives up the TypeScript-interop pillar, and reverses Chapter 25's decision that the runtime is Effect 4. What native code does buy is memory and startup. Bun `--aot` cut the Effect program from 83 MB to 35 MB, and scriptc cut it to 9.6 MB. That matters only if per-app memory sets the cost of hosting VibeLang apps on smithers.sh, and nobody has measured that cost. Zig is also a weak runtime language today. Its event-loop backends are experimental, 1.0 has no date, and Bun, the largest Zig program, moved to Rust in August 2026 because of use-after-free bugs and leaks on error paths.

## Three projects called "native"

| | A. Native runtime under JS | B. AOT-compile the emitted TypeScript | C. Native backend and Zig runtime |
| --- | --- | --- | --- |
| What changes | Effect's scheduler and fibers move to Zig. User code stays JavaScript on JavaScriptCore | Bun `--aot`, scriptc or Perry compiles VibeLang's TypeScript output | VibeLang emits C, Zig or LLVM IR. A Zig runtime replaces Effect |
| VibeLang work | A runtime rewrite and an engine binding | None | A backend, a runtime and a standard library |
| TypeScript interop | Kept | Kept (a subset on scriptc and Perry) | Lost unless a JavaScript engine is embedded |
| Measured | Native-to-JS call 22.8 ns. Effect step about 100 ns | Effect program 1.46x to 22x slower than the JIT. 2.4x to 8.4x less memory | Cannot be measured yet. See [Prior art](#prior-art) |
| Verdict | Slower by construction | Free when it ships. Track Bun #45631 | Years of work for a gain capped at 1.40x per request in this benchmark |

## Where an Effect server's CPU goes

Four servers answer the same route, `GET /users/:id?fields=name`, with a bearer-token check, two response headers and a JSON body. All four run on Bun.serve's native HTTP stack. A Go load generator holds 64 keep-alive connections for 10 s after a 3 s warm-up. Each server runs on one JavaScript thread, so CPU per request is 1 / (requests per second). Median of three runs:

```text
CPU per request (µs, lower is better)                  RSS
raw Bun.serve          7.75  ████████████████          46 MB
Effect handler         9.86  ████████████████████      80 MB
Effect HttpRouter     10.96  ██████████████████████    94 MB
Effect BunHttpServer  10.85  ██████████████████████   122 MB
```

- Effect's HTTP stack adds 3.1 µs per request. That is 29% of the request's CPU, and 40% more CPU than raw Bun.serve.
- If a native runtime made Effect free, this endpoint would get at most 1.40x faster. A real endpoint spends more time outside Effect (a database driver, larger JSON), so its ceiling is lower.
- The 7.75 µs floor already runs on native code. Bun's HTTP parser and socket loop are not JavaScript.
- In process, without HTTP, one handler run (three compiled frames, one service call and `runPromise`) costs 0.73 to 0.85 µs in Effect and 0.15 to 0.16 µs as plain async TypeScript (three paired runs).
- Runs varied by up to 15% (the Effect handler measured 8.80 to 10.38 µs) because other agents were loading the machine. `ps` showed the servers at 78% to 104% CPU, so the raw baseline may not have saturated its core. If it did not, Effect's real share is above 29%.

The steelman for native code is per-operation cost. On Multicore OCaml 4.10, perform and handle cost 5 ns and a fiber switch 23 ns ([continuation-prior-art.md](continuation-prior-art.md), §6.3 of the OCaml paper). Effect on JavaScriptCore costs 105 ns per service call and 247 ns per capture and resume (Chapter 25). Native effect operations can be 10x to 20x cheaper. But Amdahl's law caps the request-level gain: cutting the 3.1 µs Effect cost tenfold saves 2.8 µs, a 1.35x speedup on this endpoint.

## Effect on three native compilers

`effect-core.ts` runs the in-process handler above 200,000 times. `plain-core.ts` is the same program in plain async TypeScript. Each compiler built and ran both. The Bun `--aot` binary is a CI build, not a release build: its JIT ran the Effect program at 1.06 µs, against 0.69 µs on Bun 1.4.1. So it is compared only with its own JIT.

```text
Effect program          µs/run  baseline JIT  ratio          RSS      result
Bun 1.4.1 JIT            0.69       -         -              81 MB    correct
Bun --aot, dist JS       1.55      1.06       1.46x slower   35 MB    correct
Bun --aot, typed src     2.35      1.06       2.2x slower    36 MB    correct
scriptc 0.4.5           15.3       0.69       22x slower     9.6 MB   correct
Perry 0.5.1520            -         -         -              46 MB    TypeError: annotate is not a function

Plain async program
Bun 1.4.1 JIT            0.15       -         -
Bun --aot                0.19      0.21       1.1x faster
scriptc 0.4.5            0.25-0.37 0.15       1.7x-2.5x slower
Perry 0.5.1520           6.4       0.15       43x slower, and wrong: id -1, expected 199999
```

Effect is the worst case for type-directed AOT compilation:

- Effect's run loop dispatches over many primitive classes behind one `Effect<A, E, R>` interface, and that static type names no object layout. Bun's build compiled 13% of Effect's property accesses to a single load (1,028 of 7,888).
- Building from Effect's typed `src/` instead of `dist/` raised single loads to 20.1% (1,729 of 8,583) and made the program slower (2.35 µs against 1.55 µs). Its `--explain` still listed 2,517 causes of untyped code, including call sites over the `MaxDispatchCases = 4` limit. Types alone do not fix a megamorphic run loop.
- scriptc compiled 99% of 5,636 statements, but 2,874 of them run in its dynamic tier, 35 sites throw if reached, and 18 Effect modules need a "Node island" for `Object.setPrototypeOf` and similar calls.
- A JIT's inline caches learn which few classes reach each site at runtime. An AOT compiler must prove them at build time. Bun's own PR shows the same split on warm servers: `--aot` serves 7.1% fewer requests per second than the JIT on Express, 13.5% fewer on Elysia, 16.9% fewer on Fastify and 22.9% fewer on Koa. It ties on Bun.serve, Hono and node:http.

## Why design A is slower by construction

A C loop that calls a JavaScript continuation per step, against JavaScript that calls JavaScript:

```text
JS loop calling a JS step (the JIT inlines it)     0.13 ns/step
C loop, no JS (TinyCC)                             1.06 ns/step
JS loop calling a C function (bun:ffi)             6.10 ns/step
C loop calling a JS step (JSCallback)             22.81 ns/step
```

Every Effect step runs user code: a `flatMap` continuation, a generator's `next()` or a service method. A native scheduler therefore crosses into JavaScript at least once per step. At about 100 ns per step, the crossing alone adds 23%, and it stops the JIT from inlining across the loop. `JSCallback` is not the cheapest native-to-JS path. A call from inside the engine costs less, but it still blocks inlining. Engines move the other way: JavaScriptCore writes 22 builtins in JavaScript, including `PromiseConstructor.js` and `GeneratorPrototype.js`, and Bun keeps 18 builtin modules in TypeScript. That way the JIT compiles them together with the code that calls them.

## What native code buys

| Gain | Evidence | Who pays for it |
| --- | --- | --- |
| Memory | Effect program: 83 MB on the JIT, 35 MB with Bun `--aot`, 9.6 MB with scriptc. Bun PR servers: 28% to 37% lower peak RSS | A host that packs many small apps per machine, such as smithers.sh if it hosts VibeLang apps |
| Startup | Bun PR: first response 2.8x to 3.7x sooner on Express, Fastify and Koa. Claude Code CLI: first prompt at 141 ms instead of 318 ms | Serverless, scale-to-zero and CLIs |
| Tail latency | Bun PR at a fixed 5,000 requests per second: p99 of 54 to 91 µs compiled, 77 to 477 µs on the JIT | Latency targets at low load |
| Throughput | Warm servers are level or slower (above) | Nobody today |

Memory is the only row tied to money VibeLang could see: the hosting cost of an idle app. The Effect BunHttpServer used 122 MB against 46 MB for raw Bun.serve, so most of the memory belongs to Effect and the JIT, not to the app.

## Prior art

| Project | Approach | Status on 2026-10-26 | Lesson for VibeLang |
| --- | --- | --- | --- |
| Bun `--aot` ([PR #45631](https://github.com/oven-sh/bun/pull/45631)) | Bun's parser passes TypeScript types to JavaScriptCore, and B3 compiles the bytecode to machine code. Full JavaScript semantics, no JIT in the executable | Open: +2,117,090 lines in 16,140 files, Buildkite failing. No stable Bun includes it | Free for VibeLang, because it consumes TypeScript. Its `full-types` export condition lets a package ship typed source |
| [scriptc](https://github.com/vercel-labs/scriptc) (Vercel Labs) | `tsc` types to a typed IR, then C, then clang. A dynamic tier for what it cannot type. Reference-counted heap | 0.4.5. Repository created 2026-07-22. Experimental subset | Compiles Effect and runs it 22x slower |
| [Perry](https://github.com/PerryTS/perry) | SWC and LLVM with its own runtime, written in Rust | 0.5.1520 | Gave wrong output on a 15-line program. Its own suite loses to Bun on method calls (35 ms against 8 ms) and binary trees (13 ms against 6 ms) |
| [Static Hermes](https://speakerdeck.com/tmikov2023/static-hermes-react-native-eu-2023-announcement) (Meta) | AOT compilation of soundly typed JavaScript | Announced in 2023 as not ready for general use. A [2026 talk](https://speakerdeck.com/tmikov2023/compiling-a-real-world-cli-tool-to-native-with-static-hermes) compiles one CLI | Large gains need a sound subset |
| [Porffor](https://github.com/CanadaHonk/porffor) | JavaScript to Wasm or C | Pre-1.0. Passes 14% (README) to 35% (JavaScript Weekly) of a modified Test262 | Full JavaScript semantics are the long pole |
| [Koka](https://www.microsoft.com/en-us/research/project/koka/) | Effect types drive evidence passing ([ICFP 2021](https://www.microsoft.com/en-us/research/?p=769738)) and Perceus reference counting. Emits C with "no garbage collector or runtime system" | Research language | The speed comes from resolving handlers at compile time. VibeLang can do that in its TypeScript output |
| OCaml 5 | Effect handlers in the native runtime, multicore domains | Shipped in OCaml 5.0, December 2022 | Native effect operations cost 5 to 23 ns. Building that runtime took the OCaml team years |
| Roc | App code compiles natively. A host "platform" in Zig, Rust or C owns every effect | Rewrote 300,000 lines of Rust into Zig in 487 days and reached feature parity. 0.1.0 not released (secondary sources: [Ziggit](https://ziggit.dev/t/roc-how-our-rust-to-zig-rewrite-is-going/16743)) | The closest match to design C, and Roc has no library ecosystem to keep |

## Zig as the runtime language

- [Zig 0.16.0](https://ziglang.org/download/0.16.0/release-notes.html) (2026-04-13) made I/O an interface, `std.Io`. Its release notes call `Io.Evented`, the green-thread backend, "work-in-progress, experimental" and say it "does not yet implement networking". `Io.Uring` and `Io.Kqueue` are proofs of concept. `Io.Threaded` is the only backend described as feature-complete.
- [Zig 0.17.0](https://ziglang.org/download/0.17.0/release-notes.html) (2026-10-01) reworked the build system. Its notes do not mention `Io.Evented`. The roadmap still lists "Complete and stabilize the language", and 1.0 has no date. Releases break code: 0.16 moved the `std.fs` APIs under `std.Io` and removed most of `std.posix` in its favor.
- Bun, the largest Zig program in production, ported 535,496 lines of Zig to Rust and shipped the port as v1.4.0 on 2026-08-20 ([InfoQ](https://www.infoq.com/news/2026/09/bun-AI-rewrite-zig-rust-4-months/), [Bun's post](https://bun.com/blog/bun-in-rust)). `gh api repos/oven-sh/bun/languages` now reports 70 MB of Rust and 12.6 MB of C++. Jarred Sumner gave use-after-free, double-free and memory not freed on error paths as the reason. An effect runtime is mostly error paths: interruption, finalizers and abandoned continuations.
- A Zig runtime would need its own event loop today, as Bun built one, or a third-party `std.Io` implementation such as [zio](https://github.com/beckend/zio).

## What a native runtime would change in VibeLang

- Chapter 24 promises that "a plain JavaScript region is atomic". A multithreaded native runtime breaks that promise unless each core runs its own scheduler and heap, which one process per core with `reusePort` already gives. Changing it changes how existing VibeLang code behaves, so it needs Will's approval.
- The runtime is Effect 4 by decision (Chapter 25, strategy A), and the kernel reaches into Effect internals (`fiber._stack`, `_interruptedCause`). A native runtime must reimplement the kernel's 923 lines and the Effect behavior they pin, including finalizer order, masks and the 2,048-operation fairness budget.
- A native runtime replaces `effect@4.0.5` `src`, which is 519 files and 483,531 lines. That count excludes `@effect/platform-*`, the SQL clients and every npm package a hatch calls.

## Cheaper levers that work on every backend

1. Emit fewer Effect frames. VibeLang knows statically which code cannot pause, and Chapter 15's `$direct` lowering already runs proven plain code as JavaScript. The in-process gap (about 0.8 µs against 0.15 µs per handler) is the budget for extending it.
2. Replace generator frames with explicit state machines once a profile shows generator frames dominate. Chapter 25 lists this as "Later".
3. Resolve handlers at compile time, as Koka does. In-place evidence already costs 87 ns, against 247 ns for capture and resume (Chapter 25).
4. Use more cores with one process per core and `reusePort`. That keeps the single-thread semantics.
5. Adopt Bun `--aot` for memory and startup when it ships. If it still loses on Effect's run loop, send the dispatch shape to Effect upstream with this benchmark.

## Position and what would change it

Position: no VibeLang native backend and no Zig runtime in 2026. Revisit when any of these is true:

- A production profile of VibeLang or Smithers, from a user who pays or is blocked, shows more than 50% of server CPU in Effect runtime frames.
- smithers.sh hosts VibeLang apps, measured per-app memory sets the hosting cost, and Bun `--aot` cannot bring an Effect app under the target.
- Bun `--aot` merges and runs Effect within 10% of the JIT. VibeLang then gets native output for free, and the work becomes tuning the emitted code for it, not building a backend.

## Sources

- Bun `--aot`: [oven-sh/bun#45631](https://github.com/oven-sh/bun/pull/45631) (body, file list and checks read with `gh` on 2026-10-26). CI binary from `bunx bun-pr@1.0.42 45631`, Buildkite build 133394.
- Bun's Rust port: [Bun's post](https://bun.com/blog/bun-in-rust), [InfoQ](https://www.infoq.com/news/2026/09/bun-AI-rewrite-zig-rust-4-months/), [Bun v1.4 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0) (published 2026-08-20).
- Builtins written in JavaScript: [JavaScriptCore builtins](https://github.com/WebKit/WebKit/tree/main/Source/JavaScriptCore/builtins), [Bun builtins](https://github.com/oven-sh/bun/tree/main/src/js/builtins).
- scriptc: [README](https://github.com/vercel-labs/scriptc), [limitations](https://scriptc.dev/docs/limitations).
- Perry: [README and benchmark tables](https://github.com/PerryTS/perry).
- Static Hermes: [2023 announcement](https://speakerdeck.com/tmikov2023/static-hermes-react-native-eu-2023-announcement), [2026 CLI talk](https://speakerdeck.com/tmikov2023/compiling-a-real-world-cli-tool-to-native-with-static-hermes).
- Porffor: [README](https://github.com/CanadaHonk/porffor).
- Koka: [project page](https://www.microsoft.com/en-us/research/project/koka/), [Generalized Evidence Passing for Effect Handlers](https://www.microsoft.com/en-us/research/?p=769738).
- Zig: [0.16.0 notes](https://ziglang.org/download/0.16.0/release-notes.html), [0.17.0 notes](https://ziglang.org/download/0.17.0/release-notes.html), [release index](https://ziglang.org/download/index.json).
- Roc, secondary: [Ziggit thread](https://ziggit.dev/t/roc-how-our-rust-to-zig-rewrite-is-going/16743), [Tildes thread](https://tildes.net/~comp/1v5c/how_our_rust_to_zig_rewrite_is_going).
- In-repo: [Chapter 24](../design/history/src/324-part3-ch24-effect.md), [Chapter 25](../design/history/src/325-part3-ch25-strategies.md), [effect4-runtime.md](effect4-runtime.md), [continuation-prior-art.md](continuation-prior-art.md).

## Reproduce

The probes were disposable and ran in a scratch directory with its own `package.json`: `{"dependencies": {"effect": "4.0.5", "@effect/platform-bun": "4.0.5"}}`. Re-create them from the listings below.

HTTP servers: start one with `PORT=8104 bun effect-bun.ts`, then load it with `./loadgen -addr 127.0.0.1:8104 -c 64 -w 3s -d 10s`. The loop ran `raw`, `effect-gen`, `effect-router` and `effect-bun` three times each.

<details>
<summary>raw.ts</summary>

```ts
let seq = 0
Bun.serve({
  port: Number(process.env.PORT ?? 8101),
  fetch(req) {
    const auth = req.headers.get("authorization")
    if (auth !== "Bearer secret") return new Response("unauthorized", { status: 401 })
    const url = new URL(req.url)
    const m = /^\/users\/(\d+)$/.exec(url.pathname)
    if (!m) return new Response("not found", { status: 404 })
    const id = Number(m[1])
    const user = { id, name: `user-${id}`, fields: url.searchParams.get("fields") ?? "all" }
    return new Response(JSON.stringify(user), {
      headers: { "content-type": "application/json", "x-request-id": String(++seq), "x-powered-by": "bench" }
    })
  }
})
```

</details>

<details>
<summary>effect-gen.ts (Effect handler per request through ManagedRuntime.runPromise)</summary>

```ts
import { Context, Effect, Layer, ManagedRuntime } from "effect"

class Users extends Context.Service<Users, { readonly find: (id: number) => Effect.Effect<{ id: number; name: string }> }>()("bench/Users") {}
class Unauthorized { readonly _tag = "Unauthorized" }
class NotFound { readonly _tag = "NotFound" }

const authenticate = Effect.fnUntraced(function*(req: Request) {
  if (req.headers.get("authorization") !== "Bearer secret") return yield* Effect.fail(new Unauthorized())
})
const route = Effect.fnUntraced(function*(url: URL) {
  const m = /^\/users\/(\d+)$/.exec(url.pathname)
  if (!m) return yield* Effect.fail(new NotFound())
  return Number(m[1])
})
let seq = 0
const handler = Effect.fnUntraced(function*(req: Request) {
  yield* authenticate(req)
  const url = new URL(req.url)
  const id = yield* route(url)
  const users = yield* Users
  const user = yield* users.find(id)
  return new Response(JSON.stringify({ ...user, fields: url.searchParams.get("fields") ?? "all" }), {
    headers: { "content-type": "application/json", "x-request-id": String(++seq), "x-powered-by": "bench" }
  })
}, Effect.catchTags({
  Unauthorized: () => Effect.succeed(new Response("unauthorized", { status: 401 })),
  NotFound: () => Effect.succeed(new Response("not found", { status: 404 }))
}))

const runtime = ManagedRuntime.make(Layer.succeed(Users, { find: (id) => Effect.succeed({ id, name: `user-${id}` }) }))
Bun.serve({ port: Number(process.env.PORT ?? 8102), fetch: (req) => runtime.runPromise(handler(req)) })
```

</details>

<details>
<summary>effect-bun.ts (HttpRouter.serve on BunHttpServer). effect-router.ts is the same route behind HttpRouter.toWebHandler and Bun.serve</summary>

```ts
import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"

class Users extends Context.Service<Users, { readonly find: (id: number) => Effect.Effect<{ id: number; name: string }> }>()("bench/Users") {}
let seq = 0

// Services resolve once at layer build; the handler closes over them.
const Route = HttpRouter.use((router) => Effect.gen(function*() {
  const users = yield* Users
  yield* router.add("GET", "/users/:id", Effect.gen(function*() {
    const req = yield* HttpServerRequest.HttpServerRequest
    if (req.headers["authorization"] !== "Bearer secret") return HttpServerResponse.text("unauthorized", { status: 401 })
    const params = yield* HttpRouter.params
    const url = new URL(req.url, "http://x")
    const user = yield* users.find(Number(params.id))
    return HttpServerResponse.jsonUnsafe({ ...user, fields: url.searchParams.get("fields") ?? "all" }, {
      headers: { "x-request-id": String(++seq), "x-powered-by": "bench" }
    })
  }))
}))

const Main = HttpRouter.serve(Route.pipe(
  Layer.provide(Layer.succeed(Users, { find: (id) => Effect.succeed({ id, name: `user-${id}` }) }))
), { disableLogger: true }).pipe(Layer.provide(BunHttpServer.layer({ port: Number(process.env.PORT ?? 8104) })))

BunRuntime.runMain(Layer.launch(Main))
```

For `effect-router.ts`, replace the last two statements with:

```ts
const AppLive = Route.pipe(
  Layer.provide(Layer.succeed(Users, { find: (id) => Effect.succeed({ id, name: `user-${id}` }) })),
  Layer.provide(HttpServer.layerServices)
)
const app = HttpRouter.toWebHandler(AppLive, { disableLogger: true })
Bun.serve({ port: Number(process.env.PORT ?? 8103), fetch: (request) => app.handler(request) })
```

</details>

<details>
<summary>loadgen/main.go (closed-loop HTTP/1.1 keep-alive generator)</summary>

```go
package main

import (
	"bufio"
	"bytes"
	"flag"
	"fmt"
	"net"
	"os"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8101", "")
	conns := flag.Int("c", 64, "")
	dur := flag.Duration("d", 10*time.Second, "")
	warm := flag.Duration("w", 3*time.Second, "")
	flag.Parse()
	req := []byte("GET /users/42?fields=name HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer secret\r\n\r\n")
	var count, bad int64
	var measuring atomic.Bool
	lat := make([][]time.Duration, *conns)
	var wg sync.WaitGroup
	stop := make(chan struct{})
	for i := 0; i < *conns; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c, err := net.Dial("tcp", *addr)
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			r := bufio.NewReaderSize(c, 16384)
			for {
				select {
				case <-stop:
					return
				default:
				}
				t0 := time.Now()
				if _, err := c.Write(req); err != nil {
					return
				}
				status, n := 0, -1
				for {
					line, err := r.ReadSlice('\n')
					if err != nil {
						return
					}
					if status == 0 {
						status, _ = strconv.Atoi(string(line[9:12]))
					}
					if len(line) <= 2 {
						break
					}
					if bytes.HasPrefix(bytes.ToLower(line), []byte("content-length:")) {
						n, _ = strconv.Atoi(string(bytes.TrimSpace(line[15:])))
					}
				}
				if n < 0 {
					fmt.Fprintln(os.Stderr, "no content-length")
					os.Exit(1)
				}
				if _, err := r.Discard(n); err != nil {
					return
				}
				if measuring.Load() {
					atomic.AddInt64(&count, 1)
					if status != 200 {
						atomic.AddInt64(&bad, 1)
					}
					lat[i] = append(lat[i], time.Since(t0))
				}
			}
		}(i)
	}
	time.Sleep(*warm)
	measuring.Store(true)
	start := time.Now()
	time.Sleep(*dur)
	measuring.Store(false)
	el := time.Since(start)
	close(stop)
	var all []time.Duration
	for _, l := range lat {
		all = append(all, l...)
	}
	sort.Slice(all, func(a, b int) bool { return all[a] < all[b] })
	p := func(q float64) float64 { return float64(all[int(float64(len(all)-1)*q)].Microseconds()) }
	rps := float64(count) / el.Seconds()
	fmt.Printf("rps=%.0f us_per_req=%.2f p50_us=%.0f p99_us=%.0f non200=%d\n", rps, 1e6/rps, p(0.5), p(0.99), bad)
}
```

</details>

Compiler probes, from a directory holding `effect-core.ts` and `plain-core.ts`:

```sh
bun effect-core.ts                                   # JIT
npx scriptc@0.4.5 coverage effect-core.ts
npx scriptc@0.4.5 build effect-core.ts -o effect-core && ./effect-core
npx @perryts/perry@0.5.1520 compile effect-core.ts -o effect-core && ./effect-core
bunx bun-pr@1.0.42 45631                             # Bun's CI build of the --aot PR
bun-45631 build --compile --aot effect-core.ts --outfile effect-aot && ./effect-aot
```

For the typed-`src` build, replace `"effect"` with a tsconfig `paths` entry: `"effect": ["./node_modules/effect/src/index.ts"]` and `"effect/*": ["./node_modules/effect/src/*.ts"]`, with `lib: ["ESNext", "DOM"]` and `strict`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and `erasableSyntaxOnly` on. Pass the file with `--tsconfig-override`. The mapping is needed because Effect 4.0.5's `src` imports itself by package name (`src/Runtime.ts` imports `effect/Cause`) next to relative imports, which otherwise loads `dist` and `src` types together.

<details>
<summary>effect-core.ts and plain-core.ts</summary>

```ts
// effect-core.ts
import { Context, Effect, Layer, ManagedRuntime } from "effect"

class Users extends Context.Service<Users, { readonly find: (id: number) => Effect.Effect<{ id: number; name: string }> }>()("probe/Users") {}
class NotFound { readonly _tag = "NotFound" }

const route = Effect.fnUntraced(function*(path: string) {
  const m = /^\/users\/(\d+)$/.exec(path)
  if (!m) return yield* Effect.fail(new NotFound())
  return Number(m[1])
})
const handler = Effect.fnUntraced(function*(path: string) {
  const id = yield* route(path)
  const users = yield* Users
  return yield* users.find(id)
}, Effect.catchTag("NotFound", () => Effect.succeed({ id: -1, name: "none" })))

const runtime = ManagedRuntime.make(Layer.succeed(Users, { find: (id) => Effect.succeed({ id, name: `user-${id}` }) }))
const N = 200_000
const t = performance.now()
let last = { id: 0, name: "" }
for (let i = 0; i < N; i++) last = await runtime.runPromise(handler(`/users/${i}`))
console.log(JSON.stringify(last), ((performance.now() - t) * 1000 / N).toFixed(2), "us/run")
```

```ts
// plain-core.ts
const users = { find: async (id: number) => ({ id, name: `user-${id}` }) }
const route = (path: string) => {
  const m = /^\/users\/(\d+)$/.exec(path)
  if (!m) throw new Error("NotFound")
  return Number(m[1])
}
const handler = async (path: string) => {
  try { return await users.find(route(path)) } catch { return { id: -1, name: "none" } }
}
const N = 200_000
const t = performance.now()
let last = { id: 0, name: "" }
for (let i = 0; i < N; i++) last = await handler(`/users/${i}`)
console.log(JSON.stringify(last), ((performance.now() - t) * 1000 / N).toFixed(2), "us/run")
```

</details>

<details>
<summary>Boundary probe: drive.c and boundary.ts (run with bun boundary.ts)</summary>

```c
typedef double (*step_fn)(double);
double drive(step_fn step, int n) {
  double acc = 0;
  for (int i = 0; i < n; i++) acc = step(acc);
  return acc;
}
double drive_native(int n) {
  double acc = 0;
  for (int i = 0; i < n; i++) acc = acc + 1;
  return acc;
}
```

```ts
import { cc, JSCallback } from "bun:ffi"
const { symbols: { drive, drive_native } } = cc({
  source: "./drive.c",
  symbols: { drive: { args: ["function", "int"], returns: "double" }, drive_native: { args: ["int"], returns: "double" } }
})
const N = 5_000_000
const step = (acc: number) => acc + 1
const cb = new JSCallback(step, { args: ["double"], returns: "double" })
const jsLoop = (n: number) => { let acc = 0; for (let i = 0; i < n; i++) acc = step(acc); return acc }
const bench = (label: string, f: () => number) => {
  f(); f()
  const t = performance.now(); const r = f(); const ns = ((performance.now() - t) * 1e6) / N
  console.log(`${label.padEnd(52)} ${ns.toFixed(2).padStart(7)} ns/step  (result ${r})`)
}
bench("JS loop calling JS step (JIT inlines)", () => jsLoop(N))
bench("C loop, no JS (TinyCC)", () => drive_native(N))
bench("C loop calling JS step through JSCallback", () => drive(cb.ptr, N))
const ffiStep = cc({ source: "./drive.c", symbols: { drive_native: { args: ["int"], returns: "double" } } }).symbols.drive_native
bench("JS loop calling a C function per step (bun:ffi)", () => { let acc = 0; for (let i = 0; i < N; i++) acc += ffiStep(1); return acc })
```

</details>

Raw results, `us_per_req` per run:

```text
raw            7.46  7.75  7.80
effect-gen     8.80  9.86 10.38
effect-router 10.56 12.14 10.96
effect-bun    10.62 10.85 10.91
```
