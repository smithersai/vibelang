import { use } from "./bridge.vibe";
import { item } from "./banners";
export function run(flag: boolean) { use(1); return { now: flag ? item() : null }; }
