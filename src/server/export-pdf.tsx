import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import type { Block, ExportDoc } from "./export-data";

/**
 * PDF rendering via @react-pdf/renderer.
 *
 * Chosen over headless Chromium deliberately: this adds ~3MB to the container
 * rather than ~400MB, which matters on a home server. Manuscript pages are
 * typographically simple, so the tradeoff costs nothing that shows.
 *
 * Uses the built-in Times-Roman rather than an embedded font — no font files to
 * ship, and it is the closest standard face to manuscript convention.
 */

const styles = StyleSheet.create({
  /**
   * `lineHeight` is deliberately NOT set here. On the Page style it suppresses
   * `fixed` elements entirely — running heads and page numbers silently vanish.
   * Line spacing lives on the text styles below instead.
   */
  page: {
    paddingTop: 72,
    paddingBottom: 72,
    paddingHorizontal: 72,
    fontFamily: "Times-Roman",
    fontSize: 12,
    color: "#111111",
  },
  titlePage: {
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    height: "100%",
  },
  title: { fontSize: 26, fontFamily: "Times-Bold", textAlign: "center", marginBottom: 12 },
  subtitle: { fontSize: 14, textAlign: "center", marginBottom: 24, color: "#444444" },
  author: { fontSize: 12, textAlign: "center" },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "Times-Bold",
    textAlign: "center",
    marginBottom: 24,
    marginTop: 12,
  },
  h1: { fontSize: 15, fontFamily: "Times-Bold", marginTop: 14, marginBottom: 6 },
  h2: { fontSize: 13.5, fontFamily: "Times-Bold", marginTop: 12, marginBottom: 5 },
  h3: { fontSize: 12.5, fontFamily: "Times-Bold", marginTop: 10, marginBottom: 4 },
  paragraph: { marginBottom: 2, textAlign: "justify", lineHeight: 1.8 },
  indented: { textIndent: 24 },
  sceneBreak: { textAlign: "center", marginVertical: 12, letterSpacing: 4, color: "#666666" },
  note: { fontFamily: "Times-Italic", color: "#444444", marginBottom: 6 },
  meta: { fontSize: 10, color: "#555555", marginBottom: 3 },
  pageNumber: {
    position: "absolute",
    bottom: 36,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 10,
    color: "#666666",
  },
  runningHead: {
    position: "absolute",
    top: 36,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 9,
    color: "#888888",
  },
});

/** Author / Title — Chapter, the convention for a manuscript running head. */
function runningHead(doc: ExportDoc, sectionTitle: string): string {
  const parts = [doc.author, doc.title].filter(Boolean);
  return `${parts.join(" / ")} — ${sectionTitle}`;
}

/**
 * Precomputes which paragraphs are indented, so rendering stays a pure map.
 * Manuscript convention: the first paragraph after any break is flush left and
 * continuing paragraphs are indented.
 */
function withIndentFlags(blocks: Block[]): Array<{ block: Block; indent: boolean }> {
  let prevWasProse = false;
  return blocks.map((block) => {
    if (block.kind !== "paragraph") {
      prevWasProse = false;
      return { block, indent: false };
    }
    const indent = prevWasProse;
    prevWasProse = true;
    return { block, indent };
  });
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {withIndentFlags(blocks).map(({ block, indent }, i) => {
        switch (block.kind) {
          case "heading": {
            const style =
              block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3;
            return (
              <Text key={i} style={style}>
                {block.text}
              </Text>
            );
          }
          case "sceneBreak":
            return (
              <Text key={i} style={styles.sceneBreak}>
                * * *
              </Text>
            );
          case "meta":
            return (
              <Text key={i} style={styles.meta}>
                {block.label ? `${block.label}: ${block.value}` : block.value}
              </Text>
            );
          case "note":
            return (
              <Text key={i} style={styles.note}>
                {block.text}
              </Text>
            );
          default:
            return (
              <Text key={i} style={[styles.paragraph, ...(indent ? [styles.indented] : [])]}>
                {block.text}
              </Text>
            );
        }
      })}
    </>
  );
}

function ExportDocument({ doc }: { doc: ExportDoc }) {
  return (
    <Document title={doc.title} author={doc.author ?? undefined}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.titlePage}>
          <Text style={styles.title}>{doc.title}</Text>
          {doc.subtitle ? <Text style={styles.subtitle}>{doc.subtitle}</Text> : null}
          {doc.author ? <Text style={styles.author}>{doc.author}</Text> : null}
        </View>
      </Page>

      {doc.sections.map((section, i) => (
        <Page key={i} size="LETTER" style={styles.page}>
          {/**
           * Both fixed elements are declared before the flowing content.
           * Placed after it, the page-number Text renders nothing — the
           * absolutely-positioned node ends up outside the laid-out page.
           */}
          <Text style={styles.runningHead} fixed>
            {runningHead(doc, section.title)}
          </Text>
          <Text
            style={styles.pageNumber}
            fixed
            render={({ pageNumber }) => `${pageNumber}`}
          />
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <Blocks blocks={section.blocks} />
        </Page>
      ))}
    </Document>
  );
}

export async function renderPdf(doc: ExportDoc): Promise<Buffer> {
  return renderToBuffer(<ExportDocument doc={doc} />);
}
