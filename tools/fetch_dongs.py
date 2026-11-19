# -*- coding: utf-8 -*-
"""정읍시 법정동(읍·면·동·리) 코드표를 받아 data/dongs.json 으로 저장.
건축물대장조회 폴더의 bldg_core.py 와 config.json(서비스키)을 그대로 씁니다. 키는 이 파일/결과에 저장되지 않습니다."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CORE = os.path.join(os.path.dirname(ROOT), "건축물대장조회")
sys.path.insert(0, CORE)
import bldg_core as bc

key = bc.load_key()
if not key:
    sys.exit("서비스키(config.json)를 찾지 못했어요: " + CORE)
out = {}
for page in range(1, 31):
    data = bc.http_get_json(bc.REGION_URL, {"type": "json", "pageNo": page, "numOfRows": 100,
                                            "locatadd_nm": "정읍시"}, key, key_param="ServiceKey")
    rows = bc._region_rows(data)
    for r in rows:
        code = str(r.get("region_cd", ""))
        name = r.get("locatadd_nm", "")
        # 전북특별자치도 출범으로 코드가 45180→52180 으로 바뀜. 건물 데이터(옛 코드 4518…)와 맞추려고 둘 다 저장
        if code[:5] in ("45180", "52180") and len(code) == 10 and code[5:8] != "000" and "정읍시" in name:
            out["45180" + code[5:]] = name.split("정읍시")[-1].strip()
    print("page", page, "rows", len(rows), "누적", len(out), rows[0].get("region_cd") if rows else "")
    if len(rows) < 100:
        break
path = os.path.join(ROOT, "data", "dongs.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(dict(sorted(out.items())), f, ensure_ascii=False, indent=0)
print("저장:", path, len(out), "개")
