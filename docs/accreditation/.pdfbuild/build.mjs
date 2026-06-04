import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { mdToPdf } from "md-to-pdf";

const DOCS = resolve(import.meta.dirname, "..");
const MMDC = join(import.meta.dirname, "node_modules", ".bin", "mmdc");

const FILES = [
  "01-client-application-manual.md",
  "02-setup-and-network-layout.md",
  "03-system-documentation.md",
  "06-network-architecture.md",
  "README.md",
  "04-source-code/README.md",
  "04-source-code/manifest.md",
  "05-cec-samples/README.md",
];

const CSS = `
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
         font-size: 11pt; line-height: 1.5; color: #1a1a1a; }
  h1 { font-size: 22pt; border-bottom: 2px solid #444; padding-bottom: 6px; }
  h2 { font-size: 16pt; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 1.6em; }
  h3 { font-size: 13pt; }
  code { background: #f3f3f3; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; }
  pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 9pt; line-height: 1.4; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  img { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; }
  em { color: #555; }
  blockquote { border-left: 4px solid #ccc; margin-left: 0; padding-left: 14px; color: #555; }
  a { color: #0b5cad; }
`;

const tmp = mkdtempSync(join(tmpdir(), "mmd-"));
const cfgPath = join(tmp, "mmdc.json");
writeFileSync(cfgPath, JSON.stringify({ theme: "default", flowchart: { useMaxWidth: true } }));

function renderMermaid(code, id) {
  const inFile = join(tmp, `${id}.mmd`);
  const outFile = join(tmp, `${id}.svg`);
  writeFileSync(inFile, code);
  execFileSync(MMDC, ["-i", inFile, "-o", outFile, "-c", cfgPath, "-b", "white"], { stdio: "pipe" });
  return `data:image/svg+xml;base64,${readFileSync(outFile).toString("base64")}`;
}

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" };

function inlineImages(md, baseDir) {
  // ![alt](path) — inline local files as data URIs (handles spaces / %20)
  return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) => {
    if (/^(https?:|data:)/.test(url)) return m;
    const clean = decodeURI(url.trim());
    const abs = resolve(baseDir, clean);
    if (!existsSync(abs)) {
      console.warn(`  ! missing image: ${url}`);
      return m;
    }
    const ext = abs.split(".").pop().toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    return `![${alt}](data:${mime};base64,${readFileSync(abs).toString("base64")})`;
  });
}

function preprocessMermaid(md, tag) {
  let i = 0;
  return md.replace(/```mermaid\s*\n([\s\S]*?)```/g, (_m, code) => {
    const uri = renderMermaid(code, `${tag}-${i++}`);
    return `\n<p align="center"><img src="${uri}" /></p>\n`;
  });
}

const OUT = join(DOCS, "pdf");
mkdirSync(OUT, { recursive: true });

for (const rel of FILES) {
  const src = join(DOCS, rel);
  const tag = rel.replace(/[\/.]/g, "_");
  let md = readFileSync(src, "utf8");
  const diagrams = (md.match(/```mermaid/g) || []).length;
  md = preprocessMermaid(md, tag);
  md = inlineImages(md, dirname(src));
  const pdf = await mdToPdf(
    { content: md },
    {
      css: CSS,
      pdf_options: {
        format: "A4",
        margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
        printBackground: true,
      },
      launch_options: { args: ["--no-sandbox"] },
    }
  );
  const outName = rel.replace(/\//g, "__").replace(/\.md$/, ".pdf");
  writeFileSync(join(OUT, outName), pdf.content);
  console.log(`OK  ${rel}  (${diagrams} diagram${diagrams === 1 ? "" : "s"}) -> pdf/${outName}`);
}
console.log("DONE");
