import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

import type { Block, ExportDoc } from "./export-data";

/**
 * DOCX rendering, following standard manuscript format: 12pt serif,
 * double-spaced, first-line indents on continuing paragraphs, chapters starting
 * on a new page. This is what an agent or editor expects to receive, and what
 * Word, Google Docs and Pages all open cleanly.
 */

const TWIPS_PER_INCH = 1440;
// docx expresses line spacing in 240ths of a line; 480 = double-spaced.
const DOUBLE = 480;

function paragraphRuns(text: string): TextRun[] {
  return [new TextRun({ text, font: "Georgia", size: 24 })];
}

function renderBlocks(blocks: Block[]): Paragraph[] {
  const out: Paragraph[] = [];
  let prevWasProse = false;

  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        out.push(
          new Paragraph({
            heading:
              block.level === 1
                ? HeadingLevel.HEADING_1
                : block.level === 2
                  ? HeadingLevel.HEADING_2
                  : HeadingLevel.HEADING_3,
            spacing: { before: 240, after: 120 },
            children: [new TextRun({ text: block.text, font: "Georgia", bold: true })],
          }),
        );
        prevWasProse = false;
        break;

      case "sceneBreak":
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 240, line: DOUBLE },
            children: [new TextRun({ text: "* * *", font: "Georgia", size: 24 })],
          }),
        );
        prevWasProse = false;
        break;

      case "meta":
        out.push(
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({
                text: block.label ? `${block.label}: ${block.value}` : block.value,
                font: "Georgia",
                size: 20,
                color: "555555",
              }),
            ],
          }),
        );
        prevWasProse = false;
        break;

      case "note":
        out.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({ text: block.text, font: "Georgia", size: 22, italics: true }),
            ],
          }),
        );
        prevWasProse = false;
        break;

      default:
        out.push(
          new Paragraph({
            spacing: { line: DOUBLE },
            // Manuscript convention: the first paragraph after a break is flush
            // left, continuing paragraphs are indented.
            indent: prevWasProse ? { firstLine: 0.5 * TWIPS_PER_INCH } : undefined,
            children: paragraphRuns(block.text),
          }),
        );
        prevWasProse = true;
    }
  }

  return out;
}

export async function renderDocx(doc: ExportDoc): Promise<Buffer> {
  const children: Paragraph[] = [];

  // Title page.
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 3000, after: 240 },
      children: [new TextRun({ text: doc.title, font: "Georgia", size: 40, bold: true })],
    }),
  );
  if (doc.subtitle) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: doc.subtitle, font: "Georgia", size: 26 })],
      }),
    );
  }
  if (doc.author) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: doc.author, font: "Georgia", size: 24 })],
      }),
    );
  }

  doc.sections.forEach((section) => {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 480, after: 360 },
        children: [new TextRun({ text: section.title, font: "Georgia", bold: true, size: 32 })],
      }),
    );
    children.push(...renderBlocks(section.blocks));
  });

  const document = new Document({
    creator: doc.author ?? "Lux Viridis",
    title: doc.title,
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: TWIPS_PER_INCH,
              bottom: TWIPS_PER_INCH,
              left: TWIPS_PER_INCH,
              right: TWIPS_PER_INCH,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ children: [PageNumber.CURRENT], font: "Georgia", size: 20 }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}
