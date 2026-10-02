// Re-bundles src/ into a single self-contained HTML file (same format as the
// original Claude Design export, so it opens by double-click and can be
// re-imported into the Design editor).
//
//   node tools/pack.js            -> dist/Kontabo finance.html
//   node tools/pack.js out.html   -> custom output path
//
// The loader (everything outside the four __bundler/* blocks) is copied
// verbatim from dist/original.html, so runtime behaviour is unchanged; only
// the template and the asset manifest are rebuilt from src/.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const out = process.argv[2] || path.join(root, 'dist', 'Kontabo finance.html');
const loaderSrc = path.join(root, 'dist', 'original.html');

const template = fs.readFileSync(path.join(src, 'template.html'), 'utf8');
const index = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const ext = JSON.parse(fs.readFileSync(path.join(src, 'ext_resources.json'), 'utf8'));
const pageOrder = JSON.parse(fs.readFileSync(path.join(src, 'page_order.json'), 'utf8'));

const manifest = {};
for (const [uuid, meta] of Object.entries(index)) {
  const bytes = fs.readFileSync(path.join(src, 'assets', uuid + '.' + meta.ext));
  const compressed = meta.compressed;
  manifest[uuid] = {
    mime: meta.mime,
    compressed,
    data: (compressed ? zlib.gzipSync(bytes, { level: 9 }) : bytes).toString('base64'),
  };
}

// JSON inside a <script> must never contain a literal "</" sequence.
const safe = (v) => JSON.stringify(v).replace(/<\//g, '<\\/');

let html = fs.readFileSync(loaderSrc, 'utf8');
function setBlock(type, json) {
  const re = new RegExp('(<script type="__bundler/' + type + '">)\\s*[\\s\\S]*?\\s*(</script>)');
  if (!re.test(html)) throw new Error('loader is missing block ' + type);
  html = html.replace(re, (_, open, close) => open + '\n' + json + '\n  ' + close);
}
setBlock('manifest', safe(manifest));
setBlock('ext_resources', safe(ext));
setBlock('page_order', safe(pageOrder));
setBlock('template', safe(template));

// Title of the wrapper page (shown while unpacking / in the tab).
html = html.replace(/<title>[^<]*<\/title>/, '<title>Kontabo Finance</title>');

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('wrote', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
