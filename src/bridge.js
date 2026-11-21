/* CITYFORGE 4.1 — 水上桥渲染修复与桥体美术
 * 注入位置：原 IIFE 内、BOOT 之前（在 traffic/interaction 层之后）
 * 修复：水面格（t===1）上的道路建筑此前不会进入绘制分支，桥面完全不可见。
 * 由 build-v41.cjs 在主渲染循环的水面分支补上 drawRoad 调用，本模块负责桥体绘制。
 * 依赖：G, R, cam, ctx, W, H, TW, TH, ELEV, idx, inB, poly, shade, roadAt, carDY, CFTRAFFIC
 */
(function () {
  'use strict';
  var DECK = -6;                 // 桥面基准高度（世界像素，负值向上；与车辆/幽灵预览一致）
  var THICK = 3.2;               // 桥面板厚
  var RAIL = 5.2;                // 栏杆高度
  var stats = { tiles: 0, draws: 0 };

  function isBridge(x, y) {
    if (!inB(x, y)) return false;
    var i = idx(x, y);
    if (G.grid.t[i] !== 1) return false;          // 只要水面格
    var u = G.grid.b[i];
    if (!u) return false;
    var b = G.buildings.get(u);
    return !!b && b.d === 'road';
  }
  // 相邻格若也是道路，返回其路面高度（世界像素）；桥梁格返回基准高度，非道路返回 null。
  function roadDY(nx, ny) {
    if (!inB(nx, ny)) return null;
    var k = idx(nx, ny), u = G.grid.b[k];
    if (!u) return null;
    var b = G.buildings.get(u);
    if (!b || b.d !== 'road') return null;
    return G.grid.t[k] === 1 ? DECK : -G.grid.e[k] * ELEV;
  }
  // 取较接近地表的一端，保证与岸上道路平顺衔接（避免接缝台阶）
  function blend(a, b) {
    if (a === null && b === null) return DECK;
    if (a === null) return b;
    if (b === null) return a;
    return Math.max(a, b);
  }
  // 四个角点的桥面高度：0=左/上角(x,y) 1=右角(x+1,y) 2=下角(x+1,y+1) 3=左角(x,y+1)
  function corners(x, y) {
    var E = roadDY(x + 1, y), S = roadDY(x, y + 1), W = roadDY(x - 1, y), N = roadDY(x, y - 1);
    return [blend(W, N), blend(E, N), blend(E, S), blend(W, S)];
  }

  function drawBridge(x, y, env) {
    var z = cam.z, L = env.L;
    var hw = TW * .5 * z, hh = TH * .5 * z, th = TH * z;
    var ax = (x - y) * TW * .5 * z + W * .5 - cam.x * z;
    var ay = (x + y) * TH * .5 * z + H * .5 - cam.y * z;
    var c = corners(x, y);
    var P = [
      [ax, ay + c[0] * z],
      [ax + hw, ay + hh + c[1] * z],
      [ax, ay + th + c[2] * z],
      [ax - hw, ay + hh + c[3] * z]
    ];
    var wdy = G.grid.e[idx(x, y)] === 0 ? 6 : 4;    // 该格水面高度（与主循环一致）
    stats.draws++;

    // 1. 桥面在水面上的投影
    ctx.fillStyle = 'rgba(6,18,28,.32)';
    ctx.beginPath();
    ctx.moveTo(P[0][0] + 1.5 * z, P[0][1] + 9 * z);
    ctx.lineTo(P[1][0] + 1.5 * z, P[1][1] + 9 * z);
    ctx.lineTo(P[2][0] + 1.5 * z, P[2][1] + 9 * z);
    ctx.lineTo(P[3][0] + 1.5 * z, P[3][1] + 9 * z);
    ctx.closePath();
    ctx.fill();

    // 2. 桥墩：从桥面中心落到水面
    var cyD = (P[0][1] + P[2][1]) * .5;
    var cyW = ay + wdy * z + th * .5;
    var ph = Math.max(2.4 * z, cyW - cyD + 2.4 * z);
    ctx.fillStyle = shade('#4c5763', L * .82);
    ctx.beginPath();
    ctx.moveTo(ax - 2.4 * z, cyD);
    ctx.lineTo(ax + 2.4 * z, cyD);
    ctx.lineTo(ax + 3.3 * z, cyD + ph);
    ctx.lineTo(ax - 3.3 * z, cyD + ph);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade('#5f6b78', L * 1.0);
    ctx.fillRect(ax - 2.4 * z, cyD, 1.5 * z, ph * .92);
    if (cam.z > .55) {                              // 水面接触处的浅色反光
      ctx.fillStyle = 'rgba(190,232,248,' + (.16 + .08 * env.L) + ')';
      ctx.fillRect(ax - 3.6 * z, cyD + ph - 1.1 * z, 7.2 * z, 1.1 * z);
    }

    // 3. 桥面板体（下侧两条可见边补厚度）
    poly([P[1], P[2], [P[2][0], P[2][1] + THICK * z], [P[1][0], P[1][1] + THICK * z]], shade('#2e373f', L * .95));
    poly([P[2], P[3], [P[3][0], P[3][1] + THICK * z], [P[2][0], P[2][1] + THICK * z]], shade('#39434c', L * .98));
    poly(P, shade('#414b55', L * 1.03), shade('#6b7782', L), 1);

    // 4. 护栏（两条远端边），放大时才画立柱
    ctx.strokeStyle = shade('#bcc8d2', L * 1.04);
    ctx.lineWidth = 1.2 * z;
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1] - RAIL * z);
    ctx.lineTo(P[1][0], P[1][1] - RAIL * z);
    ctx.moveTo(P[0][0], P[0][1] - RAIL * z);
    ctx.lineTo(P[3][0], P[3][1] - RAIL * z);
    ctx.stroke();
    if (z > .85) {
      ctx.strokeStyle = shade('#8d99a4', L * .95);
      ctx.lineWidth = 1 * z;
      ctx.beginPath();
      var k;
      for (k = 1; k <= 2; k++) {
        var mx = P[0][0] + (P[1][0] - P[0][0]) * k / 3, my = P[0][1] + (P[1][1] - P[0][1]) * k / 3;
        ctx.moveTo(mx, my - RAIL * z); ctx.lineTo(mx, my + .6 * z);
        mx = P[0][0] + (P[3][0] - P[0][0]) * k / 3; my = P[0][1] + (P[3][1] - P[0][1]) * k / 3;
        ctx.moveTo(mx, my - RAIL * z); ctx.lineTo(mx, my + .6 * z);
      }
      ctx.stroke();
    }

    // 5. 中心虚线：只朝有道路相接的边画，保证桥面与两岸道路连续
    var cx = (P[0][0] + P[2][0]) * .5, cy = (P[0][1] + P[2][1]) * .5;
    var dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    var edges = [
      [(P[1][0] + P[2][0]) * .5, (P[1][1] + P[2][1]) * .5],
      [(P[2][0] + P[3][0]) * .5, (P[2][1] + P[3][1]) * .5],
      [(P[3][0] + P[0][0]) * .5, (P[3][1] + P[0][1]) * .5],
      [(P[0][0] + P[1][0]) * .5, (P[0][1] + P[1][1]) * .5]
    ];
    var conn = 0;
    ctx.strokeStyle = 'rgba(230,220,160,' + (.3 + L * .25) + ')';
    ctx.lineWidth = 1.1 * z;
    ctx.setLineDash([3 * z, 3.5 * z]);
    for (k = 0; k < 4; k++) {
      var dd = dirs[k];
      if (roadAt(x + dd[0], y + dd[1])) { conn++; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(edges[k][0], edges[k][1]); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    if (conn === 0) { ctx.fillStyle = 'rgba(230,220,160,.3)'; ctx.beginPath(); ctx.arc(cx, cy, 1.6 * z, 0, 6.29); ctx.fill(); }
    // 近端两条边描一层浅色压边，强化“桥面浮在水上”的体积
    ctx.strokeStyle = shade('#7d8994', L * .9);
    ctx.lineWidth = 1 * z;
    ctx.beginPath();
    ctx.moveTo(P[1][0], P[1][1] + THICK * z); ctx.lineTo(P[2][0], P[2][1] + THICK * z);
    ctx.lineTo(P[3][0], P[3][1] + THICK * z);
    ctx.stroke();
  }

  // 车辆在桥面上的高度：取四角桥面的平均，使车辆贴合桥面坡度
  var prevCarDY = carDY;
  carDY = function (x, y) {
    if (!inB(x, y)) return 0;
    var i = idx(x, y);
    if (G.grid.t[i] !== 1) return -G.grid.e[i] * ELEV;
    var c = corners(x, y);
    return (c[0] + c[1] + c[2] + c[3]) * .25;
  };

  // 桥面替代原道路绘制（保留陆上道路的交通设施绘制）
  var prevDrawRoad = drawRoad;
  drawRoad = function (x, y, env) {
    if (isBridge(x, y)) {
      stats.tiles++;
      if (typeof CFTRAFFIC !== 'undefined') {
        CFTRAFFIC.ensure();
        drawBridge(x, y, env);
        CFTRAFFIC.drawRoadFurniture(x, y);
      } else drawBridge(x, y, env);
      return;
    }
    return prevDrawRoad.apply(this, arguments);
  };

  // 远景不绘制信号灯 / 站牌 / 公交站：z<.5 时这些图标只有 1~2px，纯属浪费
  if (typeof CFTRAFFIC !== 'undefined' && CFTRAFFIC.drawRoadFurniture) {
    var origFurniture = CFTRAFFIC.drawRoadFurniture;
    CFTRAFFIC.drawRoadFurniture = function (x, y) {
      if (cam.z < .5) return;
      return origFurniture(x, y);
    };
  }

  window.CFBRIDGE = {
    version: 1,
    isBridge: isBridge,
    corners: corners,
    stats: stats,
    get deck() { return DECK; },
    // 供测试使用：直接绘制一格桥
    paint: function (x, y, env) { drawBridge(x, y, env || { L: 1, night: 0 }); }
  };
})();
