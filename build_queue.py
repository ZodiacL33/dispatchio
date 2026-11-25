#!/usr/bin/env python3
"""Dispatchio: builds queue.json (your call list) from FMCSA's free public data.

Authority (MC authorized, carrier vs broker) comes from FMCSA's current "Motus Carrier - All With History"
file. Contacts, fleet size, cargo and location come from the Company Census File. Both update daily.

  python build_queue.py                      download both files (first run) and build the queue
  python build_queue.py --explain 1290000-1290300   show why each MC in that range was kept or skipped
  python build_queue.py --columns            print the column names of both files
  python build_queue.py --refresh            download fresh copies first (do this weekly)
  python build_queue.py --insecure           skip the SSL certificate check when downloading
"""
import argparse, csv, json, os, re, shutil, ssl, subprocess, sys, urllib.request
from collections import Counter

URL = "https://data.transportation.gov/api/v3/views/{}/export.csv?accessType=DOWNLOAD"
CENSUS_ID, AUTH_ID = "az4n-8mr2", "inys-ebih"
LOWER48 = set("AL AR AZ CA CO CT DE FL GA IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT "
              "NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY".split())

ALIASES = {
    "dot": ["dot_number", "dotnumber", "usdot_number"],
    "name": ["legal_name", "legalname"], "dba": ["dba_name", "dbaname"],
    "status": ["status_code", "statuscode"],
    "operation": ["carrier_operation", "carrieroperation"], "cls": ["classdef", "carrier_class", "carrierclass"],
    "street": ["phy_street", "physical_street"], "city": ["phy_city"], "state": ["phy_state"],
    "zip": ["phy_zip"], "country": ["phy_country"],
    "phone": ["telephone", "phone"], "cell": ["cell_phone", "cellphone"],
    "email": ["email_address", "email"],
    "units": ["nbr_power_unit", "power_units", "powerunits"],
    "drivers": ["driver_total", "total_drivers", "totaldrivers"],
    "added": ["add_date", "added_date", "adddate"], "mcs150": ["mcs150_date", "mcs150date"],
    "off1": ["company_officer_1", "officer_1"], "off2": ["company_officer_2", "officer_2"],
    "genfreight": ["crgo_genfreight", "general_freight"],
    "hm": ["hm_flag", "hm_ind", "hazmat"],
}
CARGO_NAMES = {"genfreight": "General freight", "household": "Household goods", "metalsheet": "Metal sheets/coils",
               "motoveh": "Motor vehicles", "drivetow": "Drive/tow away", "logpole": "Logs/poles/beams",
               "bldgmat": "Building materials", "mobilehome": "Mobile homes", "machlrg": "Machinery/large objects",
               "produce": "Fresh produce", "liqgas": "Liquids/gases", "intermodal": "Intermodal containers",
               "passengers": "Passengers", "oilfield": "Oilfield equipment", "livestock": "Livestock",
               "grainfeed": "Grain/feed/hay", "coalcoke": "Coal/coke", "meat": "Meat", "garbage": "Garbage/refuse",
               "usmail": "US mail", "chem": "Chemicals", "drybulk": "Dry bulk", "coldfood": "Refrigerated food",
               "beverages": "Beverages", "paperprod": "Paper products", "utility": "Utility",
               "farmsupp": "Farm supplies", "construct": "Construction", "waterwell": "Water well"}


def pick(H, key):
    for a in ALIASES[key]:
        if a in H:
            return H[a]
    return None


def dotnorm(v):
    return re.sub(r"\D", "", v or "").lstrip("0")


def norm_phone(v):
    d = re.sub(r"\D", "", v or "")
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    if len(d) != 10 or d[0] in "01" or d[3] in "01" or len(set(d)) == 1:
        return None
    return d


def norm_date(v):
    v = (v or "").strip()
    m = re.match(r"^(\d{4})-?(\d{2})-?(\d{2})", v)
    if m:
        return f"{m[1]}-{m[2]}-{m[3]}"
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", v)
    return f"{m[3]}-{int(m[1]):02d}-{int(m[2]):02d}" if m else v


def active(v):
    return (v or "").strip().upper()[:1] == "A"


def truthy(v):
    return (v or "").strip().upper() in ("X", "Y", "1", "TRUE", "T")


def safe_rows(rd):
    """Yield rows; a damaged line becomes an empty row instead of stopping the run."""
    while True:
        try:
            yield next(rd)
        except StopIteration:
            return
        except csv.Error:
            yield {}


def openrd(path):
    csv.field_size_limit(1 << 24)
    rd = csv.DictReader(open(path, newline="", encoding="utf-8", errors="replace"))
    return rd, {h.strip().lower(): h for h in rd.fieldnames or []}


def download(ds_id, path, insecure, min_big, label):
    url = URL.format(ds_id)
    print(f"Downloading {label} (large file, can take 10-25 minutes)...")
    ctx = None
    if insecure:
        ctx = ssl._create_unverified_context()
        ctx.options |= getattr(ssl, "OP_IGNORE_UNEXPECTED_EOF", 0)
    req = urllib.request.Request(url, headers={"User-Agent": "dispatchio/2.0"})
    try:
        with urllib.request.urlopen(req, timeout=60, context=ctx) as r, open(path, "wb") as f:
            total, done = int(r.headers.get("Content-Length") or 0), 0
            while chunk := r.read(1 << 20):
                f.write(chunk)
                done += len(chunk)
                print(f"\r  {done >> 20} MB" + (f" / {total >> 20} MB" if total else ""), end="")
        print()
        return
    except PermissionError:
        sys.exit("\nWindows will not let this folder be written to. Move the Dispatchio folder to your Desktop or Documents and run again.")
    except Exception as e:
        err = str(e)
    if os.path.exists(path):
        os.remove(path)
    if "CERTIFICATE_VERIFY_FAILED" in err and shutil.which("curl"):
        print("\nPython could not verify the website certificate. Retrying with Windows' own downloader (curl)...")
        part = path + ".part"
        rc = subprocess.call(["curl", "-L", "--fail", "--ssl-no-revoke", "-o", part, url])
        size = os.path.getsize(part) if os.path.exists(part) else 0
        if (rc == 0 and size > 100_000) or (rc == 56 and size > min_big):
            with open(part, "rb+") as f:          # cut off any half-written last line
                f.seek(0, 2); end = f.tell(); f.seek(max(0, end - 1_000_000)); tail = f.read()
                if not tail.endswith(b"\n"):
                    f.truncate(end - len(tail) + tail.rfind(b"\n") + 1)
            os.replace(part, path)
            print(f"\nDownloaded {size >> 20} MB." + ("" if rc == 0 else " (Windows reported a closing error, the file was kept.)"))
            return
        if os.path.exists(part):
            os.remove(part)
    sys.exit(f"\nDownload of {label} failed: {err}\n"
             f"Option 1: in Chrome open https://data.transportation.gov/d/{ds_id}, Export > CSV, save it in this folder as {os.path.basename(path)}.\n"
             "Option 2: run: python build_queue.py --insecure   (skips the certificate check; the data is public)")


def top(counter, n=8):
    return ", ".join(f"{k or '(blank)'}={v:,}" for k, v in counter.most_common(n))


def load_authority(path):
    """Returns (auth, broker_dots, ff_dots). auth[mc_digits] = {'dot','car','br'} describing CURRENT authority."""
    rd, H = openrd(path)
    find = lambda pat: next((h for l, h in H.items() if re.search(pat, l)), None)
    docket = H.get("docket_number") or find(r"docket")
    dot = H.get("usdot_number") or H.get("dot_number") or find(r"(^|_)dot")
    status = H.get("op_auth_status") or find(r"(auth|oa|op).*stat") or find(r"status")
    typ = H.get("op_auth_type") or find(r"(auth|oa|op).*type")
    datec = H.get("status_change_date") or find(r"date.*(stat|chang|effect)|(stat|chang|effect).*date")
    lay_b = {k: [h for l, h in H.items() if k in l and "stat" in l and "pend" not in l and "rev" not in l]
             for k in ("common", "contract", "broker")}
    layout_b = not (typ and status) and (lay_b["common"] or lay_b["contract"])
    if not docket or not dot or not (layout_b or status):
        sys.exit("Could not recognise the authority file's columns. Run: python build_queue.py --columns\n"
                 "and send me the authority file's column list.")
    print(f"Authority columns used: docket={docket}, dot={dot}, status={status}, type={typ}, date={datec}"
          + (f", layout B {lay_b}" if layout_b else ""))
    state, ffdots, stc, tyc, n, bad = {}, set(), Counter(), Counter(), 0, 0
    for row in safe_rows(rd):
        try:
            m = re.match(r"^(MC|FF|MX)0*(\d+)$", re.sub(r"[^A-Z0-9]", "", (row.get(docket) or "").upper()))
            if not m:
                continue
            n += 1
            pre, num = m.groups()
            dt = dotnorm(row.get(dot))
            if layout_b:
                car = any(active(row.get(h)) for h in lay_b["common"] + lay_b["contract"])
                br = any(active(row.get(h)) for h in lay_b["broker"])
                if pre == "MC":
                    state[(num, "car")] = ("", car, dt); state[(num, "br")] = ("", br, dt)
                continue
            t = (row.get(typ) or "").upper() if typ else ""
            act = active(row.get(status))
            stc[row.get(status)] += 1; tyc[row.get(typ) if typ else "(none)"] += 1
            if pre == "FF" or "FORWARD" in t:
                if act and dt: ffdots.add(dt)
                continue
            if pre != "MC":
                continue
            kind = "br" if "BROKER" in t else "car"
            d = (row.get(datec) or "") if datec else ""
            cur = state.get((num, kind))
            if cur is None or d >= cur[0]:
                state[(num, kind)] = (d, act, dt)
        except Exception:
            bad += 1
    auth, bdots = {}, set()
    for (num, kind), (_, act, dt) in state.items():
        rec = auth.setdefault(num, {"dot": dt, "car": False, "br": False})
        rec["dot"] = rec["dot"] or dt
        if act:
            rec[kind] = True
            if kind == "br" and dt:
                bdots.add(dt)
    print(f"  docket rows read: {n:,}   unreadable: {bad:,}")
    if stc:
        print("  status values:", top(stc)); print("  authority type values:", top(tyc))
    if not any(r["car"] for r in auth.values()):
        sys.exit("No active carrier authorities were found in the authority file, so the status/type columns were "
                 "probably misread. Run: python build_queue.py --columns   and send me the output.")
    return auth, bdots, ffdots


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--census", default="census.csv")
    ap.add_argument("--authority", default="authority.csv")
    ap.add_argument("--refresh", action="store_true", help="download fresh copies of both files")
    ap.add_argument("--insecure", action="store_true", help="skip the SSL certificate check when downloading")
    ap.add_argument("--out", default="queue.json")
    ap.add_argument("--columns", action="store_true")
    ap.add_argument("--explain", default="", help="MC range, e.g. 1290000-1290300")
    ap.add_argument("--start-mc", type=int, default=0)
    ap.add_argument("--limit", type=int, default=0, help="stop after this many leads (0 = all)")
    ap.add_argument("--max-fleet", type=int, default=9999, help="build-time cap; the side panel sets the live limit")
    ap.add_argument("--min-fleet", type=int, default=0)
    ap.add_argument("--no-cell-fallback", action="store_true", help="never use the cell phone field")
    a = ap.parse_args()

    if a.refresh or not os.path.exists(a.census):
        download(CENSUS_ID, a.census, a.insecure, 500_000_000, "the FMCSA census")
    if a.refresh or not os.path.exists(a.authority):
        download(AUTH_ID, a.authority, a.insecure, 20_000_000, "the FMCSA authority file")
    if a.columns:
        for p in (a.census, a.authority):
            rd, _ = openrd(p)
            print(f"\n--- {p} ---\n" + "\n".join(rd.fieldnames))
            print("sample row:", next(rd, None))
        return

    lo = hi = None
    if a.explain:
        m = re.match(r"^(\d+)-(\d+)$", a.explain.strip())
        if not m:
            sys.exit("Use --explain like: --explain 1290000-1290300")
        lo, hi = int(m[1]), int(m[2])

    # ---- Step 1: current authority per MC ----
    auth, bdots, ffdots = load_authority(a.authority)
    cand = {}
    for num, r in auth.items():
        if r["car"] and r["dot"]:
            cand.setdefault(r["dot"], []).append(num)

    # ---- Step 2: census facts per candidate USDOT ----
    rd, H = openrd(a.census)
    C = {k: pick(H, k) for k in ALIASES}
    miss = [k for k in ("dot", "name", "state", "phone", "units", "genfreight") if not C[k]]
    if miss:
        sys.exit("Could not find these columns in the census file: " + ", ".join(miss) +
                 "\nRun with --columns and send me that list so I can map them.")
    cargo_cols = [(h, l[5:]) for l, h in H.items() if l.startswith("crgo_") and "desc" not in l and "othr" not in l]
    g = lambda row, k: (row.get(C[k]) or "").strip() if C[k] else ""
    verdict, census_status = {}, Counter()
    for row in safe_rows(rd):
        try:
            dt = dotnorm(g(row, "dot"))
            if dt not in cand:
                continue
            census_status[g(row, "status")] += 1
            if dt in bdots:
                verdict[dt] = "skipped: also has broker authority"; continue
            if dt in ffdots:
                verdict[dt] = "skipped: freight forwarder"; continue
            if C["status"] and not active(g(row, "status")):
                verdict[dt] = "skipped: USDOT not active"; continue
            if not truthy(g(row, "genfreight")):
                verdict[dt] = "skipped: General Freight not ticked"; continue
            country, st = g(row, "country").upper(), g(row, "state").upper()
            if (country and country != "US") or st not in LOWER48:
                verdict[dt] = f"skipped: outside the 48 states ({st or country or '?'})"; continue
            try:
                units = int(float(g(row, "units") or 0))
            except ValueError:
                units = -1
            if units < a.min_fleet or units > a.max_fleet:
                verdict[dt] = f"skipped: fleet size {units}"; continue
            ph, alt = norm_phone(g(row, "phone")), norm_phone(g(row, "cell"))
            if not ph and alt and not a.no_cell_fallback:
                ph, alt = alt, None
            if not ph:
                verdict[dt] = "skipped: no valid phone number"; continue
            try:
                drivers = int(float(g(row, "drivers") or 0))
            except ValueError:
                drivers = None
            cargo = [CARGO_NAMES.get(n, n.replace("_", " ").capitalize()) for h, n in cargo_cols if truthy(row.get(h))]
            verdict[dt] = {
                "dot": g(row, "dot"), "name": g(row, "name"), "dba": g(row, "dba"), "phone": ph,
                "phone2": alt if alt != ph else None, "email": g(row, "email").lower(),
                "owner": " / ".join(x for x in (g(row, "off1"), g(row, "off2")) if x),
                "street": g(row, "street"), "city": g(row, "city"), "state": st, "zip": g(row, "zip"),
                "units": units, "drivers": drivers, "added": norm_date(g(row, "added")),
                "mcs150": norm_date(g(row, "mcs150")), "op": g(row, "operation"), "cls": g(row, "cls"),
                "hazmat": truthy(g(row, "hm")), "cargo": cargo}
        except Exception:
            continue

    # ---- Step 3: results per MC ----
    why, leads, trace = Counter(), [], {}
    for num, r in auth.items():
        n_int = int(num)
        if not r["car"]:
            res = "skipped: authority not active" + (" (broker only)" if r["br"] else "")
        elif not r["dot"] or r["dot"] not in cand:
            res = "skipped: no USDOT on record"
        elif r["dot"] not in verdict:
            res = "skipped: not in the census file"
        else:
            res = verdict[r["dot"]]
        if isinstance(res, dict):
            why["KEPT"] += 1
            if n_int >= a.start_mc:
                leads.append({"mc": num, **res})
            trace[n_int] = "KEPT: " + res["name"]
        else:
            why[re.sub(r" \(.*\)$", "", res)] += 1
            trace[n_int] = res
    leads.sort(key=lambda c: int(c["mc"]))
    if a.limit:
        leads = leads[: a.limit]
    json.dump(leads, open(a.out, "w", encoding="utf-8"))

    print("\n--- What happened to every MC in the authority file ---")
    for k, v in sorted(why.items(), key=lambda kv: -kv[1]):
        print(f"{v:>10,}  {k}")
    print("census USDOT status values among candidates:", top(census_status))
    print(f"\nQueue ready: {len(leads):,} carriers -> {a.out}")
    if leads:
        print(f"MC range: {leads[0]['mc']} to {leads[-1]['mc']}")
    if lo is not None:
        print(f"\n--- MC {lo} to {hi} ---")
        shown = 0
        for n in range(lo, hi + 1):
            print(f"MC {n}: {trace.get(n, 'not in the FMCSA authority file (never granted, withdrawn, or too old)')}")
            shown += 1
            if shown >= 600:
                print("(stopped at 600 lines)"); break


if __name__ == "__main__":
    main()
