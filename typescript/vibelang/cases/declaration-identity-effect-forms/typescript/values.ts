import { Clock as EffectClock, type DateTime, Random } from "effect"

export const roll = Random.nextInt
export const millis = EffectClock.currentTimeMillis
export type Stamp = DateTime.Utc
