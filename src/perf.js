/* CITYFORGE 4.1 — 渲染性能层（在 performance-v4 基础上扩展）
 * 1) 光晕精灵缓存：原版每帧对每个光源调用 createRadialGradient，车辆、路灯、建筑灯累计数百次/帧。
 * 2) 图表重绘按需：指标卡刷新频率 0.5s，但历史数据只在换日时变化，避免反复重置画布。
 * 3) 自适应画质与图层缓存沿用 4.0（窗口/树木/烟雾 LOD、远景战略图、小地图缓存）。
 */
const CF4 = { frames: 0, ms: 0, slow: 0, last: performance.now(), layerVisible: true, autoQuality: true, glows: 0, charts: 0 };
window.CFPERF41 = { version: 1, glowHits: 0, glowMiss: 0, chartSkips: 0 };
const cf4Style = document.createElement('style');
cf4Style.textContent = `#cf4LayerBar{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;padding:8px;background:#102b39;border:1px solid #285366;border-radius:9px}#cf4LayerBar button{border:1px solid #376b7e;background:#153b4b;color:#bde6ed;border-radius:6px;padding:5px 8px;font-size:12px}#cf4LayerBar button.off{opacity:.42;text-decoration:line-through}.cf4Hint{color:#8eafb7;font-size:11px}`;
document.head.appendChild(cf4Style);

/* ---- 光晕精灵缓存 ---- */
const cf4GlowSprite = new Map();
function cf4GlowCanvas(col) {
  let cv = cf4GlowSprite.get(col);
  if (cv) { window.CFPERF41.glowHits++; return cv; }
  window.CFPERF41.glowMiss++;
  const RG = 48;                       // 精灵半径，绘制时按目标半径缩放
  cv = document.createElement('canvas');
  cv.width = cv.height = RG * 2;
  const g = cv.getContext('2d');
  const inner = col.replace('rgb(', '').replace('rgba(', '').replace(')', '');
  const grad = g.createRadialGradient(RG, RG, 0, RG, RG, RG);
  grad.addColorStop(0, 'rgba(' + inner + ',1)');
  grad.addColorStop(1, 'rgba(' + inner + ',0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(RG, RG, RG, 0, 6.29); g.fill();
  cf4GlowSprite.set(col, cv);
  return cv;
}
glow = function (cx, cy, r, col, alpha) {
  if (!(alpha > .004) || !(r > 0)) return;
  const sprite = cf4GlowCanvas(col);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.drawImage(sprite, cx - r, cy - r, r * 2, r * 2);
  ctx.globalAlpha = prev;
};

/* ---- 图表：数据与尺寸未变则跳过重绘 ---- */
const cf4ChartSig = new Map();
const cf4OldChart = drawChart;
drawChart = function (cvv, key, col) {
  const w = cvv.clientWidth, h = cvv.clientHeight;
  if (w < 10) return;
  const hist = G && G.hist ? G.hist : [];
  const last = hist.length ? hist[hist.length - 1] : null;
  const sig = [hist.length, last ? last[key] : '', last ? last.m : '', hist.length ? hist[0][key] : '', w, h, col, CFPRO.quality].join('|');
  if (cf4ChartSig.get(cvv) === sig) { window.CFPERF41.chartSkips++; return; }
  cf4ChartSig.set(cvv, sig);
  return cf4OldChart.apply(this, arguments);
};

function cf4LayerBar() {
  if (!$('proDashboard') || $('cf4LayerBar')) return;
  const e = document.createElement('div');
  e.id = 'cf4LayerBar';
  e.innerHTML = '<span class="cf4Hint">图层可见性</span><button data-layer="traffic">交通</button><button data-layer="poll">污染</button><button data-layer="services">服务覆盖</button><button data-layer="land">地价</button><button data-layer="fire">火灾</button><button data-layer="none">关闭图层</button>';
  $('proDashboard').querySelector('.proSettings').after(e);
  e.onclick = function (ev) {
    const b = ev.target.closest('[data-layer]'); if (!b) return;
    const l = b.dataset.layer;
    if (l === 'none') { setOverlay('none'); e.querySelectorAll('button').forEach(x => x.classList.add('off')); return; }
    const next = R.overlay === l ? 'none' : l;
    setOverlay(next);
    e.querySelectorAll('button').forEach(x => x.classList.toggle('off', x.dataset.layer !== next));
    if (typeof CityForgeInteraction !== 'undefined' && CityForgeInteraction.invalidateOverlay) CityForgeInteraction.invalidateOverlay();
  };
}
const cf4OldPro = proMetrics;
proMetrics = function () {
  cf4OldPro(); cf4LayerBar();
  if ($('cf4Perf')) $('cf4Perf').textContent = '自适应渲染：' + (CF4.autoQuality ? '开启' : '关闭') + ' · 图层重绘按需缓存 · 光晕精灵复用 ' + window.CFPERF41.glowHits + ' 次';
};
const cf4OldUpdate = update;
update = function (dt) {
  cf4OldUpdate(dt);
  CF4.frames++; CF4.ms += dt * 1000;
  if (CF4.ms > 1000) {
    const fps = CF4.frames / (CF4.ms / 1000);
    if (CF4.autoQuality && fps < 28 && CFPRO.quality !== 'low') { CFPRO.quality = 'low'; CFPRO.miniRevision = -1; CF4.slow++; }
    else if (CF4.autoQuality && fps > 54 && CFPRO.quality === 'low') { CFPRO.quality = 'balanced'; CFPRO.miniRevision = -1; }
    CF4.frames = 0; CF4.ms = 0;
  }
};
const cf4OldRender = render;
render = function (dt) {
  const t = performance.now();
  cf4OldRender(dt);
  CFPRO.renderMs = performance.now() - t;
  CF4.last = CFPRO.renderMs;
};
addEventListener('keydown', function (e) {
  if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && SCREEN === 'game') {
    const p = $('proDashboard');
    if (p && !p.classList.contains('open')) { p.classList.add('open'); updateUiPause(); proMetrics(); }
    e.preventDefault();
  }
});
