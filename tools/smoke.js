// Smoke test: opens every tab and sub-page (desktop light + mobile dark), mock Firebase, reports JS errors and horizontal overflow.
// Setup once: cd tools && npm i d3@7.9.0   (playwright is preinstalled)   Run: node tools/smoke.js
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const R = path.resolve(__dirname, '..'); const docs = path.join(R, 'docs');
const d3p = path.join(__dirname, 'node_modules/d3/dist/d3.min.js');
(async () => {
  const b = await chromium.launch(); let bad = 0;
  for (const [w, h, name, scheme] of [[1366, 900, 'desktop', 'light'], [390, 844, 'mobile', 'dark']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    await ctx.route('**/*', (r) => {
      const u = r.request().url();
      if (u.includes('gstatic.com/firebasejs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, 'mockfb', u.split('/').pop())), contentType: 'application/javascript' });
      if (u.includes('d3.min.js') && fs.existsSync(d3p)) return r.fulfill({ body: fs.readFileSync(d3p), contentType: 'application/javascript' });
      if (u.startsWith('http://t/')) {
        const f = path.join(docs, new URL(u).pathname); if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
        let body = fs.readFileSync(f); if (f.endsWith('.html')) body = body.toString().replace(/const FB = \{[^;]*\};/, "const FB = {apiKey:'x'};");
        return r.fulfill({ body, contentType: f.endsWith('json') ? 'application/json' : 'text/html' });
      }
      return r.abort();
    });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
    await p.goto('http://t/index.html'); await p.waitForTimeout(1500);
    for (const v of ['home', 'money', 'invest', 'biz']) {
      await p.click(`.tabs button[data-v=${v}]`); await p.waitForTimeout(200);
      for (const s of await p.$$eval('nav.subnav button', (x) => x.map((y) => y.dataset.s))) {
        await p.click(`nav.subnav button[data-s=${s}]`); await p.waitForTimeout(150);
        /* open every folded group on the page so its content renders too */
        for (const h of await p.$$('.acc-h:not([hidden])[aria-expanded="false"]')) { await h.click(); await p.waitForTimeout(120); }
      }
    }
    await p.click('#fab'); await p.waitForTimeout(100); await p.click('#fab-menu button[data-q=out]'); await p.waitForTimeout(500);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    console.log(name, errs.length ? errs : 'no errors', sw > w ? `OVERFLOW ${sw}px` : 'no overflow'); bad += errs.length + (sw > w);
    await ctx.close();
  }
  await b.close(); process.exit(bad ? 1 : 0);
})();
