# BPC Interactive Tools

A collection of standalone HTML tools, calculators, maps, and interactives built for the Bipartisan Policy Center.

Hosted via GitHub Pages at: `https://bipartisan-policy-center.github.io/bpc-tools/`

---

## Calculators

| Tool | Folder | Live URL |
|---|---|---|
| Auto Loan Interest Deduction | `calculators/auto-loan-interest/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/calculators/auto-loan-interest/) |
| EITC / CTC Calculator | `calculators/eitc-ctc/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/calculators/eitc-ctc/) |
| Overtime Tax Calculator | `calculators/overtime-tax/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/calculators/overtime-tax/) |

## Maps & Dashboards

| Tool | Folder | Live URL |
|---|---|---|
| Childcare Map | `maps/childcare/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/maps/childcare/) |
| Childcare Dashboard | `maps/childcare/dashboard.html` | [View](https://bipartisan-policy-center.github.io/bpc-tools/maps/childcare/dashboard.html) |

## Tables

| Tool | Folder | Live URL |
|---|---|---|
| State PFML Comparison | `tables/state-pfml/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/tables/state-pfml/) |
| Tax Provisions | `tables/tax-provisions/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/tables/tax-provisions/) |
| CBO Scoring | `tables/cbo-scoring/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/tables/cbo-scoring/) |
| ECE State Data | `tables/ece-data/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/tables/ece-data/) |

## Org Charts

| Tool | Folder | Live URL |
|---|---|---|
| DOE Reorganization Chart | `org-charts/doe-reorg/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/org-charts/doe-reorg/) |
| IES Org Chart | `org-charts/ies/ies_org_chart_bpc.html` | [View](https://bipartisan-policy-center.github.io/bpc-tools/org-charts/ies/ies_org_chart_bpc.html) |
| IES Org Chart (Tree) | `org-charts/ies/ies_org_chart_tree_bpc.html` | [View](https://bipartisan-policy-center.github.io/bpc-tools/org-charts/ies/ies_org_chart_tree_bpc.html) |

## Internal Tools

| Tool | Folder | Notes |
|---|---|---|
| GA4 Slug + Traffic Explorer | `internal-tools/ga4-slug-explorer/` | Upload GA4 CSV export, filter by content type/policy area |

---

## Adding a New Tool

1. Create a subfolder in the appropriate category (e.g., `calculators/my-new-tool/`)
2. Save your HTML file as `index.html` inside it
3. Commit and push — live immediately via GitHub Pages
4. Add a row to the table above

## WordPress Embed

```html
<iframe
  src="https://bipartisan-policy-center.github.io/bpc-tools/CATEGORY/TOOL-FOLDER/"
  width="100%" height="800" style="border:none;display:block;"
  loading="lazy">
</iframe>
```

---

*Maintained by BPC Digital. See `CLAUDE.md` for full implementation notes.*
