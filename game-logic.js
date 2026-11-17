'use strict';
const MIN=-5, MAX=5, TOTAL=26;
const GEMS=[
 {id:'perla',name:'Perla', color:'#efb9d5',cells:[[0,0],[1,0]]},
 {id:'topacio',name:'Topacio',color:'#f4b54b',cells:[[0,0],[1,0],[1,1]]},
 {id:'trebol',name:'Trébol',color:'#56cf9a',cells:[[0,0],[1,1],[2,0]]},
 {id:'prisma',name:'Prisma',color:'#58bdec',cells:[[0,0],[1,0],[2,0],[3,0]]},
 {id:'rubi',name:'Rubí',color:'#ec6875',cells:[[0,0],[1,0],[0,1],[1,1]]},
 {id:'zafiro',name:'Zafiro',color:'#6c91f0',cells:[[0,0],[1,0],[2,0],[1,1],[1,2]]},
 {id:'diamante',name:'Diamante',color:'#c59afe',cells:[[1,0],[0,1],[1,1],[2,1],[1,2]]}
];
const key=(x,y)=>`${x},${y}`;
function rotate(cells,turns=0){
  let pts=cells.map(([x,y])=>[x,y]);
  for(let i=0;i<((turns%4)+4)%4;i++)pts=pts.map(([x,y])=>[-y,x]);
  const mx=Math.min(...pts.map(p=>p[0]));const my=Math.min(...pts.map(p=>p[1]));
  return pts.map(([x,y])=>[x-mx,y-my]);
}
function gemPoints(id,x,y,r){
  const gem=GEMS.find(g=>g.id===id);
  if(!gem||!Number.isInteger(x)||!Number.isInteger(y)||!Number.isInteger(r)||r<0||r>3)return null;
  return rotate(gem.cells,r).map(([dx,dy])=>[x+dx,y+dy]);
}
function isValidPlacement(placements,id,x,y,r){
  const pts=gemPoints(id,x,y,r);if(!pts)return 'Gema o parámetros no válidos.';
  const set=new Set(pts.map(([a,b])=>key(a,b)));
  if(pts.some(([a,b])=>a<MIN||a>MAX||b<MIN||b>MAX))return 'La gema sale del plano.';
  for(const [other,placement] of Object.entries(placements)){
    if(other===id)continue;
    const old=gemPoints(other,placement.x,placement.y,placement.r);
    for(const [a,b] of old){
      if(set.has(key(a,b)))return 'Las gemas no pueden superponerse.';
      if([[a+1,b],[a-1,b],[a,b+1],[a,b-1]].some(([nx,ny])=>set.has(key(nx,ny))))return 'Las gemas distintas no pueden tocarse por lados.';
    }
  }
  return null;
}
function randomLayout(){
  const order=[...GEMS].sort((a,b)=>b.cells.length-a.cells.length);
  for(let round=0;round<400;round++){
    let placements={};let ok=true;
    for(const gem of order){
      let placed=false;
      for(let attempt=0;attempt<400;attempt++){
        let r=Math.floor(Math.random()*4), x=MIN+Math.floor(Math.random()*11),y=MIN+Math.floor(Math.random()*11);
        if(!isValidPlacement(placements,gem.id,x,y,r)){placements[gem.id]={x,y,r};placed=true;break;}
      }
      if(!placed){ok=false;break;}
    }
    if(ok)return placements;
  }
  throw new Error('No fue posible generar una distribución; prueba nuevamente.');
}
function pointMap(placements){
 const m={};for(const g of GEMS){const pl=placements[g.id];if(!pl)continue;for(const [x,y] of gemPoints(g.id,pl.x,pl.y,pl.r))m[key(x,y)]=g.id;}return m;
}
function completedGems(placements,shots){
 const shotSet=new Set(shots);
 return GEMS.filter(g=>{const p=placements[g.id];return p&&gemPoints(g.id,p.x,p.y,p.r).every(([x,y])=>shotSet.has(key(x,y)))}).map(g=>g.id);
}
function radarCount(placements,x,y){
 const map=pointMap(placements);let n=0;
 for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(map[key(x+dx,y+dy)])n++;
 return n;
}
module.exports={MIN,MAX,TOTAL,GEMS,key,gemPoints,rotate,isValidPlacement,randomLayout,pointMap,completedGems,radarCount};
