import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, PageBreak, TextRun } from 'docx';
import type { ProjectDetail } from '../shared/types.ts';
import { getSettings } from './repository.ts';

function body(text: string) {
  return text.split(/\n{2,}/).filter(Boolean).map((block) => new Paragraph({
    children: [new TextRun({ text: block, font: 'Songti SC', size: 24 })],
    spacing: { after: 180, line: 360 },
    indent: { firstLine: 480 },
  }));
}

export async function buildProjectDocx(project: ProjectDetail): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2200, after: 240 },
      children: [new TextRun({ text: project.title, font: 'Songti SC', size: 52, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: project.genre || '未分类', font: 'Songti SC', size: 24, color: '8a7a6a' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: project.description || '', font: 'Songti SC', size: 22, color: '8a7a6a' })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  if (project.type === 'screenplay') {
    for (const scene of project.scenes) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        pageBreakBefore: scene.sortOrder > 0,
        spacing: { before: 360, after: 180 },
        children: [new TextRun({ text: scene.heading, font: 'Songti SC', size: 28, bold: true })],
      }));
      children.push(...body(scene.content || ''));
    }
  } else {
    for (const chapter of project.chapters) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        pageBreakBefore: chapter.sortOrder > 0,
        spacing: { before: 360, after: 180 },
        children: [new TextRun({ text: `${chapter.number}　${chapter.title}`, font: 'Songti SC', size: 28, bold: true })],
      }));
      children.push(...body(chapter.content || ''));
    }
  }

  if (project.characters.length) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: '附录 · 人物设定', font: 'Songti SC', size: 34, bold: true })],
    }));
    project.characters.forEach((character) => {
      children.push(new Paragraph({
        spacing: { before: 180, after: 60 },
        children: [new TextRun({ text: `${character.name} · ${character.role}`, font: 'Songti SC', size: 24, bold: true })],
      }));
      children.push(new Paragraph({
        children: [new TextRun({ text: character.description || character.quote || '', font: 'Songti SC', size: 22, color: '555555' })],
        spacing: { after: 120 },
      }));
    });
  }

  const document = new Document({
    creator: getSettings().profile.name || '私家写手',
    title: project.title,
    description: project.description,
    sections: [{ properties: {}, children }],
  });
  return Buffer.from(await Packer.toBuffer(document));
}
