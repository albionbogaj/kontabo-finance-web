// Unpacks a Claude Design bundled .html into a working directory:
//   <out>/template.html          – the page template (uuid placeholders intact)
//   <out>/assets/<uuid>.<ext>    – every manifest asset, decompressed
//   <out>/manifest.json          – uuid -> {mime, compressed, ext, size}
//   <out>/ext_resources.json     – CDN id -> uuid map
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [,, src, out] = process.argv;
const html = fs.readFileSync(src, 'utf8');

function block(type) {
  const re = new RegExp('<script type="__bundler/' + type + '">\\s*([\\s\\S]*?)\\s*</script>');
  const m = html.match(re);
  if (!m) throw new Error('missing block ' + type);
  return JSON.parse(m[1]);
}

const manifest = block('manifest');
const template = block('template');
const ext = block('ext_resources');
const pageOrder = block('page_order');

fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

const extOf = {
  'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'text/javascript': 'js', 'application/javascript': 'js', 'text/css': 'css',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'text/html': 'html',
  'application/json': 'json', 'text/plain': 'txt', 'image/x-icon': 'ico',
};

const index = {};
for (const [uuid, e] of Object.entries(manifest)) {
  let bytes = Buffer.from(e.data, 'base64');
  if (e.compressed) bytes = zlib.gunzipSync(bytes);
  const ext_ = extOf[e.mime] || 'bin';
  fs.writeFileSync(path.join(out, 'assets', uuid + '.' + ext_), bytes);
  index[uuid] = { mime: e.mime, compressed: !!e.compressed, ext: ext_, size: bytes.length };
}

fs.writeFileSync(path.join(out, 'template.html'), template);
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(index, null, 2));
fs.writeFileSync(path.join(out, 'ext_resources.json'), JSON.stringify(ext, null, 2));
fs.writeFileSync(path.join(out, 'page_order.json'), JSON.stringify(pageOrder, null, 2));

console.log('assets:', Object.keys(index).length);
for (const [u, i] of Object.entries(index)) console.log(' ', u, i.mime, i.size + 'B', i.ext);
console.log('template chars:', template.length);
console.log('ext resources:', ext.map(e => e.id).join('\n  '));
