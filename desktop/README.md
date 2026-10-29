# Desktop pieces for CocoaCut

`link-audio.js` adds page links (YouTube, SoundCloud and other sites yt-dlp supports) to **Import → From link…** in the Windows app. It is ported from CocoaTune's `ytdlp.js`: a private copy of yt-dlp is downloaded on first use and refreshed every few days, and the best audio stream is saved without re-encoding.

`release-1.5.1.patch` applies steps 2 and 3 to the 1.5.1 Windows release's `main.js` and `preload.js` (`patch -p1` from the app folder), or apply the steps by hand:

1. Copy `link-audio.js` next to the app's `main.js`.
2. In `main.js`: `require('./link-audio').register();`
3. In `preload.js`, inside the existing `contextBridge.exposeInMainWorld('cocoaApp', { … })`, add (sandboxed preloads can't `require` local files, so it is written out in full):

   ```js
   audioFromLink: (url, onProgress) => {
     const id = Math.random().toString(36).slice(2);
     const h = (_, j, p) => { if (j === id && typeof onProgress === 'function') onProgress(p); };
     ipcRenderer.on('cocoacut-link-audio:progress', h);
     return ipcRenderer.invoke('cocoacut-link-audio', url, id).finally(() => ipcRenderer.removeListener('cocoacut-link-audio:progress', h));
   },
   ```
4. Add `"link-audio.js"` to `build.files` in `package.json`.

The page detects `window.cocoaApp.audioFromLink` and uses it automatically; without it, direct file links, Google Drive and Yandex Disk links still work and page links show a clear message.

Only save audio you have the right to use. Many sites, including YouTube, restrict downloading in their terms of service.

## Reinstall notice

`preload.js` sets `cocoaApp.shell` (now `2`; older apps don't set it). When a page update needs a new `main.js` or `preload.js`, raise `NEED` and `VER` in the reinstall-notice script at the end of `editor.html` and `shell` in `preload.js`. Older apps then show a "Reinstall needed" banner linking to the latest release.
