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
import argparse, csv, io, json, os, re, shutil, ssl, subprocess, sys, time, urllib.parse, urllib.request
from collections import Counter

BASE = os.environ.get("DISPATCHIO_BASE", "https://data.transportation.gov")
URL = BASE + "/api/v3/views/{}/export.csv?accessType=DOWNLOAD"
CENSUS_ID, AUTH_ID = "az4n-8mr2", "inys-ebih"
LOWER48 = set("AL AR AZ CA CO CT DE FL GA IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT "
              "NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY".split())

_ABBR = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split()
_NAMES = ["ALABAMA", "ALASKA", "ARIZONA", "ARKANSAS", "CALIFORNIA", "COLORADO", "CONNECTICUT", "DELAWARE", "FLORIDA", "GEORGIA", "HAWAII", "IDAHO", "ILLINOIS", "INDIANA", "IOWA", "KANSAS", "KENTUCKY", "LOUISIANA", "MAINE", "MARYLAND", "MASSACHUSETTS", "MICHIGAN", "MINNESOTA", "MISSISSIPPI", "MISSOURI", "MONTANA", "NEBRASKA", "NEVADA", "NEW HAMPSHIRE", "NEW JERSEY", "NEW MEXICO", "NEW YORK", "NORTH CAROLINA", "NORTH DAKOTA", "OHIO", "OKLAHOMA", "OREGON", "PENNSYLVANIA", "RHODE ISLAND", "SOUTH CAROLINA", "SOUTH DAKOTA", "TENNESSEE", "TEXAS", "UTAH", "VERMONT", "VIRGINIA", "WASHINGTON", "WEST VIRGINIA", "WISCONSIN", "WYOMING", "DISTRICT OF COLUMBIA"]
STATE_CODE = dict(zip(_NAMES, _ABBR))


def norm_state(v):
    v = (v or "").strip().upper()
    return STATE_CODE.get(v, v[:2] if len(v) == 2 else v)


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


_curl = {"on": False}


def http_get(url, insecure=False):
    """GET a URL and return bytes. Falls back to Windows' curl when Python cannot verify the certificate."""
    if not _curl["on"]:
        ctx = None
        if insecure:
            ctx = ssl._create_unverified_context()
            ctx.options |= getattr(ssl, "OP_IGNORE_UNEXPECTED_EOF", 0)
        req = urllib.request.Request(url, headers={"User-Agent": "dispatchio/3.1"})
        try:
            with urllib.request.urlopen(req, timeout=120, context=ctx) as r:
                return r.read()
        except Exception as e:
            if "CERTIFICATE_VERIFY_FAILED" in str(e) and shutil.which("curl"):
                _curl["on"] = True
            else:
                raise
    r = subprocess.run(["curl", "-sS", "-L", "--fail", "--ssl-no-revoke", "--max-time", "240", url], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"curl error {r.returncode}: {r.stderr.decode(errors='replace')[:200]}")
    return r.stdout


def fetch_retry(url, insecure, tries=6):
    err = None
    for i in range(tries):
        try:
            return http_get(url, insecure)
        except Exception as e:
            err = e
            time.sleep(min(30, 3 * (i + 1)))
    raise RuntimeError(f"gave up after {tries} tries: {err}")


def expected_rows(ds, insecure):
    try:
        t = http_get(f"{BASE}/resource/{ds}.csv?$select=count(*)%20as%20n", insecure).decode()
        m = re.search(r"(\d+)", t.split("\n", 1)[1] if "\n" in t else t)
        return int(m.group(1)) if m else None
    except Exception:
        return None


def download_paged(ds, path, label, insecure=False, token="", page=50000, order_fallbacks=("dot_number",)):
    """Downloads a dataset through FMCSA's data API in pages. Resumable, and it checks the row count at the end,
    so a dropped connection can never silently leave a half-file (the old single-stream download could)."""
    part, state, marker = path + ".part", path + ".offset", path + ".complete"
    tok = f"&$$app_token={urllib.parse.quote(token)}" if token else ""
    order = None
    for o in (":id",) + tuple(order_fallbacks):
        try:
            t = http_get(f"{BASE}/resource/{ds}.csv?$limit=1&$order={urllib.parse.quote(o)}{tok}", insecure)
            if t[:1] not in (b"{", b"[") and b"\n" in t:
                order = o
                break
        except Exception:
            continue
    if order is None:
        sys.exit(f"Could not start the {label} download (the data service did not answer). Check your internet and try again.")
    total = expected_rows(ds, insecure)
    off, mode = 0, "wb"
    if os.path.exists(part) and os.path.exists(state):
        off, mode = int(open(state).read().strip() or 0), "ab"
        print(f"Resuming {label} at row {off:,}")
    print(f"Downloading {label}" + (f" ({total:,} rows)" if total else "") + " in pages. Safe to stop and re-run; it resumes.")
    with open(part, mode) as f:
        while True:
            url = f"{BASE}/resource/{ds}.csv?$limit={page}&$offset={off}&$order={urllib.parse.quote(order)}{tok}"
            try:
                data = fetch_retry(url, insecure)
            except RuntimeError as e:
                sys.exit(f"\nDownload stopped: {e}\nRun the same command again and it will continue from row {off:,}.")
            if data[:1] in (b"{", b"["):
                sys.exit(f"\nThe data service returned an error: {data[:300].decode(errors='replace')}")
            text = data.decode("utf-8", "replace")
            n = sum(1 for _ in csv.reader(io.StringIO(text))) - 1
            if n <= 0:
                break
            body = data if off == 0 else data[data.index(b"\n") + 1:]
            f.write(body if body.endswith(b"\n") else body + b"\n")
            f.flush()
            off += n
            open(state, "w").write(str(off))
            print(f"\r  {off:,}" + (f" / {total:,} rows" if total else " rows"), end="", flush=True)
            if n < page:
                break
    print()
    if total and off < total * 0.995:
        sys.exit(f"The {label} download ended early ({off:,} of {total:,} rows). Run the command again to continue.")
    os.replace(part, path)
    try:
        os.remove(state)
    except OSError:
        pass
    open(marker, "w").write(str(off))
    print(f"{label}: {off:,} rows downloaded and verified.")


def ensure_file(ds, path, label, args, order_fallbacks):
    ok = os.path.exists(path) and os.path.exists(path + ".complete")
    if os.path.exists(path) and not ok and not args.trust_existing:
        print(f"The existing {path} was not downloaded with the verified method and may be cut short. Downloading it again.")
    if args.refresh or not ok and not (os.path.exists(path) and args.trust_existing):
        for x in (path + ".complete",):
            if os.path.exists(x):
                os.remove(x)
        download_paged(ds, path, label, args.insecure, args.app_token, order_fallbacks=order_fallbacks)


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

    def cands(pat, exclude=""):
        return [h for l, h in H.items() if re.search(pat, l) and not (exclude and re.search(exclude, l))]

    def best(lst):
        return sorted(lst, key=lambda h: 0 if re.search(r"bus|phy|physical|business|principal", h.lower()) else 2 if "mail" in h.lower() else 1)[0] if lst else None
    cn = {"name": best(cands(r"legal.*name") or cands(r"^name$|carrier.*name|company.*name|business.*name|^bus.*name", r"dba")),
          "dba": best(cands(r"dba")), "phone": best(cands(r"phone|(^|_)tel", r"fax|cell|mail")),
          "street": best(cands(r"street|addr", r"email|e_mail|city|state|zip")), "city": best(cands(r"city")),
          "state": best(cands(r"(^|_)(state|st)($|_code)")), "zip": best(cands(r"zip|postal"))}
    print("Authority contact columns used:", ", ".join(f"{k}={v}" for k, v in cn.items() if v) or "none found")
    if not cn["phone"]:
        print("  NOTE: no phone column found in the authority file, so carriers missing from the census cannot be added.")
    contact = {}
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
            if kind == "car":
                cd = contact.get(num)
                if cd is None or d >= cd[0]:
                    contact[num] = (d, {k: (row.get(h) or "").strip() for k, h in cn.items() if h})
        except Exception:
            bad += 1
    auth, bdots = {}, set()
    for (num, kind), (_, act, dt) in state.items():
        rec = auth.setdefault(num, {"dot": dt, "car": False, "br": False, "c": (contact.get(num) or (None, {}))[1]})
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


def gap_lead(num, r, a):
    """A carrier with active authority that is not in the census yet (the census lags new carriers).
    Name, address and phone come from the authority file; fleet size, cargo and authority are verified live in the panel."""
    c = r.get("c") or {}
    ph, st = norm_phone(c.get("phone")), norm_state(c.get("state"))
    if not ph or st not in LOWER48:
        return None
    return {"gap": True, "dot": r["dot"], "name": c.get("name") or f"MC {num}", "dba": c.get("dba", ""), "phone": ph, "phone2": None,
            "email": "", "owner": "", "street": c.get("street", ""), "city": c.get("city", "").title(), "state": st, "zip": c.get("zip", ""),
            "units": None, "drivers": None, "added": "", "mcs150": "", "op": "", "cls": "", "hazmat": False, "cargo": []}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--census", default="census.csv")
    ap.add_argument("--authority", default="authority.csv")
    ap.add_argument("--refresh", action="store_true", help="download fresh copies of both files")
    ap.add_argument("--insecure", action="store_true", help="skip the SSL certificate check when downloading")
    ap.add_argument("--trust-existing", action="store_true", help="use census.csv/authority.csv as they are, without re-downloading")
    ap.add_argument("--app-token", default="", help="optional free Socrata app token for faster downloads")
    ap.add_argument("--out", default="queue.json")
    ap.add_argument("--columns", action="store_true")
    ap.add_argument("--explain", default="", help="MC range, e.g. 1290000-1290300")
    ap.add_argument("--start-mc", type=int, default=0)
    ap.add_argument("--limit", type=int, default=0, help="stop after this many leads (0 = all)")
    ap.add_argument("--max-fleet", type=int, default=9999, help="build-time cap; the side panel sets the live limit")
    ap.add_argument("--min-fleet", type=int, default=0)
    ap.add_argument("--no-cell-fallback", action="store_true", help="never use the cell phone field")
    a = ap.parse_args()

    ensure_file(CENSUS_ID, a.census, "the FMCSA census", a, ("dot_number",))
    ensure_file(AUTH_ID, a.authority, "the FMCSA authority file", a, ("docket_number",))
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
    verdict, census_status, census_rows, max_dot = {}, Counter(), 0, 0
    for row in safe_rows(rd):
        try:
            dt = dotnorm(g(row, "dot"))
            census_rows += 1
            if dt.isdigit() and int(dt) > max_dot:
                max_dot = int(dt)
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

    # ---- Coverage checks: this is how a cut-short download or a bad column match shows up ----
    found = sum(1 for d in cand if d in verdict)
    cov = found / len(cand) if cand else 0
    cand_max = max((int(d) for d in cand if d.isdigit()), default=0)
    print(f"\nCensus rows read: {census_rows:,}   highest USDOT in census: {max_dot:,}   highest USDOT with active carrier authority: {cand_max:,}")
    print(f"Active carrier authorities found in the census: {found:,} of {len(cand):,} ({cov:.0%})")
    if cov < 0.9:
        print("WARNING: many active carriers are missing from the census file. The file is probably incomplete.\n"
              "         Run: python build_queue.py --refresh     (the new downloader verifies the row count)")
    buckets, bact = Counter(), Counter()
    for num, r in auth.items():
        buckets[int(num) // 100000] += 1
        bact[int(num) // 100000] += 1 if r["car"] else 0
    print("\nDockets in the authority file by MC range (should rise steadily up to the newest MCs):")
    for k in sorted(buckets)[-14:]:
        print(f"  MC {k*100000:>9,} to {k*100000+99999:>9,}: {buckets[k]:>7,} dockets, {bact[k]:>7,} with active carrier authority")

    # ---- Step 3: results per MC ----
    why, leads, trace = Counter(), [], {}
    for num, r in auth.items():
        n_int = int(num)
        if not r["car"]:
            res = "skipped: authority not active" + (" (broker only)" if r["br"] else "")
        elif not r["dot"] or r["dot"] not in cand:
            res = "skipped: no USDOT on record"
        elif r["dot"] not in verdict:
            res = gap_lead(num, r, a) or "skipped: not in the census, and no usable phone or state in the authority file"
        else:
            res = verdict[r["dot"]]
        if isinstance(res, dict):
            why["KEPT (not in census yet, verified live in the panel)" if res.get("gap") else "KEPT"] += 1
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
        cnt = Counter()
        for n in range(lo, hi + 1):
            r = trace.get(n, "not in the FMCSA authority file")
            cnt["KEPT" if r.startswith("KEPT") else re.sub(r" \(.*\)$", "", r)] += 1
        print(f"\n--- Summary for MC {lo} to {hi} ({hi - lo + 1:,} numbers) ---")
        for k, v in sorted(cnt.items(), key=lambda kv: -kv[1]):
            print(f"{v:>8,}  {k}")
        print(f"\n--- MC {lo} to {hi} ---")
        shown = 0
        for n in range(lo, hi + 1):
            print(f"MC {n}: {trace.get(n, 'not in the FMCSA authority file (never granted, withdrawn, or too old)')}")
            shown += 1
            if shown >= 600:
                print("(stopped at 600 lines)"); break


if __name__ == "__main__":
    main()
