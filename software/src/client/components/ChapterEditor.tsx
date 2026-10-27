import { useEffect, useRef } from 'react';
import type { Chapter } from '../../shared/types';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toHtml(content: string) {
  const blocks = content.split(/\n{2,}/).filter((x) => x.length > 0);
  if (!blocks.length) return '';
  return blocks.map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`).join('');
}

export function ChapterEditor({
  chapter, onChange, onSelectionChange, editorRef,
}: {
  chapter: Chapter;
  onChange: (content: string) => void;
  onSelectionChange?: (text: string, range: Range | null) => void;
  editorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const lastId = useRef<string>('');

  useEffect(() => {
    if (!editorRef.current) return;
    if (lastId.current !== chapter.id) {
      editorRef.current.innerHTML = toHtml(chapter.content);
      lastId.current = chapter.id;
    }
  }, [chapter.id, chapter.content, editorRef]);

  function reportSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !onSelectionChange) return;
    const anchor = selection.anchorNode;
    if (anchor && editorRef.current?.contains(anchor)) {
      const range = selection.getRangeAt(0).cloneRange();
      onSelectionChange(selection.toString().trim(), range);
    }
  }

  return (
    <div
      ref={editorRef}
      className="editor"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={() => {
        if (editorRef.current) onChange(editorRef.current.innerText);
      }}
      onMouseUp={reportSelection}
      onKeyUp={reportSelection}
      data-placeholder="这一章还没有开始。写下第一句话，或者让 AI 起个头。"
    />
  );
}
