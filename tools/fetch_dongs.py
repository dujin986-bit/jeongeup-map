# -*- coding: utf-8 -*-
"""정읍시 법정동(읍·면·동·리) 코드표를 받아 data/dongs.json 으로 저장.
건축물대장조회 폴더의 bldg_core.py 와 config.json(서비스키)을 그대로 씁니다. 키는 결과에 저장되지 않습니다."""
import json, os, sys, traceback
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(os.path.dirname(ROOT), "건축물대장조회"))
import bldg_core as bc

key = bc.load_key()
if not key:
    sys.exit("서비스키(config.json)를 찾지 못했어요")
out, debug = {}, []
for q in ("정읍시", "전북특별자치도 정읍시", "전라북도 정읍시"):
    for page in range(1, 31):
        try:
            data = bc.http_get_json(bc.REGION_URL, {"type": "json", "pageNo": page, "numOfRows": 100,
                                                    "locatadd_nm": q}, key, key_param="ServiceKey")
        except Exception as e:
            debug.append({"q": q, "page": page, "error": str(e)[:300]}); print("오류:", q, page, str(e)[:120]); break
        if page == 1:
            debug.append({"q": q, "raw": json.dumps(data, ensure_ascii=False)[:1500]})
        try:
            rows = bc._region_rows(data)
        except Exception as e:
            debug.append({"q": q, "page": page, "error": str(e)[:300]}); print("응답 오류:", q, str(e)[:120]); break
        for r in rows:
            code = str(r.get("region_cd", "")); name = r.get("locatadd_nm", "")
            if "정읍시" in name and len(code) == 10 and code[5:8] != "000":
                out["45180" + code[5:]] = name.split("정읍시")[-1].strip()
        print(q, "page", page, "rows", len(rows), "누적", len(out))
        if len(rows) < 100:
            break
    if out:
        break
with open(os.path.join(ROOT, "data", "dongs.json"), "w", encoding="utf-8") as f:
    json.dump(dict(sorted(out.items())), f, ensure_ascii=False, indent=0)
with open(os.path.join(ROOT, "data", "_dongs_debug.json"), "w", encoding="utf-8") as f:
    json.dump(debug, f, ensure_ascii=False, indent=1)
print("저장:", len(out), "개")
