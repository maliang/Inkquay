const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'shots-visual');
fs.mkdirSync(OUT, { recursive: true });

const BASE = 'http://127.0.0.1:4173/';

async function shot(page, name) {
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('shot', name);
}

async function metrics(page, view, size) {
  return await page.evaluate(({ view, size }) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const small = [];
    const all = document.querySelectorAll('.view.is-active *');
    for (const el of all) {
      if (!vis(el)) continue;
      // only leaf-ish text nodes
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join('')
        .trim();
      if (!ownText) continue;
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      if (fs <= 10.6) {
        small.push({
          sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
          text: ownText.slice(0, 26),
          fs: +fs.toFixed(1),
          lh: cs.lineHeight,
          color: cs.color,
          w: Math.round(el.getBoundingClientRect().width),
          h: Math.round(el.getBoundingClientRect().height),
        });
      }
    }
    // horizontal overflow inside scroll containers
    const overflows = [];
    document.querySelectorAll('.view.is-active *, .panel, .ai-panel, .topbar').forEach((el) => {
      if (!vis(el)) return;
      if (el.scrollWidth - el.clientWidth > 2 && getComputedStyle(el).overflowX !== 'visible') {
        overflows.push({
          sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
          sw: el.scrollWidth,
          cw: el.clientWidth,
        });
      }
    });
    // vertical scroll containers and their fill ratio
    const scrolls = [];
    document.querySelectorAll('.view.is-active *, .panel, .ai-panel').forEach((el) => {
      if (!vis(el)) return;
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) {
        scrolls.push({
          sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
          sh: el.scrollHeight,
          ch: el.clientHeight,
        });
      }
    });
    const text = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        fs: cs.fontSize, lh: cs.lineHeight, ff: cs.fontFamily.split(',')[0], fw: cs.fontWeight,
        color: cs.color, ls: cs.letterSpacing,
        w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
      };
    };
    const box = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      view, size, small,
      overflows, scrolls,
      key: {
        rail: box('.rail'), panel: box('.panel'), topbar: box('.topbar'),
        docPane: box('.doc-pane'), doc: box('.doc'), docTitle: text('.doc-title'),
        editor: text('.editor'), aiPanel: box('.ai-panel'),
        libHead: text('.lib-head h1'), statLabel: text('.stat-card__label'),
        viewH1: text('.view-head h1'), viewSub: text('.view-sub'),
        scriptPage: box('.script-page'), inspector: box('.script-inspector'),
        modal: box('.modal:not([hidden])'),
      },
    };
  }, { view, size });
}

(async () => {
  const browser = await chromium.launch();
  const results = [];

  for (const size of [{ w: 1440, h: 900 }, { w: 1280, h: 800 }]) {
    const ctx = await browser.newContext({
      viewport: { width: size.w, height: size.h },
      deviceScaleFactor: 2,
      locale: 'zh-CN',
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const tag = `${size.w}`;

    await shot(page, `01-library-${tag}`);
    results.push(await metrics(page, 'library', tag));

    for (const [view, n] of [['studio', '02'], ['outline', '03'], ['codex', '04'], ['screenplay', '05']]) {
      await page.click(`.rail-btn[data-nav="${view}"]`);
      await page.waitForTimeout(320);
      await shot(page, `${n}-${view}-${tag}`);
      results.push(await metrics(page, view, tag));
    }

    // boards
    await page.click('[data-script-mode="boards"]');
    await page.waitForTimeout(400);
    await shot(page, `06-boards-${tag}`);
    results.push(await metrics(page, 'screenplay', tag));

    // back to script mode, continuity check tab in studio
    await page.click('[data-script-mode="script"]');
    await page.click('.rail-btn[data-nav="studio"]');
    await page.waitForTimeout(300);
    await page.click('[data-ai-tab="check"]');
    await page.waitForTimeout(400);
    await shot(page, `07-studio-check-${tag}`);
    await page.click('[data-ai-tab="write"]');

    // wizard step 1
    await page.click('.rail-btn[data-nav="library"]');
    await page.waitForTimeout(250);
    await page.click('.btn--primary[data-open="newProject"]');
    await page.waitForTimeout(450);
    await shot(page, `08-wizard-${tag}`);

    // wizard proposal
    await page.click('#wizardNext');
    await page.waitForTimeout(2200);
    await shot(page, `09-proposal-${tag}`);

    await ctx.close();
  }

  // Extra: 1440 modal export + outline deep scroll + codex foreshadow
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Export modal from library? find trigger
  await page.click('.rail-btn[data-nav="codex"]');
  await page.waitForTimeout(300);
  await page.click('[data-codex-cat="foreshadow"]');
  await page.waitForTimeout(400);
  await shot(page, '10-codex-foreshadow-1440');

  // studio scrolled to editor bottom
  await page.click('.rail-btn[data-nav="studio"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const d = document.querySelector('#docScroll');
    if (d) d.scrollTop = d.scrollHeight;
  });
  await page.waitForTimeout(350);
  await shot(page, '11-studio-bottom-1440');

  await ctx.close();
  await browser.close();

  fs.writeFileSync(path.join(__dirname, 'metrics-visual.json'), JSON.stringify(results, null, 2));
  console.log('done');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
