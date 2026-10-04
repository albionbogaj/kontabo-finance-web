# Kontabo — çfarë ka mbetur

> **Auditim i ri: 03.10.2026.** Ky krye e zëvendëson auditimin e 13.09.2026, i cili ruhet më poshtë si histori
> dhe **nuk duhet lexuar si gjendje e sotme**: pjesa dërrmuese e „mungon"-ave të tij është ndërtuar ndërkohë.
> Çdo rresht më poshtë është verifikuar sot kundrejt kodit, serverit dhe testeve.

## Çfarë është bërë që nga 13.09.2026 (verifikuar sot)

| Dikur „mungon" | Sot |
|---|---|
| Backend + databazë qendrore | `kontabo-backend` (FastAPI + PostgreSQL), 237 teste; xhiron si shërbimi `kontabo-finance` te albco-server |
| Autentikim, multi-tenant, ftesa, lejet | Te backend-i: JWT + refresh, tenantë, role, ftesa, kyçja e llogarisë, audit log |
| Fiskalizimi real ATK | `pos/atk.py` + `pos/ledger.py`: onboarding në arkë, nënshkrim ECDSA, PosCoupon/CitizenCoupon, QR e qytetarit, zinxhir hash-esh, OFFLINE sipas nenit 26.12 |
| Kuponi sipas Shtojcës F | `pos/receipt.py` + `pos/escpos.py` me 8 etalonë (`golden/`), tekst · HTML · ESC/POS nga i njëjti burim |
| Printimi | Printer termik 80 mm, ESC/POS RAW, letra del vetë pas shitjes (0.13.0) |
| Instaluesi i POS-it + përditësimi | Inno Setup për përdorues (pa UAC) + përditësim automatik me manifest të nënshkruar (0.11.0) |
| Adapteri i printerit fiskal Tremol | `pos/tremol.py` (ZFPLabServer XK, `TremolProvider`, `FakeZfp` në teste) — 0.14.0; mbetet vetëm prova në pajisje reale |
| Librat e TVSH-së + deklarata | Seksion i vetin: libri i shitjes/blerjes në formatin e ATK-së, eksport nga VETË shablloni, deklarata [9]–[72] (04.10.2026) |
| Artikujt për arkë | ERP › POS › *Artikujt e arkave* (matrica artikuj × arka) → katalogu mban `terms`; POS 0.15.0 e zbaton (04.10.2026) |
| Kontot e artikullit | Konto e shitjes / e blerjes për çdo artikull, të përdorura vërtet nga ditari (blerja e shërbimit te 6000, aseti te 1500) (04.10.2026) |
| Fiskalizimi i faturave | Statusi e thotë të vërtetën: „Deklarohet në libër" + Libri i shitjes; agjenti i trilluar u hoq (04.10.2026) |
| Roja e serverit | `watch.sh` çdo 5 min + `GET /system/watch` + njoftimi te paneli (04.10.2026) |
| HR me paga | Punëtorët, pushimet, prezenca, lista e pagave (tatimi progresiv + kontributet), fletëpagesat, ditari (04.10.2026) |
| Importi bankar | Financë › Import bankar: CSV/TSV ose MT940 → pagesa të përputhura me faturat/blerjet e hapura (04.10.2026) |
| Depo git + CI lokal | Katër depo git; `node tools/check-logic.js` (1313), `python kontabo_pos.py --check` (1017), `pytest` (247) |
| Storno pagese | Sirtari i faturës/blerjes → „Storno pagesën" (03.10.2026) |
| SKU i produktit | Caktohet gjithmonë vetvetiu (03.10.2026) |
| ERP në telefon | Shtresa `narrow` + `@media` (03.10.2026) |
| Kopje rezervë, kufizim hyrjesh, CSP | Timer i përditshëm `pg_dump` te disku i kopjeve, fail2ban mbi log-un e Caddy-t, CSP në zbatim (03.10.2026) |

## Çfarë mbetet vërtet (03.10.2026)

**Kërkon pronarin / palë të treta**

1. **Testi teknik i ATK-së** (aplikimi 70754265): konfirmimi i njësisë së çmimit të artikullit dhe i
   rrumbullakimit bruto-së-pari para PROD-it; tri pyetjet e dokumentuara për ekzaminuesin
   (`kontabo-pos/README.md` › „Pyetje për ATK-në në test").
2. **Onboarding-u ATK arkë-për-arkë** (NUI, nr. fiskalizimi, Branch ID, POS ID, Application ID, certifikata).
3. **Dokumentacioni i F-Link-ut** (lista e komandave `.inp`, modeli i printerit) — shih
   `kontabo-pos/docs/ANALIZA-PRINTERET-FISKALE.md`; materiali i Tremol-it është i plotë.
4. **Certifikatë code-signing** për instaluesin (SmartScreen).
5. **Rrjeti**: një rekord DNS lokal `app.kontabo-ks.com → 192.168.1.106` te ruteri, që arkat dhe kompjuterët
   brenda ndërtesës ta arrijnë serverin me emrin publik.
6. **Arkat që ende tregojnë te kontabo.online**: publikimi i release-it edhe atje + token i ri për secilën
   (`deploy/README.md` §5.1).
7. **SMTP** — shtyrë me vendim të pronarit (03.10.2026): ftesat dhe rikuperimi i fjalëkalimit bëhen manualisht
   nga administratori (`POST /admin/tenants/{id}/owner-password`).

**Punë ndërtimi që mbetet**

8. **Adapteri F-Link** (`FlinkProvider`) — Tremol-i është ndërtuar (`pos/tremol.py`, 0.14.0) dhe i mbetet vetëm
   prova në pajisje reale (`kontabo-pos/docs/HAPAT-E-TESTIMIT.md` §12); F-Link-u pret dokumentacionin e pikës 3.
9. **Fiskalizimi elektronik i vetë faturës** — pret ATK-në, jo ne. Më 04.10.2026 u hoq gënjeshtra: ERP-ja nuk
   shkruan më rreshta radhe te një „Fiscal Agent" që nuk ekziston dhe fatura nuk mbetet më „Në pritje"
   përgjithmonë; statusi është „Deklarohet në libër" dhe dokumenti shkon te Libri i shitjes. Kuponët i
   fiskalizon vetë arka. Rruga për faturën ndërtohet vetëm kur të kemi specifikimin SEF të saj: te
   `kontabo-pos/dokumente_atk/` nuk ka asnjë, dhe `pos/atk.py` ndërton vetëm PosCoupon/CitizenCoupon.
10. ~~Numërimi i dokumenteve te serveri~~ — **verifikuar më 04.10.2026: nuk është vrimë.** Serveri punon me
    compare-and-set mbi gjendjen e tenantit (`app/routers/state.py`), prandaj shfletuesi i dytë merr 409, ndryshimi
    i tij hidhet dhe dy fatura me të njëjtin numër nuk shkruhen dot. Mbetet vetëm rehatia: ai që humbet duhet ta
    përsërisë veprimin. Tabela `sequences` përdoret sot nga propozimet e POS-it.
11. **Verifikimi i PIN-eve te serveri ose KDF me pepper** — sot katalogu i terminalit mbart hash-et e PIN-eve;
    ndryshimi prek edhe arkën, sepse PIN-i duhet të vlerësohet edhe pa internet.
12. ~~Monitorimi~~ — **bërë më 04.10.2026**: `deploy/onprem/watch.sh` + timer çdo 5 minuta kontrollon shërbimet,
    `/health`-in, hapësirën e diskut dhe moshën e kopjes rezervë; gjendja lexohet nga `GET /system/watch` dhe
    paneli i ERP-së nxjerr njoftimin „Serveri raporton problem". Njoftimi i jashtëm (Telegram a tjetër) ndizet
    duke vendosur `WATCH_WEBHOOK` te `/etc/kontabo-finance/watch.env`.
13. **Prodhimi / CRM** — 6 faqe meny pa model të dhënash (`genericAdd` → „nuk është ende i ndërtuar").
    ~~HR~~ u ndërtua më 04.10.2026 me vendimin e pronarit („HR me paga"): punëtorët, pushimet, prezenca, orari,
    departamentet/pozitat, lista mujore e pagave me tatimin progresiv dhe kontributet, fletëpagesat dhe hyrja në
    ditar (konto e re 2300). Normat rrinë te Cilësime › Tatimet › „Pagat" dhe duhen konfirmuar me kontabilistin.
14. **Webhooks dhe SMS** — kartela „Së shpejti" te Integrimet; kërkojnë ofrues dhe backend. Importi bankar nuk
    është më aty: u ndërtua më 04.10.2026 (Financë › Import bankar, CSV/TSV ose MT940).

---

# Auditimi i 13.09.2026 (histori — jo gjendje e sotme)

Metoda: spec-i (`Kontabo-Finance-Prompt.md`) u nda në **206 kërkesa** në 22 fusha; secila u kontrollua kundrejt kodit (ERP `src/template.html`, POS `kontabo-pos/`, testet, README). **73 kërkesa** janë të implementuara lokalisht. Çdo pretendim “mungon/pjesërisht” (262 gjithsej) kaloi nga një agjent skeptik që kërkoi implementimin real — asnjë s'u refuzua.

## Përmbledhje

Kontabo Finance ka sot dy nga katër komponentët e spec-it (ERP-ja në shfletues dhe POS-i Python/Tkinter) që punojnë plotësisht lokalisht me ruajtje reale (localStorage / SQLite), radhë fiskale të qëndrueshme, sinkronizim POS↔ERP idempotent dhe rregullin "kurrë sukses të rremë". Pjesa më e madhe e asaj që mbetet varet nga një gjë: nuk ka backend/databazë qendrore, prandaj autentikimi, multi-tenanti, lejet e kontabilistit, email/PDF, abonimet, API-ja dhe rruga browser → backend → agjent janë stub-e ose vetëm lokale. Pjesa e dytë e madhe është fiskalizimi real: Kontabo Fiscal Agent dhe tre adapterët (Tremol, F-Link, ATK) nuk ekzistojnë fare — faturat e ERP-së mbeten "Në pritje" përgjithmonë, QR-ja është kuti bosh, certifikatat/pajisjet/numëruesi "1284" janë të dhëna demo të shfaqura si reale, dhe asnjë test për mënyrat Tremol/F-Link, timeout, pa letër, certifikatë të skaduar apo izolim tenantësh nuk mund të shkruhet pa to. Në ERP dhe POS mbeten edhe një listë e gjatë boshllëqesh funksionale (autorizimi i roleve i pazbatuar, produktet/draftet e paredaktueshme, storno pagese, llogaritë bankare fikse, TVSH pa format të verifikuar, instalues POS, printim ESC/POS, bug-e sync-u) plus dokumentimi që spec-i e kërkon shprehimisht (analiza e burimeve të integrimit, hapat e testimit, udhëzuesi i instalimit, deklarata "një mënyrë për kompani = kërkesë produkti").

## Backend & infrastrukturë (14)

| Prioriteti | Përpjekja | Statusi | Çfarë mungon | Ku (evidenca) |
|---|---|---|---|---|
| must | L | mungon | Backend (ASP.NET Core ose ekuivalent) + databazë qendrore (PostgreSQL): gjithë ERP-ja ruan në localStorage të një shfletuesi të vetëm, pa server dhe pa DB qendrore | `persist()/load()/commit() → localStorage KEY 'kontabo.finance.v2' (template.html:1735-1787); needsBackend() :3448; README 'Nuk ka backend/databazë qendrore'` |
| must | L | vetëm backend | Autentikim server-side: hash-et e fjalëkalimeve, sesioni dhe numëruesi i 5 tentativave jetojnë në localStorage (anashkalohen), security.sessionHours nuk zbatohet kurrë (sesionet s'skadojnë) | `login() :2070, SESSION_KEY/LOCK_KEY :2060-2068, sessionHours pa konsumator (:1760, :2692)` |
| must | M | vetëm backend | Rrjedhat e llogarisë që janë stub: 'Harrove fjalëkalimin?', 'Regjistro kompaninë' (self-signup), pranimi i ftesës (përdoruesit 'Ftuar' s'hyjnë dot kurrë), 'Ridërgo ftesën', regjistrimi 2FA | `lForgot/lSignup :3708, :2078 'Ftesa nuk është pranuar ende (pranimi kërkon backend)', :2639, sec.tog('twoFactor') :2692` |
| must | L | pjesërisht | Izolimi real multi-tenant: pa tenantId në dokumente, pa libra/përdorues për tenant, pezullimi ndryshon vetëm rreshtin; 'Hap si kompania' ndërron vetëm emrin në kokë | `db.admin.tenants (rreshta përmbledhës) :1773; setState({company:t.name}) :2625; README:181-182` |
| must | L | pjesërisht | Lejet e kontabilistit të dhëna veçmas për secilën kompani: pa model grant kontabilist↔kompani; 'Kompanitë e mia' është listë hardcoded ('6 kompani'), '+ Shto kompani' stub, klikimi ndërron vetëm emrin | `firms :3688, '6 kompani' :1070, addCompanyToast → needsBackend :3740` |
| must | L | vetëm backend | Rruga browser → backend → agjent: ERP-ja thërret direkt http://127.0.0.1:8899 (mixed content sapo ERP-ja të servohet me https), intervali i sync kërkon rifreskim faqeje; spec kërkon lidhje dalëse TLS të autentikuar nga agjenti | `posFetch :2092-2095, setInterval fiks :3433, :2708 'hyn në fuqi pas rifreskimit'` |
| must | M | pjesërisht | Skema/migrimet e databazës: pa skemë PostgreSQL/migrime; POS SQLite vetëm CREATE IF NOT EXISTS pa user_version/ALTER (kolonat e reja s'shtohen në pos.sqlite ekzistuese); ERP vetëm kontroll v===2 me back-fill | `pos/db.py SCHEMA :20-45 + executescript :121; load() :1736` |
| must | M | pjesërisht | Ruajtja e të dhënave të ERP-së: një çelës localStorage (~5 MB), pa backup/eksport/import të plotë, pa sync mes tabeve (last write wins), audit 'vetëm shtim, pa fshirje' i pazbatueshëm në klient | `persist() :1735; :3015 pretendimi 'vetëm shtim'; README:113-117` |
| should | M | vetëm backend | Email real (SMTP) me bashkëngjitje PDF: sot vetëm mailto: me subjekt/trup; fromName/fromEmail/replyTo/ccAccountant injorohen; 'Dërgo email test' stub | `:2262 href='mailto:…', :2263 'dërgimi automatik kërkon backend', :2731 needsBackend('Dërgimi i email-it')` |
| should | M | vetëm backend | Gjenerim PDF real: 'PDF' hap dialogun e printimit ('Save as PDF'); 'Shkarko PDF' për faturat e abonimit stub | `:2228 opts.pdf toast; :2688 needsBackend('Gjenerimi i PDF-së…')` |
| should | L | vetëm backend | Abonimet & faturimi i platformës: ndryshimi i planit (pro-rata), metoda e pagesës, anulimi, 'Ritento pagesën' — stub; Mujore/Vjetore dhe ± përdorues editojnë vetëm db.subscription; nextBilling '01.10.2026' hardcoded ushqen edhe alertin e panelit | `:3736-3739 setMonthly/incUsers + needsBackend ×3; :1762 nextBilling; :2981; :3566` |
| should | L | vetëm backend | API publike, webhooks, SMS, import bankar: çelësat gjenerohen lokalisht por s'ka API; Base URL 'https://api.kontabo.app/v1' fiktive; Webhooks/SMS stub; 'Banka — import' toast 'në zhvillim' | `:2497, :2739-2745, :2737 bank/webhook, :2699 SMS` |
| should | M | pjesërisht | Modeli i të dhënave me id të qëndrueshme: rekordet lidhen me emra/SKU (emri i klientit si FK, radha adresohet me indeks vargu, pagesat pa id) — i brishtë për migrimin në backend | `saveParty :1912-1918 riemërton me string match; d.queue.map((q,j)=>j===i) :3674; pagesa pa id :1855` |
| should | S | mungon | Repository git + CI: projekti nuk është repo git (pa histori commit-esh, pa .gitignore), pa pipeline që nis check-logic.js dhe tests.py | `'Is a git repository: false'; nuk ekziston .gitignore/CI` |

## Fiskalizimi real (Fiscal Agent, adapterët) (26)

| Prioriteti | Përpjekja | Statusi | Çfarë mungon | Ku (evidenca) |
|---|---|---|---|---|
| must | L | mungon | Kontabo Fiscal Agent si shërbim Windows: IPC i autentikuar me POS-in, lidhje dalëse TLS te backend-i, i përdorur nga POS-i dhe faturat e ERP-së; sot fiskalizimi është thread daemon brenda Tkinter me NotConnectedProvider që kthen gjithnjë 'pending' | `pos/fiscal.py NotConnectedProvider :49-57; FiscalWorker(db).start() daemon (kontabo_pos.py :26-27); README 'nuk ka Fiscal Agent të veçantë Windows'` |
| must | L | mungon | TremolFiscalProvider (SDK ZFP_SDK_XK_2510231516 → ZFPLabServer → pajisja në LAN): testo lidhjen, lexo serialin, gjendja e kuponit (kupon i hapur), shitje/pagesë/mbyllje kuponi, vetëm raportet që SDK-ja i mbështet realisht; versioni i SDK-së nuk citohet askund | `fa() → needsBackend :3668-3670 ('Testo lidhjen','Lexo numrin serial','Gjendja e kuponit','Raporti X'); grep '2510231516' = 0` |
| must | L | mungon | FLinkFiscalProvider: verifikimi i modelit të printerit, versionit të instaluesit (SetupFlinkKS2018.exe), pajtueshmërisë me Windows dhe mekanizmit real të shkëmbimit (F-Link.rar ende i pahapur); nëse me skedarë — shkrim atomik, id unik kërkese, lexim rezultati, timeout (fushat path/timeout sot s'konsumohen) | `:3671 'Testo shkëmbimin'/'Verifiko modelin' → needsBackend; :3660 'shkrim atomik · timeout' vetëm tekst; flink.model:'' :1751` |
| must | S | pjesërisht | F-Link i bllokuar por i zgjedhshëm: FLINK_ETHERNET mund të aktivizohet nga admini dhe faturat hyjnë normalisht në radhë — vetëm UNCONFIGURED bllokon lëshimin | `fiscalConfigured() :3342 kontrollon vetëm mode!=='UNCONFIGURED'; banner :950` |
| must | L | mungon | AtkElectronicFiscalProvider — onboarding & certifikata: regjistrimi i POS/biznesit sipas dokumentacionit të verifikuar, gjenerimi i CSR-së, marrja/ruajtja e certifikatës, çift çelësash për çdo POS (çelësi privat vetëm në pajisje, DPAPI/CNG, kurrë në ERP/log/backup) | `'Regjistro POS'/'Gjenero CSR'/'Ngarko certifikatën'/'Kontrollo statusin' → needsBackend :3669; asnjë kod çelësash në kontabo-pos` |
| must | L | mungon | AtkElectronicFiscalProvider — nënshkrimi & dërgimi: modelet Protobuf sipas skemës pos-csharp, nënshkrimi i kuponëve, dërgimi te endpoint-et e Swagger TEST (jo të shpikura), formati i nënshkrimit i verifikuar me teste integrimi | `grep 'protobuf/CitizenCoupon/PosCoupon/swagger' = 0; pos/fiscal.py pa klient HTTP` |
| must | L | mungon | CitizenCoupon + PosCoupon nga i njëjti snapshot financiar me kontroll përputhjeje; QR reale në kupon dhe faturë A4 (sot kuti bosh vetëm në preview, docPrintHtml pa QR), e dalluar nga endpoint-i i verifikimit të qytetarit që s'përdoret kurrë si dërgim normal POS | `:1542 placeholder 'QR fiskal (verifikim ATK)'; showQr :3755 vetëm modal; docPrintHtml :2203-2222 pa QR; pos/receipt.py pa QR` |
| must | S | mungon | Konvertimet monetare sipas skemës ATK/pos-csharp (çmimi i artikullit × 10 000, totalet × 100): sot gjithçka është cent (× 100); shtresa e konvertimit mungon dhe s'dokumentohet si rregull i planifikuar | `toC()/calcLine() :1704-1714; pos/money.py to_c/calc_line; grep '10 000/pos-csharp' = 0` |
| must | M | pjesërisht | Ndarja TEST/PROD: vetëm etiketa 'TEST' — pa identitete, certifikata, radhë dhe të dhëna të ndara për mjedis; POS-i s'ka fare fushë mjedisi; nisja reale në ATK TEST nuk ka ndodhur (asnjë thirrje) | `fiscal.env:'TEST' :1751 read-only :3664; :2778 PROD i bllokuar; pos/db.py DEFAULTS pa env` |
| must | M | pjesërisht | Certifikatë e skaduar / çelës i papërshtatshëm si gabime të qarta: asnjë kontroll skadimi (certValid s'krahasohet me sot), 'Valide' shfaqet pa kusht, pa zbulim çelësi të gabuar | `fiscalStatus :3658 value:'Valide'; devices :3678 'Valide deri …'` |
| must | L | vetëm backend | Rrjedha e faturave/notave/anulimeve të ERP-së te agjenti: hyjnë në db.queue si 'Në pritje' dhe s'lëvizin kurrë, asgjë s'i transmeton; invoice.fiscal nuk rakordohet me radhën; 'Provo përsëri' vetëm ndërron statusin në 'Ritentim' | `issueBatch :3368, issueDraft :1883, createReturn :2016, cancelInvoice :1871; retry :3674; importPosSales :2135 vetëm për kuponët POS` |
| must | S | pjesërisht | Lidhja e çdo kërkese fiskale me kompani/degë/terminal/përdorues/dokument: rreshtat e radhës së ERP-së hardcode-ojnë pos:'ERP · Fiscal Agent Prishtinë' dhe time:'sot HH:MM'; faturat, notat e kreditit dhe anulimet e ERP-së s'ruajnë mode/version/pajisje | `:1871, :1883, :2016, :3368 (queue rows); issueBatch :3357-3359 pa fiscalMode/Version` |
| must | M | mungon | Statusi 'Rezultat i panjohur' pas timeout-it, verifikimi me funksionet e ofruesit dhe rakordim i kontrolluar para ridërgimit: sot çdo dështim → 'retry' dhe ridërgim i verbër (pa dallim 'dështoi para dërgimit' vs 'timeout pas dërgimit') | `FiscalWorker.tick :100-102; FiscalResult pa status 'unknown'; grep 'panjohur' = 0` |
| must | M | mungon | Gjendje gabimi të dallueshme (printer pa letër, pajisje e shkëputur, kupon i hapur) me kontroll të gjendjes së pajisjes para ritentimit, pa fallback dhe pa fiskalizim të dytë | `FiscalResult vetëm ok/error/status; statuset e radhës pending/processing/retry/done/error; grep 'letër/paper/kupon i hapur' = 0` |
| must | S | pjesërisht | Rikuperimi pas ndërprerjes së energjisë: rreshtat e lënë në 'processing' nuk rimerren kurrë (queue_pending vetëm pending/retry), asnjë reset në start, pa çelës idempotence/rakordim që shmang fiskalizimin e dyfishtë | `pos/db.py :388 status IN ('pending','retry'); fiscal.py :95 vendos 'processing'` |
| must | S | pjesërisht | Regjistër transaksionesh append-only për çdo tentativë: ritentimet mbishkruajnë last_error/updated_at në të njëjtin rresht të fiscal_queue | `pos/db.py queue_update; sync_log vetëm 'catalog'/'ack'` |
| must | M | pjesërisht | Ekzekutues i vetëm për pajisje fizike edhe ndër procese: identitet pajisjeje + lock (dy instalime POS të kopjuara mund të godasin të njëjtin printer njëkohësisht) | `FiscalWorker single-thread në një proces; README 'për arkën e dytë kopjohet dosja'` |
| must | S | pjesërisht | Agjenti verifikon autorizimin dhe versionin aktiv të konfigurimit para ekzekutimit: worker-i s'krahason fiscal_version të kuponit me versionin aktiv dhe s'bën asnjë kontroll autorizimi (token/certifikatë) | `FiscalWorker.provider() :68-74 kontrollon vetëm UNCONFIGURED dhe fiscal_simulator` |
| must | M | mungon | Procedura e koordinuar e ndryshimit të mënyrës: dy faza (ndalo/zbraz të vjetrën → konfirmim nga terminalet, edhe offline → aktivizo), numërimi i kuponëve POS ende të pasinkronizuar; sot një shkrim atomik lokal dhe teksti i dialogut premton më shumë sesa bën kodi | `changeFiscalMode :2649-2655 (pa posHealth/posSync); replace_catalog :213-216 aplikon menjëherë` |
| must | S | pjesërisht | Validimi i vlerës së mënyrës kundër FISCAL_MODES/MODES në ERP dhe POS + kontroll konkurrence në backend (compare-and-set me version; /catalog pranon çdo version pa renditje) | `changeFiscalMode pranon çdo string; replace_catalog :214-215; POST /catalog :95-98 last-write-wins` |
| must | S | pjesërisht | Rregullat e radhës për nota krediti/anulime: createReturn dhe cancelInvoice s'thërrasin fiscalConfigured(); nota për faturë ende 'Në pritje' s'hyn kurrë në radhë (fiscal '—'); zbatueshmëria/momenti i fiskalizimit për çdo lloj dokumenti s'është verifikuar me kërkesat reale | `createReturn :2010-2016 flag 'fiscalised'; cancelInvoice :1868-1871` |
| must | S | pjesërisht | Faturë A4 nga kuponi POS: lejohet edhe për kupon 'Në pritje'/'Dështoi' (kontrollohet vetëm status 'Finalizuar'); fatura e lidhur nuk përditësohet kur kuponi fiskalizohet më vonë | `invoiceFromReceipt :2154-2162; importPosSales :2135 rifreskon vetëm posReceipts` |
| must | M | pjesërisht | Identifikuesit fiskalë sipas mënyrës në dokument dhe A4 (ATK IIC/FIC/URL verifikimi, Tremol serial + nr. kuponi fiskal/Z, F-Link id): sot vetëm një fiscalRef gjenerik; A4 e faturës në pritje s'shtyp asnjë deklaratë fiskale | `docPrintHtml :2203-2222 'Numri fiskal i transaksionit'; receipts.fiscal_ref e vetme` |
| must | S | pjesërisht | Kodet tatimore ATK (taxSettings.atkCodes) ruhen por s'përdoren nga asnjë dokument/radhë; harta 'verifikohet me ATK' mbetet e paverifikuar | `seed :1753, settings :2725-2727; asnjë konsumator` |
| must | M | pjesërisht | Procedurat e verifikuara për fiskalizim offline: toggle 'offlineSales' s'dërgohet te POS-i dhe POS-i finalizon gjithnjë; asnjë procedurë/afat i verifikuar s'është koduar (pa shpikur asgjë — kërkon dokumentacion ATK/prodhuesi) | `posCatalogPayload :2105 pa offlineSales; can_finalize :530-537` |
| must | M | pjesërisht | Bllokimi i finalizimit kur adapteri i zgjedhur dështon: shitja finalizohet (stok, para, kupon 'FISKALIZIMI NË PRITJE') para çdo rezultati të adapterit — kërkon adapter real + procedurë të verifikuar | `SaleFrame.finalize → db.create_receipt (fiscal_status='pending')` |

## ERP — funksione që mungojnë (33)

| Prioriteti | Përpjekja | Statusi | Çfarë mungon | Ku (evidenca) |
|---|---|---|---|---|
| must | M | pjesërisht | Autorizimi i bazuar në role: matrica roles×permissions s'zbatohet askund (pa hasPerm/can()); çdo i kyçur, edhe Kasier, lëshon fatura, ndryshon mënyrën fiskale (kërkesa 'vetëm administratori'), redakton kompaninë, hap panelin admin (#admin) dhe fshin të dhënat me 'Rivendos të dhënat demo' | `db.roles lexohet vetëm për shfaqje (:2458, :2633, :2643, :2956); enterAdmin :3445 pa kontroll; :3753 resetDemo; changeFiscalMode :2649` |
| should | M | pjesërisht | Përdoruesit & rolet: lista fikse ROLES (pa role të personalizuara), përdoruesi s'redaktohet pas ftesës (rol/degë/departament), s'fshihet (vetëm pezullim) | `ROLES :1739; user drawer :2635-2640 pa 'Redakto'` |
| must | L | mungon | Faturë ERP e paguar në POS: asnjë rrjedhë — POS-i nuk njeh fatura FSH; një shitje e tillë do të krijonte kupon të dytë me stok/të ardhura/fiskalizim të dyfishtë | `grep 'invoice/fatur' në kontabo-pos/*.py = 0; importPosSales pa lidhje me FSH; recordPayment pa burim POS` |
| should | M | mungon | Redaktimi i faturave draft: nuk ka 'Redakto' edhe pse Faturimi masiv premton 'draftet … mund të redaktohen' | `drawer actions :1320-1331; :3622` |
| should | M | pjesërisht | Numërimi i dokumenteve: draftet konsumojnë numra FSH, anuluarat i ruajnë (boshllëqe në seri), seri globale sipas vitit aktual jo datës së dokumentit, pa seri për degë/POS | `nextNo() :1723; :3351; README:184-185` |
| should | M | mungon | Storno pagese: tri toast-e thonë 'storno pagesën para anulimit' por funksioni nuk ekziston — faturat/blerjet e paguara s'anulohen dot kurrë | `:1864, :1893, :3750; grep storno = vetëm toast-et` |
| should | M | mungon | Pagesa: pa kredit klienti/parapagime, pa alokim të një pagese në disa fatura, rimbursimi i notës së kreditit llogaritet automatikisht pa opsion 'mbaje si kredit' | `createReturn :2005 applied/refund; recordPayment :1848 një ref` |
| nice | M | mungon | Zbritje në nivel fature, lista çmimesh për klient dhe nivele çmimesh (vetëm % për rresht sot) | `calcLine :1714; line editor :2312 vetëm disc` |
| nice | S | mungon | Krijim inline i klientit/furnitorit nga forma e faturës/blerjes (Faturim masiv '+ Klient i ni' largohet nga forma) dhe skanim barkodi në formularët ERP (sot vetëm emër/SKU edhe pse Barkodet thotë 'Skanimi: POS + import') | `:2355 combo pa free-text; :795 goKliente; :2317 norm(name/sku); :3219` |
| should | M | pjesërisht | Blerje: forma pa numër/datë të faturës së furnitorit (supplierRef:'—'), blerja draft s'redaktohet, furnitori s'fshihet, pa import e-faturash të furnitorit | `createPurchase :1981; form :2363-2368; drawer :2513-2518` |
| should | M | pjesërisht | Shpenzime: gjithnjë 'Paguar' me pagesë të menjëhershme, pa shpenzime të papaguara/akruale, pa redaktim/fshirje, vendor tekst i lirë jo i lidhur me furnitorët | `addExpense :1903-1906; rows :3150 pa open` |
| must | M | pjesërisht | Produkte: pa redaktim/çaktivizim/fshirje pas krijimit (çmimi s'ndryshohet dhe s'shpërndahet te POS-i), njësi fikse (8), pa artikuj shërbimi (do të tregonin stok negativ) | `product drawer :2595 (vetëm Rregullo stokun/Blerje/Faturo/Transfero/Etiketë); :2430 seg('unit')` |
| should | S | pjesërisht | Depo & degë: pa riemërtim/fshirje/ndërrim të depos kryesore; stoku hapës vetëm në depon kryesore; degët vetëm krijohen; politika e stokut negativ mungon (faturat vetëm paralajmërojnë, importet POS/kthimet e blerjes s'kontrollojnë) | `:1923 opening→main; forms :2406-2410, :2449-2453; :2375-2376, :2141, :2012` |
| must | M | pjesërisht | Financë: llogaritë bankare/arka janë konstante ACCOUNTS — pa shtim/riemërtim/IBAN, 'Llogari bankare' pa '+ Llogari' | `ACCOUNTS :1641; page :3153-3158` |
| must | L | pjesërisht | Kontabilitet: 11 llogari fikse, pa regjistrime manuale/rregulluese, pa mbyllje periudhe/viti, pa amortizim/detyrime pagash, të dy arkat në 1000; anulimi heq regjistrimet nga ditari në vend të stornos së datuar; pa log postimesh të pandryshueshëm (posted-by/at) | `COA :1644; journal() :2171-2197 kapërcen 'Anuluar'; :2180 cashAcc gjithnjë '1000'; :3231 'Nuk editohen dorazi'` |
| should | S | pjesërisht | Navigim nga ditari te dokumenti burim: rreshtat e Ditari/Hyrjet kontabël s'kanë open handler; drawer-i i blerjes s'liston lëvizjet/regjistrimet e veta | `:3234-3236 pa open; purchase drawer :2513-2518` |
| nice | L | mungon | Multi-valutë: fmt() hardcode-on '€', company.currency vetëm informativ | `fmt :1700; :2676 co.info('Valuta')` |
| must | M | pjesërisht | TVSH për deklarim me format të verifikuar ATK: përmbledhja s'ndan grupin 8%, libri i shitjes merr normën e rreshtit të parë, kthimet e blerjes (KD) mungojnë në librin e blerjes, 'Tremujore' pa efekt, toggle 'e regjistruar për TVSH'/defaultGroup pa efekt, afati 'data 20 e muajit pasues' është rregull i shpikur | `:2901, :2904, :2907, :3172 monthsBack, :3535 new Date(y,mo,20), :3266 taxCode, :2726` |
| should | M | pjesërisht | Raporte & panel: pa interval datash të lirë (vetëm Sot/Javë/Muaj/Vit/Gjithçka dhe month/prev/year/all); eksport vetëm CSV (pa Excel/PDF/print raporti); grafiku i panelit pa vlera boshtesh | `:3519, :2806, exportCsv :2793, chart :548-558` |
| should | S | pjesërisht | Lista e faturave: pa faqezim ('faqja 1 nga 1' hardcoded), pa filtër datash, '···' dekorativ; kërkimi q i përbashkët me Shitje › Kthime | `:650, :645, :3073 vs :3488` |
| should | S | pjesërisht | Printimi i dokumenteve: preview në aplikacion hardcode-on 'TVSH 18%' dhe ndryshon nga docPrintHtml (pa kolonë zbritjeje/nota/shënime); printimi me 'Segoe UI' jo Manrope; pa header të përsëritur/page-break për tabela të gjata; etiketat gjithnjë 1 kopje (copies s'kalon kurrë); iframe+window.print() bllokohet në sandbox | `:1546; printCss :2223; printLabels :2250 (thirrjet :2595/:3218/:3221/:3730); _printHtml :2230-2236` |
| should | M | pjesërisht | Cilësime › Faturat & Kompania: shablloni A4 (Standard/Modern/Minimal) dhe gjuha e dokumentit ruhen por s'lexohen kurrë; pa logo të kompanisë (shtypet shkronja e parë) | `:2720 is.seg('template'/'lang'); docPrintHtml :2218 logo initial; :2674-2676 pa fushë logo` |
| must | M | të dhëna demo | Terminalet POS në ERP: regjistër terminalesh hardcoded ('Terminalet', P:Arkat count 3), POS-0002→Arka 2/cash2/W2 hardcoded, vetëm një URL sync — multi-till i pambështetur; pa lidhje terminal↔pos_id/branch_id real dhe pa validim që branch_id ekziston | `:2715, :2914-2919, acctFor :2129, :2137/:2140/:2148, posSync.url :2092` |
| should | S | pjesërisht | Rregullat POS të papushuara: allowDiscount, discountAuth, payTransfer, openDrawer, offlineSales, receiptPrinter ruhen në ERP por s'dërgohen kurrë te POS-i | `posCatalogPayload :2105 vs toggles :2712-2714` |
| nice | M | pjesërisht | 'Hap POS-in' hap vetëm udhëzimet — pa mekanizëm të sigurt nisjeje të programit të instaluar (URL scheme/protocol handler) | `:2749 'ERP-ja nuk e hap vetë programin'` |
| nice | M | pjesërisht | Cilësime › Llogaria: redaktimet e profilit s'sinkronizohen me db.users (mbishkruhen në hyrjen tjetër); gjuha (Shqip/English/Srpski) pa shtresë i18n; 'Fusi orar'/'Viti fiskal' tekst statik jo cilësime | `:2681 pr.txt/pr.seg('lang')/pr.info; :2084 login mbishkruan profile` |
| should | S | pjesërisht | Njoftimet: notifPrefs s'lexohen kur ndërtohen alertet; overdueDays/digest pa përdorim | `alerts :3558-3566 pa notifPrefs; :2702` |
| should | S | pjesërisht | Modulet: toggle-at ('Modulet e mia', Kompania › Modulet) jetojnë në React state — resetohen në rifreskim; 'CRM' pa NAV | `state.modules :1611; :3684-3685; :2758` |
| should | S | pjesërisht | Audit log i kompanisë: vetëm 12 rreshtat e fundit në Siguria, pa faqe të plotë/kërkim/eksport; veprimet e dokumenteve (lëshim/pagesë/notë) s'regjistrohen aty (vetëm në historinë e dokumentit); cancelInvoice premton audit por s'thërret logAudit | `:2694 db.audit.slice(0,12); cancelInvoice :1868` |
| nice | S | pjesërisht | Kohët relative që nuk plaken: 'sot HH:MM' në rreshtat e radhës, 'Hyrja e fundit' e përdoruesve, 'last: sot 08:12' në API keys | `:3368 time:'sot '+hhmm; :1748, :2084; :1758` |
| nice | S | pjesërisht | Kërkimi global: vetëm fatura/klientë/produkte (placeholder premton punëtorë/transaksione), hit-et hapin listën jo rekordin | `:1579; :3696-3697` |
| nice | S | pjesërisht | Faturim masiv: .xlsx kërkon internet (SheetJS ngarkohet nga cdnjs në runtime) — offline vetëm CSV/paste | `:3388 sc.src='https://cdnjs…/xlsx/0.18.5/…'` |
| must | S | mungon | Kontrollet e overflow-it në konvertimet dhe shumat monetare (Number.isSafeInteger / int64 para INSERT) me gabim për përdoruesin dhe teste kufitare — sot vetëm regex-et kufizojnë hyrjen | `toC()/calcLine() :1704-1714; create_receipt :338-348 pa kontroll; grep isSafeInteger = 0` |

## ERP — të dhëna demo / stubs të shfaqura si reale (15)

| Prioriteti | Përpjekja | Statusi | Çfarë mungon | Ku (evidenca) |
|---|---|---|---|---|
| must | S | të dhëna demo | Statuset ATK në Cilësime › Fiskalizimi: 'Lidhja me ATK (TEST) · Aktive · përmes Fiscal Agent' dhe 'Certifikata · Valide' janë literale pa asnjë kontroll — duhen derivuar nga gjendja reale ('i palidhur') ose shënuar 'të dhëna demo' | `fiscalStatus :3658 value:'Aktive' / value:'Valide'` |
| must | S | të dhëna demo | Numëruesi 'Të suksesshme 1284' hardcoded në radhën fiskale dhe '1,284' në Radhën globale të adminit — jo i numëruar nga rekordet | `queueStats :3676 n:1284; :3009 value:'1,284'` |
| must | S | të dhëna demo | Rreshtat seed të radhës (KS-TX-7F3A21, 'Kupon qytetar', 'Ritentim', 'Connection timeout (ATK TEST)') të palidhur me dokumente dhe që s'ndryshojnë kurrë; faturat seed 'Fiskalizuar' me referenca të shpikura KS-TX-… dhe histori 'Fiskalizimi u krye me sukses' — përgjigje fiskale të shpikura | `seedQueue :3254; seedInvoices :3409-3417` |
| must | M | të dhëna demo | Lista 'Pajisjet' hardcoded (Arka 1/2/3, 'RSA 2048 · gjeneruar në pajisje', 'CSR i gjeneruar', 'Valide deri …') — pa regjistër pajisjesh në db, injoron POS-in real të lidhur (posSync.health.pos_id), shfaq fusha ATK edhe nën Tremol/F-Link/UNCONFIGURED; 'Regjistro POS' stub | `const devices=[…] :3678; :2750 përdor health.pos_id vetëm në 'Hap POS-in'; :3669` |
| must | S | të dhëna demo | ID-të shembull në formularin live pa shënim 'demo' dhe pa burim SDK/ATK (APP-KS-00921, BR-0001, POS-0001, 192.168.1.50, portat 4444/8000, SetupFlinkKS2018.exe, 'Kontabo Fiscal Agent v0.9.2'); fushat fiskale autosave pa asnjë validim IP/port/serial/path/timeout | `seed :1751; fFld :3663 e.target.value → setIn; :1757` |
| should | S | të dhëna demo | Butoni 'Detajet' në rreshtat e radhës fiskale pa handler (no-op i heshtur); radha pa filtër/kërkim/faqezim dhe pa tab historiku të fiskalizimeve | `:990 pa sc-camel-on-click; fiscalTabs :3653 vetëm Cilësimet/Radha/Pajisjet` |
| should | S | të dhëna demo | Cilësime › Integrimet: statuse seed ('ATK Aktiv · certifikata valide deri 12.03.2027', 'Fiscal Agent v0.9.2 · online') jo të derivuara nga db.fiscal/posSync — README thotë 'statuse reale' | `integrations :1757; README:148` |
| should | S | të dhëna demo | POS demo në ERP: gjashtë ndërrime demo (db.pos: 'Fjolla K.', 'Lum G.', 12.09.2026…) të përziera me të dhënat reale në R:POS, Degët ('Arka POS', 'Shitje POS (muaji)') dhe KPI-në e Terminaleve | `:1768 pos:[…]; :2886 [...synced,...db.pos]; :2951; :2715` |
| should | M | të dhëna demo | Cilësime › Siguria: 2FA stub, tabela e sesioneve seed ('Windows 11 · Chrome', 'Android · Kontabo', IP-të) ku 'Dil' vetëm fshin rreshtin, sesioni aktual real nuk listohet, 'Njoftim për hyrje të re' i papërdorur | `:2692 sec.tog('twoFactor'); sessions seed :1759; :2693 filter` |
| should | M | të dhëna demo | Abonimi: kartë 'Visa •••• 4242' dhe fatura PLT-2026-… seed, trial banner nga props (trialDays=12) jo nga subscription.since, progress bar statik; çmimet seed të planeve pa shënim 'demo' dhe resetDemo i rikthen në heshtje | `:1762-1763; :3456 props.trialDays; :3718 trialPct; plans :1771` |
| should | S | të dhëna demo | Cilësime › API: çelësa të gjeneruar lokalisht pa API, Base URL 'https://api.kontabo.app/v1' fiktive, 'last: sot 08:12' statik | `:2497; :2739-2745; :1758` |
| should | L | të dhëna demo | Paneli admin: 12 tenantë, 10 fatura platforme, 8 agjentë 'Online', 3 adminë, audit — të gjitha seed; 'Përdoruesit e platformës' fabrikon email-e pronar@<emër>.com; 'Statusi i sistemit' hardcoded ('142 ms', '99.95%'); Abonimet '01.10.2026'/'(shtator 2026)'/'14 ditë' injoron trialDays; 'Ritento pagesën' stub; Radha globale = radha e këtij tenanti me 'ABC SH.P.K.' hardcoded; tenantët/adminët e rinj vetëm rresht lokal ('ftesa kërkon backend') | `:1770-1781; :2989; :2782-2784; :2965-2981; :3007-3011; :2476, :2481` |
| should | S | të dhëna demo | Ekrani i hyrjes: fjalëkalimi default 'kontabo' i printuar në ekran, 3 butona demo-llogarish, të gjithë përdoruesit seed me DEFAULT_PW dhe PIN POS 0000 | `:1298-1300 lDefaultPw/lDemo; :3710; :1749 pinHash('0000')` |
| nice | S | të dhëna demo | Mbetje seed: 'Arben B.' si autor i pagesave/historisë/audit-it/fiscal.changedBy në vend të who(); 'ABC SH.P.K.' jashtë rekordit të kompanisë (certSubject, emailSettings.fromName, tenants, toast, firms) — riemërtimi i kompanisë i lë të vjetruara; data fikse ('01.03.2026', '12.03.2027', '14.06.2026', '© 2026 AlbCo Partners') | `:1795, :1801, :1808, :1824, :3409, :1751, :1767; :1756, :1773-1777, :2625, :3007, :3688; :1277` |
| should | S | të dhëna demo | Kompani e zbrazët nuk krijohet dot: nisja e parë gjithnjë farëzon librat demo të ABC SH.P.K. (FSH-2026-00118…125, blerje, shpenzime, radhë); 'Rivendos të dhënat demo' i rikthen | `:3426 const db0=saved//this.seedDb(); resetDemo :1785` |

## POS (kontabo-pos) (28)

| Prioriteti | Përpjekja | Statusi | Çfarë mungon | Ku (evidenca) |
|---|---|---|---|---|
| must | M | mungon | Instalues Windows (.exe/MSI me PyInstaller/Inno), auto-start dhe mekanizëm përditësimi; sot run-pos.bat kërkon Python 3.10+ me Tkinter të instaluar paraprakisht | `run-pos.bat (py -3 / python); README 'Nuk ka instalues .exe'` |
| should | L | pjesërisht | Vendimi i stack-ut: POS-i është Python/Tkinter ndërsa spec-i rekomandon C#/.NET WPF+MVVM (kushtëzuar); zgjedhja s'është dokumentuar/verifikuar kundrejt SDK-ve (SDK Tremol është C#, pos-csharp është C#) | `pos/ui.py class App(tk.Tk); kontabo_pos.py 'Python, stdlib only'` |
| must | S | të dhëna demo | Simulatori i fiskalizimit ON si parazgjedhje dhe i ndërrueshëm nga kushdo në Cilësime (para PIN-it); ERP-ja s'mund ta fikë — de facto override lokal për terminal; nuk emulon shkëmbimin F-Link | `DEFAULT_SETTINGS 'fiscal_simulator':'1' (db.py :56); SettingsDialog :954-955, save() :968; replace_catalog s'e prek` |
| must | M | pjesërisht | Statusi live i printerit/agjentit: chip-i i printerit tregon vetëm konfigurimin (jo online/offline/pa letër — dështimi zbulohet vetëm në tentativë printimi), pa tregues të lidhjes me agjentin; gabimi i worker-it (fiscal_worker_error) nuk shfaqet askund | `SaleFrame.tick chip_print; fiscal.py run() :80-81 db.set('fiscal_worker_error')` |
| must | M | pjesërisht | Printimi i kuponit: tekst i thjeshtë me 'print /D:' pa ESC/POS (prerje, code page për ë/ç, logo), pa zbulim printeri/test-print, dështimi raportohet 'dërguar' (check=False, exit code i injoruar), pa status printimi për kupon (printed_at), pa auto-print pas finalizimit | `receipt.py print_receipt :84-102; schema receipts :30-34 pa print_status` |
| must | S | pjesërisht | Kuponi hardcode-on 'TVSH 18%' edhe pse rreshtat kanë normën e vet — rreshtat 8%/0% shtypen me etiketë të gabuar; pa përmbledhje TVSH për normë | `receipt.py :54 _lr('TVSH 18%:'); receipt_items.rate ekziston` |
| must | M | pjesërisht | Unicitet i numrave fiskalë në gjithë biznesin: pos_id tekst i lirë në Cilësime, i papushuar/i pavaliduar nga ERP-ja, numëruesi resetohet nëse fshihet data/; pa skemë numerike të pajtueshme me ATK-në (jo UUID) | `next_receipt_no :320-322; SettingsDialog FIELDS :940; posCatalogPayload pa pos_id` |
| should | S | pjesërisht | Radha fiskale: retry i sheshtë 30 s përgjithmonë (pa max tentativash, pa backoff, pa gjendje terminale 'failed' që UI e pret), pa veprim operatori ritento/braktis (QueueDialog read-only) | `fiscal.py :92, :101 retry_in=30; ui.py :782 mapon 'failed' që s'ndodh kurrë; :916-937` |
| should | M | pjesërisht | Kthimet: kthimi i pjesshëm shënon origjinalin 'returned' dhe bllokon pjesën e mbetur, rimbursim gjithnjë cash edhe për kartë, cap = sasia e shitur jo e mbetur, pa PIN menaxheri/dritare kohore, pa procedurë storno të adapterit | `create_receipt :353; ReturnDialog.load :832, do_return :856-865` |
| should | M | pjesërisht | Menaxhimi i arkës: pa raport Z/X fiskal dhe pa shtypje të raportit të ndërrimit, pa TVSH për normë, pa hyrje/dalje parash (paid-in/paid-out) gjatë ndërrimit | `close_shift :309-317, shift_totals :300-307; CloseShiftDialog :871-913` |
| should | M | mungon | Periferikë: pa kick sirtari (ESC/POS pulse), pa ekran për klientin, skaner vetëm keyboard-wedge në fushën e kërkimit (pa prefiks/sufiks, pa EAN-13 peshë/çmim, i papërdorshëm në dialogët e pagesës/kthimit) | `grep 'drawer/sirtar' = 0; on_search_enter :400-413; product_by_code :176-181` |
| should | L | mungon | Pagesa me kartë: vetëm shumë e shtypur — pa integrim EFT/terminal bankar, pa referencë autorizimi/lloj karte; 'Transfer bankar' i ERP-së s'ekziston në POS | `PaymentDialog :614-691; receipts.card_c vetëm (db.py :32)` |
| must | M | pjesërisht | Multi-terminal & provisioning: një terminal për instalim (kopjo dosjen, ndrysho POS ID/port), pa regjistër terminalesh, pa token/llogari për terminal | `README :91; DEFAULT_SETTINGS pos_id 'POS-0001'` |
| must | L | vetëm backend | Sync-u punon vetëm me tab-in e ERP-së hapur në të njëjtin PC (127.0.0.1, plain HTTP, POS-i s'push-on kurrë) — ERP-ja cloud s'e arrin dot; duhet lidhje dalëse e autentikuar nga agjenti/POS-i | `sync_server.py :121 ThreadingHTTPServer(('127.0.0.1',port)); pa klient në kontabo-pos` |
| must | S | pjesërisht | Bug i kursorit: changes_since kufizon 500 kupona/200 ndërrime por kthen max seq global — me >500 rreshta të pasinkronizuar ERP-ja kapërcen rreshta që s'i mori kurrë (humben nga sync-u) | `db.py changes_since :413-420 (LIMIT 500/200, top=counters.seq); posPull :2109` |
| must | M | pjesërisht | Push-i i katalogut mbishkruan stock_qm lokal (drift: shitjet e pasinkronizuara zbriten dy herë), fshin/rindërton klientët, çaktivizon në heshtje produktet që mungojnë, injoron stock_by_wh/warehouses; pa version/etag të katalogut | `replace_catalog :191-244 (stock_qm=excluded.stock_qm, DELETE FROM customers); catalogHash vetëm në klient :2107` |
| should | M | pjesërisht | Konfliktet pas ack: ERP-ja rifreskon vetëm fushat fiskale; POS-i nuk mëson refuzimet e ERP-së (SKU i panjohur, periudhë e mbyllur); sync_log pa kufi dhe pa UI | `/ack :99-102 vetëm synced=1; importPosSales :2135; sync_log INSERT :242, :427` |
| should | S | pjesërisht | Token statik 'kontabo-local' në tekst të hapur në të dy anët, pa rotacion/për terminal, krahasim me ==; /health pa autentikim (rrjedh operator/ndërrim/degë); CORS * në çdo përgjigje | `db.py :53; sync_server.py _cors :31, _authed :48, /health :63-75; template.html :1764` |
| should | S | pjesërisht | Versionimi: pa migrime SQLite (shih skemën), ERP-ja nuk kontrollon pajtueshmërinë e APP_VERSION të POS-it nga /health | `APP_VERSION '0.4.0' :19; posHealth :2098 pa kontroll` |
| should | M | pjesërisht | Siguria e PIN-it: sha256 një raund mbi PIN 4–6 shifror (brute force offline në ms), numërues dështimesh global për të gjithë operatorët, bllokim 30 s, autorizimi i menaxherit përputhet me çdo menaxher me PIN të njëjtë (0000 kolizion) + kod fallback '1234' | `pin_hash :78-80, verify_pin :257-270, verify_manager_pin :275-280, discount_auth_code :57` |
| should | S | pjesërisht | Cilësimet të arritshme para PIN-it (nga LoginFrame) dhe nga çdo rol; pa leje rolesh brenda POS-it | `LoginFrame :179 Cilësimet; SaleFrame :348; SettingsDialog pa kontroll roli` |
| should | M | mungon | Audit trail në POS: autorizimet e zbritjes, heqja e rreshtave, pastrimi i shportës, ndryshimet e cilësimeve, kyçja/zhkyçja s'regjistrohen; pa void të kuponit të finalizuar përveç kthimit; pa auto-lock në mosaktivitet | `remove_line/clear_cart/edit_discount :475-525 pa shkrim; SCHEMA pa tabelë audit` |
| should | M | pjesërisht | Cilësimet UI: fusha teksti të papërpunuara — pa zgjedhës printeri Windows/test-print, pa fusha pajisjeje fiskale (IP/port/serial), pa header/footer kuponi, pa backup/restore, ndryshimi i portit kërkon rinisje | `SettingsDialog FIELDS :940-942, save() :964-971` |
| should | S | mungon | Siguria e të dhënave: pa backup SQLite, pa WAL/PRAGMA, pa integrity check në start, pa log file rrotullues (HTTP log i heshtur, gabimet Tk në konsolë) | `DB.__init__ :114-131; sync_server.py log_message pass :26; pa modul logging` |
| should | S | pjesërisht | Validimi i API-së së sync: pa validim hyrjeje/limit madhësie — /catalog i keqformuar (pa sku/price_c) ngre KeyError jashtë try/except → lidhja bie me traceback në vend të JSON 400 | `do_POST :95-98; replace_catalog p['sku'] :203-204; _body :50-53` |
| nice | S | mungon | Rregullat e shitjes: stok negativ pa politikë (vetëm ⚠), pa override çmimi/artikuj me çmim të hapur, pa sasi me peshë, pa shënime rreshti; historia e kuponëve pa filtër datash/kërkim (300 të fundit) | `refresh_products :381-382; add_product :415-422; HistoryDialog receipts(limit=300)` |
| should | S | pjesërisht | Koha: timestamp-et naive datetime.now() pa zonë kohore dhe pa kontroll drift-i të orës — ATK elektronike varet nga kohë të sakta të nënshkruara | `now_iso :109-110; receipts.ts TEXT :31` |
| must | S | pjesërisht | Identiteti vizual i POS-it: fonti 'Segoe UI' (Manrope s'bundlohet), kontrollet 9–10 pt / rowheight 28 të vogla për prekje | `ui.py :31 FONT='Segoe UI'; setup_style :34-72` |

## Cilësi, siguri & UI (8)

| Prioriteti | Përpjekja | Statusi | Çfarë mungon | Ku (evidenca) |
|---|---|---|---|---|
| must | M | mungon | Mbrojtja e sekreteve me mekanizmat e Windows (DPAPI/CNG) dhe kufizimi i qasjes te identiteti i shërbimit: token-i i sync-ut, kodi i zbritjes dhe hash-et e PIN-eve në pos.sqlite dhe token-i në localStorage janë në tekst të hapur; pa çelësa/certifikata ende | `DEFAULT_SETTINGS :53 sync_token, :57 discount_auth_code; posSync.token :1764; grep DPAPI/win32crypt = 0` |
| must | S | pjesërisht | Konfigurim shembull pa sekrete jashtë kodit (config.example/.env + .gitignore): konfigurimi jeton si default-e në db.py dhe në seed-in e ERP-së; të dhënat e fotografisë së ATK-së s'kanë rrugë të sigurt për konfigurim testimi | `DEFAULT_SETTINGS :47-72; seed :1751; find *.env*/*.example* = 0` |
| should | L | mungon | Responsive: shell fiks 72/224/1fr me 100vh + overflow hidden, drawer-a 640/680/760 px, login ~820 px, KPI repeat(4,1fr), pa @media veç printimit | `:448, :1312, :1371, :2353, :1261; grep @media = :2223, :2254` |
| should | M | pjesërisht | Aksesueshmëria: rreshta/div-e të klikueshëm vetëm me maus (pa tabindex/role/tastierë), switch-e pa aria-checked/label, select-e vetëm me title, dialogë pa focus trap/aria-modal | `:635, :1141, :1145, :606-607; grep tabindex/aria-* = 0` |
| nice | M | mungon | Tema e errët / design tokens: çdo ngjyrë hex inline, pa prefers-color-scheme | `:393 html,body; grep prefers-color-scheme = 0` |
| should | M | pjesërisht | Performanca: kosto mesatare/stok/ditar rillogariten nga të gjitha lëvizjet në çdo render (O(products × movements) për shtypje tasti) — jo për mijëra dokumente | `avgCost/stockOf :1834-1835; stockRows :3527 + :3037; balances() :2198 → journal()` |
| nice | S | pjesërisht | Toast me një slot — veprimet e shpejta mbishkruajnë mesazhet e njëra-tjetrës (paralajmërim + sukses) | `toast() :3453 clearTimeout(this._t)` |
| should | S | pjesërisht | Krahasimi i versionit minimal të agjentit është leksikografik ('0.10.0' < '0.9.0') | `:3004 a.version.replace('v','')<agentMinVersion` |

## Testim, dorëzim & dokumentim (14)

| Prioriteti | Përpjekja | Statusi | Çfarë mungon | Ku (evidenca) |
|---|---|---|---|---|
| must | M | pjesërisht | Teste për secilën mënyrë veçmas (faturë ERP + shitje POS në TREMOL_ETHERNET dhe FLINK_ETHERNET): sot vetëm ATK_ELECTRONIC përmes simulatorit (SIM- refs) | `check-logic.js :141-174; tests.py :57-72, :96-99 pa kupon pas ndërrimit të mënyrës` |
| must | S | mungon | Teste konkurrence për mënyrën e vetme (kërkesa konkurruese API / changeFiscalMode) — kërkojnë backend-in | `asnjë test konkurrent; /catalog last-write-wins` |
| must | S | pjesërisht | Test i klikimit të dyfishtë (issueBatch, SaleFrame.finalize, recordPayment) — rojet ekzistojnë, testi jo (issueBatch është sinkron, testi trivial) | `_issuing :3344; _finalizing :548-555; check-logic.js/tests.py pa double-submit` |
| must | M | mungon | Teste timeout/'Rezultat i panjohur' dhe rifillim pas ndërprerjes (rreshtat 'processing') — varen nga agjenti dhe statusi i ri | `grep 'panjohur' = 0; tests.py pa test restart/crash` |
| must | M | pjesërisht | Teste printer pa letër, pajisje e shkëputur (sot testohet vetëm 'Fiscal Agent i palidhur'), kupon i hapur, dështim printimi pas suksesit fiskal (asnjë rresht i dytë në fiscal_queue) | `tests.py :71-72; receipt.py print_receipt i patestuar me printer` |
| must | M | mungon | Teste përputhjeje të të dhënave në QR, certifikatë e skaduar, çelës i papërshtatshëm, ndarje TEST/PROD — varen nga adapteri ATK dhe nga statusi i derivuar i certifikatës | `QR placeholder :1542; 'Valide' hardcoded :3658; check-logic.js pa test env` |
| must | M | mungon | Test izolimi mes kompanive dhe mbrojtje e ndryshimit të konfigurimit fiskal me terminale offline (sot testohet vetëm bllokimi nga radha e ERP-së) | `check-logic.js :166-170, :184-186; asnjë test për posSync.status/kuponë të pasinkronizuar` |
| should | M | mungon | Testet POS për rrugët e gabimit: print_receipt me printer, payload sync të keqformuar, humbja e kursorit >500, mbishkrimi i stokut nga katalogu, backoff/tentativat, skadimi i bllokimit PIN, kthime me kartë, port i zënë, logjika UI | `tests.py run_all :37-122 vetëm happy path (64 asserts)` |
| should | S | mungon | Dokumenti i analizës së materialeve + plani i shkurtër i implementimit (ANALIZA/PLAN) — nuk ekziston asnjë skedar | `vetëm README-të dhe run-pos.bat si dokumentim; shënimi në memory nuk është deliverable` |
| must | M | mungon | Analiza dhe dokumentimi i burimeve të integrimit: SDK ZFP_SDK_XK_2510231516 (Manual, protocol_description, Libs/C#, DEMOS, ChangeLog ZFPLabServer), pos-csharp/README + Swagger TEST (versione/commit-e), F-Link.rar (versioni/modeli real); mospërputhjet e zgjidhura me verifikim; lista e saktë e informacionit që mungon për çdo adapter | `grep '2510231516/pos-csharp/swagger/github.com' në të dy projektet = 0; SDK i pahapur në projekt (vetëm Downloads)` |
| must | M | pjesërisht | Udhëzuesi i instalimit Windows: POS-i i mbuluar shkurt (pa hap për instalimin e Python-it, firewall/konflikt porti, terminal i dytë vetëm një fjali), Fiscal Agent mungon plotësisht | `kontabo-pos/README.md :3-11, :91; 'Hap POS-in' card :2747-2753` |
| must | S | pjesërisht | 'Hapat e testimit' manualë për 9 skenarët e spec-it + raport i qartë i tri kategorive: çfarë u testua me simulator, çfarë me API TEST (asgjë — pa asnjë thirrje), çfarë kërkon printer real ose dokumentacion shtesë (F-Link model/protokoll, versioni SDK Tremol, formati i nënshkrimit ATK) | `README-të pa seksion 'Hapat e testimit'; kontabo-pos/README :63-68 mbulon vetëm simulatorin` |
| must | S | mungon | Dokumentimi i rinovimit/skadimit të certifikatës dhe riregjistrimit në rast humbjeje të pajisjes | `grep 'rinovim/skadim/riregjistrim/renew/expir' = vetëm 'Skadimi i sesionit' :2692` |
| must | S | mungon | Deklaratë e shprehur se kufizimi 'një mënyrë për kompani' është kërkesë e produktit, jo rregull i ATK-së | `grep 'kërkesë e produktit/rregull i ATK' = 0; README:143-145 përshkruan vetëm rregullin` |

## Module të pandërtuara (HR, Prodhim, CRM) (3)

| Prioriteti | Përpjekja | Statusi | Çfarë mungon | Ku (evidenca) |
|---|---|---|---|---|
| nice | L | mungon | HR: Punëtorët, Departamentet, Pozitat, Orari, Pushimet, Prezenca, Pagat — të gjitha bien te 'Modul i pandërtuar'; Raporte › HR placeholder; pagat s'kanë detyrime në kontabilitet (me qëllim jashtë scope-it aktual) | `NAV :1669; fallback :1243-1254; :2755 'R:HR'; genericAdd :3728` |
| nice | L | mungon | Prodhim: Recetat/BOM, Prodhimet, Materialet, Urdhrat e punës, Konsumi, Raportet — placeholder; Raporte › Prodhim placeholder | `NAV :1670; :2755-2758 'R:Prodhim'` |
| nice | M | mungon | CRM: toggle-i i modulit ekziston por s'ka NAV/faqe — aktivizimi s'bën asgjë | `:3684 ['crm','CRM',…] pa id në NAV` |

## Radha e propozuar e ndërtimit

- 1. Backend + DB qendrore + auth server-side + multi-tenant real: zëvendëso persist()/load()/commit() me API (ASP.NET Core/PostgreSQL ose stack i vendosur dhe i dokumentuar), skema/migrime, repo git + CI, config shembull pa sekrete; kjo zhbllokon ftesat, 2FA, email/PDF, abonimet, API-në, izolimin e tenantëve dhe lejet e kontabilistit për kompani.
- 2. Zbatimi i autorizimit: hasPerm()/can() në ERP (nav, openForm, issueBatch, changeFiscalMode, enterAdmin, resetDemo), role/leje edhe brenda POS-it, sekretet me DPAPI/CNG, token për terminal, /health i autentikuar.
- 3. Analiza e burimeve të integrimit para kodimit: SDK ZFP_SDK_XK_2510231516, pos-csharp/README + Swagger TEST, F-Link.rar — dokumento versionet/commit-et, mospërputhjet dhe listën e saktë të informacionit që mungon për çdo adapter; shkruaj ANALIZA/PLAN dhe deklaratën 'një mënyrë për kompani = kërkesë produkti'.
- 4. Kontabo Fiscal Agent (shërbim Windows, IPC i autentikuar me POS, lidhje dalëse TLS te backend-i): radhë durable me 'Rezultat i panjohur', rikuperim i rreshtave 'processing', regjistër append-only, gjendje gabimi të dallueshme (pa letër / e shkëputur / kupon i hapur), verifikim autorizimi+versioni, lock për pajisje; rruga ERP → backend → agjent që faturat e ERP-së të mos mbeten 'Në pritje'.
- 5. Adapterët sipas rendit të dokumentacionit: AtkElectronic në TEST (onboarding, CSR/certifikatë + çelës për POS, Protobuf, nënshkrim, CitizenCoupon/PosCoupon, QR reale, konvertimi ×10 000/×100, ndarja TEST/PROD, skadimi i certifikatës) → Tremol (SDK → ZFPLabServer, serial, kupon i hapur, raportet reale) → F-Link vetëm pas verifikimit të modelit/protokollit; bllokimi i finalizimit kur adapteri dështon dhe procedura dyfazëshe e ndryshimit të mënyrës me konfirmim nga terminalet.
- 6. Pastrimi i të dhënave demo nga ekranet fiskale dhe admin: statuset ATK/certifikata të derivuara nga gjendja reale, heqja e '1284', e rreshtave/faturave seed 'Fiskalizuar' dhe e ID-ve shembull, regjistër real i pajisjeve/terminaleve (multi-till, POS-0002 hardcoded), shënim 'demo' kudo që mbetet seed.
- 7. POS: instalues (.exe/MSI), printim ESC/POS me status printimi për kupon dhe auto-print, kupon me TVSH për normë, unicitet i numërimit të kontrolluar nga ERP-ja, rregullimi i bug-eve të sync-ut (kursori >500, mbishkrimi i stokut, validimi i /catalog), simulatori OFF si parazgjedhje dhe i kontrolluar nga ERP-ja, raport Z/X dhe hyrje/dalje parash, Manrope + kontrolle për prekje.
- 8. ERP funksionale + testet + dokumentimi: redaktim produktesh/draftesh, storno pagese, llogari bankare të konfigurueshme, TVSH me format të verifikuar (pa afatin e shpikur), kontabilitet me storno të datuar dhe regjistrime manuale; testet për secilën mënyrë, double-click, timeout, restart, pa letër, QR, certifikatë e skaduar, izolim tenantësh; udhëzuesi i instalimit (POS + Agent), hapat e testimit dhe raporti simulator / API TEST / printer real.

_141 zëra gjithsej · gjeneruar nga auditimi me 59 agjentë (spec → verifikim → refutim → sintezë)._