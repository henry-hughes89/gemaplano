'use strict';
// Integration test: Node.js >= 22 (native WebSocket client).
const assert=require('node:assert/strict');
const L=require('./game-logic');
const {srv}=require('./server');
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function main(){
 await new Promise(ok=>srv.listen(0,'127.0.0.1',ok));
 const address=`ws://127.0.0.1:${srv.address().port}`;
 function createClient(){const ws=new WebSocket(address),queue=[];ws.addEventListener('message',ev=>{try{queue.push(JSON.parse(ev.data))}catch{}});return {ws,send:v=>ws.send(JSON.stringify(v)),async get(fn,time=7000){const start=Date.now();while(Date.now()-start<time){const idx=queue.findIndex(fn);if(idx>=0)return queue.splice(idx,1)[0];await sleep(15)}throw Error('Timeout esperando estado '+JSON.stringify(queue.slice(-2)));}}}
 const a=createClient(),b=createClient();while(a.ws.readyState!==WebSocket.OPEN||b.ws.readyState!==WebSocket.OPEN)await sleep(12);
 a.send({type:'create',name:'A',mode:'free'});const session=await a.get(m=>m.type==='session');await a.get(m=>m.type==='state');
 b.send({type:'join',room:session.room,name:'B'});await b.get(m=>m.type==='session');await b.get(m=>m.type==='state');
 a.send({type:'auto'});await a.get(m=>m.type==='state'&&Object.keys(m.ownMap||{}).length===26);
 b.send({type:'auto'});await b.get(m=>m.type==='state'&&Object.keys(m.ownMap||{}).length===26);
 a.send({type:'ready',value:true});await a.get(m=>m.type==='state'&&m.players[0].ready);
 b.send({type:'ready',value:true});await b.get(m=>m.type==='state'&&m.phase==='countdown');
 const aa=await a.get(m=>m.type==='state'&&m.phase==='playing',8000);
 const bb=await b.get(m=>m.type==='state'&&m.phase==='playing',8000);
 const attacker=aa.active===0?a:b,defender=aa.active===0?b:a;
 const victimState=aa.active===0?bb:aa;
 const perla=victimState.placements.perla,points=L.gemPoints('perla',perla.x,perla.y,perla.r);
 let pos=L.key(...points[0]);attacker.send({type:'shot',x:points[0][0],y:points[0][1]});
 const first=await attacker.get(m=>m.type==='state'&&m.history?.some(h=>h.pos===pos));
 const received=await defender.get(m=>m.type==='state'&&m.ownImpacts?.some(h=>h.pos===pos));
 assert.equal(first.history.at(-1).hit,true);
 assert.equal(first.enemyRevealed[pos],'fragment','Primer nodo visible solo en gris');
 assert.equal(received.ownImpacts.at(-1).hit,true,'La mina propia registra un acierto');
 assert.equal(Object.keys(received.ownMap).length,26,'La mina propia conserva las 26 ubicaciones');
 const targetState=aa.active===0?aa:bb;let missPos='';for(let x=-5;x<=5&&!missPos;x++)for(let y=-5;y<=5&&!missPos;y++){const p=L.key(x,y);if(!targetState.ownMap[p])missPos=p;}
 const [mx,my]=missPos.split(',').map(Number);defender.send({type:'shot',x:mx,y:my});
 const missed=await defender.get(m=>m.type==='state'&&m.history?.some(h=>h.pos===missPos));
 const reflected=await attacker.get(m=>m.type==='state'&&m.ownImpacts?.some(h=>h.pos===missPos));
 assert.equal(missed.history.at(-1).hit,false);
 assert.equal(reflected.ownImpacts.at(-1).hit,false,'La mina propia distingue las rocas vacías');
 pos=L.key(...points[1]);attacker.send({type:'shot',x:points[1][0],y:points[1][1]});
 const completed=await attacker.get(m=>m.type==='state'&&m.completed?.includes('perla'));
 assert.equal(completed.players[completed.me].score.complete,1);
 for(const pt of points)assert.equal(completed.enemyRevealed[L.key(...pt)],'perla','Gema completa visible a color');
 assert.equal(completed.enemyRevealed[pos],'perla');
 console.log('OK: salas remotas, acierto gris, mina propia con impactos diferenciados, gema completa a color.');
 a.ws.close();b.ws.close();srv.close();process.exit(0);
}
main().catch(err=>{console.error(err);process.exit(1)});
