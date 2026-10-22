const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', 'screenshots');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '01-library.png') });
  await page.screenshot({ path: path.join(OUT, '01-library-full.png'), fullPage: true });

  await page.click('.project-card[data-project="fog"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '02-studio.png') });

  await page.click('#topbarTabs [data-nav="outline"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '03-outline.png') });

  await page.click('#topbarTabs [data-nav="codex"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '04-codex.png') });

  await page.click('.rail-btn[data-nav="screenplay"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '05-screenplay.png') });
  await page.click('[data-script-mode="boards"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '06-storyboards.png') });

  await page.click('.rail-btn[data-nav="library"]');
  await page.waitForTimeout(500);
  await page.click('[data-open="newProject"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '07-wizard.png') });
  await page.click('#wizardNext');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, '08-proposal.png') });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('.project-card[data-project="fog"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '09-studio-1280.png') });

  console.log('errors:', errors.length ? errors : 'none');
  console.log('screenshots:', fs.readdirSync(OUT).join(', '));
  await browser.close();
})();
