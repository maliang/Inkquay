const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://127.0.0.1:4173/';
const OUT = '/Users/maliang/Documents/develop/maliang/私家写手/qa/shots';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/probe-library-1440.png` });

  const views = ['studio', 'outline', 'codex', 'screenplay'];
  for (const v of views) {
    await page.click(`.rail-btn[data-nav="${v}"]`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/probe-${v}-1440.png` });
  }

  const dims = await page.evaluate(() => ({
    iw: innerWidth,
    sw: document.documentElement.scrollWidth,
    bw: document.body.scrollWidth,
  }));
  console.log('dims', dims);
  console.log('errors', errors);
  await browser.close();
})();
