import { type Factory } from './target.ts'
import { greeting } from './target.ts'

export type { Factory as Maker } from './target.ts'

export const invoke = (fn: Factory): string => fn()

export const greet = (): string => invoke(greeting)
