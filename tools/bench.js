const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333, HTTP_PORT = 8765;
const OUT = 'out/' + (process.env.OUT || 'v41');
const FILE = process.env.FILE || 'build/曙光城4.1-test.html';
const PROFILE = 'path.join(ROOT, '..', '.edge');
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
function cleanup(code) {
  try { if (proc) proc.kill(); } catch (e) { }
  try { server.close(); } catch (e) { }
  process.exitCode = code;
}

(async () => {
  await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));

  proc = spawn(EDGE, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-features=Translate',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,900',
    '--hide-scrollbars', 'about:blank'
  ], { stdio: 'ignore' });

  let tabs = null;
  for (let i = 0; i < 50; i++) {
    try { tabs = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); if (tabs.filter(t => t.type === 'page').length) break; } catch (e) { }
    await sleep(400);
  }
  const page = (tabs || []).filter(t => t.type === 'page')[0];
  if (!page) throw Error('没有可用的页面目标');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.reject(m.error) : q.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text); }
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(JSON.stringify(m.params.args.map(a => a.value || a.description)));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  async function ev(expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error('EVAL: ' + JSON.stringify(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails));
    return r.result.value;
  }
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const url = 'http://127.0.0.1:' + HTTP_PORT + '/' + encodeURIComponent(FILE) + '?bench=1';
  await send('Page.navigate', { url });
  for (let i = 0; i < 30; i++) { await sleep(500); const ok = await ev('!!window.CFTEST').catch(() => false); if (ok) break; }
  console.log('BOOT', await ev('JSON.stringify({href:location.href,title:document.title,canvas:!!document.querySelector("#view"),seam:!!window.CFTEST})').catch(e => String(e)));

  const result = await ev('CFTEST.run()');
  fs.writeFileSync(OUT + '-checks.json', result);
  const parsed = JSON.parse(result);
  console.log('CHECKS\n  ' + parsed.checks.map(c => (c.pass ? 'PASS ' : 'FAIL ') + c.test).join('\n  '));
  console.log('CITY', JSON.stringify(parsed.city));
  console.log('BRIDGE', JSON.stringify(parsed.bridge));

  if (parsed.bridge) {
    await ev('CFTEST.centerTile(' + (parsed.bridge.x + .5) + ',' + ((parsed.bridge.y0 + parsed.bridge.y1) / 2 + .5) + ',1.15)');
  }
  await sleep(400);
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '-bridge.png', Buffer.from(shot1.data, 'base64'));

  await ev('CFTEST.zoom(.55)');
  await ev('CFTEST.centerMap(.55)');
  await sleep(400);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '-city.png', Buffer.from(shot2.data, 'base64'));

  const bench = await ev('JSON.stringify(CFTEST.benchSuite(40))');
  fs.writeFileSync(OUT + '-bench.json', bench);
  const bj = JSON.parse(bench);
  console.log('BENCH render', JSON.stringify(bj.render), '\n      updateRender', JSON.stringify(bj.updateRender), '\n      perf', JSON.stringify(bj.perf));
  console.log('PROFILE', await ev('JSON.stringify([CFTEST.profile(.45),CFTEST.profile(.8)])'));
  await ev('CFTEST.centerTile(' + (parsed.bridge ? (parsed.bridge.x + .5) : 48) + ',' + (parsed.bridge ? ((parsed.bridge.y0 + parsed.bridge.y1) / 2 + .5) : 48) + ',1.15)');
  console.log('PROBE', await ev('JSON.stringify([CFTEST.probe(420,600),CFTEST.probe(720,600),CFTEST.probe(720,300),CFTEST.probe(1100,700)])'));
  if (parsed.bridge) {
    console.log('BRIDGE-PROBE', await ev('(function(){var b=' + JSON.stringify(parsed.bridge) + ';CFTEST.centerTile(b.x+.5,(b.y0+b.y1)/2+.5,1.15);var p=CFTEST.screenOf(b.x,(b.y0+b.y1)/2+(b.y0+b.y1>0?0:0),0);var row=[];for(var k=0;k<6;k++){row.push(CFTEST.probe(720,300+k*14))}var mid=CFTEST.probe(720,300);return JSON.stringify({mid:mid,row:row})})()'));
  }
  console.log('TYPES', await ev('JSON.stringify(CFTEST.typeCounts())'));
  console.log('ERRORS', errors.length ? errors.slice(0, 6) : 'none');

  ws.close();
  cleanup(0);
})().catch(e => { console.error('FAILED', e); cleanup(1); });
