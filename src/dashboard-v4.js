/* CITYFORGE Dashboard v4 — independent dashboard layer
 * Depends on globals exposed by city-v3/interaction-v3: G, R, SCREEN, setOverlay,
 * overlayFill, activeEffects, defOf, CFPRO/CFTRAFFIC, fmtN/fmtM (optional), and $ (optional).
 * Load after those modules; it does not require HTML changes or modify game data.
 */
(function(){'use strict';
  var A=window.CityForgeDashboardV4=window.CityForgeDashboardV4||{version:4};
  var layers=[
    {id:'none',name:'关闭图层',color:'#8aa7b4'},
    {id:'water',name:'供水覆盖',color:'#35b9ff'},
    {id:'power',name:'供电覆盖',color:'#ffd166'},
    {id:'poll',name:'污染',color:'#be7cff'},
    {id:'fire',name:'消防覆盖',color:'#ff685e'},
    {id:'health',name:'医疗覆盖',color:'#62e6a8'},
    {id:'police',name:'治安覆盖',color:'#82a5ff'},
    {id:'traffic',name:'交通流量',color:'#ff9b4a'}
  ];
  var state=A.state||{opacity:0.72,visible:true,layer:'none',cacheKey:'',snapshot:null}; A.state=state;
  var style=document.createElement('style'); style.textContent=`
#cfDash4Btn{position:fixed;right:18px;top:108px;z-index:72;background:#102a3d;color:#c8f3ff;border:1px solid #29d3ff;border-radius:9px;padding:8px 12px;font-weight:700;cursor:pointer}
#cfDash4{position:fixed;right:18px;top:154px;width:min(390px,calc(100vw - 36px));max-height:calc(100dvh - 174px);overflow:auto;z-index:71;background:#091b29f2;color:#e8f5f5;border:1px solid #2a5468;border-radius:14px;box-shadow:0 18px 60px #000b;padding:14px;display:none;font:12px/1.45 system-ui,sans-serif;box-sizing:border-box}
#cfDash4.open{display:block}.cf4head{display:flex;justify-content:space-between;align-items:center;gap:8px;position:sticky;top:-14px;background:#091b29;padding:4px 0 10px;z-index:2}.cf4head h3{margin:0;color:#bceeff}.cf4close,.cf4btn{background:#142e40;border:1px solid #2a5468;color:#dff8ff;border-radius:6px;padding:5px 8px;cursor:pointer}.cf4section{border-top:1px solid #234354;margin-top:9px;padding-top:9px}.cf4grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.cf4card{background:#102838;border:1px solid #1d4355;border-radius:8px;padding:8px}.cf4card h4{margin:0 0 5px;color:#86d9ec;font-size:12px}.cf4kv{display:flex;justify-content:space-between;gap:8px;color:#a7c4ca}.cf4kv b{color:#f3fdff}.cf4layers{display:grid;grid-template-columns:1fr 1fr;gap:5px}.cf4layer{display:flex;align-items:center;gap:5px;background:#102838;border:1px solid #24495b;border-radius:6px;padding:5px;cursor:pointer}.cf4layer.active{border-color:#ffcc66}.cf4swatch{width:10px;height:10px;border-radius:50%;flex:none}.cf4muted{color:#87aab2;font-size:11px}.cf4range{width:100%;accent-color:#29d3ff}.cf4status{color:#8fd4df;margin-top:6px;min-height:16px}
@media(max-width:700px){#cfDash4Btn{top:106px;right:10px}#cfDash4{right:10px;top:150px;width:calc(100vw - 20px)}}`;
  document.head.appendChild(style);
  var btn=document.createElement('button');btn.id='cfDash4Btn';btn.textContent='▦ 城市看板 v4';document.body.appendChild(btn);
  var panel=document.createElement('aside');panel.id='cfDash4';document.body.appendChild(panel);
  function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  function n(x){if(typeof window.fmtN==='function')return fmtN(Math.round(Number(x)||0));return Math.round(Number(x)||0).toLocaleString()}
  function pct(x){return Math.round((Number(x)||0)*100)+'%'}
  function kv(k,v){return '<div class="cf4kv"><span>'+esc(k)+'</span><b>'+esc(v)+'</b></div>'}
  function read(){if(!window.G)return null;var g=G, bld=0,roads=0,cap=0,pop=0,jobs=0,fire=0,empty=0,used=0;
    if(g.buildings&&g.buildings.forEach)g.buildings.forEach(function(b){if(b.d==='road'){roads++;return}bld++;var d=typeof defOf==='function'?defOf(b):{};cap+=Number(d.cap)||0;pop+=Number(b.pop)||0;jobs+=Number(d.jobs)||0;used+=(Number(d.w)||1)*(Number(d.h)||1);if(b.fire)fire++;if(d.cap&&!b.pop)empty++});
    var land=0;if(g.grid&&g.grid.t)for(var i=0;i<g.grid.t.length;i++)if(g.grid.t[i]!==1&&g.grid.t[i]!==3)land++;
    var traffic=window.CFTRAFFIC&&CFTRAFFIC.stats||{};
    return {pop:g.pop||pop,peak:g.maxPop||0,cap:cap,jobs:g.jobs||jobs,filled:g.filled||0,staff:g.staff||0,unemp:g.unemp||0,money:g.money||0,hap:g.hap||0,poll:g.pollAvg||0,lv:g.lvAvg||0,powerSup:g.powerSup||0,powerDem:g.powerDem||0,waterCap:g.waterCap||0,waterDem:g.waterDem||0,wasteCap:g.wasteCap||0,wasteDem:g.wasteDem||0,waterCover:g.waterCover||0,roads:roads,bld:bld,land:land,used:used,fire:fire,empty:empty,traffic:traffic,N:g.N||0,rev:window.CFPRO?CFPRO.revision:0};
  }
  function key(s){return [s&&s.rev,s&&s.pop,s&&s.money,s&&s.hap,s&&s.powerSup,s&&s.waterCap,state.layer].join('|')}
  function card(title,body){return '<div class="cf4card"><h4>'+title+'</h4>'+body+'</div>'}
  function render(){var s=read();if(!s)return;var k=key(s);if(k!==state.cacheKey){state.snapshot=s;state.cacheKey=k} s=state.snapshot;
    var layerHtml=layers.map(function(l){return '<label class="cf4layer '+(state.layer===l.id?'active':'')+'"><input type="radio" name="cf4layer" value="'+l.id+'" '+(state.layer===l.id?'checked':'')+'><i class="cf4swatch" style="background:'+l.color+'"></i>'+l.name+'</label>'}).join('');
    panel.innerHTML='<div class="cf4head"><h3>城市运行看板 <small class="cf4muted">V4</small></h3><button class="cf4close">关闭 ×</button></div>'+
      '<div class="cf4section"><b>数据图层</b><div class="cf4layers">'+layerHtml+'</div><label class="cf4muted">透明度 <output id="cf4OpacityVal">'+Math.round(state.opacity*100)+'%</output><input id="cf4Opacity" class="cf4range" type="range" min="0" max="100" value="'+Math.round(state.opacity*100)+'"></label><label class="cf4muted"><input id="cf4Visible" type="checkbox" '+(state.visible?'checked':'')+'> 显示当前图层</label><div id="cf4Status" class="cf4status"></div></div>'+
      '<div class="cf4grid cf4section">'+card('人口与就业',kv('人口 / 峰值',n(s.pop)+' / '+n(s.peak))+kv('住宅容量 / 入住率',n(s.cap)+' / '+pct(s.cap?s.pop/s.cap:0))+kv('岗位 / 已填充',n(s.jobs)+' / '+n(s.filled))+kv('失业率',pct(s.unemp)))+card('基础设施',kv('电力供给 / 需求',n(s.powerSup)+' / '+n(s.powerDem))+kv('供水容量 / 需求',n(s.waterCap)+' / '+n(s.waterDem))+kv('垃圾能力 / 需求',n(s.wasteCap)+' / '+n(s.wasteDem))+kv('供水覆盖',pct(s.waterCover)))+card('城市环境',kv('幸福度',n(s.hap))+kv('平均污染',n(s.poll))+kv('平均地价',n(s.lv))+kv('资金',n(s.money)))+card('空间与安全',kv('建筑 / 道路',n(s.bld)+' / '+n(s.roads))+kv('可建设土地',n(s.land))+kv('建筑占地',n(s.used))+kv('火情 / 空置住宅',n(s.fire)+' / '+n(s.empty)))+'</div>'+
      '<div class="cf4section cf4muted">性能缓存：指标仅在 revision/核心数值变化时重算；图层渲染由现有 overlayFill 复用。'+(s.N?' 当前地图 '+s.N+'×'+s.N:'')+'</div>';
    bind();
  }
  function preserveLayer(id){var old=window.R&&R.tool, before=window.R&&R.overlay;state.layer=id;if(typeof window.setOverlay==='function')setOverlay(id);if(window.R&&old&&R.tool!==old&&typeof window.setTool==='function')setTool(old);if(window.R&&before!==id&&R.overlay!==id&&id!=='none'&&typeof window.setOverlay==='function')setOverlay(id);state.cacheKey='';render();}
  function bind(){panel.querySelector('.cf4close').onclick=close;panel.querySelectorAll('input[name="cf4layer"]').forEach(function(x){x.onchange=function(){preserveLayer(this.value)}});var op=panel.querySelector('#cf4Opacity');op.oninput=function(){state.opacity=+this.value/100;panel.querySelector('#cf4OpacityVal').textContent=this.value+'%';A.invalidate();};panel.querySelector('#cf4Visible').onchange=function(){state.visible=this.checked;A.invalidate()}}
  function open(){panel.classList.add('open');btn.setAttribute('aria-expanded','true');render();if(typeof window.updateUiPause==='function')window.updateUiPause()}
  function close(){panel.classList.remove('open');btn.setAttribute('aria-expanded','false');if(typeof window.updateUiPause==='function')window.updateUiPause()}
  btn.onclick=function(){panel.classList.contains('open')?close():open()};
  A.invalidate=function(){state.cacheKey='';if(panel.classList.contains('open'))render()};
  // Install a colour post-processor where the game exposes overlayFill. This is reversible and
  // leaves selection/tool state untouched. interaction-v3 may already have wrapped this function.
  if(typeof window.overlayFill==='function'&&!window.__cfDash4Wrapped){var base=window.overlayFill;window.overlayFill=function(x,y,i,u){if(!state.visible||state.layer==='none')return null;var c=base.apply(this,arguments);if(!c)return c;var a=state.opacity;if(a>=.999)return c;var m=String(c).match(/^rgba?\\(([^)]+)\\)$/i);if(!m)return c;var q=m[1].split(',').map(function(v){return parseFloat(v)});if(q.length<3)return c;return 'rgba('+q[0]+','+q[1]+','+q[2]+','+(a*(q.length>3&&!isNaN(q[3])?q[3]:1)).toFixed(3)+')'};window.__cfDash4Wrapped=true}
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&panel.classList.contains('open'))close()});
  A.open=open;A.close=close;A.setLayer=function(id,on){if(on===false&&state.layer===id){preserveLayer('none')}else preserveLayer(id)};A.setOpacity=function(v){state.opacity=Math.max(0,Math.min(1,Number(v)||0));A.invalidate()};A.btn=btn;btn.style.display=(typeof window.G==='undefined'?'none':'');
})();
