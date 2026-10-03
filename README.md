# Kontabo Finance — ERP (prototip lokal)

Projekti punohet **lokalisht**, pa server. Skedari që hapet me dy klikime:

```
dist/Kontabo finance.html
```

Është i njëjti format "bundle" si eksporti origjinal nga Claude Design (template + assets
të kompresuara brenda një skedari), kështu që mund të hapet direkt në shfletues **dhe**
të ri-importohet në editorin e Claude Design.

## Struktura

```
kontabo-finance/
├─ src/
│  ├─ template.html        ← burimi i faqes: HTML + logjika (<script type="text/x-dc">). KJO EDITOHET.
│  ├─ assets/              ← runtime i DC-së, React, fontet Manrope/JetBrains Mono, logo, favicon
│  ├─ manifest.json        ← uuid → mime/ext për çdo asset
│  ├─ ext_resources.json   ← React/ReactDOM (CDN id → uuid lokal)
│  └─ page_order.json
├─ tools/
│  ├─ unpack.js            ← zbërthen një bundle .html në src/
│  ├─ pack.js              ← ribën dist/Kontabo finance.html nga src/
│  ├─ dev.js               ← gjeneron dev/index.html për preview pa pack (asset-e me path relativ)
│  ├─ check-logic.js       ← kontroll sintakse + 1139 teste (çmimi bruto verbatim gross_t, nr. identifikues i operatorit, para, CSV, stoku, ditari, operacionet, kthimet, ofertat/porositë, depot, printimi/barkodet, raportet, grupet tatimore ATK + migrimi, monitori fiskal, admin, importi POS + zbritja totale + anulimet, çmimet me 4 decimale, kompania pa TVSH, blloku tatimor, modaliteti me server kundrejt një serveri mock, indeksi i lëvizjeve + faqezimi, njësitë/recetat/“Shfaqe në POS”, paketimi në blerje/transferime/numërim, libri i POS-it në server: kalimi, kuponët nga API-ja, sirtarët e përmbledhjeve, rreshtat mujorë, rifreskimi i listave, çelësat API dhe token-i i terminalit, propozimet e KONTABO BAR (bashkimi me tri anë, SKU BAR-n, kategoritë, idempotenca, lejet), render sweep)
│  └─ verify-roundtrip.js  ← verifikon që pack(unpack(x)) == x
├─ dev/index.html          ← preview i shpejtë (gjenerohet)
└─ dist/
   ├─ Kontabo finance.html ← REZULTATI (gjenerohet)
   └─ original.html        ← eksporti origjinal; pack.js kopjon loader-in prej këtu
```

## Komandat

```bash
node tools/check-logic.js     # sintaksa + testet e logjikës
node tools/dev.js             # preview: python -m http.server 8765  →  http://localhost:8765/dev/
node tools/pack.js            # ndërton dist/Kontabo finance.html
```

Rrugët (hash) e faqeve: `#dashboard #fatura #faturim-masiv #kliente #produkte #fiskalizimi #abonimi #kontabilist #perdoruesit #raporte #kompania #cilesime #admin`

## Faturim masiv (Shitje › Faturim masiv)

Dy mënyra, të njëjtin motor:

1. **Artikuj, shumë klientë** — një ose më shumë rreshta artikujsh ("+ Shto artikull", "Hiq";
   gjithmonë ≥ 1). Çdo rresht: artikulli (kërkim me emër/SKU, pa diakritikë), çmimi pa/me TVSH
   (sinkronizim dykahësh; bosh = çmimi i katalogut), sasia, grupi TVSH (A/C/D/E), zbritja %.
   Çdo klient i zgjedhur merr një faturë me **të gjithë** rreshtat. Pastaj: shënimi (i njëjtë në
   çdo faturë), data e faturës + afati (Menjëherë/7/15/30/60 ditë), lista e klientëve me kërkim,
   zgjidh/hiq të gjithë. Përmbledhja "Për një faturë" mbledh të gjithë rreshtat.
2. **Nga skedari Excel** — `.xlsx` (SheetJS ngarkohet nga cdnjs vetëm kur duhet — kërkon
   internet), `.csv`/`.txt` dhe **ngjitje direkte nga Excel** (punon offline). Kolonat
   njihen me emër (shqip/anglisht, pa diakritikë): Klienti/NUI, Artikulli/SKU, Sasia, Çmimi,
   Zbritja, Shënim. Rreshtat e të njëjtit klient bashkohen në një faturë; rreshtat me gabim
   shënohen dhe anashkalohen. Ka shabllon CSV për shkarkim.

Tri veprime: **Ruaj si drafte** (Draft, pa fiskalizim) · **Lësho si profatura**
(PRO-VVVV-NNNNN, nuk fiskalizohen) · **Lësho faturat** (FSH-VVVV-NNNNN në vazhdim të numrit
të fundit, statusi *Lëshuar*, fiskalizimi *Në pritje* — futen në radhën te Cilësime › Fiskalizimi).
Faturat lëshohen **gjithmonë** — ueb-i nuk ka asnjë portë “fiskalizim i pakonfiguruar”, sepse
fiskalizimi i shitjeve POS ndodh në vetë arkat. Statusi i dokumentit, i pagesës dhe i fiskalizimit
mbahen veçmas. Çdo dokument mban `batch` (MB-…) dhe historik auditimi.

## Grupet tatimore ATK dhe rrjedha fiskale

Letrat e grupeve tatimore janë ato të ATK-së (ligji i TVSH-së 03/L-146 + kuponët e certifikuar SEF):

| Letra | Emri | Norma |
| --- | --- | --- |
| **A** | E liruar nga TVSH | 0% |
| **C** | Norma 0% | 0% |
| **D** | Norma e reduktuar | **8%** |
| **E** | Norma standarde | **18%** |

Harta jeton te `TAX` në `template.html`; produktet mbajnë vetëm letrën, norma derivohet. Librat e
vjetër (letrat para-ATK ku C=8%, D=18%, E=0%) **migrohen automatikisht në ngarkim** (`migrateTax`,
`TAX_MIGRATE`): letra e re zgjidhet nga NORMA e vjetër (C→D, D→E, E→C, A→A; e panjohur→E), normat
dhe çmimet nuk ndryshohen kurrë; `db.taxV = 2` e shënon migrimin (edhe kodet ATK te Tatimet ndjekin
normën e vet). Katalogu për POS-in dërgon për çdo produkt `tax` (letrën) + `rate` — POS-i i shtyp
letrat në kupon pas vlerës së rreshtit dhe në tabelën e TVSH-së, saktësisht si kuponi i certifikuar.

**Rrjedha fiskale (rregulli i arkitekturës):** fiskalizimi konfigurohet **vetëm në secilën arkë**
(POS › Cilësimet, me PIN të menaxherit) — mënyra, mjedisi TEST/PROD, identifikuesit (NUI, Branch ID,
POS ID, Application ID) dhe çelësat/certifikata (çelësi privat nuk largohet kurrë nga arka). Ueb-i
**nuk mban asnjë cilësim fiskal dhe nuk bën asnjë shkrim fiskal**: faqja Cilësime › Fiskalizimi është
monitor vetëm-lexim — gjendja fiskale e çdo arke siç e raporton vetë (heartbeat: mënyra, mjedisi,
versioni, simulatori, kuponët në pritje), radha e transaksioneve dhe statuset fiskale të kuponëve.
Katalogu që i dërgohet arkave **nuk përmban bllok fiskal** (POS-i injoron çdo bllok të tillë të vjetër);
letrat/normat për produkt mbeten, se janë të dhëna produkti.

### Paratë
Të gjitha llogaritjet bëhen me **integer cent** (sasia në të mijëta, zbritja në basis points),
kurrë me float. Rrumbullakimi në cent bëhet një herë për rresht: nëntotali → zbritja → TVSH.

## Ndërlidhjet e moduleve (Fatura → Blerje → Financë → Produkte/Stok → Kontabilitet)

Të gjitha regjistrimet jetojnë në një bazë të vetme `db` (`state.db`): `invoices`, `purchases`,
`payments`, `expenses`, `movements` (lëvizjet e stokut), `products`, `customers`, `suppliers`,
`queue` (radha fiskale). Asnjë shifër nuk është e shkruar me dorë — paneli, financat, stoku dhe
ditari kontabël **rrjedhin nga dokumentet**:

| Veprimi | Çfarë ndodh (operacionet te `template.html`) |
| --- | --- |
| Fatura lëshohet (`issueBatch`) | numër FSH, lëvizje stoku **−sasia** me koston mesatare, kërkesë ndaj klientit, hyrje në radhën fiskale *Në pritje* |
| Pagesë fature (`recordPayment`) | rresht PAG-…, `paid` ↑, statusi Pjesërisht/Paguar, gjendja e bankës/arkës ↑ |
| Anulim fature (`cancelInvoice`) | stoku kthehet, kërkesa hiqet; e fiskalizuar → *Anulim* në radhë; e dështuar/në pritje → kërkesa tërhiqet. Faturat me pagesa nuk anulohen |
| Blerje pranohet (`receivePurchase` / `createPurchase`) | lëvizje stoku **+sasia** me çmimin e blerjes, kosto e fundit e produktit përditësohet, detyrim ndaj furnitorit |
| Pagesë blerjeje | PAG-… dalje, banka/arka ↓, statusi i blerjes |
| Shpenzim (`addExpense`) | SHP-… + pagesë dalje, TVSH e zbritshme te deklarata |
| Inventarizim (`adjustStock`) | diferenca si lëvizje *Rregullim* me koston mesatare |
| Produkt/klient/furnitor i ri | hyn në `db` dhe në të gjitha listat/kërkimet; klienti/furnitori ka **profil** (sirtar) me fatura, pagesa, borxh dhe **Redakto** (riemërimi ndjek dokumentet) |
| **Notë krediti** (`createReturn`, KR-…) | për fatura të lëshuara, sipas rreshtave (deri në sasinë e pakthyer): stoku **kthehet me koston e daljes**, shuma **ul borxhin** e faturës (`creditApplied`) dhe pjesa tjetër **rimbursohet** nga arka/banka (pagesë `refund`); fatura e fiskalizuar → *Notë krediti* në radhën fiskale; nota shtypet si dokument A4 dhe hyn si shitje negative në raporte/TVSH |
| **Kthim te furnitori** (KD-…) | stoku del me çmimin e blerjes, detyrimi ulet ose pritet rimbursim; `cancelReturn` i kthen të gjitha |
| Draft → **Lësho** (`issueDraft`), Profaturë → **Kthe në faturë** | drafti lëshohet me datën e sotme (stok, radhë fiskale); profatura shënohet *Faturuar* dhe lidhet me faturën |
| **Ofertë** (OF-…) → **Porosi** (PS-…) → Faturë | oferta nuk prek asgjë; porosia e hapur **rezervon** sasitë (Stok › Gjendja: Rezervuar, I disponueshëm); “Faturo porosinë” hap formularin e parapërgatitur dhe fatura e mbyll porosinë (lidhje në të dy drejtimet) |
| **Porosi blerjeje** (PB-…) → Blerje | sasitë shfaqen “Në ardhje”; “Prano mallin → Blerje” krijon blerjen me hyrje në depon e zgjedhur |
| **Depo & transferime** (`db.warehouses`, `movements[].wh`, TR-…) | hapja e stokut është te depoja kryesore; çdo lëvizje mban depon; transferimi = dalje + hyrje me koston mesatare (vlera e stokut nuk ndryshon); POS-0002 shet nga Depo Prizren |
| **Printo / PDF / Email** (`printDocs`, `previewHtml`, `emailDoc`) | faturë, profaturë, blerje, notë krediti, ofertë, porosi, fletë-transferim në formatin A4 **“Precision Flow”** (shih më poshtë) përmes dialogut të printimit të shfletuesit (PDF = “Save as PDF” aty); “Pamja A4” shfaq PIKËRISHT të njëjtin dokument në një iframe; email-i hap programin e përdoruesit |
| **Barkodet** (`genBarcodes`, `printLabels`) | produktet pa barkod marrin EAN-13 të brendshëm (prefiks 200, shifra kontrolli e vlefshme); etiketa 50×30 mm me Code 128 (SVG) |

Nga këto derivohen: **Paneli** (KPI-të sipas periudhës Sot / Këtë javë / Këtë muaj / Këtë vit / Gjithçka me
krahasim ndaj periudhës së kaluar, grafiku i 9 muajve nga librat, njoftimet me “Shëno të lexuara”, borxhlinjtë),
**Financë** (Hyrje, Dalje,
Shpenzime, Pagesa, Llogari bankare / Arkë me gjendje rrjedhëse, Bilanci, TVSH mujore, Fitim/Humbje),
**Stok** (Gjendja me koston mesatare dhe vlerën, Lëvizjet, Hyrje/Dalje, Inventar), **Produkte**
(gjendja e llogaritur, Kategoritë, Lista e çmimeve me marzh, sirtari i produktit me historikun e
lëvizjeve) dhe **Kontabilitet** (Ditari me regjistrime të balancuara Dr/Cr për çdo dokument, Plani
kontabël, Bilanci, Fitim/Humbje). `journal()`/`balances()` gjenerohen gjithmonë nga dokumentet, nuk
ruhen. Statusi *Vonuar* derivohet nga afati (`docStatus`), nuk ruhet.

Faqet e listave (Blerje, Financë, Stok, Kontabilitet) përdorin **një template të vetëm**
(`isTable` + `pageTable(page)`), sirtarët e detajeve `drawerVals()` dhe formularët `formVals()`
(Fatura e re, Blerje e re, Pagesë, Shpenzim, Produkt, Inventar, Klient/Furnitor (+ redaktim), Notë krediti / Kthim,
Ofertë, Porosi, Porosi blerjeje, Transferim, Depo). Listat Fatura / Klientë / Produktet kanë **Rendit** dhe **Filtro**
(select-e) dhe eksport CSV real; faqet e tjera Njësitë, Barkodet, Lista e çmimeve, Kontabilitet › Raporte janë të lidhura.

### Ruajtja
Në këtë ndërtim me një skedar, gjithë `db` ruhet në `localStorage` (`kontabo.finance.v2`) pas çdo
veprimi (`commit()`) dhe mbijeton rifreskimin. Te lista e faturave shfaqet "ruajtur lokalisht ·
Rivendos të dhënat demo". Kur të ketë backend, `persist()/load()/commit()` janë pika e vetme që
zëvendësohet me API; operacionet e mësipërme mbeten të njëjtat.

## Kategoritë e produkteve dhe çmimet me/pa TVSH (Produkte)
- **Kategoritë** janë listë e menaxhuar: `db.categories = [{id, name, note}]`. Migrimi (`migrateCats`) e ndërton
  një herë nga kategoritë që mbajnë produktet (id deterministik `K-<slug>`, p.sh. `K-ndertim`) dhe është idempotent —
  kthen të njëjtin objekt kur s'mungon asgjë; në modalitetin me server lista ruhet me `apiCommit({categories})` herën e
  parë dhe pas çdo ringarkimi nga serveri (`apiReloadState`) kur një produkt mban kategori jashtë listës. Produkti e
  mban kategorinë **me emër** (`p.cat`) — katalogu i POS-it dhe raportet lexojnë po atë; payload-i i katalogut dërgon
  shtesë edhe listën `categories` (çelës i padëmshëm). Emri ruhet me shkrimin e regjistrit (`canonCat`): nëse shkruani
  "ndërtim" kur ekziston "Ndërtim", produkti merr "Ndërtim" — filtri i Produkteve dhe raporti sipas kategorisë nuk ndahen.
- **Produkte › Kategoritë** (`#kategorite`): numri i produkteve, nën minimum, vlera, shitjet e muajit; "+ Kategori"
  (emri unik pa dallim shkronjash), "Redakto" (riemërimi përditëson çdo produkt), "Fshi" vetëm kur asnjë produkt s'e
  përdor (ndryshe "N produkte e përdorin"). Te formulari i produktit kombo-ja "Kategoria" liston këtë listë; një emër i
  ri i shkruar krijohet me ruajtjen.
- **Formulari i produktit** (i ri dhe "Redakto" nga sirtari i produktit) ka dy çifte të sinkronizuara: *Kosto e blerjes
  pa TVSH ⇄ me TVSH* dhe *Çmimi i shitjes pa TVSH ⇄ me TVSH*, sipas shkronjës tatimore (A/C 0 %, D 8 %, E 18 %).
  **Çmimet pranojnë deri në 4 numra pas presjes** (kërkesa e ATK-së për SEF, neni 26): ruhen në **të dhjetëmijëta**
  (`price_t`, `cost_t`, `toT`/`fromT`/`fmtT`) **krahas centëve** `price_c`/`cost_c` = të dhjetëmijëtat e rrumbullakuara
  (`cOfT`) — çdo libër që punon me cent (fatura, stoku, ditari, raportet) vazhdon të lexojë centët; librat e vjetër pa
  `price_t` lexohen si `price_c × 100` (`priceT(p)`/`costT(p)`). Rregulli i çiftit punon në 4 decimale:
  `bruto = round(neto × (100+rate)/100)`, `neto = round(bruto × 100/(100+rate))` (`grossOfT`/`netOfT`). Ana **neto**
  është e vërteta që ruhet; ndërrimi i shkronjës tatimore ri-llogarit vetëm anën bruto nga neto, kështu që ndërrimet e
  përsëritura nuk "rrëshqasin". Shembull @18 %: bruto 2.20 → neto **1.8644** (dhe kthehet saktë në 2.20); neto 1.86 →
  bruto 2.1948; neto 18.50 → bruto 21.83. Vlerat shfaqen me **2 decimale, me 4 vetëm kur ka saktësi nën cent**
  (lista e produkteve, sirtari, Lista e çmimeve, etiketat, CSV). Katalogu i POS-it dërgon për çdo produkt `price_c`
  (kontrata e vjetër, cent neto) **dhe** `price_t` (të dhjetëmijëta neto) **dhe** `gross_t` (bruto, shih më poshtë).
  **Çmimi bruto fjalë për fjalë (`gross_t`)**: jo çdo bruto 4-shifror arrihet nga një neto në të dhjetëmijëta (Shtojca F
  p79: 1.5068 @ 18 % — neto 1.2769 jep 1.5067, 1.2770 jep 1.5069), prandaj formulari i produktit ruan **edhe anën bruto
  siç qëndron në formular** (`gross_t`, e shkruar ose e nxjerrë) krahas netos; `grossT(p)` e shfaq dhe e dërgon te arkat
  **fjalë për fjalë** sa kohë përputhet me neton brenda **një centi** (një bruto e mbetur nga para ndryshimit të shkronjës
  tatimore / të regjistrimit në TVSH injorohet dhe bruto rrjedh prapë nga neto). Lista e produkteve, sirtari, Lista e
  çmimeve, etiketat dhe katalogu (`gross_t`) shtypin të njëjtin numër që arka shtyp në kupon (3 × 1.5068 = 4.52).
  Rreshtat e kuponëve POS të importuar mbajnë `gross_t` kur arka e dërgon.

## Njësitë, recetat dhe “Shfaqe në POS” (Produkte)

- **Njësitë** (`UNITS`): copë, m, m², m³, kg, **l**, pako, **shishe**, **gotë**, thes, kovë — kombo te formulari i produktit.
  Copë, pako, shishe, gotë, thes dhe kovë numërohen me numra të plotë (`INT_UNITS`), të tjerat me deri në 3 decimale; çmimi
  është për njësi. Produkte › Njësitë tregon për çdo njësi produktet, gjendjen, vlerën, shitjet e muajit dhe decimalet.
  Njësia **kyçet** (`unitLocked`) sapo produkti ka gjendje fillestare, lëvizje stoku (edhe shitje të arkave nga libri i
  serverit), përdoret në një recetë ose është në një dokument draft.
- **Receta** (formulari › **Lloji**: *Mall me stok* / *Recetë (nga përbërësit)*; `p.recipe = [{sku, qm}]`): përbërësit janë
  vetëm mall me stok, sasia në njësinë e përbërësit për 1 njësi të shitur — për litrin pranohen edhe `cl`/`ml` (`recipeQm`:
  4 cl = 0.04 l). Një nivel i vetëm (përbërësi s'ka recetë, produkti që është përbërës s'bëhet recetë); produkti me gjendje,
  lëvizje ose dokumente draft nuk bëhet recetë (`recipeError`). Receta **nuk ka stok as kosto të vetën**: kostoja = kostoja
  mesatare e përbërësve (`recipeCost`, me marzhin te formulari), gjendja = sa mund të bëhen nga përbërësit (`makeQm`, edhe për
  depo). Kur shitet (faturë, importi lokal i kuponëve) dalin nga stoku **përbërësit** (lëvizje me `via` = SKU e recetës,
  rrumbullakim gjysma larg zeros), kurrë vetë receta; nota e kreditit i kthen përbërësit pro rata me koston e daljes; në
  importin lokal të kuponëve kthimi i një artikulli recetë kthen paratë pa rikthyer përbërës (i shërbyer = humbje). Receta
  nuk blihet, nuk porositet te furnitori, nuk transferohet, nuk numërohet dhe nuk i kthehet furnitorit. Me librin e POS-it në
  server konsumin e recetës e regjistron serveri (i ngrirë me kuponin).
- **“Shfaqe në POS”** (`p.pos`, parazgjedhje *Po — shitet në arkë*; *Jo — vetëm në ERP*): katalogu i arkave
  (`posCatalogPayload`) mban vetëm produktet e shfaqura; një recete i dërgohet si stok sasia që lejojnë përbërësit (`stock_qm`,
  `stock_by_wh`), vetë receta dhe paketimi nuk dalin kurrë nga ERP-ja. Një katalog me zero produkte të shfaqura nuk dërgohet
  kurrë (arka do ta zbrazte listën); me “Dërgo katalogun” shfaqet njoftimi `CAT_EMPTY`.

## Paketimi — blerjet, transferimet dhe numërimi në paketime

Produkti (jo receta) mund të ketë një **paketim** opsional (`p.pack = {unit, qm}`: 1 paketim = `qm` të mijëta të njësisë së
produktit — p.sh. Rum në `l` me *1 shishe = 0.7 l*; njësia e paketimit ndryshe nga ajo e produktit, sasia e plotë për
njësitë me numra të plotë — `packError`). Blerjet, porositë e blerjes dhe transferimet kanë te rreshti
çelësin **“Sasia në”** (njësia e produktit ⇄ paketimi): në paketime shkruhen sasia dhe **çmimi për paketim**, ndërsa ruhen
gjithmonë në njësinë e produktit — `qm = paketime × pack.qm`, `unit_t = çmimi i paketimit × 1000 / pack.qm` (4 decimale) dhe
shuma e rreshtit = paketime × çmimi i paketimit (fatura e furnitorit deri në cent). Lëvizjet, dokumentet dhe stoku nuk e
ndërrojnë kurrë njësinë; paketimet mbeten vetëm si shënim (`12 shishe × 0.7 l`) te sirtari, printimi A4 dhe lëvizja. Porosia →
Blerje vjen e parapërgatitur në paketime për sa kohë produkti ka të njëjtin paketim; kthimi te furnitori çmohet me çmimin për
njësi dhe pjesa e fundit kthen mbetjen e saktë. **Numërimi** (Inventar) ka “Numërimi në”: *12.5 shishe → 8.75 l*, diferenca
regjistrohet në njësinë e produktit dhe numërimi në paketime shënohet te shënimi. Gjendja, Produktet dhe sirtari i produktit
tregojnë ekuivalentin `≈ 12 shishe` (`packEq`). Rreshtat e shitjes nuk janë kurrë në paketime.

## Kompania pa TVSH · blloku tatimor · kuponët me 4 decimale (agjenda e testit ATK, aplikimi 70754265)

- **E regjistruar në TVSH** (Kompania › Të dhënat e kompanisë — i njëjti çelës `taxSettings.vatRegistered` si te
  Cilësime › Tatimet) + **Numri i TVSH-së** (`company.vat`). Katalogu i dërgon te arkat në bllokun `company`:
  `vatRegistered` (true/false) dhe `vatNo` (bosh kur s'është e regjistruar — kuponi nuk shtyp numër TVSH-je).
  Kur kompania **nuk** është e regjistruar (`vatOn()` = false): çdo dokument shitjeje i ERP-së del në **grupin A (0 %)**
  — `effTax(code)`/`effRate(code)` (rreshtat e faturës, Faturimi masiv, Excel-i, formulari i produktit: bruto = neto);
  redaktori i rreshtave ofron vetëm A; fatura e lëshuar ka `vat = 0`, artikujt mbajnë `tax:'A'`; sirtari, pamja A4 dhe
  printimi nuk kanë rresht TVSH-je (kolona e artikullit shfaq **A**), koka s'ka numër TVSH-je; ditari nuk poston TVSH
  (2400). Kuponët POS të importuar regjistrohen po ashtu në A me TVSH 0 (`sub = total`, rreshtat `tax:'A', rate:0`)
  edhe nëse arka ka dërguar ndarje TVSH-je — totali i paguar nuk preket. Shkronjat/normat e produkteve mbeten të
  dhëna: kur regjistrimi rikthehet, gjithçka punon prapë me A/C/D/E. Faturat e vjetra me TVSH > 0 vazhdojnë të
  shfaqin rreshtin e TVSH-së.
- **Numri identifikues i operatorit** (Kërkesat SEF neni 25.18: kuponi mban emrin e punëtorit **dhe** numrin e tij
  identifikues): Kompania › Përdoruesit › sirtari i një përdoruesi me rol POS › **Nr. identifikues për kupon…** ruan
  `users[].opCode` (shkronja/shifra . _ - /, deri në 20; bosh = kuponi shtyp vetëm emrin, si Shtojca F) dhe katalogu e
  dërgon si `operators[].code`; arka shtyp `EMRI I PUNËTORIT: FILAN FISTEKU (ID 1234)`. Në modalitetin API ruhet me
  `PATCH /users/{id}` (`opCode`).
- **Kodi i bllokut tatimor (ATK)** (Cilësime › POS › Pajisjet & puna offline, `posSettings.fiscalBlockCode`) shkon te
  arkat me katalogun si `posSettings.fiscalBlockCode` (i pastruar nga hapësirat). Kuponët e lëshuar nga **blloku i
  veçantë tatimor** gjatë ndërprerjes së arkës (UA 01/2026 neni 45, kërkesat teknike neni 25 pika 16) regjistrohen
  në arkë dhe vijnë te ERP-ja me `source:"block"` + `block_no` (nr. serik i kuponit nga blloku), `block_code`
  (seria/kodi), `block_ts` (koha e lëshimit). ERP-ja i regjistron si shitje të zakonshme (stok, arkë, ditar, radhë
  fiskale) me `source/blockNo/blockCode/blockTs` te `db.posReceipts`; POS › Shitje tregon nën numrin e kuponit
  **“nga blloku tatimor nr. …”**, sirtari ka rreshtin “Blloku tatimor”, radha fiskale e njëjtën etiketë.
- **`importPosSales` — fushat e reja që kupton nga POS-i** (të gjitha opsionale, një POS më i vjetër lexohet si më parë):
  `item.qty_q` (sasia në të dhjetëmijëta, 4 decimale — ka përparësi ndaj `qty_m`; stoku lëviz me sasinë e
  rrumbullakuar në të mijëta, paratë janë ato që llogariti arka), `item.unit_t` (çmimi neto për njësi në të
  dhjetëmijëta — ka përparësi ndaj `unit_c`, ruhen të dy), `item.disc_c` (zbritja e rreshtit **në vlerë**, cent, krahas
  `disc_bp` në %), `item.tax` (shkronja ATK e shtypur në kupon; pa të, derivohet nga norma), `receipt.cancel_reason`
  (ose `reason`) te kuponi i anulimit — ruhet te anulimi **dhe** te origjinali (`cancelReason`), shfaqet te sirtari
  (“Arsyeja e anulimit”) dhe te radha fiskale (“… · Arsyeja: …”). Sirtari i kuponit tregon sasinë/çmimin me 4 decimale
  kur POS-i i dërgoi ashtu, zbritjen në % ose “−€x”, dhe shkronjën + normën (`E · 18%`).

## Formati A4 i faturës — “Precision Flow”

Dokumentet e printuara ndjekin dizajnin e pronarit (“Kontabo ERP Fatura Dizajn”, `docPrintHtml` + `PRINT_CSS` + `PRINT_PAGER`):

| Çfarë | Si |
| --- | --- |
| Faqja | A4 portret, margjina 15 mm (20 mm poshtë), `@page{size:A4;margin:0}`; shiriti i theksit 0,8 × 34 mm lart majtas |
| Tipografia | **IBM Plex Sans** (i ngulitur në bundle si skedar variabël latin + latin-ext, 100–700) → Manrope → fonti i sistemit; bazë 9,5 pt, etiketa 7,5 pt, “FATURË” 24 pt, totali 14 pt, mbetja 12 pt; numrat `tabular-nums` |
| Numrat | format evropian vetëm në print: `1.250,00 €` (`fmtEu`) — ekrani ruan formatin e vet |
| Koka | logo (monogram / emër / pa logo) + të dhënat e kompanisë majtas; titulli, numri, barkodi Code 128 dhe data/afati/monedha djathtas |
| Brezi | FATURUAR PËR (ose FURNITORI/KLIENTI) + REFERENCA (nr. i dokumentit, referenca, arsyeja, nr. fiskal) |
| Tabela | Nr. · Përshkrimi (+ SKU poshtë) · Njësia · Sasia · Çmimi/njësi · [Zbritja] · TVSH · Shuma; `table-layout:fixed`, qeliza 2 mm / 1,5 mm |
| Përmbledhja | Nëntotali → [Zbritja e rreshtave] → Baza e tatueshme → një rresht TVSH-je **për çdo normë** → Totali → [Paguar] → Mbetja. Shkalla mbyllet gjithmonë; kur fatura ka zbritje totale (bruto, e shpërndarë në rreshta) shfaqet “Vlera para zbritjes → Zbritje në faturë → Baza” |
| Pagesa | Përfituesi, banka, IBAN, SWIFT (opsional), mënyra, referenca, afati + falënderimi dhe kushtet e pagesës |
| Fundi | nënshkrimet (opsionale), shënimi i fundit nga Cilësimet, footer-i me “Gjeneruar me Kontabo ERP” (opsional), nr. fiskal dhe **“Faqe X nga Y”** |
| Faqezimi | `PRINT_PAGER` mat lartësitë reale në dokumentin e printimit: header-i i tabelës përsëritet, asnjë rresht nuk ndahet, blloku i përmbledhjes mbahet i pandarë (nëse s'hyn, rreshti i fundit kalon bashkë me të), faqet pasuese kanë kokën e shkurtër “… · vazhdim” dhe shënimin “Vazhdon në faqen tjetër →” |

Cilësime › Faturat › **Pamja e faturës A4**: logoja, ngjyra e theksit, SWIFT/BIC, kushtet e pagesës dhe çelësat për barkodin, kolonën e zbritjes, nënshkrimet dhe brandimin. Shablloni **“Minimal”** = varianti me pak bojë (sfondet bardh, vija navy).
QR-ja e dizajnit nuk vizatohet: ERP-ja nuk ka ende gjenerues QR dhe një kod demonstrues te një faturë do të ishte çorientues.

## Hyrja (login)

Aplikacioni hapet me ekranin e hyrjes (email + fjalëkalim, “Mbaj mend në këtë pajisje”, shfaq/fshih fjalëkalimin,
5 tentime të gabuara → bllokim 30 s). Përdoruesit janë `db.users`; fjalëkalimi ruhet vetëm si `sha256(salt:pw)`
(`pwSalt/pwHash`, si PIN-et e POS-it) dhe **nuk dërgohet kurrë te POS-i**. Fjalëkalimi i parazgjedhur i llogarive demo
është `kontabo` (paralajmërim derisa të ndryshohet te Cilësime › Llogaria › Ndrysho fjalëkalimin; pronari mund ta
rikthejë nga sirtari i përdoruesit). Sesioni (`kontabo.finance.session`) ruhet në `localStorage` ose `sessionStorage`;
“Dil” e mbyll. Çdo veprim, pagesë dhe rresht i audit log-ut mban emrin e përdoruesit të kyçur (`who()`).
Në këtë ndërtim verifikimi kryhet në shfletues — me backend-in hyrja, 2FA dhe rikuperimi kalojnë në server.

## Modaliteti me server (kontabo-backend)

Te ekrani i hyrjes → **Serveri** → shkruani adresën e backend-it (`http://127.0.0.1:8800/api/v1`, shih `../kontabo-backend/README.md`)
→ **Lidhu**. Që nga ai moment faqja punon si **klient i API-së** (`apiFetch`, `apiLogin`, `apiLoadAll`, `apiCommit`):

| Çfarë | Lokal (pa server) | Me server |
| --- | --- | --- |
| Hyrja | hash në shfletues, `kontabo` | `POST /auth/login` (bcrypt, JWT + refresh me rotacion, bllokim 5×30 s), ftesa dhe rikuperimi i fjalëkalimit reale (token-i kthehet nga serveri në zhvillim, me SMTP vjen me email) |
| Përdoruesit, rolet, PIN-et | `db.users`/`db.roles` në localStorage | `/users`, `/roles`, `/users/{id}/pin` — pasqyrohen në `db.*` për t’u shfaqur njësoj |
| Fiskalizimi | s’ka konfigurim në ueb — monitor vetëm-lexim | njësoj: **asnjë thirrje `/fiscal`** (as GET, as PUT) — gjendja për arkë vjen me heartbeat-et e terminaleve (`/pos/status` → `terminals[].fiscal`) |
| Librat e kompanisë (fatura, blerje, stok, financë…) | `kontabo.finance.v2` | `tenant_state` në server: `GET /state`, çdo `commit()` → `POST /state/commit {baseVersion, patch}`; 409 → gjendja e serverit fiton, ndryshimi lokal hidhet me njoftim; offline → patch-et presin (`kontabo.finance.pending`) dhe ridërgohen |
| Audit | `db.audit` | `POST /audit`, vetëm shtim |
| Kompani të shumta (kontabilist) | — | lista te menuja e avatarit → `POST /auth/switch-tenant` |

Çelësat në pronësi të serverit (`users`, `roles`, `fiscal`, `audit`, `sessions`, `security`, `profile`, `terminals`) nuk dërgohen
kurrë me `/state/commit`. Tenant-i i ri farëzohet nga klienti me **libra bosh** (`seedEmpty`: kompania nga tenant-i, një degë, një
depo, një llogari bankare + një arkë, asnjë faturë/produkt/klient) në hyrjen e parë — të dhënat demo (`seedDb`, ABC SH.P.K.)
ekzistojnë vetëm në modalitetin lokal. Pronari mund t’i zbrazë librat e kompanisë në server nga fundi i faqes Fatura →
**Zbraz librat e kompanisë** (konfirmim; përdoruesit, rolet, terminalet dhe fiskalizimi mbeten; shënohet në audit).
Kur faqja shërbehet nga vetë serveri (Nginx: ERP + `/api/v1` në të njëjtin origin — p.sh. AWS), lidhja bëhet vetë dhe rreshti
**Serveri** nuk shfaqet fare. Butoni **Lokal** (vetëm në ndërtimin lokal) e kthen faqen në modalitetin pa server.

**Regjistrimi i një kompanie të re** (ekrani i hyrjes → **Regjistro kompaninë**, vetëm me server — në ndërtimin lokal linku
tregon njoftimin “kërkon backend”): pamja `signup` kërkon emrin e kompanisë (NUI 6–12 shifra dhe qyteti opsionalë), emrin e plotë,
email-in dhe fjalëkalimin (min. 8, i përsëritur; butoni ndizet vetëm kur gjithçka është valide — `lCanSignup`) dhe dërgon
`POST /auth/signup {company:{name,nui,city}, name, email, password, remember}` pa bearer (`apiSignup`; NUI/qyteti bosh
dërgohen si `""`). Përgjigja është e njëjta me `/auth/login` me kompaninë e re si tenant aktiv → `apiEnter` → paneli i kompanisë së re,
librat farëzohen bosh në ngarkimin e parë (kartela e kompanisë merr NUI-n/qytetin e formularit); pas suksesit dhe në dalje formulari
zbrazet i tëri (`signupBlank`), që një kompani e dytë në të njëjtin kompjuter të mos trashëgojë NUI-n e vjetër. Email me llogari
ekzistuese + fjalëkalimi i saj = kompania i shtohet llogarisë; fjalëkalim i gabuar = `invalid_credentials` me numërues tentimesh dhe
bllokim si te hyrja (dështimi i 5-të vjen me `failsLeft:0` + `retryAfter` dhe shfaqet si “llogaria u bllokua për N s”, jo “edhe 0
tentime” — njësoj te hyrja). Gabimet shfaqen në shqip sipas `e.code` (`duplicate_name`, `duplicate_nui`, `invalid_credentials`,
`email_invited` — email me ftesë në pritje, pranohet vetëm nga lidhja e ftesës, `locked`, `signup_disabled` — flag-u “signup” te
Admin › Planet & flags, `too_many_requests` — limit për IP, `weak_password`/`validation_error` = mesazhi i serverit).
Baneri “Provë falas — Edhe N ditë” llogaritet nga tenant-i i serverit (`tenant.createdAt` + `trialEndsAt`, ruhen në `apiCfg`,
`trialInfo()`), rifreskohet çdo ditë pa hyrje të re dhe s'bie kurrë nën 0; pa server bie te 14 ditët e premtuara në ekranin e regjistrimit.

**Admin i platformës** (`admin@kontabo.app`, pa anëtarësi kompanie): hyn drejt në panelin Admin me një skelet bosh — kompanitë,
planet, flag-et, përdoruesit e të gjitha kompanive (`GET /admin/users`) dhe audit-i vijnë nga `/admin/*`; nuk sheh kurrë libra demo
dhe nuk hyn dot në ERP-në e një kompanie pa llogari kompanie.

**Terminalet POS** (POS › Arkat): **+ Terminal** krijon rekordin (`POST /terminals`) dhe tregon token-in `kt_…` **vetëm një herë**;
POS-i (v0.6.0, Cilësimet › Serveri Kontabo) sinkronizon vetë me serverin, kjo faqe i tërheq kuponët/ndërrimet nga `/pos/sales`
(`posSyncServer`, çdo 15 s ose **Sinkronizo nga serveri**) dhe dërgon katalogun me `PUT /pos/catalog` sa herë ndryshon. Një server
me librin e POS-it (`posLedger:1`) e zëvendëson këtë rele — shih “Libri i POS-it në server” më poshtë.

## Raportet · Kompania · Cilësimet · Admin paneli

**Raporte** (`morePages()`, çelësat `R:…`): Shitje (sipas klientit / artikullit / muajit / faturat),
Blerje, Financë (fluksi i parasë, aging i kërkesave dhe i detyrimeve, shpenzimet sipas kategorisë),
Stok (gjendja sipas kategorisë, lëvizjet sipas artikullit, rotacioni/mbulimi), POS (ndërrimet e arkës nga
`db.pos`), TVSH (përmbledhje, **Libri i shitjes**, **Libri i blerjes**). Periudha (ky muaj / i kaluari / viti /
gjithçka) dhe **Eksporto CSV** (real, `exportCsv()`) te çdo tabelë. HR/Prodhim shfaqin gjendjen e modulit,
pa të dhëna të simuluara.

**Kompania**: Të dhënat e kompanisë (autosave → koka e faturës A4, email-i dërgues, fiskalizimi),
Degët (+ formular, ID BR-…), Përdoruesit (`db.users`, ftesë me formular → *Ftuar*, sirtar me pezullim),
Rolet (matricë rolesh × lejesh me çelësa, Pronari i kyçur, audit log).

**Cilësime**: Llogaria, Abonimi (çmimet vijnë nga planet e platformës), Pagesat, Siguria (sesionet,
audit log), Njoftimet (matricë ngjarje × kanal), **Fiskalizimi — vetëm lexim (konfigurohet në secilën
arkë)**: tabela e arkave me mënyrën/mjedisin/versionin/simulatorin dhe kuponët në pritje siç i raporton
çdo arkë (heartbeat), radha e transaksioneve, statuset fiskale të kuponëve, udhëzuesi “si konfigurohet
në arkë” dhe grupet tatimore ATK — **asnjë fushë konfigurimi dhe asnjë shkrim fiskal**; POS (rregullat,
pagesat, printeri si pajisje printimi), Faturat (afati i parazgjedhur → formularët, teksti i fundit → A4, QR/banka), Tatimet,
Email (shabllone me vendmbajtës), Integrimet (statuse reale), API (çelësa të gjeneruar lokalisht, shfaqen
një herë, ruhet vetëm prefiksi; revokim).

**Admin paneli** (avatar → “Paneli i administratorit”, ose `#admin`; `ADMIN_NAV`, çelësat `A:…`,
`db.admin`): Përmbledhje (MRR/ARR, vëmendje), Kompanitë/tenantët (sirtar: pezullo/riaktivizo, ndrysho
planin, hap si kompania), Abonimet, Faturat e platformës, **Planet & çmimet** (ndryshimi shfaqet menjëherë
te Abonimi i kompanisë), **Modulet & flags** (fikja e një flag-u heq modulin nga navigimi i kompanive),
Përdoruesit e platformës, Administratorët, Agjentët fiskalë, Radha globale, Audit log, Cilësimet e
platformës (PROD i bllokuar pa certifikatë prodhimi), Statusi i sistemit.

Rregull i përgjithshëm: veprimet që kërkojnë backend (email, 2FA, pagesa, PROD) shfaqin njoftim **portokalli
“kërkon backend”** — kurrë sukses të rremë (`needsBackend()`).

## POS-i desktop (Python) dhe sinkronizimi

POS-i është program më vete në `../kontabo-pos/` (shih README-në atje). ERP-ja është **klienti** i API-së
lokale të POS-it (`db.posSync`: URL, token, interval, kursor; `posSync()` / `posPushCatalog()` /
`posPull()` / `importPosSales()` te `template.html`). Sa herë sinkronizon: `/health` → merr kuponët e rinj
(`/sales?since=kursor`) → i regjistron → `/ack` → ridërgon katalogun nëse ka ndryshuar (stoku i freskët,
letrat tatimore, klientët, koka e kuponit — **pa asnjë konfigurim fiskal**). Faqet POS › Arkat / Shitje / Kthime / Operatorët / Mbyllja e arkës /
Raportet e arkës dhe **Hap POS-in** (udhëzimet + statusi) lexojnë nga `db.posReceipts` / `db.posShifts`.
Kuponët POS hyjnë në shitjet e panelit, TVSH-në, Fitim/Humbjen dhe ditarin (`salesDocs()`), me kthimet
negative; fatura A4 e gjeneruar nga një kupon (`invoiceFromReceipt`) shënohet `fromPos` dhe nuk numërohet dy herë.

**Statuset e kuponit që kupton `importPosSales`** (`status` i kuponit siç e dërgon POS-i, direkt ose përmes serverit):
`final` (shitje) · `return` (kupon kthimi, shumat negative, `orig_id` → shitja) · `returned` (shitja që u kthye → *Kthyer*) ·
`cancel` / `void` (të dyja shkrimet; edhe `cancelled`/`canceled`/`voided`). Kuponi me status anulimi **dhe referencë**
(`orig_id`, `reference_id`, `ref_id`, ose `orig_no`/`reference_no`/`ref_no` me numrin) është **kuponi i anulimit** (kuponi
ATK i tipit CANCEL): regjistrohet si dokument më vete `Anulim kuponi POS` me status *Anulim*, **kthim i plotë** i origjinalit —
stoku hyn prapë (lëvizje `sale_cancel` = “Anulim shitje”, me koston mesatare), paratë dalin nga arka (`dir:'out'`) dhe/ose
karta nga banka, ditari rikthen të ardhurat/TVSH-në dhe koston e mallit, dhe në radhën fiskale futet rreshti me llojin
**Anulim** (`txId` = `atk_transaction_id` i POS-it, `origNo` = kuponi i anuluar, arsyeja “Anulim i kuponit … · ATK …”).
Shumat e anulimit merren gjithmonë me shenjë negative pavarësisht si i dërgon POS-i; nëse kuponi i anulimit vjen **pa rreshta**,
pasqyron origjinalin (edhe kur vjen para tij në të njëjtin paketë — origjinalët përpunohen të parët). Origjinali shënohet
*Anuluar* (`cancelId`/`cancelNo`) dhe nuk humb kurrë këtë status në ri-sinkronizim; statusi `void` pa referencë është
thjesht origjinali i anuluar (*Anuluar*). Idempotent sipas UUID-së së kuponit si çdo kupon tjetër: ri-tërheqja e të njëjtit
anulim rifreskon vetëm fushat fiskale, kurrë stokun/paratë. Në POS › Shitje të dy kuponët mbajnë etiketën **Anuluar** (nën-teksti
tregon lidhjen), sirtari i secilit lidh tjetrin (“Anulimi …” / “Kuponi origjinal …”) dhe tregon transaksionin ATK; kuponi i
anuluar nuk gjeneron dot faturë A4. Raportet, paneli dhe TVSH-ja i marrin nga `salesDocs()` — shitja + anulimi = zero neto.
**Serveri (`kontabo-backend`, `app/pos_relay.py RECEIPT_STATUSES`)**: POS-i dërgon saktësisht `cancel` për kuponin e ri të
anulimit dhe `void` për freskimin e statusit të origjinalit; lista e bardhë e serverit sot ka vetëm `final / returned / return /
void` — derisa të shtohet `cancel`, serveri e refuzon atë rresht me 400 `validation_error`, POS-i e kapërcen (mbetet në pritje
te arka, riprovohet pas rinisjes) dhe kalimi lokal `/sales` i faqes së ERP-së e sjell anulimin pa ndryshim.

**Zbritja totale e faturës** (`discount_total_c`, cent): POS-i e ka shtyrë tashmë në totalet e rreshtave (ashtu e kërkon shërbimi
ATK), kështu `sub_c + vat_c = total_c = paguar`. ERP-ja e ruan si `discount` te kuponi dhe te fatura A4 e gjeneruar prej tij
dhe e tregon si rreshtat “Totali para zbritjes” / “Zbritje totale” (sirtari i kuponit, sirtari i faturës, pamja A4 dhe printimi
`docPrintHtml`), ndërsa Nëntotali/TVSH/Totali mbeten neto — totali i A4-ës është gjithmonë i barabartë me shumën e paguar.
**PIN-et e operatorëve** (POS › Operatorët → “Cakto/Ndrysho PIN”, 4–6 shifra, parazgjedhje 0000) ruhen si
`sha256(salt:pin)` te `db.users[].pinHash/pinSalt` (`sha256()` sinkron në JS) dhe udhëtojnë te POS-i vetëm si hash.

## Libri i POS-it në server (`posLedger:1`)

Kur `GET /health` i serverit liston `posLedger:1` (kontabo-backend), kuponët e arkave **nuk ruhen më në librin e kompanisë**
(`tenant_state`): serveri e regjistron vetë çdo kupon (kostot, llogaritë, depoja dhe konsumi i recetave ngrihen një herë) në
**rreshta libri** — një për arkë-ditë (*Përmbledhje ditore*), një për çdo kupon me NUI të blerësit dhe, për muajt e mbyllur, një
për arkë-muaj (më poshtë). ERP-ja i lexon me `GET /pos/ledger?since=&limit=200` (në çdo ngarkim nga e para, pastaj çdo 15 s), i
mban në memorie (`_ledger`) dhe **nxjerr** prej tyre dokumentet, lëvizjet e stokut, pagesat dhe ndërrimet: `view()` = libri +
rreshtat e nxjerrë (`_srv`). Stoku, arka/banka, ditari, raportet, TVSH-ja, paneli, P:Arkat dhe P:Operatorët lexojnë kështu
librin bashkë me rreshtat e serverit; asgjë e nxjerrë nuk dërgohet me `/state/commit` dhe tik-u i POS-it nuk bën commit. Releja e
vjetër (`/pos/sales`, `/pos/ack`) nuk punon; katalogu shkon me `PUT /pos/catalog` (stoku = libri + rreshtat e serverit) vetëm
pasi rreshtat të jenë ngarkuar dhe libri të ketë kaluar. Çdo thirrje mban `X-Kontabo-Client: 2`.

- **P:Shitje / P:Kthime** dhe skeda **“Kuponët”** e monitorit fiskal (kuponët e pafiskalizuar të 365 ditëve të fundit) i lexojnë
  kuponët veç e veç nga `GET /pos/receipts` (periudha Sot / 7 ditë / Ky muaj / 31 ditë ose me data, arka, statusi, kërkimi; 50
  për faqe + “Shfaq më shumë”). Lista **rifreskohet vetë çdo 30 s** sa kohë faqja është e hapur dhe skeda e shfletuesit e
  dukshme — në heshtje, me të njëjtat filtra dhe të gjithë rreshtat e ngarkuar (mbi 200 në faqe nga 200, deri në 1000), pa
  prekur filtrat, faqet dhe sirtarin; kuponët e rinj dalin lart.
- Sirtari i kuponit (`GET /pos/receipts/{id}`) tregon kuponët e lidhur (origjinali, kthimet, anulimi); **Fatura A4** krijohet
  vetëm nga një kupon i finalizuar, një herë, si faturë `fromPos` pa shitje, stok apo fiskalizim të dytë. Sirtari i përmbledhjes
  ditore tregon operatorët, fiskalizimin, kuponët e pafiskalizuar, artikujt neto dhe pagesat; “Shiko kuponat e ditës” hap
  P:Shitje me atë arkë dhe datë.
- Me të njëjtin server çelësat te Cilësime › API mbahen në server (`/api-keys`) dhe P:Arkat ka “Rigjenero tokenin” për
  terminalin (`POST /terminals/{id}/rotate`).

**Kalimi në ngarkimin e parë** (`posLedgerMigrate`): një libër i vjetër me kuponë të importuar kalon automatikisht kur e hap
pronari ose një përdorues me leje POS, pasi të jenë dërguar ndryshimet e padërguara: `POST /pos/receipts/known` → `POST
/pos/ledger/activate` (vlerat e ngrira nga libri, kuponët legacy, pastaj `done`) → pritet që serveri të jetë gati → **një
commit** që heq nga libri kuponët që serveri i ka, bashkë me lëvizjet, pagesat, rreshtat e radhës fiskale dhe ndërrimet e tyre,
dhe e shënon librin (`posLedgerV: 1`, `posLegacyNos`). Kuponët që serveri nuk i ka, ose i ka me gabim / në pritje të origjinalit /
të përjashtuar, mbeten në libër si *legacy* dhe serveri i përjashton përgjithmonë — asnjë kupon nuk numërohet dy herë. Kalimi
shkruan një rresht audit-i dhe, kur totalet e POS-it të një muaji ndryshojnë, një dialog të vetëm me diferencat (libri i vjetër →
serveri). Është idempotent (409 → përsëritet); derisa të kryhet faqja tregon vetëm librin, me banerin “Libri i POS-it po kalon në
server”. Në çdo ngarkim të mëvonshëm `posLedgerReconcile` heq rreshtat POS jo-legacy që mund t'i ketë rikthyer një ndërtim i
vjetër. Një kompani e re në këtë server lind me `posLedgerV: 1` (pa kalim); “Zbraz librat e kompanisë” zbraz edhe librin e
POS-it (`POST /pos/ledger/reset`).

### Rreshtat mujorë

Për një muaj të mbyllur serveri mund t'i bashkojë ditët e një arke në **një rresht** `kind:'month'` (`M:<arka>:<YYYY-MM>`, data =
dita e fundit e muajit, nr. `POS-<posId>-<YYYYMM>-<key6>`); rreshtat ditorë vijnë si tombstones dhe zhduken. ERP-ja e lexon si
përmbledhjen ditore: dokumenti *Përmbledhje mujore · <arka>*, pagesat `POS-<YYYYMM>-<key6>` (+`K` për kartën), regjistrimi
“Përmbledhje mujore POS” në ditar dhe lëvizjet me kostot e ngrira — me totale identike me ditët që zëvendëson (stoku, arka,
raportet, TVSH-ja, paneli). Sirtari tregon muajin, numrin e kuponëve, ditën e parë–të fundit dhe operatorët e mbledhur; “Shiko
kuponat e muajit” hap P:Shitje me atë arkë nga data 1 deri në fund të muajit. Një rresht mujor nuk numërohet kurrë si “sot”.

### Propozimet e KONTABO BAR (`posProposals:1`)

Kur `GET /health` liston edhe `posProposals:1`, produktet dhe kategoritë që një bar (KONTABO BAR) i krijon ose i ndryshon vijnë si
**propozime** `{key, kind, before, after, sku}`. Në çdo tik të librit të POS-it (pas ngarkimit, çdo 15 s) **vetëm** një përdorues me
lejen `produkte` ose Pronari i merr me `GET /pos/proposals?state=pending&limit=200`, i zbaton të gjitha në **një commit** dhe, pasi
commit-i të ketë zbritur në server, i mbyll me `POST /pos/proposals/resolve` (`applied` / `partial` / `rejected` + `{sku, applied,
kept, reason}`); kur serveri thotë `more`, vazhdon me grumbullin tjetër. Pa veçorinë, ose pa leje, nuk lexohet asgjë.

- **Fiton ERP-ja** (bashkim me tri anë, fushë për fushë: emri, kategoria, çmimi me TVSH `gross_t`, TVSH-ja — shkronja ose norma e
  barit −1/0/8/18 → A/C/D/E —, njësia, “Shfaqe në POS” = `active && !ingredient`): vlera e barit merret vetëm aty ku vlera e ERP-së
  është ende ajo që bari pa (`before`); një fushë që mungon te `before` llogaritet si e ndryshuar nga ERP-ja, përveç kur ERP-ja e ka
  tashmë vlerën e barit. Njësia ndjek kyçjen (`unitLocked`, edhe me lëvizjet e librit të POS-it) dhe rregullin e paketimit. Çmimi
  bruto ruhet siç vjen, neto (`price_t` / `price_c`) llogaritet prej tij si te formulari i produktit, me normën e shkronjës (së re).
  Stoku dhe kostoja nuk preken kurrë.
- Produkti gjendet me `sku`, pastaj me `barKey` (çelësi i barit), pastaj — vetëm pa `before` — me emrin pa dallim shkronjash të
  mëdha/vogla. **Produkt i ri** (pa `before`, i pa gjetur): SKU `BAR-<numri i lirë i radhës>`, kategoria krijohet po mungoi, kosto
  dhe gjendje fillestare 0, `barKey`; një produkt vetëm për receta del i fshehur nga POS-i. Me `before` një produkt që ERP-ja nuk
  e ka nuk krijohet sërish (refuzohet). Receta nuk krijohen kurrë nga bari.
- **Kategoritë** zbatohen të parat: riemërim kur ERP-ja ka ende emrin `before` (kategoria dhe `cat` i çdo produkti të saj — një
  produkt i propozuar me emrin e vjetër bie te kategoria e riemëruar), krijim kur asnjë kategori nuk e ka emrin `after`, përndryshe
  refuzim (ERP-ja fiton).
- **Idempotent**: çdo propozim i trajtuar mbetet në libër te `posProposalsDone` (1000 të fundit, me rezultatin) dhe nuk zbatohet
  dy herë; një që serveri e ka ende në pritje mbyllet sërish me rezultatin e ruajtur. Pas një 409 libri i serverit fiton (edhe
  `posProposalsDone` e ndjek serverin) dhe grumbulli zbatohet sërish mbi të; kur serveri e refuzon commit-in (4xx) libri ringarkohet
  dhe provohet pas 5 minutash. Nuk punon ndërsa ka ndryshime të padërguara ose ndërsa libri i POS-it po kalon.
- Një rresht audit-i për grumbull (“N produkte / M kategori nga KONTABO BAR (arkat): … të zbatuara · … pjesërisht · … të refuzuara
  · të reja: BAR-…”); katalogu shkon sërish te arkat vetë (hash-i ndryshoi) nga një përdorues me leje POS.

## Çfarë NUK bën ky prototip (me qëllim)
- Nuk fiskalizon realisht: faturat vetëm hyjnë në radhë me status *Në pritje*; Fiscal Agent,
  adapterët Tremol/F-Link/ATK dhe nënshkrimi nuk janë pjesë e këtij skedari.
- Nuk ka backend/databazë qendrore — ruajtja është në shfletues.
- Ende pa ndërtuar: **HR** dhe **Prodhim** — shfaqen si faqe me shënimin “modul i pandërtuar”, pa asnjë simulim.
- Printimi/PDF-ja kalojnë nga dialogu i shfletuesit (nuk ka gjenerim PDF në server); email-i nuk dërgohet nga
  aplikacioni (hapet programi i përdoruesit); këto janë pikat e para për backend-in.
- Admin paneli punon mbi të dhënat e këtij skedari: tenantët e tjerë janë rreshta përmbledhës (nuk kanë libra
  të vetat); “Hap si kompania” ndërron vetëm emrin në kokë.
- Kontabiliteti është i thjeshtuar (11 llogari, kosto mesatare, pa amortizim/paga si detyrime).
- Draftet marrin numër FSH sikurse në të dhënat demo ekzistuese (FSH-2026-00118 është Draft);
  nëse kërkohet numërim vetëm në lëshim, ndryshohet `nextNo` te `issueBatch`.
