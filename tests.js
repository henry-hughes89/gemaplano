'use strict';
const assert=require('node:assert/strict');const G=require('./game-logic');
assert.equal(G.GEMS.reduce((s,g)=>s+g.cells.length,0),26);
for(const g of G.GEMS){for(let r=0;r<4;r++){assert.equal(new Set(G.rotate(g.cells,r).map(p=>p.join(','))).size,g.cells.length);}}
let attempts=80;
for(let i=0;i<attempts;i++){
 const p=G.randomLayout();assert.equal(Object.keys(p).length,7);
 for(const [id,loc] of Object.entries(p)){assert.equal(G.isValidPlacement(p,id,loc.x,loc.y,loc.r),null);}
 assert.equal(Object.keys(G.pointMap(p)).length,26);
 assert.equal(G.completedGems(p,Object.keys(G.pointMap(p))).length,7);
 for(let x=-4;x<=4;x+=4){for(let y=-4;y<=4;y+=4){assert.ok(G.radarCount(p,x,y)>=0&&G.radarCount(p,x,y)<=9);}}
}
assert.equal(G.isValidPlacement({},'prisma',5,5,0),'La gema sale del plano.');
console.log(`OK: 26 nodos, rotaciones, ${attempts} distribuciones automáticas, radar y victorias.`);
