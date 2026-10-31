// foldkit's declarations added import { Effect } from "effect" to files written with single quotes.
import { Effect } from 'effect'
import type { Model } from './model.js'

export type Program = Effect.Effect<Model>
