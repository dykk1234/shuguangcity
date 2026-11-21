const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334, HTTP_PORT = 8766;
const OUT = 'out/' + (process.env.OUT || 'cap');
const FILE = process.env.FILE || 'build/曙光城4.1-test.html';
const PROFILE = path.join(ROOT, '..', '.edge');
const ROOT = __dirname;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT) || !fs.existsSync(full)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});
let proc = null;
function cleanup(code) { try { if (proc) proc.kill(); } catch (e) { } try { server.close(); } catch (e) { } process.exitCode = code; }

(async () => {
  await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));
  proc = spawn(EDGE, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-features=Translate',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let tabs = null;
  for (let i = 0; i < 50; i++) { try { tabs = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); if (tabs.filter(t => t.type === 'page').length) break; } catch (e) { } await sleep(400); }
  const page = (tabs || []).filter(t => t.type === 'page')[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.reject(m.error) : q.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push(d.exception ? (d.exception.description || d.exception.value) : d.text); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  async function ev(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error('EVAL: ' + JSON.stringify(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails)); return r.result.value; }
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + HTTP_PORT + '/' + encodeURIComponent(FILE) + '?bench=1' });
  for (let i = 0; i < 30; i++) { await sleep(500); if (await ev('!!window.CFTEST').catch(() => false)) break; }

  console.log('CITY', await ev('JSON.stringify(CFTEST.buildCity(96,7))'));
  const br = JSON.parse(await ev('JSON.stringify(CFTEST.buildBridge())'));
  console.log('BR', JSON.stringify(br));
  // 隐藏右侧面板，便于比对画面
  await ev('(function(){document.body.classList.add("panel-closed");var p=document.getElementById("proDashboard");if(p)p.classList.remove("open");return 1})()');
  const shots = [
    ['mid', 48, 48, 1],
    ['bridge', br.x + .5, (br.y0 + br.y1) / 2 + .5, 1.25],
    ['deck', br.x + .5, (br.y0 + br.y1) / 2 + .5, 2.2],
    ['wide', 48, 48, .62]
  ];
  for (const [name, tx, ty, z] of shots) {
    await ev('CFTEST.centerTile(' + tx + ',' + ty + ',' + z + ')');
    await sleep(500);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + '-' + name + '.png', Buffer.from(shot.data, 'base64'));
  }
  // 调试 A：地面强制洋红 —— 判断“地面填充是否执行”
  await ev('window.CFDEBUG_DB=1');
  await ev('CFTEST.centerTile(48,48,1)'); await sleep(400);
  console.log('GA_DB', await ev('JSON.stringify(CFPERF41)'));
  const shotDb = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '-db.png', Buffer.from(shotDb.data, 'base64'));
  await ev('window.CFDEBUG_DB=0');
  // 调试 B：每次填地之前重置 globalAlpha=1 —— 判断“是否 alpha 泄漏”
  await ev('window.CFDEBUG_ALPHA=1');
  await ev('CFTEST.centerTile(48,48,1)'); await sleep(400);
  const shotFx = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '-afix.png', Buffer.from(shotFx.data, 'base64'));
  await ev('window.CFDEBUG_ALPHA=0');
  console.log('ERRORS', errors.length ? errors.slice(0, 5) : 'none');
  ws.close(); cleanup(0);
})().catch(e => { console.error('FAILED', e); cleanup(1); });
