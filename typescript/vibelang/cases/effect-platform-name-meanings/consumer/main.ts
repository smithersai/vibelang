import type { HostHeaders, HostResponse, HostEvent, HostWorker, HostConsole, HostFileSystem, HeadersModule, ResponseModule, EventModule, WorkerModule } from "../out/main.js"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Check<T extends true> = T
type H = Check<Equal<HostHeaders, Headers>>
type R = Check<Equal<HostResponse, Response>>
type E = Check<Equal<HostEvent, Event>>
type W = Check<Equal<HostWorker, Worker>>
type C = Check<Equal<HostConsole, Console>>
type F = Check<Equal<HostFileSystem, FileSystem>>
type HM = Check<Equal<HeadersModule, typeof import("effect/http/Headers")>>
type RM = Check<Equal<ResponseModule, typeof import("effect/ai/Response")>>
type EM = Check<Equal<EventModule, typeof import("effect/eventlog/Event")>>
type WM = Check<Equal<WorkerModule, typeof import("effect/workers/Worker")>>
