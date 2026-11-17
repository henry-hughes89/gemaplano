'use strict';
// Minimal WebSocket server for small JSON text messages (RFC 6455).
// No external packages; the browser itself provides the WebSocket client.
const {EventEmitter}=require('node:events');const crypto=require('node:crypto');
const OPEN=1,CLOSED=3;
class WebSocketLite extends EventEmitter{
 constructor(socket){super();this.socket=socket;this.readyState=OPEN;this.buffer=Buffer.alloc(0);this.closed=false;
  socket.on('data',d=>this.read(d));socket.on('error',()=>this.end());socket.on('close',()=>this.end());}
 end(){if(this.closed)return;this.closed=true;this.readyState=CLOSED;this.emit('close');}
 frame(op,payload){if(this.readyState!==OPEN)return;const length=payload.length;let head;
  if(length<126){head=Buffer.from([0x80|op,length]);}
  else if(length<=65535){head=Buffer.alloc(4);head[0]=0x80|op;head[1]=126;head.writeUInt16BE(length,2);}
  else {head=Buffer.alloc(10);head[0]=0x80|op;head[1]=127;head.writeBigUInt64BE(BigInt(length),2);}
  try{this.socket.write(Buffer.concat([head,payload]));}catch{this.close();}}
 send(data){this.frame(1,Buffer.from(data));}
 close(){if(this.closed)return;try{this.frame(8,Buffer.alloc(0));this.socket.end();}catch{}this.end();}
 read(data){if(this.closed)return;this.buffer=Buffer.concat([this.buffer,data]);if(this.buffer.length>30000){this.close();return;}
  while(this.buffer.length>=2){const b=this.buffer[0],v=this.buffer[1],op=b&0x0f,fin=!!(b&0x80),masked=!!(v&0x80);let length=v&127,off=2;
   if(!fin||!masked){this.close();return;}
   if(length===126){if(this.buffer.length<4)return;length=this.buffer.readUInt16BE(2);off=4;}
   if(length===127){if(this.buffer.length<10)return;const n=this.buffer.readBigUInt64BE(2);if(n>12000n){this.close();return;}length=Number(n);off=10;}
   if(length>12000){this.close();return;}
   if(this.buffer.length<off+4+length)return;
   const mask=this.buffer.subarray(off,off+4),msg=Buffer.from(this.buffer.subarray(off+4,off+4+length));this.buffer=this.buffer.subarray(off+4+length);
   for(let j=0;j<length;j++)msg[j]^=mask[j%4];
   if(op===8){this.close();return;}
   if(op===9){this.frame(10,msg);continue;}
   if(op===10)continue;
   if(op!==1){this.close();return;}
   this.emit('message',msg);
  }
 }
}
class WebSocketServerLite extends EventEmitter{
 constructor({server}){super();server.on('upgrade',(req,socket)=>{
  const key=req.headers['sec-websocket-key'];if(!key||typeof key!=='string'||req.headers.upgrade?.toLowerCase()!=='websocket')return socket.destroy();
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const ws=new WebSocketLite(socket);this.emit('connection',ws);
 });}
}
module.exports={WebSocketServer:WebSocketServerLite,WebSocket:{OPEN}};
