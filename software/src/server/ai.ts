import type { Response } from 'express';
import type { AiStreamRequest, ProjectDetail } from '../shared/types.ts';
import {
  buildWritingContext,
  getProviderRow,
  getProjectDetail,
  getSettings,
  saveMessage,
  deleteMessage,
} from './repository.ts';
import { decryptSecret } from './crypto.ts';
import { countWords } from './utils.ts';

interface StreamOptions extends Omit<AiStreamRequest, 'modelId'> {
  modelId: string;
  signal: AbortSignal;
  onDelta?: (delta: string) => void;
}

function writeEvent(res: Response, payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function providerEndpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (!base) throw new Error('Base URL 未配置');
  if (/\/v\d+(?:beta)?$/i.test(base) || /\/(?:api\/)?v\d+$/i.test(base) || /compatible-mode\/v1$/i.test(base)) {
    return `${base}${path}`;
  }
  return `${base}/v1${path}`;
}

function mockParagraphs(project: ProjectDetail | null, prompt: string, regenerate = false): string[] {
  const lead = project?.characters[0]?.name || '他';
  const second = project?.characters[1]?.name || '她';
  if (project?.type === 'screenplay') {
    return [
      `内景 · 场景 · 夜`,
      `应急灯每三秒闪一次。${lead}举着手电，光柱停在墙面的划痕上。`,
      `${second}：你确定是这里？\n${lead}：地址对得上。可这个地方，不该还有人。`,
    ];
  }
  const genericVariants = [
    [
      `雾从窗外漫进来时，${lead}听见楼下有人敲门。三下，停一拍，又三下。桌上那封没有署名的信，已经被拆开又折好三次。`,
      `${second}没有立刻去开门。她先把台灯调暗，让屋里只剩下信纸边缘那一点反光。门外的人也在等，等他先犯错。`,
    ],
    [
      `${lead}把录音笔按停，房间里只剩下雨。${second}刚才说的最后一句话还在耳边，像一根没有拔出来的刺。`,
      '他重新按下录音键，倒回三秒。这一次，背景里多了一个人的呼吸声。',
    ],
    [
      `门铃响的时候，${lead}正在烧水。水壶先叫了一声，门铃才响第二下。他关掉火，看见猫眼里的人没有脸。`,
      `${second}从卧室出来，手里拿着那本不该存在的相册。“别开。”她说。`,
    ],
  ];
  return genericVariants[regenerate ? 1 + Math.floor(Math.random() * 2) : 0];
}

async function streamMock(res: Response, opts: StreamOptions, project: ProjectDetail | null) {
  const paragraphs = mockParagraphs(project, opts.prompt, Boolean(opts.regenerate));
  const text = paragraphs.join('\n\n');
  const provider = '本地演示';
  const model = '墨笔演示模型';
  writeEvent(res, { type: 'meta', provider, model });
  let sent = '';
  for (let i = 0; i < text.length; i += 2) {
    if (opts.signal.aborted) break;
    const chunk = text.slice(i, i + 2);
    sent += chunk;
    opts.onDelta?.(chunk);
    writeEvent(res, { type: 'delta', text: chunk });
    await new Promise((resolve) => setTimeout(resolve, 24));
  }
  return { provider, model, text: sent, aborted: opts.signal.aborted };
}

async function streamOpenAI(res: Response, opts: StreamOptions, provider: Record<string, any>, key: string, system: string) {
  const url = providerEndpoint(provider.base_url, '/chat/completions');
  const body = {
    model: opts.modelId,
    stream: true,
    temperature: getSettings().generation.temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: opts.prompt },
    ],
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`模型请求失败：HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  writeEvent(res, { type: 'meta', provider: provider.name, model: opts.modelId });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || '';
        if (delta) {
          text += delta;
          opts.onDelta?.(delta);
          writeEvent(res, { type: 'delta', text: delta });
        }
      } catch {
        // ignore malformed SSE chunks
      }
    }
  }
  return { provider: provider.name, model: opts.modelId, text };
}

async function streamAnthropic(res: Response, opts: StreamOptions, provider: Record<string, any>, key: string, system: string) {
  const url = providerEndpoint(provider.base_url, '/messages');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.modelId,
      max_tokens: 2048,
      stream: true,
      system,
      messages: [{ role: 'user', content: opts.prompt }],
    }),
    signal: opts.signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic 请求失败：HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  writeEvent(res, { type: 'meta', provider: provider.name, model: opts.modelId });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      try {
        const json = JSON.parse(data);
        const delta = json.type === 'content_block_delta' ? json.delta?.text || '' : '';
        if (delta) {
          text += delta;
          opts.onDelta?.(delta);
          writeEvent(res, { type: 'delta', text: delta });
        }
      } catch {
        // ignore
      }
    }
  }
  return { provider: provider.name, model: opts.modelId, text };
}

async function streamGoogle(res: Response, opts: StreamOptions, provider: Record<string, any>, key: string, system: string) {
  const base = provider.base_url.replace(/\/+$/, '');
  const url = `${base}/models/${encodeURIComponent(opts.modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
      generationConfig: { temperature: getSettings().generation.temperature },
    }),
    signal: opts.signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`Gemini 请求失败：HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  writeEvent(res, { type: 'meta', provider: provider.name, model: opts.modelId });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      try {
        const json = JSON.parse(data);
        const delta = json.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
        if (delta) {
          text += delta;
          opts.onDelta?.(delta);
          writeEvent(res, { type: 'delta', text: delta });
        }
      } catch {
        // ignore
      }
    }
  }
  return { provider: provider.name, model: opts.modelId, text };
}

export async function streamAssistant(res: Response, opts: StreamOptions) {
  const settings = getSettings();
  const project = getProjectDetail(opts.projectId);
  if (!project) throw new Error('作品不存在');
  const chapter = opts.chapterId ? project.chapters.find((c) => c.id === opts.chapterId) : null;
  const providerId = opts.providerId || settings.defaultModel?.providerId || 'mock';
  const modelId = opts.modelId || settings.defaultModel?.modelId || 'mock-writer';
  let partial = '';
  const streamOpts: StreamOptions = {
    ...opts, providerId, modelId,
    onDelta: (delta) => { partial += delta; },
  };
  const row = getProviderRow(providerId);
  if (!row) throw new Error('供应商不存在');
  const key = decryptSecret(row.api_key_enc);
  const useMock = row.kind === 'mock';
  if (!useMock && !key) throw new Error(`${row.name} 尚未配置 API Key，请先到设置中填写`);
  const effectiveProviderId = useMock ? 'mock' : providerId;
  const effectiveModelId = useMock ? 'mock-writer' : modelId;

  if (!streamOpts.regenerate) {
    saveMessage({
      projectId: streamOpts.projectId,
      chapterId: streamOpts.chapterId,
      role: 'user',
      content: streamOpts.prompt,
      providerId: effectiveProviderId,
      modelId: effectiveModelId,
    });
  }

  const system = [
    '你是一位与中文作者长期合作的小说 / 剧本共笔助手。',
    '你的任务是续写、改写或分析当前作品，保持已有文风、人物语气与叙事视角。',
    '只输出可以直接回到正文中的中文内容，除非作者明确要求分析。不要解释你的写作过程，不要复述规则。',
    '如果作者要求对白，请用中文全角引号。不要使用 Markdown 标题。',
    '',
    buildWritingContext(streamOpts.projectId, streamOpts.chapterId || null),
  ].join('\n');

  let result: { provider: string; model: string; text: string; aborted?: boolean };
  try {
    if (useMock) {
      result = await streamMock(res, streamOpts, project);
    } else if (row.kind === 'anthropic') {
      result = await streamAnthropic(res, streamOpts, row, key, system);
    } else if (row.kind === 'google') {
      result = await streamGoogle(res, streamOpts, row, key, system);
    } else {
      result = await streamOpenAI(res, streamOpts, row, key, system);
    }
    const aborted = Boolean(result.aborted || (streamOpts.signal.aborted && !res.writableEnded));
    const finalText = result.text || partial;
    if (streamOpts.replaceMessageId) {
      deleteMessage(streamOpts.projectId, streamOpts.replaceMessageId);
    }
    const message = saveMessage({
      projectId: streamOpts.projectId,
      chapterId: streamOpts.chapterId,
      role: 'assistant',
      content: finalText,
      providerId: effectiveProviderId,
      modelId: effectiveModelId,
      status: aborted ? 'aborted' : 'complete',
    });
    if (!aborted && !res.writableEnded) {
      writeEvent(res, {
        type: 'done',
        messageId: message.id,
        provider: result.provider,
        model: result.model,
        words: countWords(finalText),
      });
    }
  } catch (error) {
    if (streamOpts.signal.aborted) {
      // 客户端点“停止”会先 abort fetch；已生成的内容仍要落库，不能整段丢掉。
      if (partial.trim()) {
        if (streamOpts.replaceMessageId) deleteMessage(streamOpts.projectId, streamOpts.replaceMessageId);
        saveMessage({
          projectId: streamOpts.projectId,
          chapterId: streamOpts.chapterId,
          role: 'assistant',
          content: partial,
          providerId: effectiveProviderId,
          modelId: effectiveModelId,
          status: 'aborted',
        });
      }
      return;
    }
    if (!res.writableEnded) {
      writeEvent(res, { type: 'error', message: error instanceof Error ? error.message : 'AI 请求失败' });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}
