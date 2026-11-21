/* CITYFORGE traffic upgrade — paste INSIDE the original IIFE, immediately before BOOT.
 * Simple visual road traffic / shuttle buses, NOT a passenger-demand simulation.
 * Install this before other upgrade wrappers; wrappers must call their captured predecessor.
 */
const CFTRAFFIC = (function () {
  'use strict';
  const MAX_BUSES = 12, GAP = .32;
  const roadClasses = Object.freeze([
    Object.freeze({grade:0,name:'普通道路',speed:1,capacity:1,maintenanceMultiplier:1,upgradeCost:0}),
    Object.freeze({grade:1,name:'主干道路',speed:1.45,capacity:1.4,maintenanceMultiplier:2,upgradeCost:45}),
    Object.freeze({grade:2,name:'快速道路',speed:1.95,capacity:1.8,maintenanceMultiplier:4,upgradeCost:110})
  ]);
  const config = { maxVehicles:82, maxCars:70, pathBudget:4096, solvesPerUpdate:4, pathCacheSize:256,
    busFrequency: 18, busCapacity: 32, cacheTTL: 5, showRouteLabels: true };
  let selectedClass = 0, solveBudget = 4, congestionEpoch = 0;
  const pathCache = new Map();
  let tripSources = [], tripTargets = new Map();
  function gradeOf(b) { return b && Number.isInteger(b.roadClass) ? clamp(b.roadClass,0,2) : 0; }
  function setRoadClass(grade) { if (!Number.isInteger(grade)||grade<0||grade>2) return false; selectedClass=grade; return true; }
  function configure(opts) {
    opts=opts||{};
    ['maxVehicles','maxCars','pathBudget','solvesPerUpdate','pathCacheSize','busFrequency','busCapacity','cacheTTL'].forEach(function(k){
      if(Number.isFinite(opts[k])) config[k]=Math.floor(clamp(opts[k],k==='maxCars'?0:1,k==='maxVehicles'||k==='maxCars'?160:k==='pathBudget'?16384:k==='pathCacheSize'?1024:k==='cacheTTL'?120:k==='busCapacity'?500:120));
    });
    R.cars=R.cars.slice(0,config.maxVehicles); return Object.assign({},config);
  }
  function roadMaintenance(b) { return roadClasses[gradeOf(b)].maintenanceMultiplier; }
  function upgradeRoad(x,y,grade,opts) {
    if(!ensure()||!Number.isInteger(grade)||grade<0||grade>2) return {ok:false,reason:'无效道路等级',cost:0};
    const n=nodeOf(x,y); if(!n) return {ok:false,reason:'请选择已有道路',cost:0};
    const old=gradeOf(n.building);
    if(grade<old) return {ok:false,reason:'不支持降级',cost:0};
    const cost=(opts&&opts.free)||G.diff==='sandbox'?0:Math.max(0,roadClasses[grade].upgradeCost-roadClasses[old].upgradeCost);
    if(cost && !(G.money>=cost)) return {ok:false,reason:'资金不足',cost:cost};
    if(old===grade) return {ok:true,cost:0,changed:false};
    n.building.roadClass=grade; if(cost)G.money-=cost;
    G.dirty=true; R.miniDirty=true; invalidate('topology');
    return {ok:true,cost:cost,changed:true,grade:grade};
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let owner = null, graphDirty = true, routesDirty = true, demandDirty = true;
  let nodes = new Map(), components = [], mobileNodes = [], routes = [], stops = new Map();
  let clock = 0, sampleClock = 1, targetClock = 1, density = new Map();
  const stats = {
    roadCount: 0, connectedRoads: 0, largestComponentRoads: 0, isolatedRoads: 0, components: 0,
    intersections: 0, cars: 0, buses: 0, vehicles: 0, routes: 0, stops: 0,
    waiting: 0, redWaiting: 0, avgSpeed: 0, congestion: 0,
    busStopVisits: 0, graphRebuilds: 0, routeRebuilds: 0, pathSolves:0, pathCacheHits:0, pathExpanded:0, pathBudgetMisses:0, completedTrips:0, passengerLoad:0, passengerWaiting:0, busCapacity:32, cacheEntries:0,
    model: '抽样源目的地加权交通 / 公交往返（非逐人通勤、无完整客流或匝道冲突模型）'
  };
  const key = function (x, y) { return y * G.N + x; };
  function invalidate(kind) {
    if (kind === 'demand') { demandDirty=true; return; }
    if (kind !== 'routes') graphDirty = true;
    routesDirty = true;
  }
  function reset() {
    owner = G; nodes.clear(); components = []; mobileNodes = [];
    routes = []; stops.clear(); density.clear(); pathCache.clear(); tripSources=[]; tripTargets.clear(); graphDirty = true; routesDirty = true; solveBudget=config.solvesPerUpdate;
    clock = 0; sampleClock = 1; targetClock = 1;
    Object.keys(stats).forEach(function (k) { if (typeof stats[k] === 'number') stats[k] = 0; });
  }
  function rebuildGraph() {
    nodes = new Map(); components = []; mobileNodes = [];
    // roadTiles is refreshed by recompute, so it can be stale immediately after a drag.
    G.buildings.forEach(function (b) {
      if (b.d === 'road') nodes.set(key(b.x, b.y), { k: key(b.x, b.y), x: b.x, y: b.y, nb: [], component: -1, building:b, grade:gradeOf(b), trunkDistance:Infinity });
    });
    nodes.forEach(function (n) {
      dirs.forEach(function (d) {
        const x = n.x + d[0], y = n.y + d[1];
        if (x < 0 || y < 0 || x >= G.N || y >= G.N) return;
        const next = nodes.get(key(x, y));
        if (next) n.nb.push(next.k);
      });
      if (n.nb.length) mobileNodes.push(n.k);
    });
    nodes.forEach(function (root) {
      if (root.component !== -1) return;
      const id = components.length, queue = [root.k]; root.component = id;
      for (let i = 0; i < queue.length; i++) {
        const n = nodes.get(queue[i]);
        n.nb.forEach(function (k) {
          const next = nodes.get(k);
          if (next.component === -1) { next.component = id; queue.push(k); }
        });
      }
      components.push(queue);
    });
    stats.roadCount = nodes.size; stats.connectedRoads = mobileNodes.length;
    stats.isolatedRoads = nodes.size - mobileNodes.length;
    stats.components = components.length;
    stats.largestComponentRoads = components.reduce(function (max, part) { return Math.max(max, part.length); }, 0);
    stats.intersections = 0;
    nodes.forEach(function (n) { if (n.nb.length >= 3) stats.intersections++; });
    const trunkQueue=[];
    nodes.forEach(function(n){if(n.grade>=1){n.trunkDistance=0;trunkQueue.push(n.k);}});
    for(let i=0;i<trunkQueue.length;i++) {const n=nodes.get(trunkQueue[i]);n.nb.forEach(function(k){const q=nodes.get(k);if(q.trunkDistance>n.trunkDistance+1){q.trunkDistance=n.trunkDistance+1;trunkQueue.push(k);}});}
    pathCache.clear(); demandDirty=true;
    stats.graphRebuilds++; graphDirty = false; routesDirty = true;
    // Cached ordinary paths may contain removed interior nodes: clear them atomically.
    R.cars = [];
  }
  function adjacentRoad(b) {
    const d = DEFS[b.d], choices = [];
    for (let x = b.x; x < b.x + d.w; x++) {
      if (b.y > 0 && nodes.has(key(x, b.y - 1))) choices.push(key(x, b.y - 1));
      if (b.y + d.h < G.N && nodes.has(key(x, b.y + d.h))) choices.push(key(x, b.y + d.h));
    }
    for (let y = b.y; y < b.y + d.h; y++) {
      if (b.x > 0 && nodes.has(key(b.x - 1, y))) choices.push(key(b.x - 1, y));
      if (b.x + d.w < G.N && nodes.has(key(b.x + d.w, y))) choices.push(key(b.x + d.w, y));
    }
    choices.sort(function (a, z) {
      return components[nodes.get(z).component].length - components[nodes.get(a).component].length || nodes.get(a).trunkDistance-nodes.get(z).trunkDistance || a-z;
    });
    const mobile=choices.find(function (k) { return nodes.get(k).nb.length > 0; });
    return mobile===undefined?choices[0]:mobile;
  }
  function rebuildDemand() {
    tripSources=[];tripTargets=new Map();
    G.buildings.forEach(function(b){const d=DEFS[b.d];if(!d||b.d==='road')return;const k=adjacentRoad(b);if(k===undefined)return;
      const entry={key:k,building:b.u};
      if(d.cap||b.pop>0)tripSources.push(entry);
      if(d.jobs||d.trade){const id=nodes.get(k).component;if(!tripTargets.has(id))tripTargets.set(id,[]);tripTargets.get(id).push(entry);}
    }); demandDirty=false;
  }
  function buildingAccess(b) {
    if(!ensure()||!b||!DEFS[b.d])return {adjacent:false,component:-1,componentSize:0,trunkDistance:null,roadClass:null,connected:false};
    const k=b.d==='road'?key(b.x,b.y):adjacentRoad(b),n=nodes.get(k);
    return {adjacent:!!n,component:n?n.component:-1,componentSize:n?components[n.component].length:0,
      trunkDistance:n&&Number.isFinite(n.trunkDistance)?n.trunkDistance:null,roadClass:n?n.grade:null,connected:!!n&&n.nb.length>0,roadKey:n?n.k:null};
  }
  // Bounded Dijkstra with a binary min heap; congestion snapshots are cached for 5 seconds.
  function weightedPath(start,end) {
    if(start===end)return [start];
    if(!nodes.has(start)||!nodes.has(end)||nodes.get(start).component!==nodes.get(end).component)return null;
    const cacheKey=start+':'+end+':'+congestionEpoch;
    if(pathCache.has(cacheKey)){const hit=pathCache.get(cacheKey); if(clock-hit.time<=config.cacheTTL){stats.pathCacheHits++;return hit.path;} pathCache.delete(cacheKey);}
    if(solveBudget<=0)return null;solveBudget--;stats.pathSolves++;
    const heap=[],dist=new Map([[start,0]]),parent=new Map();
    function push(k,v){let i=heap.length;heap.push([k,v]);while(i){const p=(i-1)>>1;if(heap[p][1]<=v)break;heap[i]=heap[p];i=p;}heap[i]=[k,v];}
    function pop(){const top=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][1]<heap[j][1])j++;if(heap[j][1]>=last[1])break;heap[i]=heap[j];i=j;}heap[i]=last;}return top;}
    push(start,0);let expanded=0;
    while(heap.length&&expanded<config.pathBudget){const item=pop(),k=item[0],cost=item[1];if(cost!==dist.get(k))continue;expanded++;stats.pathExpanded++;
      if(k===end){const path=[end];let at=end;while(at!==start){at=parent.get(at);path.push(at);}path.reverse();
        if(pathCache.size>=config.pathCacheSize)pathCache.delete(pathCache.keys().next().value);pathCache.set(cacheKey,{path:path,time:clock}); stats.cacheEntries=pathCache.size; return path;}
      const n=nodes.get(k);n.nb.forEach(function(qk){const q=nodes.get(qk),a=roadClasses[n.grade],b=roadClasses[q.grade];
        const w=1/Math.min(a.speed,b.speed)*(1+Math.min(4,(density.get(qk)||0)/b.capacity)*.65),next=cost+w;
        if(!dist.has(qk)||next<dist.get(qk)){dist.set(qk,next);parent.set(qk,k);push(qk,next);}
      });
    } stats.pathBudgetMisses++;return null;
  }
  function buildRoutes() {
    routes = []; stops = new Map();
    // One BFS route per depot, at most 12 depots; destination is a reachable road terminus.
    G.buildings.forEach(function (b) {
      if (b.d !== 'bus' || routes.length >= MAX_BUSES) return;
      const start = adjacentRoad(b);
      if (start === undefined) return;
      const queue = [start], parent = new Map([[start, null]]);
      for (let i = 0; i < queue.length; i++) {
        nodes.get(queue[i]).nb.forEach(function (k) {
          if (!parent.has(k)) { parent.set(k, queue[i]); queue.push(k); }
        });
      }
      if (queue.length < 3) return;
      let at = queue[queue.length - 1], path = [];
      while (at !== null) { path.push(at); at = parent.get(at); }
      path.reverse();
      // Keep long-world routes bounded while retaining a continuous BFS shortest path.
      if (path.length > 128) path = path.slice(0, 128);
      const route = { id: routes.length + 1, depot: b.u, path: path, stopIndices: new Set([0, path.length - 1]),
         frequency: config.busFrequency, capacity: config.busCapacity, headway: 3600 / config.busFrequency };
      for (let i = 6; i < path.length - 2; i += 6) route.stopIndices.add(i);
      route.stopIndices.forEach(function (i) {
        const k = path[i];
        if (!stops.has(k)) stops.set(k, []);
        stops.get(k).push(route.id);
      });
      routes.push(route);
    });
    // Topology/depot changes regenerate shuttles, never leave an invalid cached route alive.
    R.cars = R.cars.filter(function (c) { return !c.bus; });
    stats.routes = routes.length; stats.stops = stops.size;
    stats.routeRebuilds++; routesDirty = false;
  }
  function ensure() {
    if (!G) return false;
    if (owner !== G) reset();
    if (graphDirty) rebuildGraph();
    if (routesDirty) buildRoutes();
    if (demandDirty) rebuildDemand();
    return true;
  }
  function nodeOf(x, y) { return nodes.get(key(x, y)); }
  function signal(n) {
    // 5 seconds east/west, 1 all-red, 5 north/south, 1 all-red.
    const p = (clock + ((n.x * 3 + n.y * 5) % 9)) % 12;
    return p < 5 ? 'x' : p < 6 ? 'red' : p < 11 ? 'y' : 'red';
  }
  function canEnter(c) {
    const n = nodeOf(c.tx, c.ty);
    return !n || n.nb.length < 3 || signal(n) === (c.tx !== c.fx ? 'x' : 'y');
  }
  function edge(c) { return key(c.fx, c.fy) + ':' + key(c.tx, c.ty); }
  function spaceAt(f, t) {
    const gap=GAP/Math.min(roadClasses[nodes.get(f).grade].capacity,roadClasses[nodes.get(t).grade].capacity);
    return !R.cars.some(function (c) {
      return key(c.fx, c.fy) === f && key(c.tx, c.ty) === t && c.t < gap + .06;
    });
  }
  function makeCar(f, t, extra) {
    const a = nodes.get(f), b = nodes.get(t);
    return Object.assign({ fx: a.x, fy: a.y, tx: b.x, ty: b.y, t: 0,
      sp: .7 + Math.random() * .55, col: CAR_COLS[Math.floor(Math.random() * CAR_COLS.length)],
      waiting: false, redWait: false, moved: 0 }, extra || {});
  }
  function spawnSafe() {
    if (!ensure() || !SETTINGS.cars || !mobileNodes.length || R.cars.length >= config.maxVehicles) return false;
    if (R.cars.filter(function (c) { return !c.bus; }).length >= config.maxCars) return false;
    for (let i = 0; i < 8; i++) {
      const source=tripSources.length?tripSources[Math.floor(Math.random()*tripSources.length)]:null;
      const f=source?source.key:mobileNodes[Math.floor(Math.random()*mobileNodes.length)];
      const dests=tripTargets.get(nodes.get(f).component)||[], part=components[nodes.get(f).component];
      const dest=dests.length?dests[Math.floor(Math.random()*dests.length)]:null;
      const end=dest?dest.key:part[Math.floor(Math.random()*part.length)];
      const path=weightedPath(f,end);if(!path||path.length<2)continue;
      const t=path[1];if (!spaceAt(f,t)) continue;
      R.cars.push(makeCar(f,t,{path:path,pi:0,source:source?source.building:null,destination:dest?dest.building:null,destinationKey:end}));return true;
    }
    return false;
  }
  function syncTarget() {
    if (!ensure()) return;
    if (!SETTINGS.cars) { R.cars = []; sample(); return; }
    const target = mobileNodes.length ? clamp(Math.floor((Number.isFinite(G.cfTrafficDemand)?G.cfTrafficDemand:G.pop) / 26) + (mobileNodes.length > 6 ? 2 : 0), 0, Math.min(config.maxCars,config.maxVehicles)) : 0;
    let ordinary = R.cars.filter(function (c) { return !c.bus; }).length;
    if (ordinary > target) R.cars = R.cars.filter(function (c) { return c.bus || ordinary-- <= target; });
    // A bounded loop replaces the original unbounded while/spawnCar combination.
    ordinary = R.cars.filter(function (c) { return !c.bus; }).length;
    routes.forEach(function (r) {
      if (R.cars.length>=config.maxVehicles || R.cars.some(function (c) { return c.bus && c.route === r; })) return;
      if (!spaceAt(r.path[0], r.path[1])) return;
      R.cars.push(makeCar(r.path[0], r.path[1], {
        bus: true, route: r, ri: 0, direction: 1, dwell: 1.4, sp: .72, col: '#ffb02e'
      }));
    });
    for (let i = ordinary; i < target; i++) { if (!spawnSafe()) break; }
    sample();
  }
  function chooseNext(c) {
    const here = nodeOf(c.tx, c.ty);
    if (!here || !here.nb.length) return false;
    let next;
    const oldRi=c.ri, oldDirection=c.direction, oldDwell=c.dwell;
    if (c.bus) {
      c.ri += c.direction;
      if (c.route.stopIndices.has(c.ri)) c.dwell = 1.8;
      if (c.ri === c.route.path.length - 1) c.direction = -1;
      else if (c.ri === 0) c.direction = 1;
      next = c.route.path[c.ri + c.direction];
    } else {
      c.pi++;
      if(!c.path||c.pi>=c.path.length-1){stats.completedTrips++;return false;}
      next=c.path[c.pi+1];
    }
    const n = nodes.get(next);
    if (!n || !here.nb.includes(next)) return false;
    if(!spaceAt(here.k,next)){
      if(c.bus){c.ri=oldRi;c.direction=oldDirection;c.dwell=oldDwell;}else c.pi--;
      c.t=.999;c.waiting=true;return true;
    }
    if(c.bus&&c.route.stopIndices.has(c.ri))stats.busStopVisits++;
    c.fx = here.x; c.fy = here.y; c.tx = n.x; c.ty = n.y; c.t = 0;
    return true;
  }
  function sample() {
    density = new Map(); stats.passengerLoad = 0; let waiting = 0, red = 0, buses = 0, speed = 0;
    R.cars.forEach(function (c) {
      if (c.waiting) waiting++; if (c.redWait) red++; if (c.bus) buses++;
      speed += c.waiting ? 0 : (c.actualSpeed||c.sp);
      if (c.bus) { const routeLoad = Math.min(config.busCapacity, Math.max(0, Math.round((Number(G.pop)||0) / Math.max(1, routes.length * 8)))); c.load = routeLoad; stats.passengerLoad += routeLoad; }
       const k = key(c.t < .5 ? c.fx : c.tx, c.t < .5 ? c.fy : c.ty);
      density.set(k, (density.get(k) || 0) + 1);
    });
    stats.vehicles = R.cars.length; stats.buses = buses; stats.cars = R.cars.length - buses;
    stats.waiting = waiting; stats.redWaiting = red; stats.passengerWaiting = Math.max(0, Math.round((Number(G.pop)||0) / 12) - stats.passengerLoad); stats.busCapacity = config.busCapacity; stats.cacheEntries = pathCache.size;
    stats.avgSpeed = R.cars.length ? Math.round(speed / R.cars.length * 30) : 0;
    stats.congestion = R.cars.length ? Math.round(waiting / R.cars.length * 100) : 0;
    sampleClock = 0;
  }
  function tick(dt) {
    if (!ensure()) return;
    if (!SETTINGS.cars) { if (R.cars.length) R.cars = []; sample(); return; }
    solveBudget=config.solvesPerUpdate;
    dt = clamp(Number(dt) || 0, 0, .25); clock += dt;
    const epoch=Math.floor(clock/5);if(epoch!==congestionEpoch){congestionEpoch=epoch;pathCache.clear();}
    sampleClock += dt; targetClock += dt;
    if (targetClock >= 1) { targetClock = 0; syncTarget(); }
    // Directed-edge buckets share lanes for ordinary cars and buses. Opposite lanes are separate.
    const lanes = new Map();
    R.cars.forEach(function (c) {
      const e = edge(c); if (!lanes.has(e)) lanes.set(e, []); lanes.get(e).push(c);
    });
    lanes.forEach(function (lane) { lane.sort(function (a, b) { return b.t - a.t; }); });
    const remove = new Set();
    lanes.forEach(function (lane) {
      let leader = null;
      lane.forEach(function (c) {
        c.waiting = false; c.redWait = false;
        if (!nodeOf(c.fx, c.fy) || !nodeOf(c.tx, c.ty)) { remove.add(c); return; }
        if (c.dwell > 0) { c.dwell = Math.max(0, c.dwell - dt); c.waiting = true; leader = c; return; }
        const before = c.t;
        const gap=GAP/Math.min(roadClasses[nodeOf(c.fx,c.fy).grade].capacity,roadClasses[nodeOf(c.tx,c.ty).grade].capacity);
        let limit = 1;
        // Stop before the intersection center. Already committed cars finish clearing it.
        if (c.t <= .62 && !canEnter(c)) { limit = .62; c.redWait = c.t >= .60; }
        if (leader) limit = Math.min(limit, Math.max(c.t, leader.t - gap));
        const speed=c.sp*Math.min(roadClasses[nodeOf(c.fx,c.fy).grade].speed,roadClasses[nodeOf(c.tx,c.ty).grade].speed);
        c.actualSpeed=speed;
        let nextT = Math.min(c.t + dt * speed, limit);
        // Keep distance from vehicles just after this edge's destination, including queues.
        if (nextT > .70) {
          R.cars.forEach(function (other) {
            if (other === c || other.fx !== c.tx || other.fy !== c.ty) return;
            if (other.tx - other.fx !== c.tx - c.fx || other.ty - other.fy !== c.ty - c.fy) return;
            nextT = Math.min(nextT, Math.max(c.t, 1 + other.t - gap));
          });
        }
        c.t = Math.max(c.t, nextT); c.moved = c.t - before;
        c.waiting = c.moved < dt * speed * .2;
        if (c.t >= 1) { if (!chooseNext(c)) remove.add(c); leader = c.t>.9?c:null; }
        else leader = c;
      });
    });
    if (remove.size) R.cars = R.cars.filter(function (c) { return !remove.has(c); });
    if (sampleClock >= .5) sample();
  }
  function drawRoadFurniture(x, y) {
    const n = nodeOf(x, y); if (!n || cam.z < .38) return;
    const z = cam.z, p = w2s(isoX(x + .5, y + .5), isoY(x + .5, y + .5) + carDY(x, y));
    ctx.save();
    if(n.grade>0){ctx.fillStyle=n.grade===2?'#f6cd69':'#78c9ef';ctx.font='bold '+Math.max(7,8*z)+'px sans-serif';ctx.textAlign='center';ctx.fillText(n.grade===2?'Ⅱ':'Ⅰ',p[0],p[1]+3*z);}
    if (n.nb.length >= 3) {
      const phase = signal(n);
      // Two labelled signal heads: x travel and y travel, matching the actual entry rule.
      ['x', 'y'].forEach(function (axis, i) {
        const sx = p[0] + (i ? 11 : -11) * z, sy = p[1] - 3 * z;
        ctx.strokeStyle = '#c8d5de'; ctx.lineWidth = 1.2 * z;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 12 * z); ctx.stroke();
        ctx.fillStyle = '#15232e'; ctx.fillRect(sx - 2.7 * z, sy - 16 * z, 5.4 * z, 8 * z);
        ctx.fillStyle = phase === axis ? '#58f5a2' : '#ff535a';
        ctx.beginPath(); ctx.arc(sx, sy - 12 * z, 1.8 * z, 0, Math.PI * 2); ctx.fill();
        if (cam.z > .9) { ctx.font = 'bold ' + (6 * z) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(axis.toUpperCase(), sx, sy - 18 * z); }
      });
    }
    if (stops.has(n.k)) {
      const sx = p[0] + 16 * z, sy = p[1] + 3 * z;
      ctx.strokeStyle = '#d7ebf5'; ctx.lineWidth = 1.4 * z;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 12 * z); ctx.stroke();
      ctx.fillStyle = '#149ac5'; ctx.fillRect(sx - 4 * z, sy - 18 * z, 8 * z, 8 * z);
      ctx.fillStyle = '#fff'; ctx.font = 'bold ' + (7 * z) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('B', sx, sy - 11.5 * z);
    }
    ctx.restore();
  }
  function drawBus(c, env) {
    const p = carScreen(c), z = cam.z;
    const angle = Math.atan2((p.dx + p.dy) * TH / 2, (p.dx - p.dy) * TW / 2);
    ctx.save(); ctx.translate(p.s[0], p.s[1] - 2 * z); ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.fillRect(-8 * z, -2 * z, 16 * z, 6 * z);
    ctx.fillStyle = shade('#ffb02e', env.L * .7 + .35); ctx.fillRect(-8 * z, -3.4 * z, 16 * z, 6.8 * z);
    ctx.fillStyle = '#d7f3fc'; ctx.fillRect(-5.8 * z, -2.6 * z, 10.4 * z, 1.8 * z);
    ctx.fillStyle = '#2c5e77';
    for (let i = 0; i < 4; i++) ctx.fillRect((-5.5 + i * 2.7) * z, -.5 * z, 2 * z, 2 * z);
    ctx.fillStyle = '#fff5b5'; ctx.fillRect(6.4 * z, -2.4 * z, 1.2 * z, 4.8 * z);
    ctx.restore();
    if (cam.z > .75) {
      ctx.save(); ctx.font = 'bold ' + Math.max(8, 8 * z) + 'px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe1a0'; if (config.showRouteLabels) ctx.fillText('B' + c.route.id + ' ' + (c.load || 0) + '/' + config.busCapacity + (c.dwell > 0 ? ' · 停靠' : ''), p.s[0], p.s[1] - 10 * z); ctx.restore();
    }
  }
  function fillTraffic(x, y) {
    const n = nodeOf(x, y); if (!n) return null;
    if (!n.nb.length) return 'rgba(255,83,90,.55)';
    const d = density.get(n.k) || 0;
    return d >= 3 ? 'rgba(255,83,90,.55)' : d >= 2 ? 'rgba(255,176,46,.48)' : 'rgba(61,220,132,.24)';
  }
  // Optional extra hook. Not called automatically: road furniture is already depth sorted.
  function drawOverlay() {
    if (!ensure() || R.overlay !== 'traffic') return;
    ctx.save(); ctx.strokeStyle = 'rgba(41,211,255,.7)'; ctx.lineWidth = 2 * cam.z;
    routes.forEach(function (r) {
      ctx.beginPath(); r.path.forEach(function (k, i) {
        const n = nodes.get(k), p = w2s(isoX(n.x + .5, n.y + .5), isoY(n.x + .5, n.y + .5) + carDY(n.x, n.y));
        if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
      }); ctx.stroke();
    }); ctx.restore();
  }
  const labels = {
    roadCount: '道路格数', connectedRoads: '有邻接的道路格', largestComponentRoads: '最大连通片道路格', isolatedRoads: '孤立道路格', components: '路网连通片区',
    intersections: '信号灯路口', cars: '普通车辆', buses: '运营公交', vehicles: '可见车辆合计',
    routes: '往返公交线路', stops: '公交站点', waiting: '等待车辆（含停站）', redWaiting: '红灯等待车辆',
    avgSpeed: '估算均速（视觉刻度）', congestion: '等待车辆占比（%）', busStopVisits: '累计公交停站次数', passengerLoad: '抽象公交载客量', passengerWaiting: '抽象候车人数', busCapacity: '单车容量', cacheEntries: '路径缓存条目',
    graphRebuilds: '路网重建次数', routeRebuilds: '线路重建次数', pathSolves:'加权路径求解次数',pathCacheHits:'路径缓存命中',pathExpanded:'累计路径展开节点',pathBudgetMisses:'有界求解未完成',completedTrips:'完成抽样行程', model: '模拟范围'
  };
  function metricsHTML() {
    return '<dl class="traffic-metrics">' + Object.keys(stats).map(function (k) {
      return '<div><dt>' + labels[k] + '</dt><dd>' + stats[k] + '</dd></div>';
    }).join('') + '</dl>';
  }
  return { stats: stats, labels: labels, metricsHTML: metricsHTML, invalidate: invalidate, ensure: ensure, reset: reset,
    roadClasses:roadClasses,gradeOf:gradeOf,getRoadClass:gradeOf,setRoadClass:setRoadClass,upgradeRoad:upgradeRoad,roadMaintenance:roadMaintenance,
    configure:configure,get config(){return Object.assign({},config);},get selectedRoadClass(){return selectedClass;},
    buildingAccess:buildingAccess,componentOfBuilding:function(b){return buildingAccess(b).component;},
    roadInfo:function(x,y){if(!ensure())return null;const n=nodeOf(x,y);return n?Object.assign({x:x,y:y},roadClasses[n.grade]):null;},
    findPath:function(x1,y1,x2,y2){if(!ensure())return null;const p=weightedPath(key(x1,y1),key(x2,y2));return p?p.map(function(k){const n=nodes.get(k);return [n.x,n.y];}):null;},
    drawOverlay: drawOverlay, drawRoadFurniture: drawRoadFurniture, drawBus: drawBus,
    fillTraffic: fillTraffic, spawn: spawnSafe, updateTarget: syncTarget, update: tick,
    neighbors: function (x, y) {
      if (!ensure()) return [];
      const n = nodeOf(x, y);
      return n ? n.nb.map(function (k) { const q = nodes.get(k); return [q.x, q.y]; }) : [];
    },
    get graph() { ensure(); return { nodes: nodes, components: components }; },
    get routes() { ensure(); return routes; }
  };
})();

// Replace the risky/random-scan traffic functions, while preserving original car art.
roadNeighbors = function (x, y) { return CFTRAFFIC.neighbors(x, y); };
spawnCar = function () { return CFTRAFFIC.spawn(); };
updateCarsTarget = function () { return CFTRAFFIC.updateTarget(); };
updateCars = function (dt) { return CFTRAFFIC.update(dt); };

// Manhattan-connected rasterization: every successive tile is a cardinal neighbour.
// Non-road brushes retain the original Bresenham behaviour.
(function () {
  const previous = lineTiles;
  lineTiles = function (x0, y0, x1, y1, fn) {
    if (R.tool !== 'road') return previous.apply(this, arguments);
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x1 >= x0 ? 1 : -1, sy = y1 >= y0 ? 1 : -1;
    let ix = 0, iy = 0; fn(x0, y0);
    while (ix < dx || iy < dy) {
      if (ix < dx && (iy >= dy || (ix + .5) * dy <= (iy + .5) * dx)) { x0 += sx; ix++; }
      else { y0 += sy; iy++; }
      fn(x0, y0);
    }
  };
})();
(function () {
  const previous = place;
  place = function (id, x, y, opts) {
    const grade=id==='road'?(opts&&Number.isInteger(opts.roadClass)?clamp(opts.roadClass,0,2):opts&&opts.free?0:CFTRAFFIC.selectedRoadClass):0;
    const extra=id==='road'&&!(opts&&opts.free)&&G.diff!=='sandbox'?CFTRAFFIC.roadClasses[grade].upgradeCost:0;
    // Include the ordinary tile/bridge cost when checking the grade surcharge.
    if(extra&&typeof canPlace==='function'){const check=canPlace(id,x,y);if(!check.ok)return check;if(G.money<check.cost+extra)return {ok:false,reason:'资金不足',cost:check.cost+extra};}
    const result = previous.apply(this, arguments);
    if(result&&result.ok){
      if(id==='road'){
        const b=G.grid&&G.grid.b?G.buildings.get(G.grid.b[y*G.N+x]):Array.from(G.buildings.values()).find(function(b){return b.d==='road'&&b.x===x&&b.y===y;});
        if(b)b.roadClass=grade;
        if(extra){G.money-=extra;result.cost=(result.cost||0)+extra;const undo=!(opts&&opts.drag)&&R.undoStack&&R.undoStack[R.undoStack.length-1];if(undo&&undo.kind==='place')undo.cost+=extra;const drag=opts&&opts.drag&&R.dragPlace&&R.dragPlace[R.dragPlace.length-1];if(drag)drag.cost+=extra;}
      }
      CFTRAFFIC.invalidate(id==='road'?'topology':id==='bus'?'routes':'demand');
    }
    return result;
  };
})();
(function () {
  const previous = removeBuilding;
  removeBuilding = function (b) {
    const type = b && b.d, result = previous.apply(this, arguments);
    CFTRAFFIC.invalidate(type==='road'?'topology':type==='bus'?'routes':'demand');
    return result;
  };
})();
(function () {
  const previous = newGame;
  newGame = function () { const result = previous.apply(this, arguments); CFTRAFFIC.reset(); return result; };
})();
(function () {
  const previous = deserialize;
  deserialize = function () { const result = previous.apply(this, arguments); CFTRAFFIC.invalidate(); return result; };
})();
(function () {
  const previous = drawRoad;
  drawRoad = function (x, y, env) {
    CFTRAFFIC.ensure(); previous.apply(this, arguments); CFTRAFFIC.drawRoadFurniture(x, y);
  };
})();
(function () {
  const previous = drawCar;
  drawCar = function (c, env) { if (c.bus) CFTRAFFIC.drawBus(c, env); else previous.apply(this, arguments); };
})();
(function () {
  const previous = overlayFill;
  overlayFill = function (x, y, i, u) {
    if (R.overlay === 'traffic') { CFTRAFFIC.ensure(); return CFTRAFFIC.fillTraffic(x, y); }
    return previous.apply(this, arguments);
  };
})();
if (!OVERLAYS.some(function (o) { return o.id === 'traffic'; })) OVERLAYS.push({
  id: 'traffic', n: '🚦交通', c: '#29d3ff', lo: '畅通', hi: '拥挤 / 孤立',
  grad: 'linear-gradient(90deg,#3ddc84,#ffb02e,#ff535a)'
});
