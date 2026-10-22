const { BASE, launch, attachConsole, makeCtx, shot, saveLog } = require('./lib.cjs');

(async () => {
  const ctx = makeCtx();
  const { log, setStep } = ctx;
  const { browser, page } = await launch({ width: 1440, height: 900 });
  attachConsole(page, ctx);

  const activeView = () => page.evaluate(() => document.querySelector('.view.is-active')?.dataset.view);
  const text = (sel) => page.locator(sel).first().innerText();
  const count = (sel) => page.locator(sel).count();

  try {
    /* ================= 新建向导 ================= */
    setStep('wizard');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.lib-head [data-open="newProject"]');
    await page.waitForTimeout(300);
    const w1 = await page.evaluate(() => ({
      modal: !document.querySelector('#newProjectModal').hidden,
      overlay: !document.querySelector('#overlay').hidden,
      step: document.querySelector('.wizard-step.is-active span')?.textContent,
      type: document.querySelector('.type-option.is-active')?.dataset.type,
      backHidden: document.querySelector('#wizardBack').hidden,
      bodyVisible: !document.querySelector('.wizard-body[data-wizard-step="1"]').hidden,
      hint: document.querySelector('#wizardHint').textContent,
    }));
    log('新建作品弹窗打开=步骤 1、默认长篇', w1.modal && w1.step === '01' && w1.type === 'novel' && w1.backHidden ? 'pass' : 'fail', w1);
    await shot(page, 'wizard-step1-1440');

    // 四类体裁
    for (const t of ['short', 'script', 'series', 'novel']) {
      await page.click(`.type-option[data-type="${t}"]`);
      await page.waitForTimeout(100);
      const active = await page.evaluate(() => document.querySelector('.type-option.is-active')?.dataset.type);
      const activeCount = await page.evaluate(() => document.querySelectorAll('.type-option.is-active').length);
      log(`体裁「${t}」单选生效`, active === t && activeCount === 1 ? 'pass' : 'fail', { active, activeCount });
    }

    // chips
    await page.click('#toneOptions .chip:nth-child(2)');
    await page.click('#lengthOptions .chip:nth-child(1)');
    await page.waitForTimeout(150);
    const chips = await page.evaluate(() => ({
      tone: document.querySelector('#toneOptions .is-active')?.textContent,
      toneCount: document.querySelectorAll('#toneOptions .is-active').length,
      length: document.querySelector('#lengthOptions .is-active')?.textContent,
      lengthCount: document.querySelectorAll('#lengthOptions .is-active').length,
    }));
    log('语气/体量 chips 单选', chips.tone === '冷峻克制' && chips.length === '8 万字' && chips.toneCount === 1 && chips.lengthCount === 1 ? 'pass' : 'fail', chips);

    // 填写并生成
    await page.fill('#newTitle', '雾中灯塔测试');
    await page.fill('#newPremise', '一个守塔人在雾里收到自己的来信。');
    await page.click('#wizardNext');
    await page.waitForTimeout(250);
    const loading = await page.evaluate(() => ({
      step: document.querySelector('.wizard-step.is-active span')?.textContent,
      done: document.querySelectorAll('.wizard-step.is-done').length,
      loadingHidden: document.querySelector('#wizardLoading').hidden,
      proposalHidden: document.querySelector('#wizardProposal').hidden,
      nextLabel: document.querySelector('#wizardNext').textContent.trim(),
      nextDisabled: document.querySelector('#wizardNext').disabled,
    }));
    log('步骤 2：loading 可见、方案隐藏', loading.step === '02' && !loading.loadingHidden && loading.proposalHidden ? 'pass' : 'fail', loading);
    await shot(page, 'wizard-loading-1440');

    // loading 期间点下一步反馈
    const beforeBlockedClick = await page.evaluate(() => document.querySelector('.wizard-step.is-active span')?.textContent);
    await page.click('#wizardNext');
    await page.waitForTimeout(200);
    const blockedClick = await page.evaluate(() => ({
      step: document.querySelector('.wizard-step.is-active span')?.textContent,
      disabled: document.querySelector('#wizardNext').disabled,
      toast: document.querySelectorAll('.toast').length,
    }));
    log('loading 中「采用方案」按钮无 loading 禁用态且点击无提示', blockedClick.disabled === false && blockedClick.toast === 0 ? 'pass' : 'fail', blockedClick);
    if (blockedClick.toast === 0 && blockedClick.step === beforeBlockedClick) await shot(page, 'BUG-wizard-loading-click-1440');

    await page.waitForTimeout(1400);
    const proposal = await page.evaluate(() => ({
      loadingHidden: document.querySelector('#wizardLoading').hidden,
      proposalHidden: document.querySelector('#wizardProposal').hidden,
      title: document.querySelector('.proposal__head h3').textContent,
      premise: document.querySelector('.proposal__head p').textContent,
      candidate: document.querySelector('.proposal__head .tag').textContent,
      nextLabel: document.querySelector('#wizardNext').textContent.trim(),
    }));
    log('1.3s 后展示 AI 方案', !proposal.proposalHidden && proposal.loadingHidden ? 'pass' : 'fail', proposal);
    log('方案标题采用用户输入', proposal.title === '雾中灯塔测试' ? 'pass' : 'fail', { title: proposal.title });
    log('方案灵感采用用户输入', proposal.premise.includes('守塔人') ? 'pass' : 'fail', { premise: proposal.premise });
    await shot(page, 'wizard-proposal-1440');

    // 换一个方案
    await page.click('[data-action="rerollProposal"]');
    await page.waitForTimeout(250);
    const reroll = await page.evaluate(() => ({
      title: document.querySelector('.proposal__head h3').textContent,
      candidate: document.querySelector('.proposal__head .tag').textContent,
      toast: Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent.trim()).slice(-1)[0],
    }));
    log('换方案只改标题（候选计数不变）', reroll.title !== '雾中灯塔测试' ? 'pass' : 'fail', reroll);
    log('换方案后候选计数仍为 1/3', reroll.candidate.includes('1/3') ? 'fail' : 'pass', reroll);
    await shot(page, 'wizard-reroll-1440');

    // 返回修改
    await page.click('#wizardBack');
    await page.waitForTimeout(250);
    const backStep = await page.evaluate(() => ({
      step: document.querySelector('.wizard-step.is-active span')?.textContent,
      title: document.querySelector('#newTitle').value,
      tone: document.querySelector('#toneOptions .is-active')?.textContent,
    }));
    log('从步骤 2 返回步骤 1 且保留输入', backStep.step === '01' && backStep.title === '雾中灯塔测试' ? 'pass' : 'fail', backStep);

    // 到步骤 3
    await page.click('#wizardNext');
    await page.waitForTimeout(1500);
    await page.click('#wizardNext');
    await page.waitForTimeout(300);
    const step3 = await page.evaluate(() => ({
      step: document.querySelector('.wizard-step.is-active span')?.textContent,
      done: document.querySelectorAll('.wizard-step.is-done').length,
      createdText: document.querySelector('.created-state p').textContent,
      nextLabel: document.querySelector('#wizardNext').textContent.trim(),
      backHidden: document.querySelector('#wizardBack').hidden,
    }));
    log('步骤 3：显示创建完成态、按钮=进入写作台', step3.step === '03' && step3.nextLabel.includes('进入写作台') ? 'pass' : 'fail', step3);
    log('步骤 3 才可返回（步骤 3 无返回按钮）', step3.backHidden === true ? 'pass' : 'fail', step3);
    log('创建完成态标题与换方案后的标题一致', step3.createdText.includes(reroll.title) ? 'pass' : 'fail', { createdText: step3.createdText, proposalTitle: reroll.title });
    await shot(page, 'wizard-step3-1440');

    // 进入写作台
    await page.click('#wizardNext');
    await page.waitForTimeout(700);
    const afterCreate = await page.evaluate(() => ({
      view: document.querySelector('.view.is-active')?.dataset.view,
      overlayHidden: document.querySelector('#overlay').hidden,
      toast: Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent.trim()).slice(-1),
      cards: document.querySelectorAll('.project-card[data-project]').length,
    }));
    log('步骤 3「进入写作台」应进入写作台', afterCreate.view === 'studio' ? 'pass' : 'fail', afterCreate);
    await shot(page, 'BUG-wizard-enter-studio-1440');

    // 关闭后重新打开是否重置
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.lib-head [data-open="newProject"]');
    await page.waitForTimeout(250);
    const reopen = await page.evaluate(() => ({
      step: document.querySelector('.wizard-step.is-active span')?.textContent,
      title: document.querySelector('#newTitle').value,
      type: document.querySelector('.type-option.is-active')?.dataset.type,
      proposalHidden: document.querySelector('#wizardProposal').hidden,
    }));
    log('重新打开向导重置到步骤 1', reopen.step === '01' && reopen.proposalHidden ? 'pass' : 'fail', reopen);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    log('Esc 关闭向导', await page.evaluate(() => document.querySelector('#overlay').hidden) ? 'pass' : 'fail');

    // 模板按钮预选体裁
    setStep('wizard-template');
    for (const [idx, t] of [[2, 'short'], [3, 'script'], [4, 'series']]) {
      await page.click(`.template-row .template-card:nth-child(${idx})`);
      await page.waitForTimeout(250);
      const active = await page.evaluate(() => document.querySelector('.type-option.is-active')?.dataset.type);
      log(`模板卡 ${idx} 预选体裁=${t}`, active === t ? 'pass' : 'fail', { active });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }

    /* ================= 键盘 ================= */
    setStep('keyboard');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(350);
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(350);
    const cmdK = await page.evaluate(() => ({
      view: document.querySelector('.view.is-active')?.dataset.view,
      focused: document.activeElement?.id,
    }));
    log('⌘K 从写作台跳到作品库并聚焦搜索框', cmdK.view === 'library' && cmdK.focused === 'libSearch' ? 'pass' : 'fail', cmdK);
    await shot(page, 'keyboard-cmdk-1440');

    // 搜索范围
    await page.fill('#libSearch', '雨夜');
    await page.waitForTimeout(200);
    const searchChapter = await page.evaluate(() => Array.from(document.querySelectorAll('.project-card[data-project]')).filter((c) => getComputedStyle(c).display !== 'none').length);
    await page.fill('#libSearch', '沈砚');
    await page.waitForTimeout(200);
    const searchChar = await page.evaluate(() => Array.from(document.querySelectorAll('.project-card[data-project]')).filter((c) => getComputedStyle(c).display !== 'none').length);
    log('搜索框可搜章节名（占位文案承诺「章节、人物」）', searchChapter > 0 ? 'pass' : 'fail', { 雨夜: searchChapter });
    log('搜索框可搜人物名（占位文案承诺「人物」）', searchChar > 0 ? 'pass' : 'fail', { 沈砚: searchChar });
    await page.fill('#libSearch', '');

    // ⌘S
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(350);
    await page.keyboard.press('Meta+s');
    await page.waitForTimeout(250);
    log('⌘S 保存提示', (await count('.toast')) > 0 ? 'pass' : 'fail');

    // ⌘. 专注
    await page.keyboard.press('Meta+.');
    await page.waitForTimeout(250);
    const dotFocus = await page.evaluate(() => document.querySelector('#app').classList.contains('focus-mode'));
    log('⌘. 切换专注模式', dotFocus ? 'pass' : 'fail');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    // 专注模式下 ⌘K
    await page.keyboard.press('Meta+.');
    await page.waitForTimeout(200);
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(350);
    const focusLeak = await page.evaluate(() => ({
      view: document.querySelector('.view.is-active')?.dataset.view,
      focus: document.querySelector('#app').classList.contains('focus-mode'),
      rail: getComputedStyle(document.querySelector('.rail')).display,
      topbar: getComputedStyle(document.querySelector('.topbar')).display,
      panel: getComputedStyle(document.querySelector('#panel')).display,
      exit: getComputedStyle(document.querySelector('.focus-exit')).display !== 'none',
    }));
    log('专注模式下 ⌘K 应退出专注或保持写作台', !(focusLeak.focus && focusLeak.view === 'library') ? 'pass' : 'fail', focusLeak);
    if (focusLeak.focus && focusLeak.view === 'library') await shot(page, 'BUG-focus-cmdk-library-1440');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    // Esc 在向导中
    await page.click('.lib-head [data-open="newProject"]');
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    log('Esc 关闭新建向导', (await page.evaluate(() => document.querySelector('#overlay').hidden)) ? 'pass' : 'fail');

    // ⌘K 在弹窗打开时
    await page.click('.lib-head [data-open="newProject"]');
    await page.waitForTimeout(250);
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(300);
    const cmdKModal = await page.evaluate(() => ({
      overlay: !document.querySelector('#overlay').hidden,
      view: document.querySelector('.view.is-active')?.dataset.view,
      focusOwner: document.activeElement?.id,
    }));
    log('弹窗打开时 ⌘K 不应改变底层视图', cmdKModal.view === 'library' ? 'pass' : 'fail', cmdKModal);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    /* ================= 布局：1280 ================= */
    setStep('layout-1280');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await measure('1280', 'library');

    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(400);
    await measure('1280', 'studio');
    await shot(page, 'studio-1280');
    // 写作台关键宽度
    const studioMetrics = await page.evaluate(() => {
      const q = (s) => document.querySelector(s)?.getBoundingClientRect();
      return {
        doc: q('.doc-pane'),
        ai: q('#aiPanel'),
        toolbar: { scroll: document.querySelector('.doc-toolbar').scrollWidth, client: document.querySelector('.doc-toolbar').clientWidth },
        title: q('#chapterTitle'),
        editor: q('#editor'),
        topbar: q('.topbar'),
        statusbar: q('.doc-statusbar'),
        pill: q('.model-pill'),
      };
    });
    log('1280 写作台工具栏不溢出', studioMetrics.toolbar.scroll <= studioMetrics.toolbar.client + 1 ? 'pass' : 'fail', studioMetrics.toolbar);
    log('1280 写作台三栏宽度合理（文档>500, AI>300）', studioMetrics.doc.width > 500 && studioMetrics.ai.width > 300 ? 'pass' : 'fail', {
      doc: Math.round(studioMetrics.doc.width),
      ai: Math.round(studioMetrics.ai.width),
    });
    await page.click('.rail-btn[data-nav="outline"]');
    await page.waitForTimeout(400);
    await measure('1280', 'outline');
    await shot(page, 'outline-1280');
    await page.click('.rail-btn[data-nav="codex"]');
    await page.waitForTimeout(400);
    await measure('1280', 'codex');
    await shot(page, 'codex-1280');
    await page.click('.rail-btn[data-nav="screenplay"]');
    await page.waitForTimeout(400);
    await measure('1280', 'screenplay');
    await shot(page, 'screenplay-1280');
    await page.click('.rail-btn[data-nav="library"]');
    await page.waitForTimeout(400);
    await shot(page, 'library-1280');

    // 弹窗 1280
    await page.click('.lib-head [data-open="newProject"]');
    await page.waitForTimeout(300);
    const modalFits = await page.evaluate(() => {
      const r = document.querySelector('#newProjectModal').getBoundingClientRect();
      const body = document.querySelector('.wizard-body[data-wizard-step="1"]');
      return {
        rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        iw: innerWidth,
        ih: innerHeight,
        bodyScroll: body.scrollHeight,
        bodyClient: body.clientHeight,
      };
    });
    log('1280 向导弹窗完整显示', modalFits.rect.right <= 1280 && modalFits.rect.bottom <= 800 && modalFits.rect.top >= 0 ? 'pass' : 'fail', modalFits);
    await shot(page, 'wizard-1280');
    await page.keyboard.press('Escape');

    /* ================= 布局：1024 ================= */
    setStep('layout-1024');
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await measure('1024', 'library');
    await shot(page, 'library-1024');
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(400);
    await measure('1024', 'studio');
    await shot(page, 'studio-1024');
    await page.click('.rail-btn[data-nav="outline"]');
    await page.waitForTimeout(400);
    await measure('1024', 'outline');
    await shot(page, 'outline-1024');
    await page.click('.rail-btn[data-nav="codex"]');
    await page.waitForTimeout(400);
    await measure('1024', 'codex');
    await shot(page, 'codex-1024');
    await page.click('.rail-btn[data-nav="screenplay"]');
    await page.waitForTimeout(400);
    await measure('1024', 'screenplay');
    await shot(page, 'screenplay-1024');

    setStep('console');
    log('控制台无 error', ctx.consoleErrors.filter((e) => e.type === 'error' || e.type === 'pageerror').length === 0 ? 'pass' : 'fail', {
      errors: ctx.consoleErrors.filter((e) => e.type === 'error' || e.type === 'pageerror'),
    });
  } catch (err) {
    log('脚本异常中止', 'fail', { step: ctx.getStep(), message: err.message, stack: (err.stack || '').split('\n').slice(0, 5) });
    await shot(page, 'C-ABORT-' + ctx.getStep());
  } finally {
    saveLog('c-wizard-keyboard-layout', { results: ctx.results, console: ctx.consoleErrors });
    await browser.close();
  }

  async function measure(label, view) {
    const m = await page.evaluate(() => {
      const bad = [];
      const seen = new Set();
      document.querySelectorAll('body *').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.right > innerWidth + 1 && r.left < innerWidth) {
          const sel = el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + Array.from(el.classList).slice(0, 2).join('.');
          const key = sel + Math.round(r.right);
          if (seen.has(key)) return;
          seen.add(key);
          bad.push({ sel, right: Math.round(r.right), width: Math.round(r.width) });
        }
      });
      const overflowing = Array.from(document.querySelectorAll('.view, .library, .studio, .outline-view, .codex-view, .screenplay, .main, .topbar, .doc-toolbar, .ai-panel, .panel'))
        .filter((el) => el.scrollWidth > el.clientWidth + 2)
        .map((el) => ({
          sel: el.id ? '#' + el.id : el.className.split(' ')[0],
          scroll: el.scrollWidth,
          client: el.clientWidth,
        }));
      return {
        iw: innerWidth,
        ih: innerHeight,
        docScroll: document.documentElement.scrollWidth,
        bodyScroll: document.body.scrollWidth,
        bad: bad.slice(0, 12),
        overflowing,
      };
    });
    log(`${label} ${view}：无横向溢出`, m.docScroll <= m.iw + 1 && m.bad.length === 0 ? 'pass' : 'fail', m);
    return m;
  }
})();
