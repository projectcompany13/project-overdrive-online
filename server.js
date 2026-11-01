'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const TICK = 1000 / 30;
const MAX_PLAYERS = 10;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || true }, pingInterval: 25000, pingTimeout: 20000 });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
const rooms = new Map();
const COLORS = ['#5de7ff','#ff65a8','#b38aff','#ffd166','#64f0b0','#ff9466','#8da8ff','#f47cff','#b9f36b','#ff7777'];
const UPGRADES = [
  {id:'damage',name:'Тяжёлое ядро',desc:'+25% к урону оружия',icon:'◆'},
  {id:'rate',name:'Частый разряд',desc:'+20% к скорости стрельбы',icon:'⚡'},
  {id:'health',name:'Усиленная оболочка',desc:'+35 к максимальному здоровью и лечение',icon:'⬡'},
  {id:'speed',name:'Сверхскорость',desc:'+12% к скорости передвижения',icon:'»'},
  {id:'dash',name:'Фазовый рывок',desc:'Рывок перезаряжается быстрее',icon:'➤'},
  {id:'shield',name:'Энергетический щит',desc:'На 12% меньше входящего урона',icon:'◈'},
  {id:'split',name:'Раздвоенный импульс',desc:'Каждый выстрел выпускает два снаряда',icon:'✦'},
  {id:'pierce',name:'Пробивной заряд',desc:'Снаряд пробивает дополнительную цель',icon:'↗'},
  {id:'ricochet',name:'Рикошет',desc:'Снаряды один раз отскакивают от границы',icon:'⤴'},
  {id:'nova',name:'Взрывной след',desc:'Уничтожение врага наносит урон рядом стоящим',icon:'✹'},
  {id:'heal',name:'Ремонтный импульс',desc:'Восстанови 60 здоровья',icon:'✚'}
];
const MAPS = ['core','factory','skyline'];
const WEAPONS = ['pulse','scatter','cannon'];
const CHARS = ['vanguard','scout','guardian'];
const rand = (a,b) => a + Math.random() * (b-a);
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
function code(){ return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function playerBase(id, name, index, character, weapon, width, height){
  const char = character === 'scout' ? {hp:170,speed:255,armor:0,dash:1.7} : character === 'guardian' ? {hp:260,speed:180,armor:.08,dash:2.4} : {hp:210,speed:215,armor:0,dash:2.2};
  return {id,name:(typeof name==='string'?name:'').slice(0,16)||`Боец ${index+1}`,color:COLORS[index%COLORS.length],x:width/2+rand(-55,55),y:height/2+rand(-55,55),r:14,hp:char.hp,maxHp:char.hp,speed:char.speed,armor:char.armor,damage:weapon==='cannon'?30:weapon==='scatter'?9:18,fireRate:weapon==='cannon'?1.8:weapon==='scatter'?2.1:3.2,weapon:WEAPONS.includes(weapon)?weapon:'pulse',character:CHARS.includes(character)?character:'vanguard',dashCd:char.dash,dashLeft:0,dashReady:0,inv:0,score:0,kills:0,alive:true,aim:0,input:{x:0,y:0,fire:false,dash:false,q:false},lastShot:0,upgrades:[],pending:[],effects:{split:false,pierce:0,ricochet:false,nova:false},lastQ:0};
}
function obstaclesFor(map,w,h){const cx=w/2,cy=h/2;if(map==='factory')return [{x:cx-125,y:cy-55,w:90,h:110},{x:cx+35,y:cy-55,w:90,h:110},{x:cx-45,y:cy-150,w:90,h:55},{x:cx-45,y:cy+95,w:90,h:55}];if(map==='skyline')return [{x:cx-180,y:cy-95,w:115,h:55},{x:cx+65,y:cy+40,w:115,h:55},{x:cx-40,y:cy-25,w:80,h:50}];return [{x:cx-65,y:cy-65,w:130,h:24},{x:cx-65,y:cy+41,w:130,h:24}];}
function spawnEnemy(room,i){const w=room.width,h=room.height,side=i%4;let x=side===0?rand(40,w-40):side===1?w-40:side===2?rand(40,w-40):40;let y=side===0?40:side===1?rand(40,h-40):side===2?h-40:rand(40,h-40);const types=['chaser','shooter','tank','runner','drone'];const type=room.round===1?['chaser','chaser','shooter','runner'][Math.floor(Math.random()*4)]:types[Math.floor(Math.random()*types.length)];const data={chaser:[16,45+room.round*8,85,'#ff579b'],shooter:[14,38+room.round*7,58,'#ffb45c'],tank:[22,95+room.round*13,38,'#a987ff'],runner:[11,30+room.round*6,135,'#66e5a9'],drone:[13,48+room.round*7,76,'#55e7df']}[type];room.enemies.push({id:crypto.randomUUID(),x,y,r:data[0],hp:data[1],maxHp:data[1],speed:data[2],color:data[3],type,fire:rand(.6,1.8),phase:0,alive:true});}
function beginRound(room){room.enemies=[];room.shots=[];room.roundState='playing';room.roundStarted=Date.now();room.players.forEach(p=>{p.hp=Math.min(p.maxHp,p.hp+30);p.alive=true;p.x=room.width/2+rand(-70,70);p.y=room.height/2+rand(-70,70);p.pending=[];p.input={x:0,y:0,fire:false,dash:false,q:false};});const n=Math.min(28,3+room.round*2);for(let i=0;i<n;i++)spawnEnemy(room,i);if(room.mode==='standard'&&room.round===5)room.enemies.push({id:crypto.randomUUID(),x:room.width*.78,y:room.height/2,r:37,hp:650,maxHp:650,speed:55,color:'#ff665f',type:'boss',fire:1,phase:0,alive:true});}
function rollUpgrades(){return [...UPGRADES].sort(()=>Math.random()-.5).slice(0,3);}
function broadcastRoom(room){io.to(room.code).emit('room:update',roomInfo(room));}
function roomInfo(room){return {code:room.code,host:room.host,players:[...room.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,character:p.character,weapon:p.weapon,ready:p.ready||false})),status:room.status,mode:room.mode,map:room.map};}
function createRoom(socket,data){let c=code();while(rooms.has(c))c=code();const room={code:c,host:socket.id,players:new Map(),status:'lobby',mode:data.mode==='endless'?'endless':'standard',map:MAPS.includes(data.map)?data.map:'core',width:1000,height:650,round:1,roundState:'waiting',score:0,shots:[],enemies:[],obstacles:[],lastTick:Date.now(),winner:null};room.players.set(socket.id,playerBase(socket.id,data.name,0,data.character,data.weapon,room.width,room.height));room.obstacles=obstaclesFor(room.map,room.width,room.height);rooms.set(c,room);socket.join(c);socket.data.room=c;socket.emit('room:joined',{...roomInfo(room),selfId:socket.id});broadcastRoom(room);}
function leaveRoom(socket){const c=socket.data.room;if(!c)return;const room=rooms.get(c);socket.leave(c);delete socket.data.room;if(!room)return;room.players.delete(socket.id);if(room.players.size===0){rooms.delete(c);return;}if(room.host===socket.id)room.host=room.players.keys().next().value;if(room.status==='playing'&&room.roundState==='upgrade'&&[...room.players.values()].every(p=>p.pending.length===0)){if(room.mode==='standard'&&room.round>=5)endMatch(room);else{room.round++;beginRound(room);io.to(room.code).emit('round:begin',snapshot(room));}}broadcastRoom(room);}
function hitRect(e,o){const x=clamp(e.x,o.x,o.x+o.w),y=clamp(e.y,o.y,o.y+o.h);return Math.hypot(e.x-x,e.y-y)<e.r;}
function keepOut(e,obs){for(const o of obs)if(hitRect(e,o)){const x=clamp(e.x,o.x,o.x+o.w),y=clamp(e.y,o.y,o.y+o.h),dx=e.x-x,dy=e.y-y,d=Math.hypot(dx,dy)||1;e.x=x+dx/d*(e.r+1);e.y=y+dy/d*(e.r+1);}}
function damagePlayer(room,p,amount){if(p.inv>0||!p.alive)return;p.hp-=amount*(1-p.armor);p.inv=.22;if(p.hp<=0){p.hp=0;p.alive=false;}}
function finishRound(room){room.roundState='upgrade';room.players.forEach(p=>{p.pending=rollUpgrades();p.input={x:0,y:0,fire:false,dash:false,q:false};});io.to(room.code).emit('round:upgrade',{round:room.round,choices:Object.fromEntries([...room.players.values()].map(p=>[p.id,p.pending]))});}
function applyUpgrade(p,id){const u=UPGRADES.find(x=>x.id===id);if(!u||!p.pending.some(x=>x.id===id))return false;switch(id){case'damage':p.damage*=1.25;break;case'rate':p.fireRate*=1.2;break;case'health':p.maxHp+=35;p.hp=Math.min(p.maxHp,p.hp+35);break;case'speed':p.speed*=1.12;break;case'dash':p.dashCd=Math.max(.65,p.dashCd*.7);break;case'shield':p.armor=Math.min(.55,p.armor+.12);break;case'split':p.effects.split=true;break;case'pierce':p.effects.pierce++;break;case'ricochet':p.effects.ricochet=true;break;case'nova':p.effects.nova=true;break;case'heal':p.hp=Math.min(p.maxHp,p.hp+60);break;}p.upgrades.push(u.name);p.pending=[];return true;}
function endMatch(room){room.status='finished';room.roundState='finished';const sorted=[...room.players.values()].sort((a,b)=>b.score-a.score);room.winner=sorted[0]?.id||null;io.to(room.code).emit('match:over',{winner:room.winner,players:sorted.map(p=>({id:p.id,name:p.name,score:p.score,kills:p.kills}))});}
function tick(room,dt){if(room.status!=='playing'||room.roundState!=='playing')return;const now=Date.now(),obs=room.obstacles;
  for(const p of room.players.values()){
    if(!p.alive)continue;const inp=p.input;let dx=clamp(inp.x,-1,1),dy=clamp(inp.y,-1,1),len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;
    if(inp.dash&&p.dashReady<=0&&(dx||dy)){p.x+=dx*135;p.y+=dy*135;p.dashReady=p.dashCd;p.inv=.32;}p.dashReady=Math.max(0,p.dashReady-dt);p.inv=Math.max(0,p.inv-dt);p.x=clamp(p.x+dx*p.speed*dt,p.r,room.width-p.r);p.y=clamp(p.y+dy*p.speed*dt,p.r,room.height-p.r);keepOut(p,obs);
    p.aim=Number.isFinite(inp.aim)?inp.aim:p.aim;
    if(inp.fire&&now-p.lastShot>1000/p.fireRate){p.lastShot=now;const n=p.effects.split?2:1,spread=p.weapon==='scatter'?5:1;for(let i=0;i<spread;i++){const off=spread===1?0:(i-(spread-1)/2)*.2;for(let j=0;j<n;j++){const a=p.aim+off+(n===2?(j?-.07:.07):0);room.shots.push({id:crypto.randomUUID(),x:p.x+Math.cos(a)*18,y:p.y+Math.sin(a)*18,vx:Math.cos(a)*(p.weapon==='cannon'?390:540),vy:Math.sin(a)*(p.weapon==='cannon'?390:540),r:p.weapon==='cannon'?9:6,life:2,owner:p.id,damage:p.damage/(spread>1?1.8:1),bounces:p.effects.ricochet?1:0,pierce:p.effects.pierce,hit:[]});}}}
    if(inp.q&&now-p.lastQ>5000){p.lastQ=now;for(const e of room.enemies){if(e.alive&&Math.hypot(e.x-p.x,e.y-p.y)<220){e.hp-=65;if(e.hp<=0)killEnemy(room,e,p);}}p.inv=.7;}
  }
  for(const e of room.enemies){if(!e.alive)continue;e.phase+=dt;e.fire-=dt;const targets=[...room.players.values()].filter(p=>p.alive);if(!targets.length)continue;let target=targets.sort((a,b)=>dist(e,a)-dist(e,b))[0],vx=target.x-e.x,vy=target.y-e.y,d=Math.hypot(vx,vy)||1,a=Math.atan2(vy,vx);let move=1;
    if(e.type==='shooter'||e.type==='boss'){move=d>260?1:d<175?-.65:.08;e.x+=Math.cos(a)*e.speed*move*dt+Math.cos(e.phase*1.4)*24*dt;e.y+=Math.sin(a)*e.speed*move*dt+Math.sin(e.phase*1.2)*24*dt;if(e.fire<=0&&d<600){const spread=e.type==='boss'?[-.22,0,.22]:[0];spread.forEach(v=>room.shots.push({id:crypto.randomUUID(),x:e.x,y:e.y,vx:Math.cos(a+v)*300,vy:Math.sin(a+v)*300,r:7,life:2,owner:'enemy',damage:e.type==='boss'?17:11,bounces:0,pierce:0,hit:[]}));e.fire=e.type==='boss'?1.15:1.5;}}
    else{e.x+=Math.cos(a)*e.speed*dt;e.y+=Math.sin(a)*e.speed*dt;}e.x=clamp(e.x,e.r,room.width-e.r);e.y=clamp(e.y,e.r,room.height-e.r);keepOut(e,obs);for(const p of targets)if(dist(e,p)<e.r+p.r)damagePlayer(room,p,e.type==='tank'?22:16);
  }
  for(const s of room.shots){s.x+=s.vx*dt;s.y+=s.vy*dt;s.life-=dt;if(obs.some(o=>s.x>o.x&&s.x<o.x+o.w&&s.y>o.y&&s.y<o.y+o.h)){s.life=0;continue;}if(s.x<0||s.x>room.width||s.y<0||s.y>room.height){if(s.bounces>0){if(s.x<0||s.x>room.width)s.vx*=-1;if(s.y<0||s.y>room.height)s.vy*=-1;s.bounces--;s.x=clamp(s.x,0,room.width);s.y=clamp(s.y,0,room.height);}else{s.life=0;continue;}}
    if(s.owner==='enemy'){for(const p of room.players.values())if(p.alive&&dist(s,p)<s.r+p.r){damagePlayer(room,p,s.damage);s.life=0;break;}}
    else{const owner=room.players.get(s.owner);for(const e of room.enemies){if(!e.alive||s.hit.includes(e.id)||dist(s,e)>s.r+e.r)continue;s.hit.push(e.id);e.hp-=s.damage;if(e.hp<=0)killEnemy(room,e,owner);if(s.pierce>0)s.pierce--;else{s.life=0;break;}}}
  }
  room.shots=room.shots.filter(s=>s.life>0);if(room.enemies.every(e=>!e.alive)){finishRound(room);return;}
  if([...room.players.values()].every(p=>!p.alive)){endMatch(room);return;}
  io.to(room.code).emit('state',snapshot(room));
}
function killEnemy(room,e,p){if(!e.alive)return;e.alive=false;if(p){p.score+=e.type==='boss'?1500:e.type==='tank'?180:100;p.kills++;if(p.effects.nova)for(const other of room.enemies)if(other.alive&&dist(other,e)<100){other.hp-=35;if(other.hp<=0)killEnemy(room,other,p);}}}
function snapshot(room){return {code:room.code,status:room.status,round:room.round,roundState:room.roundState,mode:room.mode,map:room.map,width:room.width,height:room.height,players:[...room.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,x:p.x,y:p.y,r:p.r,hp:p.hp,maxHp:p.maxHp,alive:p.alive,aim:p.aim,score:p.score,kills:p.kills,weapon:p.weapon,inv:p.inv,upgrades:p.upgrades})),enemies:room.enemies,shots:room.shots,obstacles:room.obstacles};}
io.on('connection',socket=>{
  socket.emit('hello',{maxPlayers:MAX_PLAYERS});
  socket.on('room:create',data=>{if(socket.data.room)leaveRoom(socket);createRoom(socket,data||{});});
  socket.on('room:join',data=>{const room=rooms.get(String(data?.code||'').toUpperCase());if(!room){socket.emit('error:notice','Комната не найдена. Проверь код.');return;}if(room.status!=='lobby'){socket.emit('error:notice','Матч уже начался.');return;}if(room.players.size>=MAX_PLAYERS){socket.emit('error:notice','Комната заполнена (максимум 10 игроков).');return;}if(socket.data.room)leaveRoom(socket);const p=playerBase(socket.id,data.name,room.players.size,data.character,data.weapon,room.width,room.height);room.players.set(socket.id,p);socket.join(room.code);socket.data.room=room.code;socket.emit('room:joined',{...roomInfo(room),selfId:socket.id});broadcastRoom(room);});
  socket.on('room:leave',()=>leaveRoom(socket));
  socket.on('match:start',()=>{const room=rooms.get(socket.data.room);if(!room||room.host!==socket.id||room.status!=='lobby')return;if(room.players.size<1)return;room.status='playing';room.round=1;beginRound(room);io.to(room.code).emit('match:started',snapshot(room));});
  socket.on('input',data=>{const room=rooms.get(socket.data.room),p=room?.players.get(socket.id);if(!p||room.status!=='playing'||room.roundState!=='playing')return;p.input={x:clamp(Number(data.x)||0,-1,1),y:clamp(Number(data.y)||0,-1,1),aim:clamp(Number(data.aim)||0,-Math.PI*2,Math.PI*2),fire:!!data.fire,dash:!!data.dash,q:!!data.q};});
  socket.on('upgrade:choose',data=>{const room=rooms.get(socket.data.room),p=room?.players.get(socket.id);if(!p||room.roundState!=='upgrade'||!applyUpgrade(p,data?.id))return;const done=[...room.players.values()].every(x=>x.pending.length===0);if(done){if(room.mode==='standard'&&room.round>=5){endMatch(room);return;}room.round++;beginRound(room);io.to(room.code).emit('round:begin',snapshot(room));}else socket.emit('upgrade:accepted',p.upgrades.at(-1));});
  socket.on('disconnect',()=>leaveRoom(socket));
});
setInterval(()=>{const now=Date.now();for(const room of rooms.values()){const dt=Math.min((now-room.lastTick)/1000,.05);room.lastTick=now;tick(room,dt);}},TICK);
server.listen(PORT,'0.0.0.0',()=>console.log(`PROJECT: OVERDRIVE ONLINE запущен: http://localhost:${PORT}`));
