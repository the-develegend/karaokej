/** Startup screen shown while the API starts. Driven through window.karaokejSplash. */
export const splashHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
    <title>Karaokej</title>
    <style>
      :root {
        --bg: #14121c;
        --text: #f5f1e6;
        --muted: #a39d8f;
        --border: #3a3546;
        --accent: #e2b84a;
        --accent-light: #ffe08a;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        height: 100%;
        background: var(--bg);
        color: var(--text);
        font: 14px/1.5 'Segoe UI', system-ui, sans-serif;
        user-select: none;
      }
      main {
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 0 40px;
        -webkit-app-region: drag;
      }
      h1 { margin: 0 0 4px; font-size: 24px; font-weight: 700; color: var(--accent-light); }
      .sub { margin: 0 0 24px; color: var(--muted); }
      ol { list-style: none; margin: 0; padding: 0; }
      li { display: flex; align-items: center; gap: 10px; padding: 6px 0; color: var(--muted); }
      li .mark { width: 16px; height: 16px; flex: none; border-radius: 50%; border: 2px solid var(--border); }
      li.active { color: var(--text); }
      li.active .mark { border-color: var(--accent); border-top-color: transparent; animation: spin 0.8s linear infinite; }
      li.done .mark { border-color: var(--accent); background: var(--accent); }
      li .time { margin-left: auto; font-variant-numeric: tabular-nums; }
      .note { margin: 24px 0 0; color: var(--muted); font-size: 12px; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <main>
      <h1>Karaokej</h1>
      <p class="sub">Starting… <span id="elapsed">0s</span></p>
      <ol id="steps"></ol>
      <p class="note" id="note"></p>
    </main>
    <script>
      const started = Date.now();
      const elapsed = document.getElementById('elapsed');
      setInterval(() => {
        elapsed.textContent = Math.floor((Date.now() - started) / 1000) + 's';
      }, 250);

      const list = document.getElementById('steps');
      const rows = new Map();

      // at: epoch ms from the main process, since calls made before this page loaded arrive late.
      window.karaokejSplash = {
        setSteps(steps) {
          list.textContent = '';
          rows.clear();
          for (const { id, label } of steps) {
            const li = document.createElement('li');
            li.innerHTML = '<span class="mark"></span><span class="label"></span><span class="time"></span>';
            li.querySelector('.label').textContent = label;
            list.appendChild(li);
            rows.set(id, { li, startedAt: 0 });
          }
        },
        start(id, at = Date.now()) {
          const row = rows.get(id);
          if (!row) return;
          row.startedAt = at;
          row.li.className = 'active';
        },
        done(id, at = Date.now()) {
          const row = rows.get(id);
          if (!row) return;
          row.li.className = 'done';
          if (row.startedAt) {
            row.li.querySelector('.time').textContent = ((at - row.startedAt) / 1000).toFixed(1) + 's';
          }
        },
        note(text) {
          document.getElementById('note').textContent = text;
        },
      };
    </script>
  </body>
</html>
`;
