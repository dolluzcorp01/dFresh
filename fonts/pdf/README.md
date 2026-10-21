# PDF fonts

Static Regular and Bold instances of the fonts the site already uses, for the PDF documents
(`src/backend_routes/pdf-writer.js`, pdfkit). pdfkit cannot embed the variable `.woff2` files, so each was cut once
at weight 400 and 700 (width 100) with fontTools:

| File | From |
|---|---|
| `OpenSans-Regular.ttf`, `OpenSans-Bold.ttf` | `src/fonts/open-sans-latin.woff2` |
| `NotoSansTamil-Regular.ttf`, `NotoSansTamil-Bold.ttf` | `fonts/source/noto-sans-tamil.woff2` |
| `NotoSansDevanagari-Regular.ttf`, `NotoSansDevanagari-Bold.ttf` | `fonts/source/noto-sans-devanagari.woff2` |

```
python -m pip install fonttools brotli
python -c "from fontTools.ttLib import TTFont; from fontTools.varLib import instancer; f = TTFont('fonts/source/noto-sans-tamil.woff2'); s = instancer.instantiateVariableFont(f, {'wght': 700, 'wdth': 100}); s.flavor = None; s.save('fonts/pdf/NotoSansTamil-Bold.ttf')"
```

Another script in a PDF: add its `<Family>-Regular.ttf` and `<Family>-Bold.ttf` here (family as in
`fonts/scripts.json`, spaces removed). Until then its letters print as empty boxes in PDFs. Browser print windows
use the full `fonts/source` files (GET /api/dfresh/print-fonts.css) and need nothing here.

Licence: SIL Open Font License 1.1 (Open Sans, Noto Sans).
