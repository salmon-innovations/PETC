import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const DOCS = resolve(import.meta.dirname, "..");
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

const BOX = "DIGIFLASH · SALMON INNOVATIONS";
const boxPadded = "DIGIFLASH".padEnd(BOX.length, " ");

// placeholder number -> photo filename (in <root>/photos/manual/). null = leave as-is.
const PHOTOS = {
  "3.2": null,                       // installer — no screenshot available
  "4.1": "login.png",
  "5":   "run-test.png",
  "6.1": "plate_lookup.png",
  "6.2": "run_test_with_results.png",
  "6.3": null,                       // photo-capture two-shot — no screenshot available
  "7.1": "LTMS_Upload.png",
  "7.2": "Vehicle tab.png",
  "7.3": "owner_tab.png",
  "7.4": "results.png",
  "7.5": "technician.png",
  "7.6": "Photos_Tab.png",
  "7.7": "review_tab.png",
  "7.8": "CEC_Preview.png",
  "8.3": "test history.png",
  "9.2": "analytics.png",
  "10":  "settings.png",
};

function rebrand(s) {
  s = s.replaceAll("github.com/salmon-innovations/PETC", "github.com/digiflash/PETC");
  s = s.replaceAll("github.com:salmon-innovations/PETC", "github.com:digiflash/PETC");
  s = s.replaceAll("densilerio15@gmail.com", "christian.silerio.digiflash@gmail.com");
  s = s.replaceAll("(Developer, Salmon Innovations)", "(Lead Developer, Digiflash)");
  s = s.replaceAll(
    "in my capacity as Developer of the PETC Data Submission SaaS",
    "in my capacity as Lead Developer of the PETC Data Submission SaaS"
  );
  s = s.replaceAll("`" + BOX + "`", "`DIGIFLASH`");
  s = s.replaceAll(BOX, boxPadded);
  s = s.replaceAll(
    "| Prepared by | Christian Deiniel Y. Silerio |",
    "| Prepared by | Christian Deiniel Y. Silerio (Lead Developer, Digiflash) |"
  );
  s = s.replaceAll("Salmon Innovations'", "Digiflash's");
  s = s.replaceAll("Salmon Innovations", "Digiflash");
  return s;
}

function insertPhotos(s) {
  // Replace:  > **Screenshot placeholder X** – <description>.
  const re = /^> \*\*Screenshot placeholder ([\d.]+)\*\* [–-] (.+)$/gm;
  return s.replace(re, (m, num, desc) => {
    const file = PHOTOS[num];
    if (!file) return m; // leave placeholder
    const rel = "../../photos/manual/" + encodeURI(file);
    const caption = desc.replace(/\.\s*$/, "");
    return `![${caption}](${rel})\n\n*Figure ${num} — ${caption}.*`;
  });
}

let changed = 0;
for (const rel of FILES) {
  const p = join(DOCS, rel);
  const before = readFileSync(p, "utf8");
  let after = rebrand(before);
  if (rel === "01-client-application-manual.md") after = insertPhotos(after);
  if (before !== after) {
    writeFileSync(p, after);
    console.log("UPDATED  " + rel);
    changed++;
  } else {
    console.log("unchanged " + rel);
  }
}
console.log(`\n${changed} files changed`);
