import {Effect} from "effect"
type VNode={props:Record<string,unknown>|null;children:unknown[]}
declare global{namespace JSX{type Element=VNode}}
let events:string[]=[]
let n=2
function h(tag:unknown,props:Record<string,unknown>|null,...children:unknown[]):VNode{events.push("h");return {props,children}}
function Box(props:{a:number;v:number}):VNode{return {props,children:[]}}
const tags={get Box(){events.push("tag");return Box}}
const attrs={get value(){events.push("attribute");return n}}
function spread(){events.push("spread");return {s:3}}
function build(stop:boolean){
 const Tag0=tags.Box;const a0=attrs.value;const spread0={...spread()};n=10;if(stop)return 7;events.push("body");return <Tag0 a={a0} {...spread0} v={1}/>
}
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){
 const result:unknown[]=[]
 for(const stop of [true,false]){events=[];n=2;const value=build(stop);result.push([value,[...events]])}
 return result
})}
