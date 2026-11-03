import {Context} from "effect"
export interface Shape {readonly value:number}
export class Database extends Context.Service<Database,Shape>()("alchemy/Database") {}
export const Flags=Context.Reference<Shape>("alchemy/Flags",{defaultValue:()=>({value:7})})
