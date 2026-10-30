// 假 OpenAI 兼容服务：DELAY_MS 毫秒后返回一份合法企划 JSON（或 HANG=1 永不返回）
import http from 'node:http';
const DELAY = Number(process.env.DELAY_MS || 8000);
const PORT = Number(process.env.PORT || 8899);
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const started = Date.now();
    console.log(`[fake] ${req.method} ${req.url} delay=${DELAY}ms body=${body.length}B`);
    setTimeout(() => {
      if (process.env.HANG === '1') { console.log('[fake] HANG: 不回应'); return; }
      const plan = {
        acts: [
          { title: '第一幕 裂缝', summary: '日常被打破', beats: [
            { chapterNo: 1, title: '不寻常的清晨', summary: '异常出现', tags: ['钩子'] },
            { chapterNo: 2, title: '线索', summary: '追查开始', tags: ['谜面'] },
            { chapterNo: 3, title: '越界', summary: '无法回头', tags: ['转折'] },
          ] },
          { title: '第二幕 深水', summary: '失控', beats: [
            { chapterNo: 4, title: '旧关系', summary: '过去的人', tags: ['关系'] },
            { chapterNo: 5, title: '代价', summary: '伤害扩散', tags: ['升级'] },
          ] },
          { title: '第三幕 回声', summary: '选择', beats: [
            { chapterNo: 6, title: '原点', summary: '回到开始', tags: ['回收'] },
            { chapterNo: 7, title: '选择', summary: '行动回答主题', tags: ['高潮'] },
          ] },
        ],
        characters: [
          { name: '沈砚舟', role: '主角', age: '32', tags: ['克制'], quote: '“我只想知道真相。”', description: '被卷入事件的人', secret: '他早就知道一部分。' },
          { name: '苏晚照', role: '对手', age: '41', tags: ['冷静'], quote: '“有些答案回不去了。”', description: '维持秩序的人', secret: '她也曾是受害者。' },
        ],
        chapter: { title: '第一章 不寻常的清晨', content: '假服务返回的正文。\n\n第二段。' },
      };
      const payload = JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(plan) }, finish_reason: 'stop' }], usage: {} });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(payload);
      console.log(`[fake] 已回应，耗时 ${Date.now() - started}ms`);
    }, DELAY);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`[fake] listening ${PORT} delay=${DELAY} hang=${process.env.HANG || 0}`));
