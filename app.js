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
  const when = item.ts ? `<br><small>${new Date(item.ts).toLocaleString("ko-KR")}</small>` : "";
  const popup = new maplibregl.Popup({ offset: 20 }).setHTML(
    `<strong>${esc(item.name || item.title)}</strong> <small>(${c.label})</small><br>${esc(item.desc || "")}${when}`
  );
  const m = new maplibregl.Marker({ element: el }).setLngLat(item.coord).setPopup(popup).addTo(map);
  m._item = item; markers.push(m);
}
function esc(s) { return String(s).replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch])); }

function render() {
  markers.forEach(m => m.remove()); markers = [];
  LANDMARKS.filter(l => activeCats.has(l.cat)).forEach(l => addMarker(l, true));
  reports.filter(r => activeCats.has(r.cat)).forEach(r => addMarker(r, false));
  renderFeed();
}

// ---------- 제보 목록 (상단) ----------
function timeAgo(ts) {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return m + "분 전";
  if (m < 1440) return Math.floor(m / 60) + "시간 전";
  return Math.floor(m / 1440) + "일 전";
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
      map.flyTo({ center: r.coord, zoom: 17, pitch: 60, duration: 1500 });
      const mk = markers.find(x => x._item && x._item.id === r.id);
      if (mk && !mk.getPopup().isOpen()) setTimeout(() => mk.togglePopup(), 1500);
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
      id: "buildings-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building",
      minzoom: 14,
      paint: {
        "fill-extrusion-color": "#c9ccd1",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.9,
      },
    });
  }
  setupTerrain();
  setupColors();
  setupBasePoi();
  loadBoundary();
  loadLocalBuildings().then(loadShops);   // 건물 레이어 뒤에 올려야 가려지지 않음
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
      map.addLayer({
        id: `${src}-3d`, type: "fill-extrusion", source: src, minzoom: 14,
        paint: {
          "fill-extrusion-color": HEIGHT_COLOR,
          // 층수 정보가 없는 건물(height 0)은 기본 6m로 표시
          "fill-extrusion-height": ["case", [">", ["get", "height"], 0], ["get", "height"], 6],
          "fill-extrusion-opacity": 0.92,
        },
      });
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
      properties: { id: s.id, name: e.name || s.name, category: s.category, address: s.address,
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
        `<small>${esc(p.address)}</small>` + (IS_LOCAL ? `<div class="edit-row">` +
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
function setPos(lngLat) {
  pending = [lngLat.lng, lngLat.lat];
  document.getElementById("pos").textContent = (pickMode ? "📍 표시된 위치 · 지도를 움직여 맞추세요" : "위치") +
    `: ${pending[1].toFixed(5)}, ${pending[0].toFixed(5)}`;
}
function openPanel(lngLat, pick) {
  pickMode = !!pick; crosshair.hidden = !pickMode;
  setPos(lngLat);
  panel.hidden = false;
}
function closePanel() { panel.hidden = true; pickMode = false; crosshair.hidden = true; }
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
        description: document.getElementById("desc").value.trim().slice(0, 300),
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
    if (!res.ok) return;
    const rows = await res.json();
    const next = rows.filter(r => CATEGORIES[r.category]).map(r => ({
      id: r.id, title: r.title, desc: r.description || "", cat: r.category,
      coord: [r.lon, r.lat], ts: r.created_at }));
    // 새로 승인된 제보 감지 (방송 모드: 그 위치로 카메라 이동). 첫 로딩은 제외
    const fresh = next.filter(r => !knownIds.has(r.id));
    const firstLoad = !started; started = true;
    next.forEach(r => knownIds.add(r.id));
    if (JSON.stringify(next) === JSON.stringify(reports)) return;   // 변화 없으면 다시 그리지 않음(열린 팝업 유지)
    reports = next;
    render();
    if (LIVE && !firstLoad && fresh.length) showReport(fresh[0]);
  } catch (e) {}
}
fetchReports();
setInterval(fetchReports, 30000);   // 실시간 알림이 안 올 때를 위한 보조 갱신


// ---------- 지형 + 색감 ----------
const HEIGHT_COLOR = ["interpolate", ["linear"], ["coalesce", ["get", "height"], 6],
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
      set(l.id, "fill-extrusion-color", HEIGHT_COLOR.map((v, i) => i === 2 ? ["coalesce", ["get", "render_height"], 6] : v));
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
  map.flyTo({ center: r.coord, zoom: 17, pitch: 60, duration: 3000, essential: true });
  setTimeout(() => {
    const mk = markers.find(x => x._item && x._item.id === r.id);
    if (mk && !mk.getPopup().isOpen()) mk.togglePopup();
  }, 3200);
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
  if (wx.kind === "fog") return "rgba(235,238,242," + (0.3 + 0.3 * wx.i) + ")";
  if (wx.night) return "rgba(8,18,60," + (wx.kind === "clear" ? 0.38 : 0.5) + ")";
  if (wx.kind === "storm") return "rgba(30,36,50,0.45)";
  if (wx.kind === "rain") return "rgba(55,65,80," + (0.15 + 0.2 * wx.i) + ")";
  if (wx.kind === "cloud") return "rgba(90,98,110," + (0.06 + 0.16 * wx.i) + ")";
  if (wx.kind === "snow") return "rgba(235,242,255,0.14)";
  return "transparent";
}

function applyWeather(next) {
  wx = next;
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
