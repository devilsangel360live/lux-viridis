import { NextResponse } from "next/server";

import { requireProject } from "@/server/guard";
import { buildExport, type ExportKind } from "@/server/export-data";
import { renderDocx } from "@/server/export-docx";
import { renderPdf } from "@/server/export-pdf";

export const dynamic = "force-dynamic";

const KINDS: ExportKind[] = ["manuscript", "selection", "bible", "outline"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const guard = await requireProject(url.searchParams.get("projectId"));
  if (!guard.ok) return NextResponse.json({ error: "unauthorized" }, { status: guard.status });

  const kind = (url.searchParams.get("kind") ?? "manuscript") as ExportKind;
  const format = url.searchParams.get("format") ?? "docx";
  const nodeId = url.searchParams.get("nodeId");

  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: "unknown export kind" }, { status: 400 });
  }
  if (format !== "docx" && format !== "pdf") {
    return NextResponse.json({ error: "unknown format" }, { status: 400 });
  }

  const doc = await buildExport(guard.project, kind, nodeId);
  if (doc.sections.length === 0) {
    return NextResponse.json({ error: "nothing to export" }, { status: 409 });
  }

  const buffer = format === "pdf" ? await renderPdf(doc) : await renderDocx(doc);

  // A filename the writer can recognise months later in a downloads folder.
  const filename = `${slug(doc.title)}.${format}`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type":
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(buffer.length),
    },
  });
}

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "export"
  );
}
