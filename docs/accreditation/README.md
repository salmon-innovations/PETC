# PETC – DOTr IT Provider Accreditation Documents

This folder contains the documentation package submitted to the Department of Transportation (DOTr) for IT Provider accreditation of the PETC (Private Emission Testing Center) Data Submission SaaS.

The primary compliance baseline is **DOTr Department Order No. 2023-008, dated 06 March 2023**. DOTC DO 2005-37 is treated as historical/reference material only unless a reviewer specifically asks for a legacy mapping.

## Required Deliverables

| # | Deliverable | File | Status |
|---|---|---|---|
| 1 | Client Application Program Manual | `01-client-application-manual.md` | **Draft v0.2** |
| 2 | Set-up and Network Lay-out | `02-setup-and-network-layout.md` | **Draft v0.2** |
| 3 | System Documentation | `03-system-documentation.md` | **Draft v0.2** |
| 4 | Client Application Program Source Code | `04-source-code/` (live repo, read-only access) | **Draft v0.1** |
| 5 | Sample of CEC Documents | `05-cec-samples/` | **Draft v0.1** |
| 6 | Network Architecture / Diagram | `06-network-architecture.md` | **Draft v0.1** |
| 7 | DO 2023-008 Compliance Matrix | `00-do-2023-008-compliance-matrix.md` | **Draft v0.1** |
| 8 | Annex 6 / PETC Form 02 Templates | `templates/` | **Draft v0.1** |

## Export to Word/PDF

Each Markdown document is structured for clean export to Microsoft Word or PDF using Pandoc:

```bash
pandoc 03-system-documentation.md \
  -o 03-system-documentation.docx \
  --reference-doc=reference.docx \
  --toc
```

Use the `--reference-doc` flag if a formal template is provided by DOTr or LTO.

## Document Control

- **Prepared by**: Christian Deiniel Y. Silerio (Lead Developer, Digiflash)
- **Prepared for**: Emmanuel Jayson Florendo Jr. (Client)
- **Submitting to**: Department of Transportation (DOTr), Land Transportation Office (LTO)
- **Project**: PETC Data Submission SaaS
- **Repository**: PETC (private)
