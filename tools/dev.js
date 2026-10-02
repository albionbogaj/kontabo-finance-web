// Emits dev/index.html: the template with asset uuids resolved to relative
// file paths, so the page can be served straight from disk without the
// unpack step (instant reload while editing src/template.html).
//
//   node tools/dev.js
//   python -m http.server 8765      (from kontabo-finance/)
//   open http://localhost:8765/dev/
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const index = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const ext = JSON.parse(fs.readFileSync(path.join(src, 'ext_resources.json'), 'utf8'));

let html = fs.readFileSync(path.join(src, 'template.html'), 'utf8');
const url = (uuid) => '../src/assets/' + uuid + '.' + index[uuid].ext;

for (const uuid of Object.keys(index)) html = html.split(uuid).join(url(uuid));

// React / ReactDOM: point the runtime at the bundled copies instead of the CDN.
const resources = {};
for (const e of ext) resources[e.id] = url(e.uuid);
const inject = '<script>window.__resources=' + JSON.stringify(resources) + ';</script>';
html = html.replace(/<head[^>]*>/i, (m) => m + inject);

fs.mkdirSync(path.join(root, 'dev'), { recursive: true });
fs.writeFileSync(path.join(root, 'dev', 'index.html'), html);
console.log('wrote dev/index.html');
