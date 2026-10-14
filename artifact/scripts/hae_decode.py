"""Decode a Health Auto Export email into per-day activity rows (JSON).

Usage: python3 hae_decode.py raw.txt
raw.txt holds the Gmail get_message RAW `raw` value (base64url of the whole MIME message).
Prints [{"date", "active", "exercise", "resting", "steps", "weight"}], one per CSV row;
missing values are null.
"""
import base64, csv, email, io, json, sys

data = open(sys.argv[1]).read().strip()
try:
    msg = email.message_from_bytes(base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)))
except Exception:
    msg = email.message_from_string(data)  # already-decoded MIME text
for part in msg.walk():
    if part.get_content_type() == "text/csv":
        text = part.get_payload(decode=True).decode("utf-8-sig")
        break
else:
    sys.exit("No text/csv attachment found")

COLS = {"active": "Active Energy", "exercise": "Apple Exercise Time", "resting": "Resting Energy",
        "steps": "Step Count", "weight": "Weight"}
def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None
rows = []
for r in csv.DictReader(io.StringIO(text)):
    out = {"date": (r.get("Date/Time") or r.get("Date") or "")[:10]}
    for key, prefix in COLS.items():
        col = next((c for c in r if c and c.startswith(prefix)), None)
        v = num(r.get(col)) if col else None
        if v is not None and key == "weight" and "(kg)" in col: v *= 2.20462
        out[key] = v
    if out["date"]: rows.append(out)
print(json.dumps(rows))
