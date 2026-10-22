const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/maliang/Documents/develop/maliang/私家写手';
const SHOTS = path.join(ROOT, 'qa/shots');
const LOGS = path.join(ROOT, 'qa/logs');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(LOGS, { recursive: true });

const BASE = 'http://127.0.0.1:4173/';

function makeCtx() {
  const results = [];
  const consoleErrors = [];
  let step = 'init';
  const log = (name, status, detail) => {
    results.push({ step, name, status, detail });
    const mark = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'INFO';
    console.log(`${mark} [${step}] ${name}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
  };
  return { results, consoleErrors, log, setStep: (s) => (step = s), getStep: () => step };
}

async function launch(viewport = { width: 1440, height: 900 }) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  return { browser, page };
}

function attachConsole(page, ctx) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      ctx.consoleErrors.push({ step: ctx.getStep(), type: m.type(), text: m.text() });
    }
  });
  page.on('pageerror', (e) => {
    ctx.consoleErrors.push({ step: ctx.getStep(), type: 'pageerror', text: e.message });
  });
}

async function shot(page, name) {
  const p = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: p });
  return `qa/shots/${name}.png`;
}

function saveLog(name, data) {
  fs.writeFileSync(path.join(LOGS, `${name}.json`), JSON.stringify(data, null, 2));
}

module.exports = { BASE, SHOTS, ROOT, launch, attachConsole, makeCtx, shot, saveLog };
