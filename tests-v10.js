'use strict';
// Integration checks for v10: secret result, radar scan, synchronized pauses.
// Requires Node.js >= 22 for the native WebSocket test client.
const assert=require('node:assert/strict'),{srv,rooms}=require('./server'),L=require('./game-logic');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const url=`ws://127.0.0.1:${srv.address().port}`;
 function client(){const ws=new WebSocket(url),q=[];ws.onmessage=e=>q.push(JSON.parse(e.data));
 return {ws,send:m=>ws.send(JSON.stringify(m)),async next(check,timeout=8500){const t=Date.now();while(Date.now()-t<timeout){const i=q.findIndex(check);if(i>=0)return q.splice(i,1)[0];await pause(15);}throw Error('Timeout expecting event; last '+JSON.stringify(q.slice(-3)));}};}
 const a=client(),b=client();while(a.ws.readyState!==1||b.ws.readyState!==1)await pause(10);
 a.send({type:'create',name:'MinerA',mode:'timed',minutes:1});const session=await a.next(m=>m.type==='session');await a.next(m=>m.type==='state');
 b.send({type:'join',room:session.room,name:'MinerB'});await b.next(m=>m.type==='session');await b.next(m=>m.type==='state');
 a.send({type:'auto'});await a.next(m=>m.type==='state'&&Object.keys(m.placements||{}).length===7);
 b.send({type:'auto'});await b.next(m=>m.type==='state'&&Object.keys(m.placements||{}).length===7);
 a.send({type:'ready',value:true});await a.next(m=>m.type==='state'&&m.players[0].ready);
 b.send({type:'ready',value:true});await b.next(m=>m.type==='state'&&m.phase==='countdown');
 const ready=await a.next(m=>m.type==='state'&&m.phase==='playing');await b.next(m=>m.type==='state'&&m.phase==='playing');
 assert.equal(ready.version,'10.0.0');const room=rooms.get(session.room),idx=ready.active,acting=idx===0?a:b,other=idx===0?b:a;
 room.players[idx].turns=4; // Arrange a turn-5 radar without 8 unrelated shots.
 acting.send({type:'radar',x:0,y:0});
 const scanning=await acting.next(m=>m.type==='state'&&m.phase==='scanning');
 assert.equal(scanning.scan.actor,idx);assert.equal(scanning.radars.length,0,'Result must remain hidden during radar animation');
 const before=room.timers.slice();await pause(340);assert.deepEqual(room.timers,before,'Radar scan must stop both clocks');
 const result=await acting.next(m=>m.type==='state'&&m.phase==='settling'&&m.radars.length===1);
 const count=L.radarCount(room.players[1-idx].placements,0,0);assert.equal(result.radars[0].n,count,'Exact radar count');
 const scanPause=room.timers.slice();await pause(360);assert.deepEqual(room.timers,scanPause,'Radar result must not tax next player');
 const play=await other.next(m=>m.type==='state'&&m.phase==='playing'&&m.active===1-idx);
 assert.equal(play.active,1-idx);
 const x=0,y=0,who=1-idx;
 other.send({type:'shot',x,y});
 const ex=await other.next(m=>m.type==='state'&&m.phase==='excavating');
 assert.equal(ex.excavation.actor,who);assert.equal(ex.history.length,0,'No hit information during excavation');
 const t=room.timers.slice();await pause(350);assert.deepEqual(room.timers,t,'Excavation must stop both clocks');
 const shot=await other.next(m=>m.type==='state'&&m.history.some(h=>h.pos==='0,0'));
 assert.equal(shot.history.length,1,'Result appears after excavation');
 console.log('PASS v10: 2 clients, radar turn 5, hidden scan result, 3x3 count, paused clocks, delayed shot result.');
 a.ws.close();b.ws.close();srv.close();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
