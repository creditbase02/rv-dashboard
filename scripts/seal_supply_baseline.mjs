// Run only for a reviewed, private ledger. All input paths must be outside Git.
import fs from 'node:fs';
import path from 'node:path';
import {aggregate} from '../worker/src/supply-lock.js';
import {canonical,signSnapshot} from '../worker/src/supply-proof.js';
import {validateSupplySnapshot} from '../worker/src/index.js';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>i%2?a:[...a,[v,all[i+1]]],[]));
for(const name of ['--baseline','--previous','--key','--output'])if(!args[name])throw Error(`Required ${name}`);
const root=path.resolve(new URL('..',import.meta.url).pathname);
for(const name of ['--baseline','--previous','--key','--output']){const resolved=path.resolve(args[name]);if(resolved===root||resolved.startsWith(root+path.sep))throw Error('Private sealing inputs/output must stay outside the repository');}
const next=JSON.parse(fs.readFileSync(args['--baseline'])),prior=JSON.parse(fs.readFileSync(args['--previous']));
if(next.through<=prior.through||next.version===prior.version)throw Error('Sealing must advance cutoff and version');
if(next.through.slice(0,4)!==prior.through.slice(0,4))throw Error('Year rollover requires a separately reviewed new-year baseline; archive the old year');
if(canonical(next.peer_definitions)!==canonical(prior.peer_definitions))throw Error('Do not reclassify locked history during sealing');
const remaining=next.records.map(canonical);
for(const record of prior.records){const index=remaining.indexOf(canonical(record));if(index<0)throw Error('A locked event was removed or changed');remaining.splice(index,1);}
for(const text of remaining){const record=JSON.parse(text);if(record.date<=prior.through||record.date>next.through)throw Error('Newly sealed events must be after the previous cutoff and through the new cutoff');}
const aliases=new Set(next.aliases.map(canonical));if(prior.aliases.some(r=>!aliases.has(canonical(r))))throw Error('Historical source aliases must remain available');
const privateKey=JSON.parse(fs.readFileSync(args['--key'])),publicKey={...privateKey};delete publicKey.d;publicKey.key_ops=['verify'];
const config={version:next.version,through:next.through,public_key:publicKey};
const data=aggregate(next.records,next.peer_definitions,next.through);data.quality.date_corrections=next.date_corrections||0;validateSupplySnapshot(data);
const signed=await signSnapshot(data,config,'0'.repeat(64),privateKey);
fs.mkdirSync(args['--output'],{recursive:true});
fs.writeFileSync(path.join(args['--output'],'supply-lock.json'),JSON.stringify(config)+'\n');
fs.writeFileSync(path.join(args['--output'],'supply-data.json'),JSON.stringify(signed)+'\n');
console.log(`Sealed ${next.through}; rows=${data.row_count}; YTD=${data.ytd_usd}; copy only these two aggregate files to the manual PR.`);
