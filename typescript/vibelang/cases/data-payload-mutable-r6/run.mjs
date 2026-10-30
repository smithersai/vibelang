import {Payload,mutate} from "./out/main.js"
console.log(JSON.stringify(mutate(Payload.Item({nested:{count:1}, values:[],readonlyNested:{count:0},dictionary:{count:1}}))))
