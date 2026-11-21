/* build-v41.cjs — 从原始基础版本构建 4.1（水上桥修复 + 渲染性能）
 * 基准：D:/Download/曙光城_CITYFORGE_改进版.html（与 2.0/3.0/4.0 同一源）
 * 输出：曙光城_CITYFORGE_4.1_水上桥修复版.html（默认）；CF_TEST=1 时输出 ...4.1_test.html
 */
const fs = require('fs');
const path = require('path');
/* 基座构建源（CITYFORGE 改进版），可用环境变量 CF_SRC 覆盖 */
const SRC = process.env.CF_SRC || 'D:/Download/曙光城_CITYFORGE_改进版.html';
if (!fs.existsSync(SRC)) throw Error('找不到基座文件：' + SRC + '（请用环境变量 CF_SRC 指定）');
let h = fs.readFileSync(SRC, 'utf8');
function rep(a, b) { if (!h.includes(a)) throw Error('Missing anchor: ' + a.slice(0, 90)); h = h.replace(a, b); }

/* ---------- 与 2.0 相同的基础补丁 ---------- */
rep('<title>曙光城 · 城市营造模拟 · 改进版</title>', '<title>曙光城 4.1 · 水上桥修复与性能版</title>');
rep('<option value="72">大型 · 72×72 群岛湾岸</option>',
    '<option value="72">大型 · 72×72</option><option value="96">扩展 · 96×96</option><option value="128">都市 · 128×128</option><option value="192">区域 · 192×192（建议性能模式）</option><option value="256">超大 · 256×256（实验性）</option>');
rep('N>=24&&N<=96', 'Number.isInteger(N)&&N>=24&&N<=256');
rep("if(e.key===' '){keys.space=true;if(SCREEN==='game'){e.preventDefault();togglePause()}return}",
    "if(e.key===' '){keys.space=true;if(SCREEN==='game')e.preventDefault();return}if(e.key.toLowerCase()==='p'&&SCREEN==='game'){togglePause();return}");
h = h.replaceAll('<kbd>空格</kbd> 暂停', '<kbd>P</kbd> 暂停 · 空格拖动平移')
    .replaceAll('暂停 (空格)', '暂停 (P)').replaceAll('空格暂停', 'P 暂停')
    .replaceAll('<kbd>Space</kbd>', '<kbd>P</kbd>').replaceAll('暂停 / 继续', '暂停 / 继续（P）');
h = h.replaceAll(', .45,', ', .08,').replaceAll(',.45,2.4', ',.08,2.4');
rep("G.grid.t[i]=0;R.miniDirty=true", "G.grid.t[i]=0;G.dirty=true;proBump();R.miniDirty=true");
rep("function slotKey(k){return 'cf_save_'+k}", "function slotKey(k){return 'cf4_save_'+k}");
rep("raw=localStorage.getItem(slotKey(k))",
    "raw=localStorage.getItem(slotKey(k))||localStorage.getItem('cf3_save_'+k)||localStorage.getItem('cf2_save_'+k)||localStorage.getItem('cf_save_'+k)");
rep("G.dirty=true;R.miniDirty=true;toast('success','🧹'", "proBump();G.dirty=true;R.miniDirty=true;toast('success','🧹'");
rep("G.dirty=true;R.miniDirty=true;toast('success','⛰️','全城地形已平整'", "proBump();G.dirty=true;R.miniDirty=true;toast('success','⛰️','全城地形已平整'");
rep("数据保存在本地浏览器 · v2.0", "数据保存在本地浏览器 · v4.1");
rep("if(uiTimer>.22)", "if(uiTimer>.5)");
rep("const fCom=G.jobs>0?Math.round(G.filled*G.comJobs/G.jobs):0;", "const fCom=G.jobs>0?Math.min(G.filled,Math.round(G.filled*G.comJobs/G.jobs)):0;");
rep("const d=defOf(b),u=d.up*dm.up*UPKEEP_MULT;", "const d=defOf(b),u=d.up*dm.up*UPKEEP_MULT*(b.d==='road'?CFTRAFFIC.roadMaintenance(b):1);");
rep("fmtM(Math.round(d.up*DIFF[G.diff].up*UPKEEP_MULT))", "fmtM(Math.round(d.up*DIFF[G.diff].up*UPKEEP_MULT*(b.d==='road'?CFTRAFFIC.roadMaintenance(b):1)))");
rep("(jobsAvail>0||G.pop<30)", "((b.cfLocalJobs||0)>0||G.pop<30)");
rep("const add=1+Math.floor(srnd()*2)+(G.dem.r>40?1:0);", "const add=(b.cfLocalJobs||0)>0?1+Math.floor(srnd()*2)+(G.dem.r>40?1:0):1;");
rep("G.pop>=30&&G.unemp>.25", "G.pop>=30&&(b.cfEmployment||0)<.75");

/* ---------- 性能：道路中心虚线批处理（低倍时按行合并 stroke） ---------- */
rep(`  let conn=0;
  ctx.strokeStyle='rgba(230,220,160,'+(.3+L*.25)+')';ctx.lineWidth=1.1*z;ctx.setLineDash([3*z,3.5*z]);
  dirs.forEach(function(dd,k){
    if(roadAt(x+dd[0],y+dd[1])){conn++;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(edges[k][0],edges[k][1]);ctx.stroke()}
  });
  ctx.setLineDash([]);`,
`  let conn=0;
  const dash=R.dash;
  dirs.forEach(function(dd,k){
    if(roadAt(x+dd[0],y+dd[1])){conn++;
      if(dash){dash.push(cx,cy,edges[k][0],edges[k][1])}
      else{ctx.strokeStyle='rgba(230,220,160,'+(.3+L*.25)+')';ctx.lineWidth=1.1*z;ctx.setLineDash([3*z,3.5*z]);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(edges[k][0],edges[k][1]);ctx.stroke();ctx.setLineDash([])}
    }
  });`);

/* ---------- 4.1 主渲染循环：修复水上桥 + 免分配快速绘制 ---------- */
const LOOP_START = '  if(!G)return;\n  const N=G.N;\n  const c1=s2tile';
const LOOP_END = '  drawGhost(env);\n  drawParticles(env);';
const i0 = h.indexOf(LOOP_START);
const i1 = h.indexOf(LOOP_END);
if (i0 < 0 || i1 < 0 || i1 < i0) throw Error('渲染循环锚点未找到');

const NEW_LOOP = String.raw`  if(!G)return;
  const N=G.N;
  const c1=s2tile(-60,-110),c2=s2tile(W+60,-110),c3=s2tile(-60,H+200),c4=s2tile(W+60,H+200);
  const minX=clamp(Math.min(c1[0],c2[0],c3[0],c4[0])-1,0,N-1),maxX=clamp(Math.max(c1[0],c2[0],c3[0],c4[0])+2,0,N-1);
  const minY=clamp(Math.min(c1[1],c2[1],c3[1],c4[1])-1,0,N-1),maxY=clamp(Math.max(c1[1],c2[1],c3[1],c4[1])+2,0,N-1);
  const carBuckets=new Map();
  R.cars.forEach(function(c){
    const tx=c.t<.5?c.fx:c.tx,ty=c.t<.5?c.fy:c.ty;
    const k=ty*N+tx;let arr=carBuckets.get(k);if(!arr){arr=[];carBuckets.set(k,arr)}arr.push(c);
  });
  const showGrid=(SETTINGS.grid||(R.tool!=='select'&&SCREEN==='game'))&&cam.z>.5;
  const hov=R.hover;
  /* ---- 4.1 快速绘制：标量递推投影、屏幕剔除、免分配四边形 ---- */
  const z=cam.z,hw=TW*.5*z,hh=TH*.5*z,th=TH*z,ox=W*.5-cam.x*z,oy=H*.5-cam.y*z,L=env.L;
  const cullL=-TW*z-40,cullR=W+TW*z+40,cullB=H+TH*z+340,cullT=-TH*z-10;
  const overOn=R.overlay!=='none';
  const DBATCH=z<.78;   /* 低倍时虚线并入按行批量 stroke：1px 虚线肉眼不可分辨，省掉逐格 stroke */
  const qf=[0,0,0,0,0,0,0,0];
  function qset(ax,ay,i){
    qf[0]=ax;qf[1]=ay+i*th;qf[2]=ax+(1-2*i)*hw;qf[3]=ay+hh;qf[4]=ax;qf[5]=ay+(1-i)*th;qf[6]=ax-(1-2*i)*hw;qf[7]=ay+hh;
  }
  function qdraw(fill,stroke,lw){
    ctx.beginPath();ctx.moveTo(qf[0],qf[1]);ctx.lineTo(qf[2],qf[3]);ctx.lineTo(qf[4],qf[5]);ctx.lineTo(qf[6],qf[7]);ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill()}
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw||1;ctx.stroke()}
  }
  // 平地草地色阶预计算：最常见的瓦片不再逐格 shade 拼字符串
  const grassShade=new Array(13);
  for(let gi=0;gi<13;gi++)grassShade[gi]=shade(env.se.grass,L*(.9+gi/13*.14));
  let drawn=0;
  const DBG=!!window.CFDEBUG_DB,AFIX=!!window.CFDEBUG_ALPHA;
  for(let s=minX+minY;s<=maxX+maxY;s++){
    const x0=Math.max(minX,s-maxY),x1=Math.min(maxX,s-minY);
    let ax=(2*x0-s)*hw+ox,ay=s*hh+oy;
    /* 沿对角线 x 递增时 x−y 加 2、x+y 不变 ⇒ ax 每次加 2hw，ay 保持不变 */
    if(DBATCH)R.dash=[];
    for(let x=x0;x<=x1;x++,ax+=2*hw){
      const y=s-x;
      const i=idx(x,y),t=G.grid.t[i],v=G.grid.v[i],u=G.grid.b[i],e=G.grid.e[i];
      const dy=t===1?(e===0?6:4):-e*ELEV;
      const top=ay+dy*z;
      if(top>cullB||top+th<cullT||ax+hw<cullL||ax-hw>cullR)continue;
      drawn++;
      let cxg=ax,cyg=top+th*.5;
      if(t===1){
        const wob=Math.sin(env.t*1.6+x*.8+y*.6)*.06;
        ctx.beginPath();ctx.moveTo(ax,top);ctx.lineTo(ax+hw,top+hh);ctx.lineTo(ax,top+th);ctx.lineTo(ax-hw,top+hh);ctx.closePath();
        if(AFIX)ctx.globalAlpha=1;
        ctx.fillStyle=DBG?'#ff00ff':shade(e===0?'#155a80':'#1f7fa8',L*(.92+wob));ctx.fill();
        if(hashi(x*31+y*57)<.3){
          ctx.strokeStyle='rgba(180,230,250,'+(.12+.1*Math.sin(env.t*2+x))+')';ctx.lineWidth=1;
          ctx.beginPath();ctx.moveTo(ax-6*z,cyg);ctx.lineTo(ax+6*z,cyg);ctx.stroke();
        }
        if(inB(x+1,y)&&G.grid.t[idx(x+1,y)]!==1){ctx.strokeStyle='rgba(210,240,255,.3)';ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(ax+hw,top+hh);ctx.lineTo(ax,top+th);ctx.stroke()}
        if(inB(x,y+1)&&G.grid.t[idx(x,y+1)]!==1){ctx.strokeStyle='rgba(210,240,255,.3)';ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(ax-hw,top+hh);ctx.lineTo(ax,top+th);ctx.stroke()}
        // 4.1 修复：水面格上的道路（桥）必须进入道路绘制分支，此前被整个跳过
        if(u){const b=G.buildings.get(u);if(b&&b.d==='road')drawRoad(x,y,env)}
      }else{
        const eE=inB(x+1,y)?(G.grid.t[idx(x+1,y)]===1?-2:G.grid.e[idx(x+1,y)]):-2;
        const eS=inB(x,y+1)?(G.grid.t[idx(x,y+1)]===1?-2:G.grid.e[idx(x,y+1)]):-2;
        if(e>eE){const hg=((e-Math.max(eE,-2))*ELEV+(eE<0?8:0))*z;
          ctx.beginPath();ctx.moveTo(ax+hw,top+hh);ctx.lineTo(ax,top+th);ctx.lineTo(ax,top+th+hg);ctx.lineTo(ax+hw,top+hh+hg);ctx.closePath();
          ctx.fillStyle=shade(t===5?'#a8946a':'#6b5a44',L*.55);ctx.fill()}
        if(e>eS){const hg=((e-Math.max(eS,-2))*ELEV+(eS<0?8:0))*z;
          ctx.beginPath();ctx.moveTo(ax-hw,top+hh);ctx.lineTo(ax,top+th);ctx.lineTo(ax,top+th+hg);ctx.lineTo(ax-hw,top+hh+hg);ctx.closePath();
          ctx.fillStyle=shade(t===5?'#b8a478':'#7a6850',L*.72);ctx.fill()}
        let fill;
        if(t===4)fill=shade('#4a4038',L*(.9+(v%7)*.02));
        else if(t===5){let sb='#d9c58c';if(env.snowy>.3)sb=mixc(sb,'#eef2f4',env.snowy*.35);fill=shade(sb,L*(.94+(v%9)*.015))}
        else if(t===0&&e===0&&env.snowy<.15)fill=grassShade[v%13];
        else{
          let base=env.se.grass;
          if(e>0)base=mixc(base,'#9ab86a',e*.09);
          if(env.snowy>.15)base=mixc(base,'#dfe8ea',clamp(env.snowy*(.3+e*.2),0,.85));
          fill=shade(base,L*(.9+(v%13)/13*.14));
        }
        ctx.beginPath();ctx.moveTo(ax,top);ctx.lineTo(ax+hw,top+hh);ctx.lineTo(ax,top+th);ctx.lineTo(ax-hw,top+hh);ctx.closePath();
        if(AFIX)ctx.globalAlpha=1;
        ctx.fillStyle=DBG?'#ff00ff':fill;ctx.fill();
        if(t===5&&z>.6){ctx.fillStyle='rgba(150,125,80,'+(.25*L)+')';
          ctx.fillRect(cxg-5*z,cyg,2*z,1.2);ctx.fillRect(cxg+3*z,cyg+2,1.6*z,1.2)}
        if(t===4){ctx.fillStyle='rgba(20,16,12,.5)';ctx.fillRect(cxg-4*z,cyg-1,3*z,2);ctx.fillRect(cxg+2*z,cyg+2,2.4*z,1.6)}
        if(t===0&&z>.65&&env.season<2&&env.snowy<.3&&v%19===0){
          const fc=['#ff8ab8','#ffd97a','#f0f4f8'];
          for(let k=0;k<3;k++){ctx.fillStyle=fc[(v+k)%3];
            ctx.fillRect(cxg+(hashi(v*7+k)-.5)*18*z,cyg+(hashi(v*13+k)-.5)*8*z,1.6*z,1.6*z)}
        }
        if(t===0&&e>=2&&v%13===0&&z>.55){
          ctx.beginPath();ctx.moveTo(cxg+6*z,cyg+2);ctx.lineTo(cxg+10*z,cyg-3*z);ctx.lineTo(cxg+13*z,cyg+2);ctx.closePath();
          ctx.fillStyle=shade('#8d97a3',L*.9);ctx.fill();
        }
        if(u){
          const b=G.buildings.get(u);
          if(b&&b.d==='road')drawRoad(x,y,env);
          else if(b&&b.d!=='park'&&b.d!=='bigpark'&&b.d!=='tree'&&b.d!=='solar'&&b.d!=='wind'&&b.d!=='farm'){
            qset(ax,top,.07);qdraw(shade('#8a94a0',L*.92));
          }
        }
      }
      if(overOn){const of=overlayFill(x,y,i,u);if(of){qset(ax,top,.02);qdraw(of)}}
      if(showGrid){qset(ax,top,0);qdraw(null,'rgba(233,245,242,.07)',1)}
      if(hov&&hov[0]===x&&hov[1]===y&&SCREEN==='game')poly(tilePts(x,y,.02,dy),null,'rgba(255,255,255,.55)',1.4);
      if(R.sel){const sd=defOf(R.sel);
        if(x>=R.sel.x&&x<R.sel.x+sd.w&&y>=R.sel.y&&y<R.sel.y+sd.h)
          poly(tilePts(x,y,.03,dy),'rgba(41,211,255,'+(.1+.06*Math.sin(env.t*3))+')','rgba(41,211,255,.8)',1.4);
      }
      const cb=carBuckets.get(i);
      if(cb)cb.forEach(function(c){drawCar(c,env)});
      if(t===2){
        const n=1+v%3;
        for(let k=0;k<n;k++){
          const ox2=((hashi(x*13+y*7+k*31)-.5)*22)*z,oy2=((hashi(x*7+y*17+k*11)-.5)*10)*z;
          drawTree(cxg+ox2,cyg+oy2+4*z,.8+hashi(k+x+y)*.4,env,v+k);
        }
      }else if(t===3){
        const ph=(22+v%12)*z;
        ctx.beginPath();ctx.moveTo(cxg-14*z,cyg+4*z);ctx.lineTo(cxg,cyg-ph);ctx.lineTo(cxg+2*z,cyg+6*z);ctx.closePath();
        ctx.fillStyle=shade('#8d97a3',L*.95);ctx.fill();
        ctx.beginPath();ctx.moveTo(cxg+2*z,cyg+6*z);ctx.lineTo(cxg,cyg-ph);ctx.lineTo(cxg+15*z,cyg+3*z);ctx.closePath();
        ctx.fillStyle=shade('#6a7480',L*.7);ctx.fill();
        const snowH=.62+env.snowy*.2;
        poly([[cxg-14*z*(1-snowH),cyg-ph*snowH+4*z*(1-snowH)],[cxg,cyg-ph],[cxg+15*z*(1-snowH),cyg-ph*snowH+3*z*(1-snowH)],[cxg+1*z,cyg-ph*(snowH-.1)],[cxg-2*z,cyg-ph*(snowH-.06)]],shade('#eef4f8',L*1.05));
      }
      if(u){
        const b=G.buildings.get(u);
        if(b){const d=defOf(b);
          if(b.x+d.w-1===x&&b.y+d.h-1===y&&b.d!=='road')drawBuilding(b,env);
        }
      }
    }
    if(DBATCH&&R.dash&&R.dash.length){
      ctx.strokeStyle='rgba(230,220,160,'+(.3+L*.25)+')';ctx.lineWidth=1.1*z;ctx.setLineDash([3*z,3.5*z]);
      ctx.beginPath();
      for(let k=0;k<R.dash.length;k+=4){ctx.moveTo(R.dash[k],R.dash[k+1]);ctx.lineTo(R.dash[k+2],R.dash[k+3])}
      ctx.stroke();ctx.setLineDash([]);R.dash.length=0;
    }
  }
  if(DBATCH)R.dash=null;
  if(window.CFPERF41){window.CFPERF41.tiles=drawn;window.CFPERF41.ga=[1,1];}
`;
h = h.slice(0, i0) + NEW_LOOP + h.slice(i1);

/* ---------- 模块注入 ---------- */
rep('/* ================= BOOT ================= */',
    ['traffic-v4.js', 'tools-v3.js', 'city-v3.js', 'simulation-v3.js', 'road-ui-v3.js', 'interaction-v3.js',
      'perf.js', 'bridge.js', 'dashboard-v4.js', ...(process.env.CF_TEST ? ['seam.js'] : [])]
      .map(f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n') + '\n/* ================= BOOT ================= */');

h = h.replace(/<\/html>\s*<\/body>\s*<\/html>\s*$/i, '</html>');
const out = process.env.CF_TEST ? 'build/曙光城4.1-test.html' : '曙光城4.1.html';
fs.writeFileSync(out, h);
const js = h.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
fs.writeFileSync(process.env.CF_TEST ? 'v41-test/compiled-game-41-test.js' : 'compiled-game-41.js', js);
new Function(js);
console.log('Built', out, Buffer.byteLength(h), 'bytes; syntax OK; tiles drawn (runtime only)');
