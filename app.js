const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty", // 무료, API 키 불필요
  center: JEONGEUP_CENTER,
  zoom: 15.2,
  pitch: 60,
  bearing: -20,
  maxPitch: 80,
  minZoom: 9.5,
  maxBounds: [[126.55, 35.25], [127.25, 35.85]],   // 정읍시 일대(대략). 경계 파일이 있으면 자동 보정
});
// 시험용 밤 지도 스타일: 주소 끝에 ?style=dark (CARTO Dark Matter, 무료·키 불필요)
const DARKSTYLE = new URLSearchParams(location.search).get("style") === "dark";
if (DARKSTYLE) {
  map.setStyle("https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json", {
    diff: false,
    // 우리 글자 레이어(가게·건물 이름)가 한글로 나오도록 글꼴 서버는 OpenFreeMap 것을 그대로 사용
    transformStyle: (prev, next) => ({ ...next, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf" }),
  });
}
let VEC_SRC_CACHE = null;
function vecSrc() {                // 스타일의 벡터 타일 소스 이름 (liberty=openmaptiles, CARTO=carto 등)
  if (VEC_SRC_CACHE) return VEC_SRC_CACHE;
  const s = map.getStyle().sources || {};
  VEC_SRC_CACHE = s.openmaptiles ? "openmaptiles" : (Object.keys(s).find(k => s[k].type === "vector") || "openmaptiles");
  return VEC_SRC_CACHE;
}
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), "top-right");

// ---------- 데이터 ----------
const STORE_KEY = "jeongeup-reports-v1";
const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } };
const store = (list) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch {} };

const LIVE = new URLSearchParams(location.search).get("live") === "1";   // 방송 모드
if (LIVE) document.body.classList.add("live");
const IS_LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);   // 내 PC에서만 가게 수정 가능
let reports = [];                // 시민 제보: 서버(Supabase)에서 승인된 것만 받아옴
let activeCats = new Set(Object.keys(CATEGORIES));
let markers = [];

// ---------- 필터 UI ----------
const filtersEl = document.getElementById("filters");
const catSel = document.getElementById("cat");
for (const [key, c] of Object.entries(CATEGORIES)) {
  const b = document.createElement("button");
  b.className = "chip on"; b.textContent = c.label; b.style.flex = "none";
  b.onclick = () => {
    activeCats.has(key) ? activeCats.delete(key) : activeCats.add(key);
    b.classList.toggle("on");
    render();
  };
  filtersEl.appendChild(b);
  catSel.add(new Option(c.label, key));
}

// ---------- 마커 ----------
function addMarker(item, isLandmark) {
  const c = CATEGORIES[item.cat];
  const el = document.createElement("div");
  el.className = "pin";
  el.style.background = c.color;
  if (isLandmark) el.style.outline = "2px solid #fff";
  const when = item.ts ? `<br><small>${timeAgo(item.ts)} · ${new Date(item.ts).toLocaleString("ko-KR")}</small>` : "";
  const popup = new maplibregl.Popup({ offset: 20 }).setHTML(
    `<strong>${esc(item.name || item.title)}</strong> <small>(${c.label})</small><br>${esc(item.desc || "")}${when}` + navLinks(item.name || item.title, item.coord[0], item.coord[1])
  );
  el.addEventListener("click", () => playFx(item.cat, el));      // 클릭 연출 (1~2초)
  const m = new maplibregl.Marker({ element: el }).setLngLat(item.coord).setPopup(popup).addTo(map);
  m._item = item; markers.push(m);
}
function navLinks(name, lon, lat) {         // 길찾기/지도 링크 (카카오·네이버, 키 필요 없음)
  const nm = String(name || "").replace(/[,]/g, " ");
  return `<div class="nav-links"><a href="https://map.kakao.com/link/to/${encodeURIComponent(nm)},${lat},${lon}" target="_blank" rel="noopener">🚗 길찾기</a>` +
         `<a href="https://map.naver.com/p/search/${encodeURIComponent("정읍 " + nm)}" target="_blank" rel="noopener">네이버지도</a></div>`;
}
function esc(s) { return String(s).replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch])); }

function render() {
  markers.forEach(m => m.remove()); markers = [];
  LANDMARKS.filter(l => activeCats.has(l.cat)).forEach(l => addMarker(l, true));
  reports.filter(r => activeCats.has(r.cat)).forEach(r => addMarker(r, false));
  renderFeed();
  if (typeof renderComm === "function" && commEl && !commEl.hidden) renderComm();
}

// ---------- 제보 목록 (상단) ----------
function timeAgo(ts) {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return m + "분 전";
  if (m < 1440) return Math.floor(m / 60) + "시간 전";
  return Math.floor(m / 1440) + "일 전";
}
// 목록에서 제보를 눌렀을 때: 그 위치로 날아가서 팝업을 열고 연출(경광등·폭죽 등)까지 자동 재생
function focusReport(r, dur = 1500) {
  map.flyTo({ center: r.coord, zoom: 17, pitch: 60, duration: dur, essential: true });
  let done = false;
  const fire = () => {
    if (done) return; done = true;
    const mk = markers.find(x => x._item && x._item.id === r.id);
    if (!mk) return;
    if (!mk.getPopup().isOpen()) mk.togglePopup();
    playFx(r.cat, mk.getElement());
  };
  map.once("moveend", () => setTimeout(fire, 120));
  setTimeout(fire, dur + 700);        // moveend가 안 오는 경우 대비
}
function renderFeed() {
  const btn = document.getElementById("feed-btn"), box = document.getElementById("feed");
  if (!btn || !box) return;
  const list = reports.filter(r => activeCats.has(r.cat));
  btn.textContent = `제보 ${list.length}`;
  if (LIVE) box.hidden = false;
  box.innerHTML = list.length ? "" : '<div class="feed-empty">아직 제보가 없어요. 지도를 길게 눌러 첫 제보를 남겨 보세요!</div>';
  for (const r of list) {
    const c = CATEGORIES[r.cat];
    const row = document.createElement("div");
    row.className = "feed-row";
    row.innerHTML = `<span class="feed-dot" style="background:${c.color}"></span><div><div class="feed-title">${esc(r.title)}</div>` +
      `<div class="feed-meta">${c.label} · ${timeAgo(r.ts)}${r.desc ? " · " + esc(r.desc) : ""}</div></div>`;
    row.onclick = () => {
      if (!LIVE) box.hidden = true;
      focusReport(r);
    };
    box.appendChild(row);
  }
}
document.getElementById("feed-btn").onclick = () => { const b = document.getElementById("feed"); b.hidden = !b.hidden; };

// ---------- 3D 건물 ----------
map.on("load", () => {
  const layers = map.getStyle().layers;
  // liberty 스타일에 3D 건물 레이어가 이미 있으면 그대로 사용, 없으면 추가
  const has3d = layers.some(l => l.type === "fill-extrusion");
  if (!has3d) {
    map.addLayer({
      id: "buildings-3d", type: "fill-extrusion", source: vecSrc(), "source-layer": "building",
      minzoom: 14,
      paint: {
        "fill-extrusion-color": "#c9ccd1",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.9,
      },
    });
  }
  try { map.setLight({ anchor: "viewport", position: [1.4, 210, 45], intensity: 0.55, color: "#fff4e0" }); } catch (e) {}   // 면 음영
  addAptImages();
  setupTerrain();
  if (!DARKSTYLE) setupColors();
  setupBasePoi();
  loadBoundary();
  loadLocalBuildings().then(() => { bldReady = true; setBuildingNight(nightOn); loadShops(); loadSignals(); });   // 건물 레이어 뒤에 올려야 가려지지 않음
  loadPlaces();
  render();
});

// ---------- 수집한 정읍 건물 데이터 (tools/collect_buildings.py 결과) ----------
// data/<구역>.geojson 이 있으면 3D 건물로 얹고, 큰 건물(7층 이상)은 이름 라벨을 붙인다.
function centroidOf(geom) {
  let ring = null;
  if (!geom) return null;
  if (geom.type === "Polygon") ring = geom.coordinates[0];
  else if (geom.type === "MultiPolygon") ring = geom.coordinates[0] && geom.coordinates[0][0];
  if (!ring || !ring.length) return null;
  let x = 0, y = 0;
  for (const c of ring) { x += c[0]; y += c[1]; }
  return [x / ring.length, y / ring.length];
}

async function loadLocalBuildings() {
  const seen = new Set();           // 구역 겹침으로 생기는 중복 건물 제거
  const groups = new Map();         // 이름 -> 라벨 위치(평균), 최고층
  for (const z of ZONES) {
    try {
      const res = await fetch(`data/${z.id}.geojson`);
      if (!res.ok) continue;
      const gj = await res.json();
      gj.features = gj.features.filter(f => {
        const id = f.properties && f.properties.id;
        if (!id) return true;
        if (seen.has(id)) return false;
        seen.add(id); return true;
      });
      const src = `local-${z.id}`;
      map.addSource(src, { type: "geojson", data: gj });
      const H = ["case", [">", ["get", "height"], 0], ["get", "height"], 6];
      const common = { "fill-extrusion-vertical-gradient": true, "fill-extrusion-height": H, "fill-extrusion-opacity": 0.92 };
      // 일반 건물: 모든 줌 / 아파트: 멀리서는 단색, 가까이서는 창문 줄무늬 패턴
      map.addLayer({ id: `${src}-3d`, type: "fill-extrusion", source: src, minzoom: 14, filter: ["!", IS_APT],
        paint: { ...common, "fill-extrusion-color": BLD_DAY } });
      map.addLayer({ id: `${src}-apt`, type: "fill-extrusion", source: src, minzoom: 14, maxzoom: aptPatterns ? APT_PATTERN_ZOOM : 24, filter: IS_APT,
        paint: { ...common, "fill-extrusion-color": APT_FAR_DAY } });
      for (let i = 0; aptPatterns && i < 5; i++) {
        map.addLayer({ id: `${src}-apt${i}`, type: "fill-extrusion", source: src, minzoom: APT_PATTERN_ZOOM,
          filter: ["all", IS_APT, ["==", APT_PICK, i]],
          paint: { ...common, "fill-extrusion-pattern": `apt${i}-day` } });
      }
      z.status = "loaded";
      for (const f of gj.features) {
        const p = f.properties || {};
        const name = (p.name || "").trim();
        if (!name) continue;
        const c = centroidOf(f.geometry);
        if (!c) continue;
        const g = groups.get(name) || { x: 0, y: 0, n: 0, floors: 0 };
        g.x += c[0]; g.y += c[1]; g.n += 1; g.floors = Math.max(g.floors, p.floors || 0);
        groups.set(name, g);
      }
    } catch (e) { /* 파일 없음/열기 제한: 무시 */ }
  }
  NAMED.length = 0;                 // 검색용: 이름 있는 건물(아파트 등)
  for (const [name, g] of groups) NAMED.push({ name, coord: [g.x / g.n, g.y / g.n] });
  const labels = [];
  for (const [name, g] of groups) {
    if (g.floors < 7) continue;     // 큰 건물(아파트 단지 등)만 이름 표시
    labels.push({ type: "Feature", geometry: { type: "Point", coordinates: [g.x / g.n, g.y / g.n] },
                  properties: { name, floors: g.floors } });
  }
  if (labels.length) {
    map.addSource("local-labels", { type: "geojson", data: { type: "FeatureCollection", features: labels } });
    map.addLayer({
      id: "local-labels", type: "symbol", source: "local-labels", minzoom: 15,
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12,
                "text-anchor": "center", "text-max-width": 8 },
      paint: { "text-color": "#1b1b1b", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
    });
  }
}

// ---------- 내 장소 (data/places.json: tools/find_place.py 로 추가) ----------
// 지도 글자가 아니라 화면 위에 항상 떠 있는 노란 간판(HTML 마커)으로 표시한다.
async function loadPlaces() {
  try {
    const res = await fetch("data/places.json?" + Date.now());
    if (!res.ok) return;
    const places = await res.json();
    for (const p of places) {
      const el = document.createElement("div");
      if (p.kind === "spot") {                       // 장소: 분류 색 점 + 이름, 누르면 설명
        const c = (CATEGORIES[p.cat] || CATEGORIES.info).color;
        el.className = "spot";
        el.innerHTML = `<b style="background:${c}"></b><span>${esc(p.name)}</span>`;
        const pop = new maplibregl.Popup({ offset: 14 }).setHTML(
          `<strong>${esc(p.name)}</strong><br>${esc(p.desc || "")}<br><small>${esc(p.address || "")}</small>`);
        new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat(p.coord).setPopup(pop).addTo(map);
      } else {                                       // 내 사무실: 노란 간판
        el.className = "sign";
        el.style.background = p.color || "#ffd400";
        if (p.textColor) el.style.color = p.textColor;
        el.innerHTML = `<span>${esc(p.name)}</span><i></i>`;
        new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(p.coord).addTo(map);
      }
    }
  } catch (e) { /* 파일 없음: 무시 */ }
}

// ---------- 정읍시 경계 (data/boundary.geojson: tools/fetch_boundary.py) ----------
// 경계 밖은 회색으로 가리고, 이동 범위를 정읍시 + 여백으로 제한한다.
async function loadBoundary() {
  try {
    const res = await fetch("data/boundary.geojson");
    if (!res.ok) return;
    const gj = await res.json();
    const holes = [];
    let w = 999, s = 999, e = -999, n = -999;
    const eat = ring => { holes.push(ring); for (const [x, y] of ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); } };
    for (const f of gj.features) {
      const g = f.geometry; if (!g) continue;
      if (g.type === "Polygon") eat(g.coordinates[0]);
      else if (g.type === "MultiPolygon") g.coordinates.forEach(poly => eat(poly[0]));
    }
    if (!holes.length) return;
    const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    map.addSource("mask", { type: "geojson", data: { type: "Feature", geometry: { type: "Polygon", coordinates: [world, ...holes] } } });
    map.addSource("boundary", { type: "geojson", data: gj });
    map.addLayer({ id: "mask-fill", type: "fill", source: "mask", paint: { "fill-color": "#dfe3e8", "fill-opacity": 0.93 } });
    map.addLayer({ id: "boundary-line", type: "line", source: "boundary", paint: { "line-color": "#1f6feb", "line-width": 2.5 } });
    const pad = 0.03;
    map.setMaxBounds([[w - pad, s - pad], [e + pad, n + pad]]);
  } catch (err) { /* 경계 파일 없음: 대략 범위만 적용 */ }
}

// ---------- 상가/시설 (data/shops.json: tools/search_shops.py) ----------
function shopColor(cat) {
  if (/카페|커피/.test(cat)) return "#8d5524";
  if (/음식|식당|한식|분식|치킨|중식|일식|양식/.test(cat)) return "#f76b15";
  if (/숙박|모텔|펜션|호텔/.test(cat)) return "#8e4ec6";
  if (/편의점|마트|슈퍼|소매/.test(cat)) return "#2f9e44";
  if (/주차/.test(cat)) return "#1f6feb";
  return "#6b7280";
}

let SHOPS = [];
let EDITS = { edits: {}, added: [] };   // 이름 수정/숨김 (data/shop_edits.json, tools/serve.py 가 저장)

function shopFeatures() {
  const out = [];
  for (const s of SHOPS.concat(EDITS.added || [])) {
    const e = (EDITS.edits || {})[s.id] || {};
    if (e.hidden) continue;
    out.push({ type: "Feature", geometry: { type: "Point", coordinates: s.coord },
      properties: { id: s.id, name: e.name || s.name, category: s.category, address: s.address, lon: s.coord[0], lat: s.coord[1],
                    color: shopColor(s.category) } });
  }
  return out;
}

async function sendEdit(payload) {
  const r = await fetch("/api/edit", { method: "POST", headers: { "Content-Type": "application/json" },
                                       body: JSON.stringify(payload) });
  if (!r.ok) throw new Error("저장 실패 (run_map.bat 으로 연 지도에서만 수정이 저장됩니다)");
  EDITS = await r.json();
  const feats = shopFeatures();
  map.getSource("shops").setData({ type: "FeatureCollection", features: feats });
  const chip = document.getElementById("shop-chip");
  if (chip) chip.textContent = `상가 ${feats.length}`;
}

async function loadShops() {
  try {
    const res = await fetch("data/shops.json");
    if (!res.ok) return;
    SHOPS = await res.json();
    try { const er = await fetch("data/shop_edits.json"); if (er.ok) EDITS = await er.json(); } catch (e) {}
    if (!SHOPS.length) return;
    const feats = shopFeatures();
    map.addSource("shops", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
    map.addLayer({ id: "shops-dot", type: "circle", source: "shops", minzoom: 14,
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3, 18, 7],
               "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
    map.addLayer({ id: "shops-label", type: "symbol", source: "shops", minzoom: 16.5,
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11,
                "text-offset": [0, 1.1], "text-anchor": "top", "text-max-width": 8 },
      paint: { "text-color": "#1b1b1b", "text-halo-color": "#fff", "text-halo-width": 1.4 } });
    map.on("click", "shops-dot", e => {
      // 같은 위치에 겹친 가게도 모두 찾는다 (건물 하나에 여러 가게가 있는 경우)
      const pt = e.point;
      const found = map.queryRenderedFeatures([[pt.x - 8, pt.y - 8], [pt.x + 8, pt.y + 8]], { layers: ["shops-dot"] });
      const seen = new Set(), list = [];
      for (const f of found) {
        const id = f.properties.id;
        if (seen.has(id)) continue;
        seen.add(id); list.push(f.properties);
      }
      if (!list.length) return;
      const rows = list.map((p, i) =>
        `<div class="shop-row" data-i="${i}"><strong>${esc(p.name)}</strong><br>${esc(p.category)}<br>` +
        `<small>${esc(p.address)}</small>` + navLinks(p.name, p.lon, p.lat) + (IS_LOCAL ? `<div class="edit-row">` +
        `<button data-a="rename">이름 수정</button><button data-a="hide">없는 가게</button></div>` : "") + `</div>`).join("");
      const head = list.length > 1 ? `<div class="shop-head">이 위치에 가게 ${list.length}곳</div>` : "";
      const pop = new maplibregl.Popup({ offset: 10, maxWidth: "300px" }).setLngLat(e.lngLat)
        .setHTML(`${head}<div class="shop-list">${rows}</div>`).addTo(map);
      pop.getElement().querySelectorAll(".shop-row").forEach(row => {
        const p = list[Number(row.dataset.i)];
        if (!IS_LOCAL) return;
        row.querySelector('[data-a="rename"]').onclick = async () => {
          const n = window.prompt("올바른 가게 이름", p.name);
          if (!n || !n.trim()) return;
          try { await sendEdit({ action: "rename", id: p.id, name: n.trim() }); pop.remove(); } catch (err) { alert(err.message); }
        };
        row.querySelector('[data-a="hide"]').onclick = async () => {
          if (!window.confirm(`"${p.name}" 을(를) 지도에서 숨길까요? (폐업/없는 가게)`)) return;
          try { await sendEdit({ action: "hide", id: p.id }); pop.remove(); } catch (err) { alert(err.message); }
        };
      });
    });
    map.on("mouseenter", "shops-dot", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "shops-dot", () => { map.getCanvas().style.cursor = ""; });
    const chip = document.createElement("button");
    chip.id = "shop-chip"; chip.className = "chip on"; chip.style.flex = "none"; chip.textContent = `상가 ${feats.length}`;
    chip.onclick = () => {
      const on = chip.classList.toggle("on");
      for (const id of ["shops-dot", "shops-label"]) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    document.getElementById("filters").appendChild(chip);
    if (nightOn) setBuildingNight(true);   // 가게 후광 레이어는 가게가 올라온 뒤에 만든다
  } catch (e) { /* 파일 없음: 무시 */ }
}

// ---------- 기본 지도(OpenStreetMap)의 상호/시설 글자 ----------
// 옛 이름이나 없는 가게가 섞여 있어 고칠 수 없으므로, 기본은 끄고 우리 가게 데이터만 보여준다.
// 위쪽 "지도 상호" 칩으로 다시 켤 수 있다.
function setupBasePoi() {
  const ids = map.getStyle().layers.filter(l => l["source-layer"] === "poi").map(l => l.id);
  if (!ids.length) return;
  const set = on => ids.forEach(id => map.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
  set(false);
  const chip = document.createElement("button");
  chip.className = "chip"; chip.style.flex = "none"; chip.textContent = "지도 상호";
  chip.title = "기본 지도에 들어 있는 상호(고칠 수 없음) 보기";
  chip.onclick = () => set(chip.classList.toggle("on"));
  document.getElementById("filters").appendChild(chip);
}

// ---------- 제보 ----------
const panel = document.getElementById("panel");
let pending = null;
let pickMode = false;
const crosshair = document.getElementById("crosshair");
// 핀이 가게·장소·건물 위에 놓이면 그 이름을 보여준다 (가게 30m, 장소 40m, 이름 있는 건물 60m 이내 가장 가까운 것)
let pendingPlace = null;
function nearestPlace(lng, lat) {
  const dist = c => Math.hypot((c[0] - lng) * 91000, (c[1] - lat) * 111000);
  let best = null;
  const take = (name, c, lim, kind) => { if (!name || !c) return; const d = dist(c); if (d <= lim && (!best || d < best.d)) best = { name, d, kind }; };
  for (const s of (typeof SHOPS !== "undefined" ? SHOPS : []).concat(EDITS.added || [])) {
    const e = (EDITS.edits || {})[s.id] || {}; if (e.hidden) continue;
    take(e.name || s.name, s.coord, 30, "상가");
  }
  for (const p of PLACES_IDX) take(p.name, p.coord, 40, "장소");
  for (const n of NAMED) take(n.name, n.coord, 60, "건물");
  for (const l of LANDMARKS) take(l.name, l.coord, 60, "명소");
  return best;
}
function setPos(lngLat) {
  pending = [lngLat.lng, lngLat.lat];
  pendingPlace = nearestPlace(pending[0], pending[1]);
  const posEl = document.getElementById("pos");
  posEl.textContent = pendingPlace ? `📍 선택한 장소: ${pendingPlace.name}` :
    ((pickMode ? "📍 표시된 위치 · 지도를 움직여 맞추세요" : "위치") + `: ${pending[1].toFixed(5)}, ${pending[0].toFixed(5)}`);
  posEl.style.fontWeight = pendingPlace ? "700" : "";
  const nm = document.getElementById("ch-name");
  if (nm) { nm.textContent = pendingPlace ? pendingPlace.name : ""; nm.hidden = !(pickMode && pendingPlace); }
}
function openPanel(lngLat, pick) {
  pickMode = !!pick; crosshair.hidden = !pickMode;
  setPos(lngLat);
  panel.hidden = false;
}
function closePanel() { panel.hidden = true; pickMode = false; crosshair.hidden = true; const nm = document.getElementById("ch-name"); if (nm) nm.hidden = true; }
map.on("move", () => { if (pickMode && !panel.hidden) setPos(map.getCenter()); });
document.getElementById("fab").onclick = () => openPanel(map.getCenter(), true);
map.on("contextmenu", e => openPanel(e.lngLat));            // PC: 우클릭
let pressTimer;                                              // 모바일: 길게 누르기
map.on("touchstart", e => { if (e.points.length === 1) pressTimer = setTimeout(() => openPanel(e.lngLat), 600); });
["touchend", "touchmove", "touchcancel"].forEach(t => map.on(t, () => clearTimeout(pressTimer)));

document.getElementById("cancel").onclick = closePanel;
const modeSel = document.getElementById("mode");
function syncMode() {
  const shop = modeSel.value === "shop";
  document.getElementById("cat").hidden = shop;
  document.getElementById("shopcat").hidden = !shop;
  document.getElementById("title").placeholder = shop ? "가게 이름" : "제목 (예: 내장산 입구 정체)";
  document.getElementById("desc").placeholder = shop ? "주소/설명 (선택)" : "내용 (선택)";
}
modeSel.onchange = syncMode;
if (!IS_LOCAL) {                            // 공개 사이트에서는 제보만
  modeSel.hidden = true;
  document.getElementById("hint").textContent = "지도를 길게 누르면(PC는 우클릭) 우리 동네 소식을 제보할 수 있어요";
}

async function saveShop() {
  const name = document.getElementById("title").value.trim();
  if (!name || !pending) return;
  try {
    await sendEdit({ action: "add", name, category: document.getElementById("shopcat").value,
                     address: document.getElementById("desc").value.trim(), coord: pending });
    document.getElementById("title").value = ""; document.getElementById("desc").value = "";
    closePanel();
  } catch (err) { alert(err.message); }
}

document.getElementById("save").onclick = async () => {
  if (modeSel.value === "shop") { saveShop(); return; }
  const title = document.getElementById("title").value.trim();
  if (!title || !pending) return;
  const last = Number(localStorage.getItem("jeongeup-last-report") || 0);
  if (Date.now() - last < 30000) { alert("제보는 30초에 한 번만 보낼 수 있어요."); return; }
  const btn = document.getElementById("save"); btn.disabled = true;
  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/reports", {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY,
                 "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ category: catSel.value, title: title.slice(0, 60),
        description: ((document.getElementById("desc").value.trim() + (pendingPlace ? "\n📍 " + pendingPlace.name : "")).trim()).slice(0, 300),
        lon: pending[0], lat: pending[1] }),
    });
    if (!res.ok) throw new Error("제보 전송 실패 (" + res.status + ")");
    try { localStorage.setItem("jeongeup-last-report", String(Date.now())); } catch {}
    document.getElementById("title").value = ""; document.getElementById("desc").value = "";
    closePanel();
    alert("제보가 접수됐어요! 확인 후 지도에 표시됩니다.");
  } catch (err) { alert(err.message); }
  btn.disabled = false;
};

// 승인된 제보를 서버에서 받아옴 (15초마다 갱신)
const knownIds = new Set(); let started = false;
async function fetchReports() {
  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/reports?select=id,category,title,description,lon,lat,created_at&order=created_at.desc&limit=200",
      { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } });
    if (!res.ok) return false;
    const rows = await res.json();
    const next = rows.filter(r => CATEGORIES[r.category] && (Date.now() - new Date(r.created_at)) < (EXPIRE_HOURS[r.category] || 72) * 3600e3).map(r => ({
      id: r.id, title: r.title, desc: r.description || "", cat: r.category,
      coord: [r.lon, r.lat], ts: r.created_at }));
    // 새로 승인된 제보 감지 (방송 모드: 그 위치로 카메라 이동). 첫 로딩은 제외
    const fresh = next.filter(r => !knownIds.has(r.id));
    const firstLoad = !started; started = true;
    next.forEach(r => knownIds.add(r.id));
    if (JSON.stringify(next) === JSON.stringify(reports)) return true;   // 변화 없으면 다시 그리지 않음(열린 팝업 유지)
    reports = next;
    render();
    if (LIVE && !firstLoad && fresh.length) showReport(fresh[0]);
    return true;
  } catch (e) { return false; }
}
fetchReports();
setInterval(fetchReports, 30000);   // 실시간 알림이 안 올 때를 위한 보조 갱신


// ---------- 지형 + 색감 ----------
// ---------- 건물 낮/밤 + 아파트 창문 줄무늬 ----------
const APT_PATTERN_ZOOM = 16;
const APT_WALL = ["#f2e3c6", "#cfe0f1", "#e9d2d2", "#d5e6d0", "#e0dbee"];
const BLD_DAY = ["interpolate", ["linear"], ["coalesce", ["get", "height"], 6],
  0, "#e8dcc8", 10, "#e3c9a8", 25, "#d9a98a", 45, "#c98a7a", 70, "#a96f86"];
const BLD_NIGHT = ["interpolate", ["linear"], ["coalesce", ["get", "height"], 6],
  0, "#8d92b8", 10, "#868cb8", 25, "#7f86b6", 45, "#787fb6", 70, "#7279b8"];
const APT_FAR_DAY = ["match", ["%", ["floor", ["/", ["to-number", ["coalesce", ["get", "id"], "0"], 0], 1000]], 5],
  0, APT_WALL[0], 1, APT_WALL[1], 2, APT_WALL[2], 3, APT_WALL[3], APT_WALL[4]];
const APT_FAR_NIGHT = "#8e96c0";
const BLD_NIGHT_DS = ["interpolate", ["linear"], ["coalesce", ["get", "height"], 6],
  0, "#2e334d", 10, "#2b3050", 25, "#282d52", 45, "#252a54", 70, "#222758"];
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function makeWindowImage(wall, band, alpha) {      // 8x8 타일: 층마다 가로 유리띠 한 줄 (세로 칸 없이 깔끔하게)
  const W = 8, Hh = 8, d = new Uint8Array(W * Hh * 4), wr = hex2rgb(wall), br = hex2rgb(band);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    let c = wr;
    if (y >= 2 && y < 6) c = wr.map((v, k) => Math.round(v * (1 - alpha) + br[k] * alpha));   // 유리띠
    else if (y === 7) c = wr.map(v => Math.round(v * 0.9));                                     // 층 구분선
    const o = (y * W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  return { width: W, height: Hh, data: d };
}
function makeNightImage(wall) {                    // 밤: 어두운 벽에 노란 불빛 점만 드문드문
  const W = 16, Hh = 16, d = new Uint8Array(W * Hh * 4), wr = hex2rgb(wall), spots = [[3, 5], [10, 11]];
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    let c = wr;
    for (const [sx, sy] of spots) if (x >= sx && x < sx + 3 && y >= sy && y < sy + 3) c = [255, 214, 130];
    const o = (y * W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  return { width: W, height: Hh, data: d };
}
function addAptImages() {
  const dark = (h, k) => "#" + hex2rgb(h).map(v => Math.round(v * k).toString(16).padStart(2, "0")).join("");
  APT_WALL.forEach((w, i) => {
    try {
      map.addImage(`apt${i}-day`, makeWindowImage(w, "#7f98b0", 0.45));
      map.addImage(`apt${i}-night`, makeNightImage(dark(w, 0.36)));
    } catch (e) {}
  });
  try { aptPatterns = APT_WALL.every((_, i) => map.hasImage(`apt${i}-day`) && map.hasImage(`apt${i}-night`)) && !/[?&]stripes=0/.test(location.search); } catch (e) {}
}
let nightOn = false, bldReady = false, aptPatterns = false;
// 밤 조명: 도로 빛, 가게 후광, 하늘 쪽 안개
function ensureNightLights() {
  try {
    if (!map.getLayer("night-road-glow")) {
      const firstExt = map.getStyle().layers.find(l => l.type === "fill-extrusion");
      const flt = ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "street", "residential", "service"]]];
      const w = k => ["interpolate", ["linear"], ["zoom"], 13, ["*", k, 2], 17, ["*", k, 11]];
      const kk = ["match", ["get", "class"], ["motorway", "trunk", "primary"], 1.2, ["secondary", "tertiary"], 0.8, 0.4];
      map.addLayer({ id: "night-road-glow", type: "line", source: vecSrc(), "source-layer": "transportation", minzoom: 13, filter: flt,
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffb85c", "line-width": w(kk), "line-blur": 3, "line-opacity": 0.3 } }, firstExt && firstExt.id);
      map.addLayer({ id: "night-road-core", type: "line", source: vecSrc(), "source-layer": "transportation", minzoom: 14, filter: flt,
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffd98a", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.5, 18, 2.4], "line-opacity": 0.85 } }, firstExt && firstExt.id);
    }
    if (map.getSource("shops") && !map.getLayer("shops-glow")) {
      map.addLayer({ id: "shops-glow", type: "circle", source: "shops", minzoom: 14,
        layout: { visibility: "none" },
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 4, 18, 13], "circle-color": "#ffcf7a", "circle-blur": 0.7, "circle-opacity": 0.9 } }, "shops-dot");
    }
  } catch (e) {}
}
function setBuildingNight(on) {
  nightOn = !!on;
  if (!bldReady) return;
  try {                                   // 땅·길·물·글씨까지 한꺼번에 어둡게 (건물만 어두워 보이던 문제)
    const cv = map.getCanvas(); cv.style.transition = "filter 1.5s ease";
    cv.style.filter = on && !DARKSTYLE ? "brightness(0.5) contrast(1.2) saturate(0.8) hue-rotate(8deg)" : "none";
  } catch (e) {}
  document.body.classList.toggle("night", !!on);
  if (on) ensureNightLights();
  for (const id of ["night-road-glow", "night-road-core", "shops-glow"]) { try { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); } catch (e) {} }
  try { map.setLight(on ? { anchor: "viewport", position: [1.4, 210, 45], intensity: 0.25, color: "#9fb0ff" } : { anchor: "viewport", position: [1.4, 210, 45], intensity: 0.55, color: "#fff4e0" }); } catch (e) {}
  for (const l of map.getStyle().layers) {
    try {
      if (/^local-.*-3d$/.test(l.id)) map.setPaintProperty(l.id, "fill-extrusion-color", on ? (DARKSTYLE ? BLD_NIGHT_DS : BLD_NIGHT) : BLD_DAY);
      else if (/^local-.*-apt$/.test(l.id)) map.setPaintProperty(l.id, "fill-extrusion-color", on ? APT_FAR_NIGHT : APT_FAR_DAY);
      else { const m = l.id.match(/^local-.*-apt(\d)$/); if (m) map.setPaintProperty(l.id, "fill-extrusion-pattern", `apt${m[1]}-${on ? "night" : "day"}`); }
    } catch (e) {}
  }
}

// 아파트 추정: 이름에 '아파트' 포함 또는 높이 24m(8층) 이상 → 건물마다 파스텔톤을 섞어 단지 느낌
const IS_APT = ["any", [">=", ["coalesce", ["get", "height"], 0], 24], [">", ["index-of", "아파트", ["coalesce", ["get", "name"], ""]], -1]];
const APT_PICK = ["%", ["floor", ["/", ["to-number", ["coalesce", ["get", "id"], "0"], 0], 1000]], 5];
const APT_COLOR = ["case", IS_APT,
  ["match", APT_PICK, 0, "#f2e3c6", 1, "#cfe0f1", 2, "#e9d2d2", 3, "#d5e6d0", "#e0dbee"],
  ["interpolate", ["linear"], ["coalesce", ["get", "height"], 6],
    0, "#e8dcc8", 10, "#e3c9a8", 25, "#d9a98a", 45, "#c98a7a", 70, "#a96f86"]];
const HEIGHT_COLOR_OLD = ["interpolate", ["linear"], ["coalesce", ["get", "height"], 6],
  0, "#e8dcc8", 10, "#e3c9a8", 25, "#d9a98a", 45, "#c98a7a", 70, "#a96f86"];

function setupTerrain() {
  try {
    // 무료 지형 고도 타일(키 불필요)
    map.addSource("dem", {
      type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 14,
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      attribution: "Terrain: Mapzen/AWS",
    });
    const firstSymbol = map.getStyle().layers.find(l => l.type === "symbol");
    map.addLayer({
      id: "hillshade", type: "hillshade", source: "dem",
      paint: {
        "hillshade-exaggeration": 0.6,
        "hillshade-shadow-color": "#3b4a3a",
        "hillshade-highlight-color": "#fffbe6",
        "hillshade-accent-color": "#5c6b52",
      },
    }, firstSymbol && firstSymbol.id);
    map.setTerrain({ source: "dem", exaggeration: 1.6 });
  } catch (e) { console.warn("지형 설정 실패", e); }
}

function setupColors() {
  const set = (id, prop, val) => { try { if (map.getLayer(id)) map.setPaintProperty(id, prop, val); } catch (e) {} };
  for (const l of map.getStyle().layers) {
    const id = l.id;
    if (l.type === "fill" && /water/.test(id)) set(id, "fill-color", "#7fb6d9");
    else if (l.type === "line" && /waterway/.test(id)) set(id, "line-color", "#6aa9d0");
    else if (l.type === "fill" && /(wood|forest)/.test(id)) set(id, "fill-color", "#8fb97a");
    else if (l.type === "fill" && /(grass|park|meadow|farm|agri)/.test(id)) set(id, "fill-color", "#c5e0a5");
  }
  set("background", "background-color", "#f4efe4");
  // 산길·오솔길·보행로 점선은 너무 많아서 가까이 확대했을 때만 표시
  for (const l of map.getStyle().layers) {
    if (l.type === "line" && /(path|track|trail|footway|pedestrian|cycleway|steps)/i.test(l.id) && !/tunnel/i.test(l.id)) {
      try { map.setLayerZoomRange(l.id, 17, 24); } catch (e) {}
    }
  }
  // 터널 도로: 네이버 지도처럼 연한 살구색 띠 + 회색 점선 테두리
  for (const l of map.getStyle().layers) {
    if (!/tunnel/i.test(l.id) || l.type !== "line") continue;
    try {
      map.setLayoutProperty(l.id, "visibility", "visible");
      if (/casing/i.test(l.id)) {
        map.setPaintProperty(l.id, "line-color", "#8a7f7a");
        map.setPaintProperty(l.id, "line-opacity", 0.9);
        map.setPaintProperty(l.id, "line-opacity", 0.5);
      } else {
        map.setPaintProperty(l.id, "line-color", "#ecd8cc");
        map.setPaintProperty(l.id, "line-opacity", 0.95);
      }
    } catch (e) {}
  }
  // 기본 지도(오픈스트리트) 건물도 같은 톤으로
  for (const l of map.getStyle().layers) {
    if (l.type === "fill-extrusion" && !l.id.startsWith("local-")) {
      set(l.id, "fill-extrusion-color", HEIGHT_COLOR_OLD.map((v, i) => i === 2 ? ["coalesce", ["get", "render_height"], 6] : v));
    }
  }
}


// ---------- 접속자 수 + 실시간 제보 알림 (Supabase Realtime) ----------
(function setupRealtime() {
  try {
    if (!window.supabase) return;
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const myId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
    const el = document.getElementById("viewers");
    const ch = sb.channel("viewers", { config: { presence: { key: myId } } });
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState();
      const n = Object.values(st).filter(m => !(m[0] && m[0].live)).length;   // 방송 화면 자신은 제외
      el.textContent = `👀 지금 ${n}명이 지도 보는 중`; el.hidden = false;
    }).on("postgres_changes", { event: "*", schema: "public", table: "reports" }, () => fetchReports())
      .subscribe(async status => { if (status === "SUBSCRIBED") await ch.track({ live: LIVE }); });
  } catch (e) { console.warn("실시간 연결 실패", e); }
})();

// ---------- 방송 모드: 자동 카메라 ----------
if (IS_LOCAL) document.getElementById("live-link").hidden = false;
let holdUntil = 0, tourI = 0;
function closePopups() { markers.forEach(m => { const p = m.getPopup(); if (p && p.isOpen()) m.togglePopup(); }); }
function tourStep() {
  if (Date.now() < holdUntil) return;
  closePopups();
  const s = TOUR[tourI++ % TOUR.length];
  const label = document.getElementById("tour-label");
  label.textContent = "📍 " + s.name; label.hidden = false;
  map.flyTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing, duration: 6000, essential: true });
  map.once("moveend", () => {     // 도착하면 천천히 돌면서 보여주기
    if (Date.now() < holdUntil) return;
    map.easeTo({ bearing: s.bearing + 35, duration: 9000, easing: t => t, essential: true });
  });
}
function showReport(r) {
  holdUntil = Date.now() + 15000;
  document.getElementById("tour-label").textContent = "🔔 새 제보";
  focusReport(r, 3000);
}
if (LIVE) {
  document.getElementById("live-url").hidden = false;
  map.on("load", () => { setTimeout(tourStep, 4000); setInterval(tourStep, 17000); });
}


// ---------- 날씨 효과 (비/눈/안개/밤/천둥번개) ----------
const WX_CODE = (c) => {
  if (c <= 1) return { kind: "clear", label: "맑음", i: 0 };
  if (c === 2) return { kind: "cloud", label: "구름 조금", i: 0.3 };
  if (c === 3) return { kind: "cloud", label: "흐림", i: 0.6 };
  if (c === 45 || c === 48) return { kind: "fog", label: "안개", i: 0.7 };
  if (c >= 51 && c <= 57) return { kind: "rain", label: "이슬비", i: 0.25 };
  if (c === 61) return { kind: "rain", label: "약한 비", i: 0.4 };
  if (c === 63 || c === 66) return { kind: "rain", label: "비", i: 0.6 };
  if (c === 65 || c === 67) return { kind: "rain", label: "강한 비", i: 0.9 };
  if (c === 71 || c === 77) return { kind: "snow", label: "약한 눈", i: 0.35 };
  if (c === 73) return { kind: "snow", label: "눈", i: 0.6 };
  if (c === 75) return { kind: "snow", label: "폭설", i: 0.9 };
  if (c === 80) return { kind: "rain", label: "소나기", i: 0.5 };
  if (c === 81) return { kind: "rain", label: "소나기", i: 0.7 };
  if (c === 82) return { kind: "rain", label: "폭우", i: 1 };
  if (c === 85) return { kind: "snow", label: "눈", i: 0.5 };
  if (c === 86) return { kind: "snow", label: "폭설", i: 0.9 };
  if (c >= 95) return { kind: "storm", label: "천둥번개", i: c === 95 ? 0.8 : 1 };
  return { kind: "cloud", label: "흐림", i: 0.4 };
};
const WX_ICON = { clear: "☀️", cloud: "☁️", rain: "🌧", snow: "❄️", fog: "🌫", storm: "⛈" };

let wx = { kind: "clear", label: "맑음", i: 0, night: false, temp: null };
const wxCanvas = document.getElementById("wx-canvas"), wxCtx = wxCanvas.getContext("2d");
const wxTint = document.getElementById("wx-tint");
let wxParticles = [], wxFlash = 0, wxNextFlash = 0;
function wxResize() { wxCanvas.width = innerWidth; wxCanvas.height = innerHeight; wxSeed(); }
addEventListener("resize", wxResize);

function wxSeed() {
  const scale = (innerWidth * innerHeight) / (1920 * 1080);
  let n = 0;
  if (wx.kind === "rain" || wx.kind === "storm") n = (200 + 900 * wx.i) * scale;
  if (wx.kind === "snow") n = (100 + 500 * wx.i) * scale;
  n = Math.max(0, Math.round(n));
  while (wxParticles.length < n) wxParticles.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, v: Math.random(), ph: Math.random() * 6.28 });
  wxParticles.length = n;
}

function wxTintColor() {
  if (wx.kind === "fog") return "rgba(235,238,242," + (0.08 + 0.12 * wx.i) + ")";
  if (wx.night) return "rgba(8,18,60," + (wx.kind === "clear" ? 0.22 : 0.3) + ")";
  if (wx.kind === "storm") return "rgba(30,36,50,0.28)";
  if (wx.kind === "rain") return "rgba(55,65,80," + (0.06 + 0.1 * wx.i) + ")";
  if (wx.kind === "cloud") return "rgba(90,98,110," + (0.02 + 0.07 * wx.i) + ")";
  if (wx.kind === "snow") return "rgba(235,242,255,0.06)";
  return "transparent";
}

function applyWeather(next) {
  if (nightForce !== null) next = { ...next, night: nightForce };
  wx = next;
  setBuildingNight(wx.night);
  wxTint.style.backgroundColor = wxTintColor();
  wxSeed();
  const b = document.getElementById("wx-badge");
  b.textContent = `${wx.night && wx.kind === "clear" ? "🌙" : WX_ICON[wx.kind]} 정읍 ${wx.temp != null ? Math.round(wx.temp) + "°C · " : ""}${wx.night && wx.kind === "clear" ? "맑은 밤" : wx.label}`;
  b.hidden = false;
}

function wxDraw(t) {
  wxCtx.clearRect(0, 0, wxCanvas.width, wxCanvas.height);
  const w = wxCanvas.width, h = wxCanvas.height;
  if (wx.kind === "rain" || wx.kind === "storm") {
    wxCtx.strokeStyle = wx.night ? "rgba(190,205,235,0.55)" : "rgba(120,140,170,0.6)";
    wxCtx.lineWidth = 1.2; wxCtx.beginPath();
    for (const p of wxParticles) {
      const len = 12 + 16 * p.v, sp = 14 + 14 * p.v;
      wxCtx.moveTo(p.x, p.y); wxCtx.lineTo(p.x - 3, p.y + len);
      p.y += sp; p.x -= 1.2;
      if (p.y > h) { p.y = -20; p.x = Math.random() * (w + 40); }
    }
    wxCtx.stroke();
  } else if (wx.kind === "snow") {
    wxCtx.fillStyle = "rgba(255,255,255,0.85)";
    for (const p of wxParticles) {
      const r = 1.5 + 2.5 * p.v;
      wxCtx.beginPath(); wxCtx.arc(p.x + Math.sin(t / 900 + p.ph) * 12, p.y, r, 0, 6.28); wxCtx.fill();
      p.y += 1.2 + 1.8 * p.v;
      if (p.y > h + 5) { p.y = -5; p.x = Math.random() * w; }
    }
  }
  if (wx.kind === "storm") {               // 번개 번쩍
    if (t > wxNextFlash) { wxFlash = 1; wxNextFlash = t + 4000 + Math.random() * 8000; }
    if (wxFlash > 0) { wxCtx.fillStyle = `rgba(255,255,255,${wxFlash * 0.55})`; wxCtx.fillRect(0, 0, w, h); wxFlash -= 0.08; }
  }
  requestAnimationFrame(wxDraw);
}
wxResize(); requestAnimationFrame(wxDraw);

// 실시간 날씨 (10분마다 자동 갱신)
let wxManual = false;
let nightForce = DARKSTYLE ? true : null;      // null=실시간(낮/밤 자동), true/false=사용자가 버튼으로 고정
(function nightBtn() {
  const b = document.getElementById("night-btn"); if (!b) return;
  const label = () => { b.textContent = wx.night ? "☀️ 낮" : "🌙 밤"; b.classList.toggle("on", nightForce !== null); };
  b.onclick = () => { nightForce = nightForce === null ? !wx.night : null; if (nightForce === null) fetchWeather(); applyWeather({ ...wx }); label(); };
  setInterval(label, 1000); label();
})();
async function fetchWeather() {
  if (wxManual) return;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_POINT.lat}&longitude=${WEATHER_POINT.lon}` +
      `&current=temperature_2m,weather_code,is_day&timezone=Asia%2FSeoul`;
    const r = await fetch(url); if (!r.ok) return;
    const cur = (await r.json()).current; if (!cur) return;
    applyWeather({ ...WX_CODE(cur.weather_code), night: cur.is_day === 0, temp: cur.temperature_2m });
  } catch (e) {}
}
fetchWeather(); setInterval(fetchWeather, 600000);

// 미리보기 (내 PC 또는 ?wx=rain 처럼 주소에 붙였을 때)
const WX_PRESET = {
  clear: { kind: "clear", label: "맑음", i: 0 }, cloud: { kind: "cloud", label: "흐림", i: 0.6 },
  rain: { kind: "rain", label: "비", i: 0.6 }, heavyrain: { kind: "rain", label: "폭우", i: 1 },
  snow: { kind: "snow", label: "눈", i: 0.6 }, fog: { kind: "fog", label: "안개", i: 0.7 },
  night: { kind: "clear", label: "맑음", i: 0, night: true }, storm: { kind: "storm", label: "천둥번개", i: 0.9, night: true },
};
(function wxPreview() {
  const sel = document.getElementById("wx-select");
  const q = new URLSearchParams(location.search).get("wx");
  if (IS_LOCAL || q) sel.hidden = false;
  const go = v => {
    if (v === "auto") { wxManual = false; fetchWeather(); return; }
    wxManual = true; applyWeather({ temp: null, night: false, ...WX_PRESET[v] });
  };
  sel.onchange = () => go(sel.value);
  if (q && WX_PRESET[q]) { sel.value = q; go(q); }
})();


// ---------- 신호등 (위치는 공공데이터, 색 변화는 방송 모드 연출) ----------
function sigBox(lon, lat, dm, props) {          // 가로세로 dm(미터) 크기 정사각형 기둥 폴리곤
  const dLat = dm / 111000, dLon = dLat / Math.cos(lat * Math.PI / 180);
  return { type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [[
    [lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]]] } };
}
async function loadSignals() {
  try {
    const res = await fetch("data/signals.json?" + Date.now());
    if (!res.ok) return;
    const pts = await res.json();
    if (!pts.length) return;
    const feats = [], lamps = [];
    pts.forEach((c, i) => {
      const [lon, lat] = c, ph = (i * 7) % 30;
      feats.push(sigBox(lon, lat, 0.18, { kind: "pole", b: 0, h: 4.6 }));              // 기둥
      feats.push(sigBox(lon, lat, 0.5, { kind: "box", b: 4.6, h: 6.3 }));              // 신호등 상자
      const lamp = sigBox(lon, lat, 0.56, { kind: "lamp", b: 5.2, h: 6.3, st: "idle", ph });  // 불빛
      feats.push(lamp); lamps.push(lamp);
    });
    const gj = { type: "FeatureCollection", features: feats };
    map.addSource("signals", { type: "geojson", data: gj });
    map.addLayer({
      id: "signals-3d", type: "fill-extrusion", source: "signals", minzoom: 16.3,
      paint: {
        "fill-extrusion-base": ["get", "b"], "fill-extrusion-height": ["get", "h"],
        "fill-extrusion-color": ["case",
          ["==", ["get", "kind"], "pole"], "#707680",
          ["==", ["get", "kind"], "box"], "#1c1e22",
          ["==", ["get", "st"], "g"], "#2ecc71", ["==", ["get", "st"], "y"], "#f1c40f",
          ["==", ["get", "st"], "r"], "#ff3b30", "#2a2d33"],
        "fill-extrusion-opacity": 1,
      },
    });
    if (LIVE) {                                     // 연출: 30초 주기 (초록14 / 노랑2 / 빨강14)
      const tick = () => {
        const t = Math.floor(Date.now() / 1000);
        for (const f of lamps) {
          const k = (t + f.properties.ph) % 30;
          f.properties.st = k < 14 ? "g" : k < 16 ? "y" : "r";
        }
        map.getSource("signals").setData(gj);
      };
      tick(); setInterval(tick, 2000);
      document.getElementById("sim-note").hidden = false;
    }
  } catch (e) { /* 파일 없음: 무시 */ }
}


// 방송 모드 끄기: Esc 키, 마우스가 움직이면 잠깐 버튼 표시
if (LIVE) {
  addEventListener("keydown", e => { if (e.key === "Escape") location.href = location.pathname; });
  const ex = document.getElementById("live-exit"); let hideT;
  addEventListener("mousemove", () => { ex.classList.add("show"); clearTimeout(hideT); hideT = setTimeout(() => ex.classList.remove("show"), 2500); });
}


// ---------- 검색 (가게·아파트·장소·주소) ----------
const NAMED = [];
let PLACES_IDX = [];
fetch("data/places.json").then(r => r.ok ? r.json() : []).then(l => { PLACES_IDX = l; ROAD_IDX = null; }).catch(() => {});
const qEl = document.getElementById("q"), resEl = document.getElementById("results");
let searchPin = null;
const norm = t => String(t || "").toLowerCase().replace(/\s+/g, "");

function searchIndex() {
  const out = [];
  for (const s of (typeof SHOPS !== "undefined" ? SHOPS : []).concat(EDITS.added || [])) {
    const e = (EDITS.edits || {})[s.id] || {};
    if (e.hidden) continue;
    out.push({ name: e.name || s.name, sub: (s.category || "").split(">").pop().trim() + (s.address ? " · " + s.address.replace("전북특별자치도 ", "") : ""),
               addr: s.address || "", coord: s.coord, kind: "상가" });
  }
  for (const p of PLACES_IDX) out.push({ name: p.name, sub: p.address ? p.address.replace("전북특별자치도 ", "") : "", addr: p.address || "", coord: p.coord, kind: "장소" });
  for (const n of NAMED) out.push({ name: n.name, sub: "건물", addr: "", coord: n.coord, kind: "건물" });
  for (const l of LANDMARKS) out.push({ name: l.name, sub: "명소", addr: "", coord: l.coord, kind: "명소" });
  return out;
}
// ---------- 도로명 주소 검색 (상가 주소의 번호로 위치를 추정) ----------
const ROAD_RE = /([가-힣0-9]+(?:대로|로|길))\s*(\d+)(?:\s*[-의]\s*(\d+))?\s*(?:번지|번길)?/;
let ROAD_IDX = null, ROAD_N = -1;
function buildRoadIdx() {
  ROAD_IDX = {};
  const add = (addr, coord) => {
    const m = String(addr || "").match(ROAD_RE); if (!m || !coord) return;
    (ROAD_IDX[m[1]] = ROAD_IDX[m[1]] || []).push({ n: +m[2], coord });
  };
  for (const s of (typeof SHOPS !== "undefined" ? SHOPS : []).concat(EDITS.added || [])) add(s.address, s.coord);
  for (const p of PLACES_IDX) add(p.address, p.coord);
  for (const k in ROAD_IDX) ROAD_IDX[k].sort((x, y) => x.n - y.n);
}
function roadSearch(raw) {
  const m = String(raw).replace(/전북특별자치도|전라북도|정읍시/g, "").match(ROAD_RE);
  if (!m) return null;
  if (!ROAD_IDX || ROAD_N !== SHOPS.length + PLACES_IDX.length) { buildRoadIdx(); ROAD_N = SHOPS.length + PLACES_IDX.length; }
  const list = ROAD_IDX[m[1]]; if (!list || !list.length) return null;
  const n = +m[2], par = n % 2;
  const same = list.filter(x => x.n % 2 === par), pool = same.length ? same : list;
  const exact = pool.find(x => x.n === n);
  let coord, approx = true;
  if (exact) { coord = exact.coord; approx = false; }
  else {
    let lo = null, hi = null;
    for (const x of pool) { if (x.n < n) lo = x; else if (x.n > n && !hi) hi = x; }
    if (lo && hi && hi.n - lo.n <= 80) { const t = (n - lo.n) / (hi.n - lo.n); coord = [lo.coord[0] + (hi.coord[0] - lo.coord[0]) * t, lo.coord[1] + (hi.coord[1] - lo.coord[1]) * t]; }
    else { const nr = pool.reduce((b, x) => Math.abs(x.n - n) < Math.abs(b.n - n) ? x : b); if (Math.abs(nr.n - n) > 30) return null; coord = nr.coord; }
  }
  // 근처 이름 있는 건물(아파트 등) 안내
  let near = null, bd = 150;
  for (const b of NAMED) { const d = Math.hypot((b.coord[0] - coord[0]) * 91000, (b.coord[1] - coord[1]) * 111000); if (d < bd) { bd = d; near = b.name; } }
  return { name: `${m[1]} ${m[2]}${m[3] ? "-" + m[3] : ""}`, sub: (approx ? "대략적인 위치" : "주소") + (near ? " · 근처: " + near : ""), addr: "", coord, kind: "주소" };
}
// ---------- 지번 주소 검색 (건물 id의 본번·부번으로 만든 data/jibun.json) ----------
let JIBUN = null, JIBUN_NAMES = null;
fetch("data/jibun.json").then(r => r.ok ? r.json() : null).then(j => { JIBUN = j; }).catch(() => {});
function jibunSearch(raw) {
  if (!JIBUN) return null;
  const s = String(raw).replace(/전북특별자치도|전라북도|정읍시/g, "");
  if (!JIBUN_NAMES) JIBUN_NAMES = Object.keys(JIBUN).sort((x, y) => y.length - x.length);
  const dong = JIBUN_NAMES.find(n => s.includes(n)); if (!dong) return null;
  const rest = s.slice(s.indexOf(dong) + dong.length);
  const m = rest.match(/^\s*(산)?\s*(\d+)(?:\s*(?:[-의]|번지)\s*(\d+))?/);
  if (!m) return null;
  const tbl = JIBUN[dong];
  const main = (m[1] || "") + (+m[2]), sub = m[3] ? +m[3] : 0;
  let coord = tbl[main + "-" + sub], approx = false;
  if (!coord) {                                    // 부번이 없거나 다르면 같은 본번의 다른 필지로 대신 안내
    const alt = Object.keys(tbl).find(k => k.startsWith(main + "-"));
    if (!alt) return null; coord = tbl[alt]; approx = true;
  }
  let near = null, bd = 120;
  for (const b of NAMED) { const d = Math.hypot((b.coord[0] - coord[0]) * 91000, (b.coord[1] - coord[1]) * 111000); if (d < bd) { bd = d; near = b.name; } }
  return { name: `${dong} ${main}${sub ? "-" + sub : ""}`, sub: (approx ? "같은 번지의 다른 필지 위치" : "지번 주소") + (near ? " · 근처: " + near : ""), addr: "", coord, kind: "주소" };
}
function doSearch() {
  const q = norm(qEl.value);
  if (q.length < 1) { resEl.hidden = true; return; }
  const scored = [];
  for (const it of searchIndex()) {
    const n = norm(it.name), a = norm(it.addr);
    let sc = 0;
    if (n === q) sc = 100; else if (n.startsWith(q)) sc = 80; else if (n.includes(q)) sc = 60; else if (a.includes(q)) sc = 40;
    if (sc) scored.push([sc, it]);
  }
  scored.sort((x, y) => y[0] - x[0]);
  const top = scored.slice(0, 8).map(x => x[1]);
  const rs = roadSearch(qEl.value) || jibunSearch(qEl.value); if (rs) top.unshift(rs);
  resEl.innerHTML = top.length ? "" : '<div class="res-empty">검색 결과가 없어요</div>';
  for (const it of top) {
    const row = document.createElement("div"); row.className = "res-row";
    row.innerHTML = `<b>${esc(it.name)}</b><small>${esc(it.sub)}</small>`;
    row.onclick = () => goTo(it);
    resEl.appendChild(row);
  }
  resEl.hidden = false;
}
function goTo(it) {
  resEl.hidden = true; qEl.blur();
  map.flyTo({ center: it.coord, zoom: 18, pitch: 60, duration: 1500, essential: true });
  if (searchPin) searchPin.remove();
  const pop = new maplibregl.Popup({ offset: 24, closeOnClick: true })
    .setHTML(`<strong>${esc(it.name)}</strong><br><small>${esc(it.sub)}</small>` + navLinks(it.name, it.coord[0], it.coord[1]));
  searchPin = new maplibregl.Marker({ color: "#e5484d" }).setLngLat(it.coord).setPopup(pop).addTo(map);
  setTimeout(() => searchPin && !searchPin.getPopup().isOpen() && searchPin.togglePopup(), 1500);
}
qEl.addEventListener("input", doSearch);
qEl.addEventListener("focus", doSearch);
qEl.addEventListener("keydown", e => { if (e.key === "Enter") { const r = resEl.querySelector(".res-row"); if (r) r.click(); } });
document.addEventListener("click", e => { if (!e.target.closest("#searchbox")) resEl.hidden = true; });

// ===== PWA: 서비스워커 + "📲 앱 설치" 버튼 (각자 선택) =====
(function () {
  if (IS_LOCAL) return;
  if ("serviceWorker" in navigator) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (had && !window.__reloaded) { window.__reloaded = true; location.reload(); } });   // 새 버전이 깔리면 한 번 자동 새로고침
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  const btn = document.getElementById("install-btn"); if (!btn || LIVE) return;
  const ua = navigator.userAgent;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return;
  const inapp = /KAKAOTALK|Instagram|FBAN|FBAV|Threads|NAVER\(inapp|DaumApps|Line\//i.test(ua);
  const ios = /iPhone|iPad|iPod/.test(ua), android = /Android/.test(ua);
  const url = location.origin + location.pathname;
  btn.hidden = false;
  let ev = null;
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); ev = e; });
  addEventListener("appinstalled", () => { btn.hidden = true; });
  const modal = document.getElementById("install-modal"), box = document.getElementById("install-box");
  const close = () => { modal.hidden = true; };
  const copy = async b => { try { await navigator.clipboard.writeText(url); b.textContent = "✓ 복사됨"; } catch (e) { b.textContent = "복사 실패 - 주소창에서 복사해 주세요"; } };
  function show(html, actions) {
    box.innerHTML = html + '<div class="im-row"></div>';
    const row = box.querySelector(".im-row");
    for (const [label, fn] of actions.concat([["닫기", close]])) {
      const b = document.createElement("button"); b.textContent = label;
      b.onclick = () => fn === close ? close() : fn(b); row.appendChild(b);
    }
    modal.hidden = false;
  }
  modal.onclick = e => { if (e.target === modal) close(); };
  btn.onclick = async () => {
    if (ev) { ev.prompt(); try { await ev.userChoice; } catch (e) {} ev = null; return; }            // 안드로이드 크롬: 바로 설치창
    if (inapp) {
      const acts = [];
      if (android) acts.push(["크롬으로 열기", () => { location.href = "intent://" + url.replace(/^https?:\/\//, "") + "#Intent;scheme=https;package=com.android.chrome;end"; }]);
      acts.push(["주소 복사", copy]);
      show(`<b>📲 앱으로 설치하기</b><p>지금 열린 화면(인스타·스레드·카카오톡 등)에서는 설치가 안 돼요.</p>` +
        (ios ? `<p>① 화면의 <b>⋯</b> 또는 <b>공유</b> 메뉴 → <b>Safari로 열기</b><br>② Safari에서 공유 버튼(□↑) → <b>홈 화면에 추가</b></p>` :
               `<p>아래 <b>크롬으로 열기</b>를 누른 뒤, 크롬에서 다시 <b>📲 앱 설치</b>를 눌러 주세요.</p>`), acts);
    } else if (ios) {
      show(`<b>📲 홈 화면에 추가</b><p>① 아래쪽 <b>공유 버튼(□↑)</b>을 누르세요<br>② <b>홈 화면에 추가</b>를 고르세요<br>③ 오른쪽 위 <b>추가</b>를 누르면 끝!</p><p style="color:#666;font-size:12px">설치하지 않아도 지도는 똑같이 쓸 수 있어요.</p>`, []);
    } else {
      show(`<b>📲 홈 화면에 추가</b><p>브라우저 메뉴(⋮)에서 <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러 주세요.</p><p style="color:#666;font-size:12px">설치하지 않아도 지도는 똑같이 쓸 수 있어요.</p>`, [["주소 복사", copy]]);
    }
  };
})();


// ===== 새로고침 버튼 + 앱으로 돌아올 때 자동 갱신 =====
async function manualRefresh(btn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = "⏳";
  const ok = await fetchReports();
  btn.textContent = ok ? "✓ 방금" : "⚠ 실패";
  setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1500);
}
for (const id of ["refresh-btn", "comm-refresh"]) { const b = document.getElementById(id); if (b) b.onclick = () => manualRefresh(b); }
let lastAutoRefresh = 0;
function autoRefresh() { if (Date.now() - lastAutoRefresh < 3000) return; lastAutoRefresh = Date.now(); fetchReports(); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) autoRefresh(); });
addEventListener("focus", autoRefresh);
addEventListener("online", autoRefresh);
addEventListener("pageshow", autoRefresh);

// ===== 커뮤니티 화면 (제보 피드 + 오늘의 주제) =====
const commEl = document.getElementById("comm"), commBody = document.getElementById("comm-body");
function renderComm() {
  if (!commBody) return;
  const topic = (typeof COMM_TOPIC !== "undefined" && COMM_TOPIC) || "";
  let html = topic ? `<div class="comm-topic"><b>📌 이번 주 주제</b><br>${esc(topic)}<br><small>지도를 길게 눌러 제보로 참여해 보세요</small></div>` : "";
  html += `<div class="comm-note">💬 이야기 글쓰기는 곧 열려요. 지금은 지도 제보로 참여할 수 있어요.</div>`;
  html += `<div class="comm-head">실시간 제보 ${reports.length}건</div>`;
  if (!reports.length) html += `<div class="feed-empty">아직 제보가 없어요. 첫 제보를 남겨 보세요!</div>`;
  commBody.innerHTML = html;
  for (const r of reports) {
    const c = CATEGORIES[r.cat];
    const card = document.createElement("div"); card.className = "comm-card";
    card.innerHTML = `<div class="comm-meta"><span class="feed-dot" style="background:${c.color}"></span>${c.label} · ${timeAgo(r.ts)}</div>` +
      `<div class="comm-title">${esc(r.title)}</div>` + (r.desc ? `<div class="comm-desc">${esc(r.desc)}</div>` : "") +
      `<button class="chip comm-go">📍 지도에서 보기</button>`;
    card.querySelector(".comm-go").onclick = () => {
      closeComm();
      focusReport(r);
    };
    commBody.appendChild(card);
  }
}
function openComm() { renderComm(); commEl.hidden = false; requestAnimationFrame(() => commEl.classList.add("open")); document.body.style.overflow = "hidden"; fetchReports(); }
function closeComm() { commEl.classList.remove("open"); setTimeout(() => { commEl.hidden = true; }, 220); document.body.style.overflow = ""; }
if (commEl) {
  document.getElementById("comm-btn").onclick = openComm;
  document.getElementById("comm-back").onclick = closeComm;
  addEventListener("keydown", e => { if (e.key === "Escape" && !commEl.hidden) closeComm(); });
  let sy = 0;                                         // 아래로 당겨서 새로고침
  commEl.addEventListener("touchstart", e => { sy = e.touches[0].clientY; }, { passive: true });
  commEl.addEventListener("touchend", e => { if (commBody.scrollTop <= 0 && e.changedTouches[0].clientY - sy > 90) manualRefresh(document.getElementById("comm-refresh")); }, { passive: true });
}


// ===== 마커 클릭 연출 (1~2초): 사건사고=경광등, 행사=폭죽, 교통=경고 파동, 웨이팅=맴도는 점, 생활정보=잔잔한 파동 =====
const fxCv = document.createElement("canvas");
fxCv.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:7;pointer-events:none";
document.body.appendChild(fxCv);
let fxRun = 0;
function playFx(cat, el) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  fxCv.width = W * dpr; fxCv.height = H * dpr;
  const g = fxCv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const id = ++fxRun, t0 = performance.now();
  const DUR = { incident: 1800, event: 1900, traffic: 1500, wait: 1500, info: 1200 }[cat] || 1200;
  const parts = [];
  if (cat === "event") {                                  // 폭죽: 3발, 시간차로 터짐
    const cols = ["#ff4d6d", "#ffd23f", "#4dd2ff", "#8aff80", "#c77dff", "#ffffff"];
    for (let s = 0; s < 3; s++) {
      const bx = x + (s - 1) * 46, by = y - 70 - (s % 2) * 30, delay = s * 280, col = cols[(s * 2) % 6];
      for (let i = 0; i < 26; i++) {
        const ang = Math.PI * 2 * i / 26 + Math.random() * 0.2, sp = 55 + Math.random() * 55;
        parts.push({ bx, by, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, delay, col: Math.random() < 0.3 ? cols[Math.floor(Math.random() * 6)] : col });
      }
    }
  }
  function frame(now) {
    if (id !== fxRun) return;
    const t = now - t0; g.clearRect(0, 0, W, H);
    if (t > DUR) return;
    const k = t / DUR;
    g.save();
    if (cat === "incident") {                             // 빨강/파랑이 번갈아 퍼지는 경광등 파동
      for (let n = 0; n < 3; n++) {
        const p = ((t - n * 420) / 900); if (p < 0 || p > 1) continue;
        g.strokeStyle = n % 2 ? "rgba(40,110,255," + (0.85 * (1 - p)) + ")" : "rgba(255,50,60," + (0.85 * (1 - p)) + ")";
        g.lineWidth = 5 * (1 - p) + 1; g.beginPath(); g.arc(x, y, 14 + p * 80, 0, 7); g.stroke();
      }
      const flash = Math.floor(t / 150) % 2;
      const gr = g.createRadialGradient(x, y, 4, x, y, 60);
      gr.addColorStop(0, (flash ? "rgba(255,50,60," : "rgba(40,110,255,") + (0.5 * (1 - k)) + ")"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, 60, 0, 7); g.fill();
    } else if (cat === "event") {
      for (const p of parts) {
        const tt = (t - p.delay) / 1000; if (tt < 0 || tt > 1.3) continue;
        const px = p.bx + p.vx * tt, py = p.by + p.vy * tt + 60 * tt * tt, al = Math.max(0, 1 - tt / 1.3);
        g.globalAlpha = al; g.fillStyle = p.col; g.beginPath(); g.arc(px, py, 2.4 * al + 0.6, 0, 7); g.fill();
      }
    } else if (cat === "traffic") {                       // 주황 경고 파동 + 삼각형
      for (let n = 0; n < 2; n++) {
        const p = ((t - n * 450) / 800); if (p < 0 || p > 1) continue;
        g.strokeStyle = "rgba(255,150,20," + (0.8 * (1 - p)) + ")"; g.lineWidth = 4 * (1 - p) + 1;
        g.beginPath(); g.arc(x, y, 12 + p * 60, 0, 7); g.stroke();
      }
      const s = Math.min(1, k * 5), al = 1 - Math.max(0, (k - 0.6) / 0.4), ty = y - 34 - 10 * Math.sin(Math.min(1, k * 3) * Math.PI);
      g.globalAlpha = al; g.fillStyle = "#ffb703"; g.strokeStyle = "#7a4b00"; g.lineWidth = 2; g.beginPath();
      g.moveTo(x, ty - 12 * s); g.lineTo(x + 12 * s, ty + 9 * s); g.lineTo(x - 12 * s, ty + 9 * s); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = "#3b2600"; g.font = "bold " + 13 * s + "px sans-serif"; g.textAlign = "center"; g.fillText("!", x, ty + 7 * s);
    } else if (cat === "wait") {                          // 핀 둘레를 도는 점 세 개
      const al = 1 - Math.max(0, (k - 0.6) / 0.4);
      for (let i = 0; i < 3; i++) {
        const ang = k * Math.PI * 4 + i * 2.09, rr = 22 + 6 * Math.sin(k * 9 + i);
        g.globalAlpha = al; g.fillStyle = "#f76b15"; g.beginPath(); g.arc(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, 4, 0, 7); g.fill();
      }
    } else {                                              // 잔잔한 파란 파동
      g.strokeStyle = "rgba(31,111,235," + (0.7 * (1 - k)) + ")"; g.lineWidth = 3 * (1 - k) + 1;
      g.beginPath(); g.arc(x, y, 10 + k * 46, 0, 7); g.stroke();
    }
    g.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
