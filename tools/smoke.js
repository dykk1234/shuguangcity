const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335, HTTP_PORT = 8767, ROOT = __dirname;
const FILE = process.env.FILE || '曙光城_CITYFORGE_4.1_水上桥修复版.html';
const OUT = process.env.OUT || 'v41-test/smoke';
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const full = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, ''));
  if (!full.startsWith(ROOT) || !fs.existsSync(full)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});
let proc = null;
function cleanup(c) { try { proc && proc.kill(); } catch (e) { } try { server.close(); } catch (e) { } process.exitCode = c; }
(async () => {
  await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));
  proc = spawn(EDGE, ['--headless=new', '--no-first-run', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + ROOT + '\\edge-profile-smoke', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let tab = null;
  for (let i = 0; i < 50; i++) { try { const t = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); tab = t.filter(x => x.type === 'page')[0]; if (tab) break; } catch (e) { } await sleep(400); }
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let seq = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.reject(m.error) : q.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errs.push(d.exception ? (d.exception.description || d.exception.value) : d.text); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); if (r.exceptionDetails) throw Error('EVAL ' + JSON.stringify(r.exceptionDetails.exception)); return r.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + HTTP_PORT + '/' + encodeURIComponent(FILE) });
  await sleep(2500);
  console.log('TITLE', await ev('document.title'));
  console.log('GLOBALS', await ev('JSON.stringify({seam:!!window.CFTEST,bridge:!!window.CFBRIDGE,perf:!!window.CFPERF41,canvas:!!document.getElementById("view")})'));
  // 通过开始界面进入游戏：默认「新游戏」按钮即 sandbox/普通难度，直接调用 play 流程不可见，改用点击
  await ev('(function(){var b=[...document.querySelectorAll("button")].find(function(x){return /新游戏|开始|创建/.test(x.textContent)});if(b){b.click();return b.textContent}return null})()');
  await sleep(1800);
  await ev('(function(){var b=[...document.querySelectorAll("button")].find(function(x){return /开始建设|确认|创建城市|进入城市/.test(x.textContent)});if(b){b.click();return b.textContent}return null})()');
  await sleep(2500);
  console.log('SCREEN', await ev('JSON.stringify({start:typeof SCREEN!=="undefined"?1:0,hud:!!document.querySelector("#gameUI"),perf:window.CFPERF41?CFPERF41.tiles:null})').catch(e => 'n/a'));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '.png', Buffer.from(shot.data, 'base64'));
  console.log('ERRORS', errs.length ? errs.slice(0, 4) : 'none');
  ws.close(); cleanup(0);
})().catch(e => { console.error('FAILED', e && e.message); cleanup(1); });
