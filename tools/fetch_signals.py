#!/usr/bin/env python3
"""정읍 신호등 위치를 OpenStreetMap(Overpass)에서 받아 data/signals.json 에 저장한다.
키 불필요. 실행: fetch_signals.bat 더블클릭
"""
import json, os, sys, urllib.request, urllib.parse

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "data", "signals.json")
BBOX = "35.47,126.80,35.62,126.92"      # 남,서,북,동 (정읍 시내 + 내장산 방향)
QUERY = f'[out:json][timeout:60];node["highway"="traffic_signals"]({BBOX});out;'
SERVERS = ["https://overpass-api.de/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter"]


def fetch():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    last = None
    for url in SERVERS:
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "jeongeup-map/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            print("실패:", url, e)
    sys.exit("신호등 데이터를 받지 못했습니다: " + str(last))


def main():
    data = fetch()
    pts = [[round(e["lon"], 6), round(e["lat"], 6)] for e in data.get("elements", []) if "lon" in e]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(pts, f)
    print(f"신호등 {len(pts)}개 저장 완료 -> data/signals.json")
    if not pts:
        print("※ 0개입니다. OSM에 이 지역 신호등이 아직 없을 수 있어요.")


if __name__ == "__main__":
    main()
