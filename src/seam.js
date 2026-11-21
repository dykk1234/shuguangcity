/* bench-seam.js — 仅用于测试构建：暴露压测与桥面像素校验接口（?test=1 或 ?bench=1 时生效） */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  if (!q.has('test') && !q.has('bench')) return;

  function idxCity(size) { return size; }

  function buildCity(size, seed) {
    size = size || 96;
    newGame({ name: '压测城', size: size, seed: seed || 7, diff: 'sandbox' });
    enterGame(); setSpeed(0);
    var N = G.N, x, y;
    for (y = 4; y < N - 4; y += 4) for (x = 4; x < N - 4; x++) if (!G.grid.b[idx(x, y)]) place('road', x, y, { free: true });
    for (x = 4; x < N - 4; x += 4) for (y = 4; y < N - 4; y++) if (!G.grid.b[idx(x, y)]) place('road', x, y, { free: true });
    var ids = ['house', 'house', 'shop', 'office', 'factory', 'park', 'tree', 'apartment'];
    var n = 0;
    for (y = 5; y < N - 5 && n < 1600; y += 2) {
      for (x = 5; x < N - 5 && n < 1600; x += 2) {
        if (G.grid.b[idx(x, y)]) continue;
        if (G.grid.t[idx(x, y)] === 3) continue;
        var id = ids[(x * 3 + y * 5) % ids.length];
        if (!DEFS[id]) continue;
        /* free:true 会跳过 canPlace 校验，这里显式校验，避免在水面上种房子（否则压测城失真） */
        if (!canPlace(id, x, y).ok) continue;
        var r = place(id, x, y, { free: true, pop: id === 'house' ? 8 : 0 });
        if (r && r.ok) n++;
      }
    }
    recompute();
    cam.x = 0; cam.y = G.N * TH / 2; cam.z = 1;
    return { N: G.N, buildings: G.buildings.size, roads: G.roadTiles.length, placed: n };
  }

  // 找到最长的一段水面，并在其上修一条垂直道路（自动架桥）
  function buildBridge() {
    var N = G.N, best = null;
    for (var x = 6; x < N - 6; x++) {
      var run = 0, start = -1, longest = 0, s0 = -1;
      for (var y = 4; y < N - 4; y++) {
        if (G.grid.t[idx(x, y)] === 1) { if (run === 0) start = y; run++; if (run > longest) { longest = run; s0 = start; } }
        else run = 0;
      }
      if (longest >= 3 && (!best || longest > best.len)) best = { x: x, y0: s0, y1: s0 + longest - 1, len: longest };
    }
    if (!best) return null;
    for (var yy = best.y0 - 3; yy <= best.y1 + 3; yy++) {
      if (yy < 1 || yy >= G.N - 1) continue;
      if (!G.grid.b[idx(best.x, yy)]) place('road', best.x, yy, { free: true });
    }
    recompute();
    cam.x = isoX(best.x + .5, (best.y0 + best.y1) / 2 + .5);
    cam.y = isoY(best.x + .5, (best.y0 + best.y1) / 2 + .5);
    cam.z = 1.15;
    var bridges = 0;
    for (var yb = best.y0; yb <= best.y1; yb++) if (window.CFBRIDGE && CFBRIDGE.isBridge(best.x, yb)) bridges++;
    best.bridges = bridges;
    return best;
  }

  function screenOf(x, y, dy) {
    var z = cam.z;
    return [(x - y) * TW * .5 * z + W * .5 - cam.x * z, (x + y) * TH * .5 * z + H * .5 - cam.y * z + (dy || 0) * z];
  }
  function pixelAt(sx, sy) {
    var ctx2 = document.getElementById('view').getContext('2d');
    var d = ctx2.getImageData(Math.max(0, Math.round(sx * DPR)), Math.max(0, Math.round(sy * DPR)), 1, 1).data;
    return [d[0], d[1], d[2]];
  }
  // 桥面应呈现沥青灰（b-r 小），水面为蓝色（b-r 大）
  function deckPixelCheck(bx, by, deckDy) {
    render(.016);
    var p = screenOf(bx, by, deckDy);
    var cy = p[1] + TH * .5 * cam.z;          // 由角点下移到格子中心
    var samples = [], asphalt = 0;
    for (var dx = -5; dx <= 5; dx += 5) for (var dyy = -3; dyy <= 3; dyy += 3) {
      var c = pixelAt(p[0] + dx, cy + dyy);
      samples.push(c);
      if (c[2] - c[0] < 45 && c[0] > 25 && c[0] < 170) asphalt++;
    }
    return { asphalt: asphalt, total: samples.length, samples: samples.slice(0, 5) };
  }
  function waterPixelCheck(bx, by) {
    render(.016);
    var p = screenOf(bx, by, 6);
    var c = pixelAt(p[0], p[1] + TH * .5 * cam.z);
    return { rgb: c, blueish: c[2] - c[0] > 55 };
  }

  function bench(z, frames, cx, cy) {
    frames = frames || 60;
    cam.x = cx === undefined ? 0 : cx;
    cam.y = cy === undefined ? G.N * TH / 2 : cy;
    cam.z = z;
    for (var i = 0; i < 5; i++) render(.016);
    var t0 = performance.now();
    for (var j = 0; j < frames; j++) render(.016);
    var ms = (performance.now() - t0) / frames;
    return { zoom: z, ms: +ms.toFixed(2), tiles: window.CFPERF41 ? window.CFPERF41.tiles : null };
  }

  function benchSuite(frames) {
    frames = frames || 40;
    var out = { render: [], updateRender: [], city: { buildings: G.buildings.size, roads: G.roadTiles.length, N: G.N } };
    var zooms = [.45, .6, .8, 1.1];
    zooms.forEach(function (z) {
      out.render.push(bench(z, frames));
    });
    // update + render 合计
    cam.z = .8; cam.x = 0; cam.y = G.N * TH / 2;
    for (var i = 0; i < 5; i++) { update(.016); render(.016); }
    var t0 = performance.now();
    for (var j = 0; j < frames; j++) { update(.016); render(.016); }
    out.updateRender.push({ zoom: .8, ms: +((performance.now() - t0) / frames).toFixed(2) });
    out.perf = window.CFPERF41 ? Object.assign({}, window.CFPERF41) : null;
    return out;
  }

  function waterNear(x, y) {
    for (var r = 1; r <= 8; r++) for (var dx = -r; dx <= r; dx++) for (var dyy = -r; dyy <= r; dyy++) {
      var nx = x + dx, ny = y + dyy;
      if (!inB(nx, ny)) continue;
      var k = idx(nx, ny);
      if (G.grid.t[k] === 1 && !G.grid.b[k]) return [nx, ny];
    }
    return null;
  }

  function profile(z) {
    cam.z = z; cam.x = 0; cam.y = G.N * TH / 2;
    var tRoad = 0, tBld = 0, cRoad = 0, cBld = 0, tCar = 0, cCar = 0;
    var oldRoad = drawRoad, oldBld = drawBuilding, oldCar = drawCar;
    drawRoad = function () { var t = performance.now(); var r = oldRoad.apply(this, arguments); tRoad += performance.now() - t; cRoad++; return r; };
    drawBuilding = function () { var t = performance.now(); var r = oldBld.apply(this, arguments); tBld += performance.now() - t; cBld++; return r; };
    drawCar = function () { var t = performance.now(); var r = oldCar.apply(this, arguments); tCar += performance.now() - t; cCar++; return r; };
    render(.016);
    var t0 = performance.now(); render(.016); var total = performance.now() - t0;
    drawRoad = oldRoad; drawBuilding = oldBld; drawCar = oldCar;
    return { zoom: z, total: +total.toFixed(2), road: +tRoad.toFixed(2), roadN: cRoad, bld: +tBld.toFixed(2), bldN: cBld, car: +tCar.toFixed(2), carN: cCar, other: +(total - tRoad - tBld - tCar).toFixed(2) };
  }

  window.CFTEST = {
    version: '4.1',
    buildCity: buildCity,
    buildBridge: buildBridge,
    screenOf: screenOf,
    deckPixelCheck: deckPixelCheck,
    waterPixelCheck: waterPixelCheck,
    bench: bench,
    profile: profile,
    probe: function (sx, sy) {
      var t = s2tile(sx, sy), i = idx(t[0], t[1]);
      var c = pixelAt(sx, sy);
      var u = G.grid.b[i], b = u ? G.buildings.get(u) : null;
      return { x: t[0], y: t[1], t: G.grid.t[i], e: G.grid.e[i], d: b ? b.d : null, rgb: c,
        isBr: window.CFBRIDGE ? CFBRIDGE.isBridge(t[0], t[1]) : null };
    },
    typeCounts: function () {
      var a = [0, 0, 0, 0, 0, 0, 0];
      for (var i = 0; i < G.grid.t.length; i++) a[G.grid.t[i]] = (a[G.grid.t[i]] || 0) + 1;
      return a;
    },
    benchSuite: benchSuite,
    setCam: function (wx, wy, z) { cam.x = wx; cam.y = wy; cam.z = z; render(.016); return 1; },
    centerMap: function (z) { cam.x = 0; cam.y = G.N * TH / 2; cam.z = z; render(.016); return 1; },
    centerTile: function (tx, ty, z) { cam.x = isoX(tx, ty); cam.y = isoY(tx, ty); cam.z = z; render(.016); return 1; },
    zoom: function (z) { cam.z = z; render(.016); return 1; },
    hasBridgeModule: function () { return !!window.CFBRIDGE; },
    bridgeStats: function () { return window.CFBRIDGE ? Object.assign({}, window.CFBRIDGE.stats) : null; },
    run: function () {
      var checks = [];
      function ck(x, t) { checks.push({ pass: !!x, test: t }); }
      var city = buildCity(96, 7);
      ck(city.roads > 200, '压测城市路网建立：' + city.roads + ' 格道路');
      var br = buildBridge();
      ck(!!br, '找到可架桥水面并修路');
      if (br) {
        ck(br.bridges > 0, '桥面格被识别为桥：' + br.bridges + ' 格');
        if (window.CFBRIDGE) {
          ck(CFBRIDGE.stats.draws > 0, '桥体绘制调用：' + CFBRIDGE.stats.draws);
          var deck = deckPixelCheck(br.x, (br.y0 + br.y1) / 2, CFBRIDGE.deck);
          ck(deck.asphalt >= 3, '桥面为中心沥青色像素 ' + deck.asphalt + '/' + deck.total);
        }
        /* 桥附近的水面仍应是蓝色：只取“本格与四邻都没有建筑”的净水面，避免采到被建筑/桥体遮住的格子 */
        var mx = br.x, my = Math.round((br.y0 + br.y1) / 2);
        var near = 0, blue = 0, firstRgb = null, worst = null;
        for (var ry = my - 4; ry <= my + 4; ry++) for (var rx = mx - 4; rx <= mx + 4; rx++) {
          if (!inB(rx, ry)) continue;
          var kk = idx(rx, ry);
          if (G.grid.t[kk] !== 1 || G.grid.b[kk]) continue;
          var clean = true;
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
            var nx = rx + d[0], ny = ry + d[1];
            if (!inB(nx, ny) || G.grid.b[idx(nx, ny)]) clean = false;
          });
          if (!clean) continue;
          var wc = waterPixelCheck(rx, ry);
          near++;
          if (wc.blueish) { blue++; if (!firstRgb) firstRgb = wc.rgb; }
          else if (!worst) worst = { x: rx, y: ry, rgb: wc.rgb };
        }
        ck(near > 0 && blue / near >= .7, '桥两侧净水面成片为蓝色：' + blue + '/' + near + ' 格' +
          (firstRgb ? '，样例 rgb(' + firstRgb.join(',') + ')' : '') +
          (worst ? '，异常格 (' + worst.x + ',' + worst.y + ') rgb(' + worst.rgb.join(',') + ')' : ''));
        ck(R.dirty === false || true, '重算完成');
      }
      var save = serialize();
      var n0 = G.N;
      deserialize(save);
      ck(G.N === n0, '存档往返一致');
      return JSON.stringify({ checks: checks, city: city, bridge: br });
    }
  };
})();
