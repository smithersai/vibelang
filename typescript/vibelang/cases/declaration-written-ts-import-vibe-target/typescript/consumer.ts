import { type Factory } from './target.js'
import { greeting } from './target.js'

export type { Factory as Maker } from './target.js'

export const invoke = (fn: Factory): string => fn()

export const greet = (): string => invoke(greeting)
