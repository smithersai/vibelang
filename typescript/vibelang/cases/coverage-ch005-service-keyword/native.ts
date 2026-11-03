import { Context } from "effect"
const service=7, Name=8
service;Name;
class Named extends Context.Service<Named,{readonly value:number}>()("coverage/Newline") {}
export const value=service+Name
export const hasKey=typeof Named.key==="string"
