'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {WebSocketServer,WebSocket}=require('./websocket-lite');
const L=require('./game-logic');
const PORT=Number(process.env.PORT||3000);
const rooms=new Map();
const srv=http.createServer((req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(url.pathname==='/api/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:true,rooms:rooms.size}));}
  if(url.pathname!=='/'&&url.pathname!=='/index.html'){res.writeHead(404);return res.end('No encontrado');}
  fs.readFile(path.join(__dirname,'public','index.html'),(err,data)=>{if(err){res.writeHead(500);return res.end('Error');}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);});
});
const wss=new WebSocketServer({server:srv});
const code=()=>{let s;do{s=crypto.randomBytes(5).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);}while(s.length<6||rooms.has(s));return s;};
const token=()=>crypto.randomBytes(24).toString('base64url');
const cleanName=v=>typeof v==='string'?v.trim().slice(0,24).replace(/[<>]/g,'')||'Jugador':'Jugador';
function makePlayer(name){return {token:token(),name:cleanName(name),ws:null,ready:false,placements:{},shots:[],radars:[],turns:0,misses:0};}
function connected(p){return !!(p&&p.ws&&p.ws.readyState===WebSocket.OPEN);}
function send(ws,obj){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));}
function error(ws,msg){send(ws,{type:'error',message:msg});}
function announce(room,msg){room.log.unshift(msg);room.log=room.log.slice(0,12);}
function scoreboard(room,p){if(!p)return {points:0,complete:0,misses:0};const enemy=room.players[room.players.indexOf(p)===0?1:0];return {points:enemy?Object.keys(L.pointMap(enemy.placements)).filter(k=>p.shots.includes(k)).length:0,complete:enemy?L.completedGems(enemy.placements,p.shots).length:0,misses:p.misses};}
function end(room,reason,winner=null){room.phase='ended';room.endReason=reason;
 if(winner!==null){room.winner=winner;}
 else {const a=scoreboard(room,room.players[0]),b=scoreboard(room,room.players[1]);room.winner=a.points===b.points?(a.complete===b.complete?(a.misses===b.misses?-1:(a.misses<b.misses?0:1)):(a.complete>b.complete?0:1)):(a.points>b.points?0:1);}
 room.lastTick=0;announce(room,room.winner===-1?'Empate.':`Partida finalizada: gana ${room.players[room.winner]?.name||'Jugador'}.`);
}
function syncClock(room){
 if(room.phase!=='playing'||room.settings.mode!=='timed')return;
 if(!connected(room.players[0])||!connected(room.players[1])){room.lastTick=0;return;}
 const now=Date.now();if(!room.lastTick){room.lastTick=now;return;}
 const elapsed=Math.min(now-room.lastTick,5000);room.lastTick=now;
 const p=room.active;room.timers[p]=Math.max(0,room.timers[p]-elapsed);
 if(room.timers[p]<=0){announce(room,`${room.players[p].name} agotó su tiempo.`);
  const other=1-p;if(room.timers[other]<=0)end(room,'time');else{room.active=other;room.lastTick=now;}}
}
function view(room,idx){
 const p=room.players[idx],e=room.players[1-idx];const ownMap=L.pointMap(p.placements);
 const completed=e?L.completedGems(e.placements,p.shots):[];
 const emap=e?L.pointMap(e.placements):{};
 const enemyRevealed={};for(const [pos,id] of Object.entries(emap))if(p.shots.includes(pos))enemyRevealed[pos]=completed.includes(id)?id:'fragment';
 const history=p.shots.map(pos=>({pos,hit:!!emap[pos]}));
 return {type:'state',code:room.code,me:idx,phase:room.phase,settings:room.settings,
  players:room.players.map((v,i)=>v?{name:v.name,ready:v.ready,connected:connected(v),score:scoreboard(room,v),turns:v.turns}:null),
  placements:p.placements,ownMap,ownHits:e?e.shots:[],enemyRevealed,history,radars:p.radars,
  completed,active:room.active,timers:room.timers,turn:p.turns+1,
  winner:room.winner,endReason:room.endReason,log:room.log,countdownRemaining:room.phase==='countdown'?Math.max(0,room.countdownEndsAt-Date.now()):0,
  waiting:room.phase==='playing'&&(!connected(room.players[0])||!connected(room.players[1]))};
}
function broadcast(room){room.updated=Date.now();room.players.forEach((p,i)=>{if(p)send(p.ws,view(room,i));});}
function resumePlayer(ws,room,p,idx){if(p.ws&&p.ws!==ws&&p.ws.readyState===WebSocket.OPEN)p.ws.close(4000,'Sesión abierta en otro dispositivo');p.ws=ws;ws.room=room.code;ws.player=idx;send(ws,{type:'session',room:room.code,token:p.token,me:idx});announce(room,`${p.name} está en la sala.`);room.lastTick=0;broadcast(room);}
function create(ws,m){const room={code:code(),phase:'setup',settings:{mode:m.mode==='free'?'free':'timed',minutes:Math.min(30,Math.max(1,Math.floor(Number(m.minutes)||10)))},players:[makePlayer(m.name),null],active:0,timers:[0,0],winner:null,endReason:null,log:[],lastTick:0,updated:Date.now()};rooms.set(room.code,room);resumePlayer(ws,room,room.players[0],0);}
function join(ws,m){const key=String(m.room||'').toUpperCase().replace(/[^A-Z0-9]/g,'');const room=rooms.get(key);if(!room)return error(ws,'Sala inexistente o expirada.');
 let idx=-1,p=null;
 if(typeof m.token==='string'){idx=room.players.findIndex(t=>t&&crypto.timingSafeEqual(Buffer.from(t.token.padEnd(64)),Buffer.from(m.token.slice(0,64).padEnd(64))));if(idx>=0)p=room.players[idx];}
 if(!p){if(room.players[1]||room.phase!=='setup')return error(ws,'La sala ya tiene dos jugadores.');idx=1;p=makePlayer(m.name);room.players[1]=p;}
 resumePlayer(ws,room,p,idx);
}
function onMessage(ws,raw){let m;try{m=JSON.parse(raw.toString())}catch{return error(ws,'Mensaje inválido.');}
 if(!m||typeof m.type!=='string')return error(ws,'Acción inválida.');
 if(!ws.room){if(m.type==='create')return create(ws,m);if(m.type==='join')return join(ws,m);return error(ws,'Primero debes crear o entrar a una sala.');}
 const room=rooms.get(ws.room),idx=ws.player,p=room?.players[idx];if(!room||!p||p.ws!==ws)return error(ws,'Sesión no válida.');
 syncClock(room);
 if(m.type==='leave'){
  if(room.phase==='playing'||room.phase==='countdown'){
   end(room,'withdraw',1-idx);
   announce(room,`${p.name} abandonó la partida.`);
   p.ws=null;ws.room=null;ws.player=null;
   send(ws,{type:'left'});broadcast(room);return;
  }
  if(idx===0&&room.phase==='setup'){
   for(const other of room.players){if(other&&other!==p&&connected(other)){send(other.ws,{type:'room_closed'});other.ws.room=null;other.ws.player=null;}}
   rooms.delete(room.code);
  }else if(idx===1&&room.phase==='setup'){
   room.players[1]=null;room.players[0].ready=false;announce(room,'El segundo explorador salió de la sala.');
  }
  p.ws=null;ws.room=null;ws.player=null;send(ws,{type:'left'});
  if(rooms.has(room.code))broadcast(room);
  return;
 }
 if(m.type==='settings'){
  if(idx!==0||room.phase!=='setup'||room.players.some(pl=>pl?.ready))return error(ws,'No es posible modificar la configuración ahora.');
  room.settings={mode:m.mode==='free'?'free':'timed',minutes:Math.min(30,Math.max(1,Math.floor(Number(m.minutes)||10)))};
 }
 else if(m.type==='place'){
  if(room.phase!=='setup'||p.ready)return error(ws,'Debes desmarcar Listo antes de cambiar las gemas.');
  const {id,x,y,r}=m;if(!L.GEMS.some(g=>g.id===id)||!Number.isInteger(x)||!Number.isInteger(y)||!Number.isInteger(r))return error(ws,'Ingresa números enteros y una gema válida.');
  const valid=L.isValidPlacement(p.placements,id,x,y,r);if(valid)return error(ws,valid);p.placements[id]={x,y,r};
 }
 else if(m.type==='remove'){
  if(room.phase!=='setup'||p.ready)return error(ws,'Desmarca Listo para modificar.');if(L.GEMS.some(g=>g.id===m.id))delete p.placements[m.id];
 }
 else if(m.type==='auto'){
  if(room.phase!=='setup'||p.ready)return error(ws,'Desmarca Listo para modificar.');try{p.placements=L.randomLayout()}catch(e){return error(ws,e.message);}
 }
 else if(m.type==='reset'){
  if(room.phase!=='setup'||p.ready)return error(ws,'Desmarca Listo para modificar.');p.placements={};
 }
 else if(m.type==='ready'){
  if(room.phase!=='setup')return error(ws,'Ya comenzó la partida.');
  if(m.value&&Object.keys(p.placements).length!==L.GEMS.length)return error(ws,'Coloca las siete gemas antes de comenzar.');
  p.ready=!!m.value;
  if(room.players.every(pl=>pl&&pl.ready)){
   room.phase='countdown';room.active=Math.random()<.5?0:1;room.timers=[room.settings.minutes*60000,room.settings.minutes*60000];room.lastTick=0;room.countdownEndsAt=Date.now()+3300;room.phase='countdown';announce(room,`Ambos yacimientos listos. ¡Preparados para explorar!`);
  }
 }
 else if(m.type==='shot'||m.type==='radar'){
  if(room.phase!=='playing'||room.waiting||!connected(room.players[0])||!connected(room.players[1]))return error(ws,'La partida no está lista para jugar.');
  if(room.active!==idx)return error(ws,'Todavía no es tu turno.');
  const x=m.x,y=m.y;if(!Number.isInteger(x)||!Number.isInteger(y)||x<L.MIN||x>L.MAX||y<L.MIN||y>L.MAX)return error(ws,'Las coordenadas deben ser enteros entre −5 y 5.');
  const enemy=room.players[1-idx],pos=L.key(x,y),nextTurn=p.turns+1;
  if(m.type==='shot'){
   if(p.shots.includes(pos))return error(ws,'Ya exploraste esas coordenadas.');
   p.shots.push(pos);const hit=!!L.pointMap(enemy.placements)[pos];if(!hit)p.misses++;
   const newCompleted=L.completedGems(enemy.placements,p.shots);
   const justComplete=newCompleted.filter(g=>!L.completedGems(enemy.placements,p.shots.slice(0,-1)).includes(g));
   announce(room,`${p.name} exploró (${x}, ${y}): ${hit?'¡fragmento encontrado!':'sin gema'}.${justComplete.length?' Gema completada: '+justComplete.map(id=>L.GEMS.find(g=>g.id===id).name).join(', ')+'.':''}`);
  }else{
   if(nextTurn%5!==0)return error(ws,'El radar solo se habilita en los turnos propios 5, 10, 15, ...');
   if(x<=L.MIN||x>=L.MAX||y<=L.MIN||y>=L.MAX)return error(ws,'El centro del radar debe estar entre −4 y 4.');
   const n=L.radarCount(enemy.placements,x,y);p.radars.push({x,y,n});announce(room,`${p.name} utilizó el radar en (${x}, ${y}) y detectó ${n} nodos con gemas.`);
  }
  p.turns++;
  if(scoreboard(room,p).points===L.TOTAL){end(room,'completed',idx);}
  else {const other=1-idx;if(room.settings.mode==='timed'&&room.timers[other]<=0){room.active=idx;}else room.active=other;room.lastTick=0;}
 }
 else return error(ws,'Acción no reconocida.');
 broadcast(room);
}
wss.on('connection',ws=>{ws.on('message',raw=>{try{onMessage(ws,raw);}catch(e){console.error('Error de acción:',e);error(ws,'No se pudo completar la acción.');}});
 ws.on('close',()=>{const r=rooms.get(ws.room);if(r&&r.players[ws.player]?.ws===ws){r.players[ws.player].ws=null;r.lastTick=0;if(r.phase==='countdown'){r.phase='setup';r.countdownEndsAt=0;for(const p of r.players)if(p)p.ready=false;announce(r,'Se canceló la cuenta regresiva porque un jugador se desconectó.');}broadcast(r);}});
});
setInterval(()=>{for(const r of rooms.values()){
 if(r.phase==='countdown'&&Date.now()>=r.countdownEndsAt){
  if(r.players.every(connected)){
   r.phase='playing';r.lastTick=Date.now();announce(r,`¡A excavar! Comienza ${r.players[r.active].name}.`);
  }else {r.phase='setup';r.countdownEndsAt=0;for(const p of r.players)if(p)p.ready=false;}
  broadcast(r);
 }else if(r.phase==='playing'&&r.settings.mode==='timed'){
  const a=r.active,t=r.timers[a],prev=r.phase;syncClock(r);
  if(prev!==r.phase||r.timers[a]!==t)broadcast(r);
 }
}},250);
setInterval(()=>{for(const [id,r] of rooms){if(Date.now()-r.updated>4*60*60*1000){for(const p of r.players)if(p?.ws)p.ws.close();rooms.delete(id);}}},60000);
if(require.main===module)srv.listen(PORT,'0.0.0.0',()=>console.log(`GEMAPLANO en http://localhost:${PORT}`));
module.exports={srv,rooms};
