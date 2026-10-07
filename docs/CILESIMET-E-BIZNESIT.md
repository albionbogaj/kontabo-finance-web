# Cilësimet e biznesit — një vlerë, e njëjtë në çdo hap

> E prodhuar nga `tools/cilesimet_biznesit.py` nga databaza e KONTABO BAR-it (vetëm lexim).
> Rifreskoje me `python tools/cilesimet_biznesit.py --shkruaj` sa herë ndryshon diçka.

## Si rrjedh identiteti

```
Kontabo Finance (Kompania › Të dhënat e kompanisë)
        │  katalogu i POS-it: company{name,nui,fiscal,address,place,phone,vatNo,vatRegistered,unitName}
        │                     unit{name,number,licence,address,place,phone}  ← koka e kuponit (Shtojca F)
        ├──────────────► KONTABO BAR      (kontabo/finance/katalogu.py → _te_dhenat_e_firmes → biznesi_*)
        └──────────────► Kontabo POS      (pos/db.py → replace_catalog → company_*)
```

Asnjë nga të dyja arkat nuk e shkruan vetë kokën e biznesit: e merr nga Finance në çdo sinkronizim.
Prandaj **vlera ndryshohet në NJË vend** — te ERP-ja — dhe del e njëjtë kudo me katalogun e radhës.

## Identiteti i firmës (sot, siç e ka arka e barit)

| Vlera | Sot | E zotëron | Del te |
|---|---|---|---|
| Emri i firmës | `AlbCo Partners L.L.C.` | Kontabo Finance | kuponi i çdo arke · fatura A4 · librat e TVSH-së |
| NUI (ARBK) | `812276899` | Kontabo Finance (i kyçur te arka) | kuponi · fatura · librat · SEF-i i ATK-së |
| Numri fiskal (ATK) | `⚠ BOSH` | Kontabo Finance | kuponi · fatura · librat |
| Numri i TVSH-së | `330646268` | Kontabo Finance | kuponi (kur je në TVSH) · fatura · deklarata |
| I regjistruar për TVSH | `1` | Kontabo Finance | normat e çdo artikulli te arka |
| Adresa | `Rr.Bogaj 23` | Kontabo Finance | kuponi · fatura |
| Qyteti | `Komoran` | Kontabo Finance | kuponi · fatura |
| Telefoni | `045405505` | Kontabo Finance | kuponi · fatura |
| Emri i njësisë (dega) | `Dega kryesore` | Kontabo Finance (branches[].name) | koka e kuponit |
| Valuta | `EUR` | e njëjtë kudo | çdo shumë |

## Fiskalizimi — për arkë, me vendim të pronarit

Rregulli: **ERP-ja nuk e dërgon kurrë konfigurimin fiskal** (`replace_catalog` e injoron bllokun `fiscal`).
Çdo arkë e merr vetë gjatë onboarding-ut të ATK-së. Këto duhet të jenë të njëjta sepse i shkruan i njëjti
njeri me të njëjtat letra — me një përjashtim: **POS ID-ja është unike për çdo arkë**.

| Cilësimi | Arka e barit (RESTAURANTIU) |
|---|---|
| Mjedisi i ATK-së (test/prodhim) | `test` |
| Numri i fiskalizimit | `037388821441` |
| Branch ID | `1` |
| POS ID (unik për ÇDO arkë) | `1231` |
| Application ID (i zhvilluesit — i njëjtë për çdo klient) | `876915359872` |
| NUI i zhvilluesit | `812276899` |
| Vendndodhja | `Komoran` |
| Printer fiskal | `tremol` |
| Printeri fiskal aktiv | `0` |
| Gjuha e kuponit | `sq` |
| Zbritja në kupon | `total` |
| Dhjetoret e çmimit | `auto` |

## Çfarë duhet parë

- ⚠ **Numri fiskal është bosh** te ERP-ja (prandaj edhe te arka, sepse prej saj e merr). Plotësoje te Kompania › Të dhënat e kompanisë — del te fatura, te kuponi dhe te librat.
- ⚠ ATK-ja është në **mjedisin TEST**: kuponët nuk kanë vlerë ligjore. Kalimi në prodhim bëhet pas certifikimit, nga vetë arka.
- ℹ Printeri fiskal `tremol` është i konfiguruar por **jo aktiv** (serial COM3).
- ℹ Arka e dytë (Kontabo POS) merr të njëjtën kokë biznesi nga katalogu; i shkruhen vetëm numrat e ATK-së, me **POS ID tjetër** nga ai i barit.
