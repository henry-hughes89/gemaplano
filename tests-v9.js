'use strict';
const assert=require('node:assert/strict'),{srv,rooms}=require('./server');
const L=require('./game-logic');
const wait=n=>new Promise(r=>setTimeout(r,n));
async function main(){await new Promise(r=>srv.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${srv.address().port}`;
 function client(){const ws=new WebSocket(url),queue=[],received=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);queue.push(m);received.push(m)});return {ws,received,send:m=>ws.send(JSON.stringify(m)),async next(fn,timeout=9000){const t=Date.now();while(Date.now()-t<timeout){const i=queue.findIndex(fn);if(i>=0)return queue.splice(i,1)[0];await wait(20)}throw Error('timeout '+JSON.stringify(queue.slice(-3)));}};}
 const a=client(),b=client();while(a.ws.readyState!==1||b.ws.readyState!==1)await wait(10);
 a.send({type:'create',name:'Ana',mode:'timed',minutes:1});const session=await a.next(m=>m.type==='session');await a.next(m=>m.type==='state');
 b.send({type:'join',room:session.room,name:'Bruno'});await b.next(m=>m.type==='session');await b.next(m=>m.type==='state');
 a.send({type:'auto'});await a.next(m=>m.type==='state'&&Object.keys(m.placements).length===7);
 b.send({type:'auto'});await b.next(m=>m.type==='state'&&Object.keys(m.placements).length===7);
 a.send({type:'ready',value:true});await a.next(m=>m.type==='state'&&m.players[0].ready);
 b.send({type:'ready',value:true});await b.next(m=>m.type==='state'&&m.phase==='countdown');
 const ba=await a.next(m=>m.type==='state'&&m.phase==='playing'),bb=await b.next(m=>m.type==='state'&&m.phase==='playing');
 assert.equal(ba.version,'9.0.0');const room=rooms.get(session.room);const attacker=room.active===0?a:b,defender=room.active===0?b:a;
 attacker.received.length=0;await wait(1050);assert.equal(attacker.received.filter(m=>m.type==='state').length,0,'Clock tick must not broadcast full state');
 assert(room.timers[room.active]<60000,'Server authoritative clock must decrement despite no state broadcast');
 const victimState=room.active===0?bb:ba,pl=victimState.placements.perla,points=L.gemPoints('perla',pl.x,pl.y,pl.r);
 // First hit, then opposing miss, then second hit completes 2-cell gem.
 attacker.send({type:'shot',x:points[0][0],y:points[0][1]});await attacker.next(m=>m.type==='state'&&m.history?.length===1);
  const originalAttacker=room.players[room.active===0?1:0],ownMap=L.pointMap(originalAttacker.placements);
 const miss=Object.keys(ownMap).length && [...Array(121).keys()].map(i=>`${i%11-5},${Math.floor(i/11)-5}`).find(k=>!ownMap[k]);
 const [mx,my]=miss.split(',').map(Number);defender.send({type:'shot',x:mx,y:my});await defender.next(m=>m.type==='state'&&m.history?.length===1);
 attacker.send({type:'shot',x:points[1][0],y:points[1][1]});const reveal=await attacker.next(m=>m.type==='state'&&m.phase==='reveal');
 const times=reveal.timers.slice(),otherActive=reveal.active;assert.equal(reveal.revealRemaining>0,true,'Reveal must have a bounded pause');await wait(1250);
 assert.deepEqual(room.timers,times,'Both clocks must stop during synchronized gem reveal');
 const resumed=await attacker.next(m=>m.type==='state'&&m.phase==='playing'&&m.active!==otherActive,5000);assert.equal(resumed.active,1-otherActive,'Other player should act after reveal');
 console.log('PASS v9: no tick spam, authoritative clock, synchronized pause, next player after reveal');a.ws.close();b.ws.close();srv.close();process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
