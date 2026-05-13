# BPC Interactive Tools

A collection of standalone HTML tools and interactives built for the Bipartisan Policy Center.

Hosted via GitHub Pages at: `https://bipartisan-policy-center.github.io/bpc-tools/`

---

## Tools

| Tool | Folder | Live URL |
|---|---|---|
| DOE Reorganization Chart | `doe-reorg-chart/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/doe-reorg-chart/) |
| IES Org Chart | `ies-org-chart/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/ies-org-chart/ies_org_chart_bpc.html) |
| IES Org Chart (Tree) | `ies-org-chart/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/ies-org-chart/ies_org_chart_tree_bpc.html) |
| Childcare Map | `childcare-map/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/childcare-map/) |
| ECE State Data Links | `ece-data/` | [View](https://bipartisan-policy-center.github.io/bpc-tools/ece-data/) |

---

## Adding a New Tool

1. Create a subfolder with a short descriptive name (e.g., `my-new-tool/`)
2. Add your HTML file as `index.html` inside it
3. Commit and push — it's live immediately via GitHub Pages
4. Add a row to the table above

## WordPress Embed

Each tool can be embedded on any WordPress page using an iframe:

```html
<iframe
  src="https://bipartisan-policy-center.github.io/bpc-tools/TOOL-FOLDER/"
  width="100%" height="800" style="border:none;display:block;"
  loading="lazy">
</iframe>
```
