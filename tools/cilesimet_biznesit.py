# -*- coding: utf-8 -*-
"""Cilësimet e biznesit — a janë të njëjta në çdo hap?

PSE: identiteti i firmës (emri, NUI, numri fiskal, numri i TVSH-së, adresa, njësia) shtypet te kuponi i çdo arke,
te fatura A4 dhe te librat e ATK-së. Nëse ndryshon qoftë edhe në një vend, dy dokumente të së njëjtës firmë dalin
ndryshe — dhe atë e sheh inspektori, jo ne. Ky mjet i lexon cilësimet reale të KONTABO BAR-it (databaza e tij,
VETËM për lexim), tregon se cili sistem e zotëron secilën vlerë dhe ku duhet të dalë e njëjta, dhe shkruan fletën
e referencës `docs/CILESIMET-E-BIZNESIT.md`.

    python tools/cilesimet_biznesit.py            # tabela në ekran
    python tools/cilesimet_biznesit.py --shkruaj  # + rifreskon docs/CILESIMET-E-BIZNESIT.md

Asgjë nuk ndryshohet askund: as te bari, as te ERP-ja, as te arka. Fjalëkalimet, certifikatat dhe token-at nuk
lexohen fare — as nuk dalin te fleta.
"""
from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

BAR_DB = Path(os.environ.get("KONTABO_BAR_DB", r"C:\ProgramData\KontaboBar\kontabo.db"))
DOC = Path(__file__).resolve().parent.parent / "docs" / "CILESIMET-E-BIZNESIT.md"

# çelësat që nuk lexohen kurrë: sekret ose pa kuptim jashtë asaj makine
SEKRET = ("fjalekalim", "certifik", "token", "sekret", "password", "stafi_zinxhiri", "licenca", "rele_kodi")

# (çelësi te bari, emri njerëzor, zotëruesi, ku duhet të dalë e njëjta vlerë)
IDENTITETI = [
    ("biznesi_emri", "Emri i firmës", "Kontabo Finance", "kuponi i çdo arke · fatura A4 · librat e TVSH-së"),
    ("biznesi_nui", "NUI (ARBK)", "Kontabo Finance (i kyçur te arka)", "kuponi · fatura · librat · SEF-i i ATK-së"),
    ("biznesi_numri_fiskal", "Numri fiskal (ATK)", "Kontabo Finance", "kuponi · fatura · librat"),
    ("biznesi_numri_tvsh", "Numri i TVSH-së", "Kontabo Finance", "kuponi (kur je në TVSH) · fatura · deklarata"),
    ("biznesi_ne_tvsh", "I regjistruar për TVSH", "Kontabo Finance", "normat e çdo artikulli te arka"),
    ("biznesi_adresa", "Adresa", "Kontabo Finance", "kuponi · fatura"),
    ("biznesi_qyteti", "Qyteti", "Kontabo Finance", "kuponi · fatura"),
    ("biznesi_telefoni", "Telefoni", "Kontabo Finance", "kuponi · fatura"),
    ("fiskal_njesia_emri", "Emri i njësisë (dega)", "Kontabo Finance (branches[].name)", "koka e kuponit"),
    ("valuta", "Valuta", "e njëjtë kudo", "çdo shumë"),
]

# Sipas rregullit të pronarit fiskalizimi konfigurohet VETËM në vetë arkën — ERP-ja nuk e dërgon kurrë.
# Prandaj këto nuk „sinkronizohen": ato duhet të jenë të njëjta sepse i shkruan teknikun i njëjti njeri.
PER_ARKE = [
    ("fiskal_mjedisi", "Mjedisi i ATK-së (test/prodhim)"),
    ("fiskal_numri_i_fiskalizimit", "Numri i fiskalizimit"),
    ("fiskal_dega_id", "Branch ID"),
    ("fiskal_pos_id", "POS ID (unik për ÇDO arkë)"),
    ("fiskal_aplikacioni_id", "Application ID (i zhvilluesit — i njëjtë për çdo klient)"),
    ("fiskal_zhvilluesi_nui", "NUI i zhvilluesit"),
    ("fiskal_vendndodhja", "Vendndodhja"),
    ("fiskal_printer_lloji", "Printer fiskal"),
    ("fiskal_printer_aktiv", "Printeri fiskal aktiv"),
    ("fiskal_gjuha", "Gjuha e kuponit"),
    ("fiskal_zbritja_ne_kupon", "Zbritja në kupon"),
    ("fiskal_decimalet_e_cmimit", "Dhjetoret e çmimit"),
]


def lexo(db: Path) -> dict:
    if not db.exists():
        return {}
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    try:
        return {k: v for k, v in con.execute("SELECT celesi, vlera FROM konfigurimet")
                if not any(s in k for s in SEKRET)}
    finally:
        con.close()


def rresht(vlera: str) -> str:
    v = (vlera or "").strip()
    return v if v else "⚠ BOSH"


def fleta(c: dict) -> str:
    out = ["# Cilësimet e biznesit — një vlerë, e njëjtë në çdo hap", "",
           "> E prodhuar nga `tools/cilesimet_biznesit.py` nga databaza e KONTABO BAR-it (vetëm lexim).",
           "> Rifreskoje me `python tools/cilesimet_biznesit.py --shkruaj` sa herë ndryshon diçka.", "",
           "## Si rrjedh identiteti", "",
           "```", "Kontabo Finance (Kompania › Të dhënat e kompanisë)",
           "        │  katalogu i POS-it: company{name,nui,fiscal,address,place,phone,vatNo,vatRegistered,unitName}",
           "        │                     unit{name,number,licence,address,place,phone}  ← koka e kuponit (Shtojca F)",
           "        ├──────────────► KONTABO BAR      (kontabo/finance/katalogu.py → _te_dhenat_e_firmes → biznesi_*)",
           "        └──────────────► Kontabo POS      (pos/db.py → replace_catalog → company_*)", "```", "",
           "Asnjë nga të dyja arkat nuk e shkruan vetë kokën e biznesit: e merr nga Finance në çdo sinkronizim.",
           "Prandaj **vlera ndryshohet në NJË vend** — te ERP-ja — dhe del e njëjtë kudo me katalogun e radhës.", "",
           "## Identiteti i firmës (sot, siç e ka arka e barit)", "",
           "| Vlera | Sot | E zotëron | Del te |", "|---|---|---|---|"]
    for k, emri, zot, ku in IDENTITETI:
        out.append(f"| {emri} | `{rresht(c.get(k, ''))}` | {zot} | {ku} |")
    out += ["", "## Fiskalizimi — për arkë, me vendim të pronarit", "",
            "Rregulli: **ERP-ja nuk e dërgon kurrë konfigurimin fiskal** (`replace_catalog` e injoron bllokun `fiscal`).",
            "Çdo arkë e merr vetë gjatë onboarding-ut të ATK-së. Këto duhet të jenë të njëjta sepse i shkruan i njëjti",
            "njeri me të njëjtat letra — me një përjashtim: **POS ID-ja është unike për çdo arkë**.", "",
            "| Cilësimi | Arka e barit (RESTAURANTIU) |", "|---|---|"]
    for k, emri in PER_ARKE:
        out.append(f"| {emri} | `{rresht(c.get(k, ''))}` |")
    out += ["", "## Çfarë duhet parë", ""]
    nr = c.get("biznesi_numri_fiskal", "").strip()
    out.append(("- ✅ Numri fiskal është i plotësuar." if nr else
                "- ⚠ **Numri fiskal është bosh** te ERP-ja (prandaj edhe te arka, sepse prej saj e merr). "
                "Plotësoje te Kompania › Të dhënat e kompanisë — del te fatura, te kuponi dhe te librat."))
    if c.get("fiskal_mjedisi") == "test":
        out.append("- ⚠ ATK-ja është në **mjedisin TEST**: kuponët nuk kanë vlerë ligjore. Kalimi në prodhim bëhet "
                   "pas certifikimit, nga vetë arka.")
    if c.get("fiskal_printer_aktiv") == "0" and c.get("fiskal_printer_lloji"):
        out.append(f"- ℹ Printeri fiskal `{c.get('fiskal_printer_lloji')}` është i konfiguruar por **jo aktiv** "
                   f"({c.get('fiskal_printer_lidhja','')} {c.get('fiskal_printer_com','')}).")
    out.append("- ℹ Arka e dytë (Kontabo POS) merr të njëjtën kokë biznesi nga katalogu; i shkruhen vetëm numrat e "
               "ATK-së, me **POS ID tjetër** nga ai i barit.")
    return "\n".join(out) + "\n"


def main() -> int:
    c = lexo(BAR_DB)
    if not c:
        print(f"Databaza e barit nuk u gjet te {BAR_DB} — cakto KONTABO_BAR_DB.", file=sys.stderr)
        return 1
    gjere = max(len(e) for _, e, _, _ in IDENTITETI)
    print("IDENTITETI I FIRMËS (një burim: Kontabo Finance)")
    for k, emri, _, _ in IDENTITETI:
        print(f"  {emri:<{gjere}} : {rresht(c.get(k, ''))}")
    print("\nFISKALIZIMI (për arkë — ERP-ja nuk e dërgon kurrë)")
    for k, emri in PER_ARKE:
        print(f"  {emri:<46} : {rresht(c.get(k, ''))}")
    if "--shkruaj" in sys.argv:
        DOC.parent.mkdir(parents=True, exist_ok=True)
        DOC.write_text(fleta(c), encoding="utf-8", newline="\n")
        print(f"\nU shkrua {DOC}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
