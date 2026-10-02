// Sanity check: does pack(unpack(original)) reproduce the original bundle?
// Compares the template text, ext_resources and every decompressed asset.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [a, b] = process.argv.slice(2).map((p) => fs.readFileSync(p, 'utf8'));
const blk = (h, t) => {
  const m = h.match(new RegExp('<script type="__bundler/' + t + '">\\s*([\\s\\S]*?)\\s*</script>'));
  return JSON.parse(m[1]);
};
const bytes = (e) => (e.compressed ? zlib.gunzipSync(Buffer.from(e.data, 'base64')) : Buffer.from(e.data, 'base64'));

console.log('template identical :', blk(a, 'template') === blk(b, 'template'));
console.log('ext_resources same :', JSON.stringify(blk(a, 'ext_resources')) === JSON.stringify(blk(b, 'ext_resources')));
const ma = blk(a, 'manifest'), mb = blk(b, 'manifest');
let ok = Object.keys(ma).length === Object.keys(mb).length;
for (const k of Object.keys(ma)) {
  if (!mb[k] || ma[k].mime !== mb[k].mime || !bytes(ma[k]).equals(bytes(mb[k]))) { ok = false; console.log('  DIFF', k); }
}
console.log('assets identical   :', ok, '(' + Object.keys(ma).length + ' assets)');
