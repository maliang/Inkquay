const { BASE, launch, attachConsole, makeCtx, shot, saveLog } = require('./lib.cjs');

(async () => {
  const ctx = makeCtx();
  const { log, setStep } = ctx;
  const { browser, page } = await launch({ width: 1440, height: 900 });
  attachConsole(page, ctx);
  const text = (sel) => page.locator(sel).first().innerText();
  const count = (sel) => page.locator(sel).count();

  try {
    /* 1. 设定库搜索词与 tab 切换 */
    setStep('codex-search-tab');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.rail-btn[data-nav="codex"]');
    await page.waitForTimeout(350);
    await page.fill('#codexSearch', '不存在的角色');
    await page.waitForTimeout(250);
    await page.click('.codex-tabs [data-codex-tab="locations"]');
    await page.waitForTimeout(300);
    const locVisible = await page.evaluate(() => ({
      query: document.querySelector('#codexSearch').value,
      visibleLocations: Array.from(document.querySelectorAll('#locationGrid .entity-card')).filter((c) => getComputedStyle(c).display !== 'none').length,
      totalLocations: document.querySelectorAll('#locationGrid .entity-card').length,
    }));
    log('无匹配搜索词下切到「地点」应为 0，实际未过滤', locVisible.visibleLocations === 0 ? 'pass' : 'fail', locVisible);
    await shot(page, 'BUG-codex-search-tab-1440');
    await page.click('.codex-tabs [data-codex-tab="characters"]');
    await page.waitForTimeout(250);
    const charsAfter = await page.evaluate(() => ({
      visibleChars: Array.from(document.querySelectorAll('.char-card')).filter((c) => getComputedStyle(c).display !== 'none').length,
      query: document.querySelector('#codexSearch').value,
    }));
    log('返回人物 tab 时旧过滤仍然生效（与搜索框一致）', charsAfter.visibleChars === 0 ? 'pass' : 'fail', charsAfter);
    await page.fill('#codexSearch', '');

    /* 2. 大纲 tooltip 位置与 beat 联动 */
    setStep('outline-tooltip');
    await page.click('.rail-btn[data-nav="outline"]');
    await page.waitForTimeout(350);
    const tipBefore = await page.evaluate(() => {
      const r = document.querySelector('#chartTooltip').getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), text: document.querySelector('#chartTooltip span').textContent };
    });
    await page.click('.beat[data-beat="19"]');
    await page.waitForTimeout(300);
    const tipAfter = await page.evaluate(() => {
      const r = document.querySelector('#chartTooltip').getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), text: document.querySelector('#chartTooltip span').textContent, tension: document.querySelector('#chartTooltip strong').textContent };
    });
    log('切换 beat 后图表 tooltip 位置跟随选中章节', tipBefore.left !== tipAfter.left || tipBefore.top !== tipAfter.top ? 'pass' : 'fail', { tipBefore, tipAfter });
    await shot(page, 'outline-tooltip-beat19-1440');

    /* 3. 批注浮层跨章节残留 */
    setStep('annotation-residue');
    await page.click('.rail-btn[data-nav="studio"]');
    await page.waitForTimeout(400);
    await page.click('.annotation-pin');
    await page.waitForTimeout(250);
    const annoOpen = await page.evaluate(() => !document.querySelector('#annotationPop').hidden);
    await page.click('[data-chapter="ch8"]');
    await page.waitForTimeout(400);
    const annoAfterChapter = await page.evaluate(() => ({
      popHidden: document.querySelector('#annotationPop').hidden,
      chapter: document.querySelector('#chapterTitle').textContent,
      markExists: !!document.querySelector('.mark'),
    }));
    log('切章节后批注浮层应关闭（无残留）', annoOpen && annoAfterChapter.popHidden ? 'pass' : 'fail', { annoOpen, annoAfterChapter });
    if (!annoAfterChapter.popHidden) await shot(page, 'BUG-annotation-residue-1440');
    await page.keyboard.press('Escape');

    /* 4. AI 面板收起状态跨项目保留 */
    setStep('ai-collapse-persist');
    await page.click('[data-action="toggleAI"]');
    await page.waitForTimeout(300);
    const collapsedFog = await page.evaluate(() => document.querySelector('.studio').classList.contains('ai-hidden'));
    await page.click('.rail-btn[data-nav="library"]');
    await page.waitForTimeout(300);
    await page.click('.project-card[data-project="ferry"]');
    await page.waitForTimeout(450);
    const collapsedFerry = await page.evaluate(() => ({
      aiHidden: document.querySelector('.studio').classList.contains('ai-hidden'),
      aiDisplay: getComputedStyle(document.querySelector('#aiPanel')).display,
      toolbarToggle: !!document.querySelector('.doc-toolbar [data-action="toggleAI"]'),
    }));
    log('切换作品后 AI 面板收起状态保留（需再次点击工具栏）', collapsedFerry.aiHidden && collapsedFerry.toolbarToggle ? 'info' : 'fail', { collapsedFog, collapsedFerry });
    await page.click('.doc-toolbar [data-action="toggleAI"]');
    await page.waitForTimeout(300);

    /* 5. 作品菜单：Esc / 外部点击 */
    setStep('project-menu');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(350);
    const popSel = '.popover:not(#modelPopover)';
    await page.click('[data-panel="studio"] [data-action="projectMenu"]');
    await page.waitForTimeout(250);
    log('作品菜单打开', (await page.locator(popSel).count()) === 1 ? 'pass' : 'fail', { count: await page.locator(popSel).count() });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const menuAfterEsc = await page.locator(popSel).count();
    log('Esc 关闭作品菜单', menuAfterEsc === 0 ? 'pass' : 'fail', { menuAfterEsc });
    if (menuAfterEsc > 0) await shot(page, 'BUG-project-menu-esc-1440b');
    await page.click('.rail-btn[data-nav="library"]');
    await page.waitForTimeout(300);
    const menuAfterNav = await page.locator(popSel).count();
    log('点击其他区域/导航后作品菜单关闭', menuAfterNav === 0 ? 'pass' : 'fail', { menuAfterNav });

    /* 6. 向导：自定义标题与步骤 3 完成态文案 */
    setStep('wizard-title-sync');
    await page.click('.lib-head [data-open="newProject"]');
    await page.waitForTimeout(250);
    await page.fill('#newTitle', '自定义书名甲');
    await page.click('#wizardNext');
    await page.waitForTimeout(1500);
    const propTitle = await text('.proposal__head h3');
    await page.click('#wizardNext');
    await page.waitForTimeout(300);
    const createdText = await text('.created-state p');
    const hint = await text('#wizardHint');
    log('步骤 3 完成态显示的标题与方案标题一致', createdText.includes(propTitle) ? 'pass' : 'fail', { propTitle, createdText, hint });
    await shot(page, 'BUG-wizard-title-mismatch-1440');
    await page.keyboard.press('Escape');

    /* 7. 向导 loading 期间 Esc 关闭再打开 */
    setStep('wizard-race');
    await page.click('.lib-head [data-open="newProject"]');
    await page.waitForTimeout(200);
    await page.click('#wizardNext');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    await page.click('.lib-head [data-open="newProject"]');
    await page.waitForTimeout(300);
    const race = await page.evaluate(() => ({
      step: document.querySelector('.wizard-step.is-active span')?.textContent,
      loadingHidden: document.querySelector('#wizardLoading').hidden,
      proposalHidden: document.querySelector('#wizardProposal').hidden,
    }));
    log('loading 中关闭后重开：仍是干净的步骤 1', race.step === '01' && !race.loadingHidden && race.proposalHidden ? 'pass' : 'fail', race);
    await page.keyboard.press('Escape');

    /* 8. 写作台：导出后焦点/滚动、替换选中提示 */
    setStep('studio-misc');
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(350);
    const replaceBefore = await count('.toast');
    await page.click('[data-action="replaceAI"]');
    await page.waitForTimeout(200);
    log('「替换选中」未选中时给出提示', (await count('.toast')) > replaceBefore ? 'pass' : 'fail');
    await page.click('[data-action="rewriteAI"]');
    await page.waitForTimeout(200);
    log('「更克制」给出提示', (await count('.toast')) > 0 ? 'pass' : 'fail');
    // 新建章节按钮的章号与卷
    const beforeCount = await page.evaluate(() => document.querySelectorAll('.chapter-item[data-chapter]').length);
    await page.click('.panel-foot [data-action="newChapter"]');
    await page.waitForTimeout(350);
    const newCh = await page.evaluate(() => {
      const act = document.querySelector('.chapter-item.is-active');
      const vol = Array.from(document.querySelectorAll('.tree-volume')).map((v) => v.textContent.trim());
      return {
        no: document.querySelector('#chapterNo').textContent,
        vol: document.querySelector('#chapterVol').textContent,
        treeNo: act?.querySelector('.chapter-item__no')?.textContent,
        title: document.querySelector('.chapter-item.is-active .chapter-item__title')?.textContent,
        volumeHeaders: vol,
        items: document.querySelectorAll('.chapter-item[data-chapter]').length,
      };
    });
    log('新建章节章号应为第 10 章（现有 9 章）', newCh.no === '第十章' ? 'pass' : 'fail', newCh);
    log('新建章节卷号应与相邻章一致（第二卷）', newCh.vol.includes('第二卷') ? 'pass' : 'fail', { vol: newCh.vol });
    log('新建章节标题应为未命名章节', newCh.title === '未命名章节' ? 'pass' : 'fail', { title: newCh.title });
    await shot(page, 'BUG-new-chapter-numbering-1440');

    setStep('console');
    log('控制台无 error', ctx.consoleErrors.filter((e) => e.type === 'error' || e.type === 'pageerror').length === 0 ? 'pass' : 'fail', {
      errors: ctx.consoleErrors.filter((e) => e.type === 'error' || e.type === 'pageerror'),
    });
  } catch (err) {
    log('脚本异常中止', 'fail', { step: ctx.getStep(), message: err.message, stack: (err.stack || '').split('\n').slice(0, 5) });
    await shot(page, 'D-ABORT-' + ctx.getStep());
  } finally {
    saveLog('d-extra', { results: ctx.results, console: ctx.consoleErrors });
    await browser.close();
  }
})();
