// CocoaCut Windows app: audio from page links (YouTube, SoundCloud, ...) for File → Import → From link…
// Ported from CocoaTune's ytdlp.js. Keeps a private, auto-updated copy of yt-dlp in the user data folder
// and saves the best audio stream without re-encoding (no ffmpeg needed), then hands the bytes to the page.
//
// main.js:     require('./link-audio').register();
// preload.js:  add to the existing  contextBridge.exposeInMainWorld('cocoaApp', { ... })  object:
//                audioFromLink: (url, onProgress) => require('./link-audio').call(url, onProgress),
//              (or paste the `call` function body from below into preload.js).
// package.json "build.files": add "link-audio.js".
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');

const CH = 'cocoacut-link-audio';

// ---------- main process ----------
function register() {
  const { app, ipcMain } = require('electron');
  const { spawn } = require('child_process');
  const { Readable } = require('stream');
  const { pipeline } = require('stream/promises');
  const ASSET = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' }[process.platform];
  const binDir = () => path.join(app.getPath('userData'), 'bin');
  const binPath = () => path.join(binDir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const stamp = () => path.join(binDir(), 'last-update');
  const UPDATE_EVERY = 3 * 24 * 3600 * 1000;
  let installing = null;

  const exists = p => fsp.access(p).then(() => true, () => false);
  async function install() {
    if (!ASSET) throw new Error('Saving from page links is not supported on this system');
    await fsp.mkdir(binDir(), { recursive: true });
    const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}`);
    if (!res.ok) throw new Error(`Could not download yt-dlp (${res.status})`);
    const tmp = binPath() + '.part';
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    await fsp.chmod(tmp, 0o755);
    await fsp.rename(tmp, binPath());
    await fsp.writeFile(stamp(), String(Date.now()));
  }
  const ensure = () => installing ||= (async () => { if (!(await exists(binPath()))) await install(); })().finally(() => { installing = null; });

  function run(args, onLine) {
    return new Promise((resolve, reject) => {
      const p = spawn(binPath(), args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, windowsHide: true });
      let err = '';
      const feed = (buf, isErr) => { const t = buf.toString('utf8'); if (isErr) err += t; for (const l of t.split(/\r?\n/)) if (l.trim()) onLine?.(l); };
      p.stdout.on('data', b => feed(b, false));
      p.stderr.on('data', b => feed(b, true));
      p.on('error', reject);
      p.on('close', code => code === 0 ? resolve() : reject(new Error(((err.match(/ERROR:\s*(.+)/) || [])[1] || `yt-dlp exited with code ${code}`).trim())));
    });
  }
  async function update() {
    await ensure();
    const last = Number(await fsp.readFile(stamp(), 'utf8').catch(() => 0));
    if (Date.now() - last < UPDATE_EVERY) return;
    await run(['-U']).catch(() => {});
    await fsp.writeFile(stamp(), String(Date.now()));
  }

  ipcMain.handle(CH, async (e, url, jobId) => {
    let u;
    try { u = new URL(String(url)); } catch { throw new Error('That is not a valid link'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https links are supported');
    await ensure();
    update().catch(() => {});
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cocoacut-'));
    try {
      let out = null;
      await run(['--no-playlist', '--no-warnings', '--newline', '--progress', '--no-simulate',
        '-f', 'bestaudio[ext=m4a]/bestaudio/best', '-o', path.join(dir, 'audio.%(ext)s'),
        '--print', 'after_move:CCUT\t%(title)s\t%(filepath)s', u.href],
      line => {
        const pct = line.match(/\[download\]\s+([\d.]+)%/);
        if (pct && !e.sender.isDestroyed()) e.sender.send(CH + ':progress', jobId, Number(pct[1]) / 100);
        if (line.startsWith('CCUT\t')) { const [, title, fp] = line.split('\t'); out = { title, fp }; }
      });
      if (!out) throw new Error('No audio was found at that link');
      const data = await fsp.readFile(out.fp);
      const name = `${(out.title || u.hostname).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}${path.extname(out.fp)}`;
      return { name, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    } finally {
      fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

// ---------- preload ----------
let seq = 0;
function call(url, onProgress) {
  const { ipcRenderer } = require('electron');
  const id = ++seq;
  const h = (_, j, p) => { if (j === id && typeof onProgress === 'function') onProgress(p); };
  ipcRenderer.on(CH + ':progress', h);
  return ipcRenderer.invoke(CH, url, id).finally(() => ipcRenderer.removeListener(CH + ':progress', h));
}

module.exports = { register, call };
