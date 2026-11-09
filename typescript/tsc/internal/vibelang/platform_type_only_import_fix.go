package vibelang

import ()

// EK4402's quick fix for an import of a platform module whose bindings no code
// reads as a value. A class is a value and a type, so TypeScript accepts
//
//	import { AsyncLocalStorage } from "node:async_hooks"
//	export type Context = AsyncLocalStorage<unknown>
//
// and keeps the runtime load. import type erases it, and chapter 5 allows
// that. No value changes, and the declaration prints the same type. Any value
// read, a re-export included, leaves the import and its EK4402 as they are.
// vibelang --fix applies it.
