// COCOMITalk - オープニング映像（canvas描画）
// このファイルは正二十面体が編み上がる18.5秒のオープニングのcanvas描画だけを担当する（音は opening-audio.js、画面と進行は opening.js）
// v1.0 2026-10-29 - cocomi_opening_v3.html から移植（文言・描画は元のまま。location遷移/リプレイ/window.__*は削除）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
(function () {
  var DUR = 18.5;

  /** cv(canvas)に描く描画器を作る。2Dコンテキストが取れなければ null */
  function create(cv) {
    var ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return null;
    var W = 0, H = 0, dpr = 1, U = 1, curT = 0;

/* ---------- utils ---------- */
function clamp(x,a,b){return x<a?a:x>b?b:x}
function lerp(a,b,t){return a+(b-a)*t}
function seg(t,a,b){return clamp((t-a)/(b-a),0,1)}
function eio(x){return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2}
function eout(x){return 1-Math.pow(1-x,3)}
function eoutExpo(x){return x>=1?1:1-Math.pow(2,-10*x)}
function rng(seed){return function(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}

/* ---------- emblem geometry: icosahedron ---------- */
var P=(1+Math.sqrt(5))/2, V=[[-1,P,0],[1,P,0],[-1,-P,0],[1,-P,0],[0,-1,P],[0,1,P],[0,-1,-P],[0,1,-P],[P,0,-1],[P,0,1],[-P,0,-1],[-P,0,1]];
V=V.map(function(v){var l=Math.hypot(v[0],v[1],v[2]);return [v[0]/l,v[1]/l,v[2]/l]});
var E=[];for(var i=0;i<12;i++)for(var j=i+1;j<12;j++){var d=Math.hypot(V[i][0]-V[j][0],V[i][1]-V[j][1],V[i][2]-V[j][2]);if(d<1.1)E.push([i,j])}
var F=[];for(var a=0;a<12;a++)for(var b=a+1;b<12;b++)for(var c=b+1;c<12;c++){function ad(x,y){return E.some(function(e){return (e[0]==x&&e[1]==y)||(e[0]==y&&e[1]==x)})}if(ad(a,b)&&ad(b,c)&&ad(a,c))F.push([a,b,c])}
// order edges by a walk so threads "weave" progressively
var rr=rng(7);E.sort(function(e1,e2){var m1=V[e1[0]][1]+V[e1[1]][1],m2=V[e2[0]][1]+V[e2[1]][1];return m2-m1+(rr()-.5)*.6});
var visit=[5,0,11,4,9,1,8,3,6,7,10,2];

function rot(v,ay,ax){var c=Math.cos(ay),s=Math.sin(ay),x=v[0]*c+v[2]*s,z=-v[0]*s+v[2]*c;var c2=Math.cos(ax),s2=Math.sin(ax),y=v[1]*c2-z*s2;z=v[1]*s2+z*c2;return [x,y,z]}

/* ---------- scene objects (seeded, deterministic) ---------- */
var r1=rng(42), dust=[];
for(var k=0;k<170;k++)dust.push({x:(r1()-.5)*9,y:(r1()-.5)*9,z:r1(),s:r1(),h:r1()});
var grainC=document.createElement('canvas');grainC.width=grainC.height=256;
(function(){var g=grainC.getContext('2d'),im=g.createImageData(256,256),r=rng(99);for(var i=0;i<im.data.length;i+=4){var v=r()*255|0;im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255}g.putImageData(im,0,0)})();

function resize(){dpr=Math.min(devicePixelRatio||1,2);W=cv.width=Math.round(innerWidth*dpr);H=cv.height=Math.round(innerHeight*dpr);U=Math.min(W,H)*.22}
/* ---------- spark (想い) path ---------- */
var EMB_R=1.0;
function embAngles(t){return [t*.35+.4, -.35+Math.sin(t*.3)*.08]}
function vertexWorld(i,t){var a=embAngles(t),p=rot(V[i],a[0],a[1]);return p}
function sparkPos(t){
  if(t<4.6){ // act1: idle + hop
    var hop=0; if(t>3.6){var h=seg(t,3.6,4.6);hop=-Math.sin(h*Math.PI)*.55*(1-h*.3)}
    var bob=Math.sin(t*2.4)*.03;
    return {x:-1.6,y:.55+bob+hop,z:0,sq:t>3.6&&t<3.72?.25:(t>4.5&&t<4.6?.2:0)};
  }
  if(t<10.4){ // act2: fly vertex to vertex
    var u=(t-4.6)/5.8*visit.length, idx=Math.min(visit.length-1,Math.floor(u)), f=eio(u-idx);
    var A=idx==0?{x:-1.6,y:.55,z:0}:(function(p){return {x:p[0]*EMB_R,y:p[1]*EMB_R,z:p[2]}})(vertexWorld(visit[idx-1],t));
    var Bp=vertexWorld(visit[idx],t), B={x:Bp[0]*EMB_R,y:Bp[1]*EMB_R,z:Bp[2]};
    var arc=Math.sin(f*Math.PI)*.25;
    return {x:lerp(A.x,B.x,f),y:lerp(A.y,B.y,f)-arc,z:lerp(A.z,B.z,f),sq:0};
  }
  // act3: dive into the core
  var last=vertexWorld(visit[visit.length-1],t), k=eio(seg(t,10.4,11.6));
  return {x:lerp(last[0],0,k),y:lerp(last[1],0,k),z:lerp(last[2],0,k),sq:0};
}

/* ---------- camera ---------- */
function camera(t){
  var s=sparkPos(t);
  var c={x:-1.6,y:.5,zoom:2.1};
  if(t<4.6){c.x=-1.6+Math.sin(t*.4)*.04;c.y=.5;c.zoom=lerp(2.5,2.1,eio(seg(t,0,4.6)))}
  else if(t<10.4){var k=eio(seg(t,4.6,6));c.x=lerp(-1.6,s.x*.55,k);c.y=lerp(.5,s.y*.55,k);c.zoom=lerp(2.1,1.55,eio(seg(t,4.6,10.4)))}
  else {var s2=sparkPos(10.4);var k2=eio(seg(t,10.4,12));c.x=lerp(s2.x*.55,0,k2);c.y=lerp(s2.y*.55,0,k2);c.zoom=lerp(1.55,1.25,k2)}
  // act4 pull back + emblem rises for title
  var pb=eio(seg(t,12.6,15.2)), L=layout(), zf=portrait()?.78:.5; c.zoom=lerp(c.zoom,zf,pb); c.y=lerp(c.y,(H/2-L.emb)/(U*zf),pb); c.x=lerp(c.x,0,pb);
  // subtle handheld drift
  c.x+=Math.sin(t*.7)*.015;c.y+=Math.cos(t*.53)*.012;
  return c;
}
function layout(){var b=letterbox(),inner=H-2*b,pr=portrait();return {b:b,inner:inner,emb:b+inner*(pr?.27:.225),title:b+inner*(pr?.53:.475),base:Math.min(W*(pr?.082:.058),inner*.11),origin:b+inner*(pr?.86:.925)}}
function portrait(){return H>W*1.1}

/* ---------- render ---------- */
function proj(x,y,z,cam){var persp=1/(1-z*.18);return {x:W/2+(x-cam.x)*U*cam.zoom*persp,y:H/2+(y-cam.y)*U*cam.zoom*persp,s:persp}}
function glow(x,y,r,col,a){var g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'rgba('+col+','+a+')');g.addColorStop(.35,'rgba('+col+','+a*.35+')');g.addColorStop(1,'rgba('+col+',0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,6.2832);ctx.fill()}

function render(t){
  curT=t; var cam=camera(t);
  ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
  // background: deep warm-black with faint horizon haze
  var bgA=seg(t,.3,2.5);
  var g=ctx.createRadialGradient(W/2,H*.55,0,W/2,H*.55,Math.max(W,H)*.8);
  g.addColorStop(0,'rgb('+(14*bgA|0)+','+(12*bgA|0)+','+(22*bgA|0)+')');g.addColorStop(1,'#000');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  // distant nebula wash, grows with structure
  var neb=bgA*(.35+.65*seg(t,6,13));
  ctx.globalCompositeOperation='lighter';
  glow(W*.5+(-cam.x)*U*.15,H*.48+(-cam.y)*U*.15,Math.max(W,H)*.55,'40,60,140',.22*neb);
  glow(W*.72+(-cam.x)*U*.2,H*.3,Math.max(W,H)*.35,'120,50,120',.12*neb);
  glow(W*.25,H*.7+(-cam.y)*U*.2,Math.max(W,H)*.35,'140,90,40',.1*neb);

  // parallax dust / bokeh (depth of field: near = large & soft)
  for(var i=0;i<dust.length;i++){var d=dust[i],par=.25+d.z*1.6;
    var x=W/2+(d.x-cam.x*par)*U*cam.zoom*.5*par, y=H/2+(d.y-cam.y*par+Math.sin(t*.2+d.h*6)*.05)*U*cam.zoom*.5*par;
    x=((x%(W*1.4))+W*1.4)%(W*1.4)-W*.2; y=((y%(H*1.4))+H*1.4)%(H*1.4)-H*.2;
    var near=d.z>.86, rad=(near?(6+d.s*14):(.6+d.s*1.4))*dpr*(near?1:par), a=(near?.07:.5*(.4+.6*Math.abs(Math.sin(t*1.3+d.h*20))))*bgA;
    var col=d.h<.6?'255,214,170':(d.h<.85?'150,190,255':'255,160,210');
    if(near)glow(x,y,rad,col,a);else{ctx.fillStyle='rgba('+col+','+a+')';ctx.beginPath();ctx.arc(x,y,rad,0,6.2832);ctx.fill()}
  }

  // ---- structure (構造) ----
  var ang=embAngles(t), pts=V.map(function(v){var p=rot(v,ang[0],ang[1]);return proj(p[0]*EMB_R,p[1]*EMB_R,p[2],cam)}), zs=V.map(function(v){return rot(v,ang[0],ang[1])[2]});
  var weave=seg(t,4.8,10.6), lock=seg(t,10.6,12.0), flash=Math.exp(-Math.pow((t-12.05)/.18,2)), crystal=eout(seg(t,11.8,13.4));
  // faces (crystallize)
  if(crystal>0){
    var order=F.map(function(f,i){return {i:i,z:(zs[f[0]]+zs[f[1]]+zs[f[2]])/3}}).sort(function(a,b){return a.z-b.z});
    ctx.globalCompositeOperation='lighter';
    order.forEach(function(o){var f=F[o.i],A=pts[f[0]],B=pts[f[1]],C=pts[f[2]];
      var shade=.5+.5*o.z, gg=ctx.createLinearGradient(A.x,A.y,C.x,C.y);
      gg.addColorStop(0,'rgba(255,190,120,'+(.10*crystal*shade)+')');gg.addColorStop(.6,'rgba(150,120,255,'+(.08*crystal*shade)+')');gg.addColorStop(1,'rgba(90,220,255,'+(.1*crystal*shade)+')');
      ctx.fillStyle=gg;ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.lineTo(C.x,C.y);ctx.closePath();ctx.fill()});
  }
  // edges: threads woven by the spark
  ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
  var nE=E.length, shown=weave*nE;
  for(var e=0;e<nE;e++){var p=clamp(shown-e,0,1);if(p<=0)break;
    var A=pts[E[e][0]],B=pts[E[e][1]],zz=(zs[E[e][0]]+zs[E[e][1]])/2, depth=.45+.55*(zz+1)/2;
    var bx=lerp(A.x,B.x,eout(p)),by=lerp(A.y,B.y,eout(p));
    var lw=(1.1+1.2*lock+2.5*flash)*dpr*depth*Math.max(.7,cam.zoom*.6);
    var hot=lerp(.55,1,lock)*depth+flash;
    var gl=ctx.createLinearGradient(A.x,A.y,B.x,B.y);gl.addColorStop(0,'rgba(255,200,140,'+hot+')');gl.addColorStop(1,'rgba(140,200,255,'+hot+')');
    ctx.strokeStyle=gl;ctx.lineWidth=lw*3;ctx.globalAlpha=.18;ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(bx,by);ctx.stroke();
    ctx.globalAlpha=1;ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(bx,by);ctx.stroke();
    if(p<1)glow(bx,by,8*dpr,'255,230,190',.9);
  }
  // vertex nodes
  for(var v=0;v<12;v++){var vi=visit.indexOf(v),born=4.6+(vi+.9)*(5.8/12);var a2=seg(t,born,born+.4);if(a2<=0)continue;var dep=.5+.5*(zs[v]+1)/2;
    glow(pts[v].x,pts[v].y,(10+10*lock+30*flash)*dpr*dep*cam.zoom*.6,'255,215,170',.55*a2*dep);ctx.fillStyle='rgba(255,248,235,'+a2*dep+')';ctx.beginPath();ctx.arc(pts[v].x,pts[v].y,1.8*dpr*cam.zoom*.7,0,6.2832);ctx.fill()}
  // inner core (証明)
  var coreA=seg(t,11.2,12.0);
  if(coreA>0){var o=proj(0,0,0,cam),pulse=1+.06*Math.sin(t*3);glow(o.x,o.y,U*cam.zoom*(.55*pulse+.9*flash),'255,205,150',.55*coreA+.4*flash);glow(o.x,o.y,U*cam.zoom*.18,'255,250,240',.9*coreA)}

  // idle loop: slow breathing halo once the sequence has ended
  var idle=seg(t,DUR-1,DUR+2);
  if(idle>0){var oi=proj(0,0,0,cam),br=.5+.5*Math.sin((t-DUR)*1.25-1.57);ctx.globalCompositeOperation='lighter';glow(oi.x,oi.y,U*cam.zoom*(1.25+.15*br),'255,200,140',.12*idle*(.35+.65*br));glow(oi.x,oi.y,U*cam.zoom*.4,'255,235,210',.18*idle*br)}
  // ---- the light-being (想い) ----
  var sA=seg(t,.9,2.2)*(1-seg(t,11.2,11.7));
  if(sA>0){
    // trail
    ctx.globalCompositeOperation='lighter';
    for(var q=1;q<=26;q++){var tt=t-q*.028;if(tt<0)break;var sp=sparkPos(tt),pp=proj(sp.x,sp.y,sp.z,cam);glow(pp.x,pp.y,(9-q*.3)*dpr*cam.zoom*.6,'255,190,120',.18*sA*(1-q/26)*(t>4.6?1:.25))}
    var s=sparkPos(t),P0=proj(s.x,s.y,s.z,cam),R=U*cam.zoom*.085*(1+.04*Math.sin(t*5));
    var flick=1+.08*Math.sin(t*17)*Math.sin(t*7.3);
    glow(P0.x,P0.y,R*6*flick,'255,170,90',.35*sA);
    glow(P0.x,P0.y,R*2.4,'255,215,160',.8*sA);
    // body
    ctx.globalCompositeOperation='source-over';
    ctx.save();ctx.translate(P0.x,P0.y);var sq=s.sq||0;ctx.scale(1+sq,1-sq);
    var bg2=ctx.createRadialGradient(-R*.3,-R*.35,R*.1,0,0,R);bg2.addColorStop(0,'rgba(255,255,250,'+sA+')');bg2.addColorStop(.6,'rgba(255,232,190,'+sA+')');bg2.addColorStop(1,'rgba(255,190,120,'+sA*.9+')');
    ctx.fillStyle=bg2;ctx.beginPath();ctx.arc(0,0,R,0,6.2832);ctx.fill();
    // eyes: look around + blink (act1 & while flying)
    var look=t<4.6?(t<2.6?0:Math.sin((t-2.6)*2.2)*.9):clamp((sparkPos(t+.05).x-s.x)*25,-1,1);
    var blink=(Math.abs(t-2.3)<.08||Math.abs(t-3.35)<.07||Math.abs(t-7.5)<.07)?.12:1;
    var eyeA=sA*(1-seg(t,10,10.6));
    ctx.fillStyle='rgba(60,30,20,'+eyeA*.85+')';
    for(var ey=-1;ey<=1;ey+=2){ctx.beginPath();ctx.ellipse(ey*R*.32+look*R*.18,-R*.05,R*.1,R*.16*blink,0,0,6.2832);ctx.fill()}
    ctx.restore();
  }

  // ---- flash & lens flare ----
  ctx.globalCompositeOperation='lighter';
  var o2=proj(0,0,0,cam);
  if(flash>.01){ctx.fillStyle='rgba(255,235,210,'+flash*.55+')';ctx.fillRect(0,0,W,H)}
  var flare=Math.max(flash,.55*eout(seg(t,13.3,14.6))*(1-.5*seg(t,15,18)));
  if(flare>.01){
    var fw=W*(.35+.65*flash+.25*seg(t,13.3,15)), fh=Math.max(2,3*dpr);
    var lg=ctx.createLinearGradient(o2.x-fw,0,o2.x+fw,0);lg.addColorStop(0,'rgba(80,140,255,0)');lg.addColorStop(.5,'rgba(200,225,255,'+flare+')');lg.addColorStop(1,'rgba(80,140,255,0)');
    ctx.fillStyle=lg;ctx.fillRect(o2.x-fw,o2.y-fh,fw*2,fh*2);
    ctx.globalAlpha=.35;ctx.fillRect(o2.x-fw*.8,o2.y-fh*6,fw*1.6,fh*12);ctx.globalAlpha=1;
    // ghosts
    for(var gh=1;gh<=3;gh++){var gx=lerp(o2.x,W-o2.x,gh*.35),gy=lerp(o2.y,H-o2.y,gh*.35);glow(gx,gy,U*(.12+gh*.06),gh==2?'120,255,200':'140,150,255',.07*flare)}
  }

  // ---- titles ----
  ctx.globalCompositeOperation='source-over';
  drawTitles(t);

  // ---- grade: vignette, grain, letterbox ----
  var vg=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.35,W/2,H/2,Math.max(W,H)*.75);vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(0,0,0,.75)');ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
  ctx.globalCompositeOperation='overlay';ctx.globalAlpha=.07;
  var fr=Math.floor(t*24),ox=(fr*73)%256,oy=(fr*151)%256;
  ctx.save();ctx.translate(-ox,-oy);ctx.fillStyle=ctx.createPattern(grainC,'repeat');ctx.fillRect(0,0,W+256,H+256);ctx.restore();
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  var bar=letterbox()*eio(seg(t,0,1.2));
  ctx.fillStyle='#000';ctx.fillRect(0,0,W,bar);ctx.fillRect(0,H-bar,W,bar);
  // fade in from black
  var fin=1-seg(t,0,.9);if(fin>0){ctx.fillStyle='rgba(0,0,0,'+fin+')';ctx.fillRect(0,0,W,H)}
}
function letterbox(){var target=portrait()?W/1.0:W/2.39;return Math.max(0,(H-target)/2)*(portrait()?.42:1)}

var SANS='-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","Noto Sans CJK JP","Segoe UI",Meiryo,sans-serif';
function spaced(text,x,y,sp,align){ // letter-spaced text, centered
  var w=0,ws=[];for(var i=0;i<text.length;i++){var m=ctx.measureText(text[i]).width;ws.push(m);w+=m+(i<text.length-1?sp:0)}
  var cx=x-w/2;for(var j=0;j<text.length;j++){ctx.fillText(text[j],cx,y);cx+=ws[j]+sp}
}
var WT=['Prompt','Embedding','Retrieval','Agent','Feedback','Cognitive Architecture'],WS=['Prayer','Empathy','Resonance','Affection','Forgiveness','Consciousness Architecture'];
function sstep(x){return x*x*(3-2*x)}
function lineW(text,sp){var w=0;for(var i=0;i<text.length;i++)w+=ctx.measureText(text[i]).width+(i<text.length-1?sp:0);return w}
function wordLines(ob){ // one line if it fits, else 2 lines; shrink if still too wide
  var maxW=W*.88,size=ob,n=1,sp,w;
  ctx.font='400 '+size+'px '+SANS;sp=size*.2;
  w=Math.max(lineW(WT.join(' · '),sp),lineW(WS.join(' · '),sp));
  if(w>maxW){n=2;w=Math.max(lineW(WT.slice(0,3).join(' · '),sp),lineW(WT.slice(3).join(' · '),sp),lineW(WS.slice(0,3).join(' · '),sp),lineW(WS.slice(3).join(' · '),sp))}
  if(w>maxW){var f=maxW/w;size*=f;sp*=f}
  return {n:n,size:size,sp:sp};
}
function drawWords(text,y,size,sp,a,tint){
  ctx.font='400 '+size+'px '+SANS;var w=lineW(text,sp),cx=W/2-w/2;
  for(var i=0;i<text.length;i++){var ch=text[i],ini=/[A-Z]/.test(ch)&&(i==0||text[i-1]==' ');
    if(ini){ctx.shadowColor='rgba('+tint+','+.9*a+')';ctx.shadowBlur=size*.9;ctx.globalAlpha=a;ctx.fillStyle='rgb('+tint+')';ctx.fillText(ch,cx,y);ctx.fillStyle='#fffaf2';ctx.fillText(ch,cx,y)}
    else{ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=size*.5;ctx.globalAlpha=a*(ch=='·'?.4:.54);ctx.fillStyle='#e8dccb';ctx.fillText(ch,cx,y)}
    cx+=ctx.measureText(ch).width+sp}
  ctx.shadowBlur=0;ctx.globalAlpha=1;
}
/* shimmer: in idle, on every 4th or 5th (seeded random) Tech/Soul switch; switches at t=20+4k */
var SHIM=(function(){var a=[24],k=1,x=20261023;function rnd(){x=(x*1103515245+12345)&0x7fffffff;return x/0x7fffffff}
  for(var i=0;i<400;i++){k+=rnd()<.5?4:5;a.push(20+4*k)}return a})();
var SH_D=1.1,SH_ST=.14;
function shimPhase(t,row){if(t<=DUR)return -1;var lo=0,hi=SHIM.length-1,s=-1;
  while(lo<=hi){var m=(lo+hi)>>1;if(SHIM[m]<=t-row*SH_ST){s=SHIM[m];lo=m+1}else hi=m-1}
  if(s<0)return -1;var p=(t-s-row*SH_ST)/SH_D;return p>=0&&p<=1?p:-1}
function shimmer(t,row,text,x,y,sp,size,str){var p=shimPhase(t,row);if(p<0)return;
  var w=lineW(text,sp),x0=x-w/2,band=Math.max(size*2.2,w*.3),cx=x0-band*.6+(w+band*1.2)*eio(p);
  var env=Math.min(1,Math.sin(Math.PI*p)*1.6)*str;
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=1;
  // wide warm bloom band
  var g=ctx.createLinearGradient(cx-band,0,cx+band,0);
  g.addColorStop(0,'rgba(255,220,170,0)');g.addColorStop(.35,'rgba(255,230,190,'+.55*env+')');g.addColorStop(.5,'rgba(255,255,255,'+env+')');g.addColorStop(.65,'rgba(255,230,190,'+.55*env+')');g.addColorStop(1,'rgba(255,220,170,0)');
  ctx.fillStyle=g;ctx.shadowColor='rgba(255,236,200,'+env+')';ctx.shadowBlur=size*1.1;spaced(text,x,y,sp);
  // near-white hot core, drawn twice for bloom
  var c=ctx.createLinearGradient(cx-band*.35,0,cx+band*.35,0);
  c.addColorStop(0,'rgba(255,255,255,0)');c.addColorStop(.5,'rgba(255,255,255,'+env+')');c.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=c;ctx.shadowColor='rgba(255,255,255,'+env+')';ctx.shadowBlur=size*.6;spaced(text,x,y,sp);ctx.shadowBlur=size*.2;spaced(text,x,y,sp);
  ctx.shadowBlur=0;
  // travelling light streak (horizontal flare) + soft halo
  var hr=size*1.3,hg=ctx.createRadialGradient(cx,y,0,cx,y,hr);hg.addColorStop(0,'rgba(255,255,255,'+.55*env+')');hg.addColorStop(.3,'rgba(255,235,200,'+.25*env+')');hg.addColorStop(1,'rgba(255,220,170,0)');
  ctx.fillStyle=hg;ctx.fillRect(cx-hr,y-hr,hr*2,hr*2);
  var sl=band*1.8,sh=Math.max(1,size*.05),sg=ctx.createLinearGradient(cx-sl,0,cx+sl,0);sg.addColorStop(0,'rgba(255,240,215,0)');sg.addColorStop(.5,'rgba(255,255,255,'+.9*env+')');sg.addColorStop(1,'rgba(255,240,215,0)');
  ctx.fillStyle=sg;ctx.fillRect(cx-sl,y-sh/2,sl*2,sh);
  // tiny star glint at the end of the word
  var q=(p-.72)/.28;if(q>0&&q<1){var ga=Math.sin(Math.PI*q)*str,gx=x0+w+size*.12,gy=y-size*.32,gl=size*(.5+.5*Math.sin(Math.PI*q));
    var rg=ctx.createRadialGradient(gx,gy,0,gx,gy,gl*.5);rg.addColorStop(0,'rgba(255,255,255,'+ga+')');rg.addColorStop(1,'rgba(255,240,210,0)');ctx.fillStyle=rg;ctx.fillRect(gx-gl,gy-gl,gl*2,gl*2);
    ctx.fillStyle='rgba(255,255,255,'+ga+')';var th=Math.max(1,size*.035);ctx.fillRect(gx-gl,gy-th/2,gl*2,th);ctx.fillRect(gx-th/2,gy-gl*.7,th,gl*1.4)}
  ctx.restore()}
function drawTitles(t){
  var pr=portrait(), Lo=layout(), base=Lo.base;
  var ty=Lo.title;
  ctx.textBaseline='middle';ctx.textAlign='left';
  // title: letter-spacing collapse + fade + soft blur-in
  var k=seg(t,13.4,15.6), ke=eoutExpo(k), a=eout(seg(t,13.4,14.6));
  if(a>0){
    ctx.font='300 '+base+'px '+SANS;
    var sp=lerp(base*1.1,base*.28,ke);
    var g=ctx.createLinearGradient(W/2-base*4,0,W/2+base*4,0);g.addColorStop(0,'#ffd9a8');g.addColorStop(.5,'#fff8ef');g.addColorStop(1,'#bcd4ff');
    ctx.shadowColor='rgba(255,190,120,'+.55*a+')';ctx.shadowBlur=base*.45;
    ctx.globalAlpha=a;ctx.fillStyle=g;spaced('COCOMI CORE',W/2,ty,sp);
    ctx.shadowBlur=0;ctx.globalAlpha=1;shimmer(t,0,'COCOMI CORE',W/2,ty,sp,base,1);
    // hairline
    var hl=eio(seg(t,14.6,15.8))*base*3.2;ctx.fillStyle='rgba(255,220,180,'+.6*a+')';ctx.fillRect(W/2-hl,ty+base*.85,hl*2,Math.max(1,dpr*.8));
  }
  // tagline
  var tb=Math.max(13*dpr,base*(pr?.36:.34)), l1=eout(seg(t,15.4,16.4)), l2=eout(seg(t,15.9,16.9));
  ctx.font='400 '+tb+'px '+SANS;ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=tb*.6;
  if(l1>0){ctx.globalAlpha=l1;ctx.fillStyle='rgba(255,244,230,.95)';spaced('想いが構造になり、',W/2,ty+base*1.3+(1-l1)*tb*.5,tb*.22)}
  if(l2>0){ctx.globalAlpha=l2;ctx.fillStyle='rgba(255,244,230,.95)';spaced('構造が証明になる。',W/2,ty+base*1.3+tb*1.75+(1-l2)*tb*.5,tb*.22)}
  // ---- PERAFCA block ----
  var ob=Math.max(10*dpr,tb*.42), y=ty+base*1.3+tb*1.75+tb*(pr?2.7:2.0);
  var wa=eout(seg(t,16.5,17.6));
  if(wa>0){
    // crossfade Tech <-> Soul: 4s each, 1.4s dissolve, loops forever
    var ws=sstep(clamp(.5-1.2*Math.cos((t-18)*Math.PI/4),0,1));
    var wl=wordLines(ob), lh=wl.size*1.75;
    ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=wl.size*.5;
    [[WT,1-ws,'188,212,255'],[WS,ws,'255,214,168']].forEach(function(o){if(o[1]<=.002)return;
      for(var li=0;li<wl.n;li++)drawWords(wl.n==1?o[0].join(' · '):(li==0?o[0].slice(0,3):o[0].slice(3)).join(' · '),y+li*lh+(1-wa)*wl.size*.6,wl.size,wl.sp,wa*o[1],o[2]);
    });
    y+=(wl.n-1)*lh;
  }
  var pa=eout(seg(t,17.0,18.2)),pk=eoutExpo(seg(t,17.0,18.6)), py=y+tb*(pr?2.6:1.95);
  if(pa>0){var pb2=tb*1.05;ctx.font='300 '+pb2+'px '+SANS;
    var pg=ctx.createLinearGradient(W/2-pb2*5,0,W/2+pb2*5,0);pg.addColorStop(0,'#ffd9a8');pg.addColorStop(.5,'#fff8ef');pg.addColorStop(1,'#bcd4ff');
    var pul=t>DUR?.5+.5*Math.sin((t-DUR)*1.25-1.57):0;
    ctx.shadowColor='rgba(255,195,130,'+(.5+.25*pul)*pa+')';ctx.shadowBlur=pb2*(.7+.3*pul);ctx.globalAlpha=pa*.95;ctx.fillStyle=pg;
    spaced('PERAFCA',W/2,py,lerp(pb2*1.4,pb2*.7,pk));ctx.shadowBlur=0;shimmer(t,1,'PERAFCA',W/2,py,lerp(pb2*1.4,pb2*.7,pk),pb2,1)}
  // origin
  var oy=py+tb*(pr?2.7:2.0), oa=seg(t,17.4,18.3);
  if(oa>0){ctx.font='400 '+ob+'px '+SANS;ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=ob*.6;ctx.globalAlpha=oa*.72;ctx.fillStyle='#e8dccb';spaced('ORIGIN ARCHITECT OF COCOMI OS',W/2,oy,ob*.45)}
  var aa=seg(t,17.8,18.5);
  if(aa>0){var ab=Math.max(8*dpr,ob*.8);ctx.font='300 '+ab+'px '+SANS;var AKT='AKC Total Support Co., Ltd.',asp=ab*.32;ctx.font='300 '+ab+'px '+SANS;var aw=lineW(AKT,asp);if(aw>W*.88){var af=W*.88/aw;ab*=af;asp*=af;ctx.font='300 '+ab+'px '+SANS}ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=ab*.6;ctx.globalAlpha=aa*.72;ctx.fillStyle='#e8dccb';spaced(AKT,W/2,oy+ob*1.9,asp);ctx.shadowBlur=0;shimmer(t,2,AKT,W/2,oy+ob*1.9,asp,ab,.85)}
  ctx.globalAlpha=1;ctx.shadowBlur=0;
}

    resize();
    return { DUR: DUR, resize: resize, render: render, time: function () { return curT; } };
  }

  window.CocomiOpeningScene = { DUR: DUR, create: create };
})();
