import fs from 'node:fs';
import {verifySnapshot,verifyTransition} from '../worker/src/supply-proof.js';
const config=JSON.parse(fs.readFileSync(new URL('../assets/supply-lock.json',import.meta.url)));
const current=JSON.parse(fs.readFileSync(process.argv[2]));
await verifySnapshot(current,config);
if(process.argv[3]){
  const previous=JSON.parse(fs.readFileSync(process.argv[3]));
  if(previous.lock){
    await verifyTransition(current,previous,config);
  }else throw Error('Supply 自動更新不得建立或更換鎖定基準');
}
console.log('Supply baseline signature PASS');
