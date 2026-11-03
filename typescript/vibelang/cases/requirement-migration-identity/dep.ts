import { Context } from "effect";
export class Input extends Context.Service<Input, { readonly value: number }>()("dep/Input") {}
