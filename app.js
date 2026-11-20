// 큰 데이터(건물·가게·신호)는 지도 준비를 기다리지 않고 바로 내려받기 시작한다. (화면에 올리는 순서는 그대로)
const PRE = {};
try { const pf = u => fetch(u).catch(() => null); for (const z of ["naejangsan", "downtown", "residential"]) PRE[z] = pf(`data/${z}.geojson`); PRE.shops = pf("data/shops.json"); PRE.signals = pf("data/signals.json?" + Date.now()); } catch (e) {}
const usePre = (k, url) => { const p = PRE[k]; PRE[k] = null; return p ? p.then(r => r || fetch(url)) : fetch(url); };   // 한 번만 사용
const T0 = performance.now(), TM = {}; const mark = k => { if (!(k in TM)) TM[k] = Math.round(performance.now() - T0); };
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty", // 무료, API 키 불필요
  center: JEONGEUP_CENTER,
  zoom: 15.2,
  pitch: 60,
  bearing: -20,
  maxPitch: 80,
  attributionControl: { compact: true },   // 출처 표시는 유지하되 ⓘ 아이콘으로 줄임
  minZoom: 9.5,
  maxBounds: [[126.55, 35.25], [127.25, 35.85]],   // 정읍시 일대(대략). 경계 파일이 있으면 자동 보정
});
map.once("load", () => { const a = document.querySelector(".maplibregl-ctrl-attrib"); if (a) { a.classList.remove("maplibregl-compact-show"); a.removeAttribute("open"); } });   // 출처 표시를 처음부터 ⓘ로 접어 둠
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

// ---------- 지도 알림 버튼 (GPS 아래): 켜짐 🔔(단풍 레드) / 꺼짐 🔕 ----------
class BellControl {
  onAdd() {
    const d = this.el = document.createElement("div"); d.className = "maplibregl-ctrl maplibregl-ctrl-group bell-ctrl";
    const b = document.createElement("button"); b.type = "button"; b.id = "bell-btn"; b.title = "알림 받기"; b.setAttribute("aria-label", "알림 받기");
    b.textContent = "🔕"; b.onclick = bellClick; d.appendChild(b);
    // (LIVE·IS_LOCAL 상수는 아래에서 선언되므로 여기서는 직접 계산)
    if (new URLSearchParams(location.search).get("live") === "1" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) || !VAPID_PUBLIC_KEY) d.hidden = true;
    setTimeout(refreshBell, 0); return d;
  }
  onRemove() { this.el.remove(); }
}
map.addControl(new BellControl(), "top-right");
async function refreshBell() {
  const b = document.getElementById("bell-btn"); if (!b) return;
  let on = false;
  try { if (pushReady()) { const sub = await pushGetSub(false); on = !!sub && Notification.permission === "granted"; } } catch (e) {}
  b.classList.toggle("on", on); b.textContent = on ? "🔔" : "🔕"; b.title = on ? "알림 켜짐 (누르면 끄기)" : "알림 받기";
}
async function bellClick() {
  if (!pushReady()) { alert("이 화면(인스타·카톡 등)에서는 알림을 켤 수 없어요.\n크롬·사파리 같은 브라우저로 열어 주세요.\n(아이폰은 '홈 화면에 추가'한 앱에서만 알림이 와요)"); return; }
  const b = document.getElementById("bell-btn");
  try {
    const sub = await pushGetSub(false);
    if (sub && Notification.permission === "granted") { if (confirm("알림을 끌까요?")) await sub.unsubscribe(); }
    else {
      const s = await pushGetSub(true);
      const r = await fetch(SUPABASE_URL + "/rest/v1/push_subscriptions", { method: "POST", headers: { ...rxHdr, Prefer: "return=minimal" }, body: JSON.stringify(pushRow(s, "guest")) });
      if (!r.ok && r.status !== 409) throw new Error("알림 등록에 실패했어요. 잠시 뒤 다시 해 주세요.");
    }
  } catch (e) { alert(e.message || "알림을 켜지 못했어요."); }
  refreshBell(); setupPushCard();
}

// ---------- 데이터 ----------
const STORE_KEY = "jeongeup-reports-v1";
const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } };
const store = (list) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch {} };

const LIVE = new URLSearchParams(location.search).get("live") === "1";   // 방송 모드
if (LIVE) document.body.classList.add("live");
const IS_LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) && new URLSearchParams(location.search).get("public") !== "1";   // 내 PC에서만 가게 수정 가능 (?public=1 이면 일반 손님 화면)
let reports = [];                // 시민 제보: 서버(Supabase)에서 승인된 것만 받아옴
let activeCats = new Set(Object.keys(CATEGORIES));
let markers = [];

// ---------- 필터 UI ----------
const filtersEl = document.getElementById("filters");
const catSel = document.getElementById("cat");
for (const [key, c] of Object.entries(CATEGORIES)) {
  const b = document.createElement("button");
  b.className = "chip cat-chip on"; b.textContent = c.icon + " " + c.label; b.style.flex = "none";
  b.style.setProperty("--c", c.color); b.style.setProperty("--cf", c.fg || "#fff");
  b.onclick = () => {
    activeCats.has(key) ? activeCats.delete(key) : activeCats.add(key);
    b.classList.toggle("on"); sfx(b.classList.contains("on") ? "on" : "off");
    render();
  };
  filtersEl.appendChild(b);
  catSel.add(new Option(c.icon + " " + c.label, key));
}
let showOffices = true;
// (관공서 필터 칩은 v84에서 제거. 관공서 배지는 항상 표시)
if (!IS_LOCAL) { catSel.add(new Option("🛠 가게 정보 수정", "__fix")); catSel.add(new Option("➕ 없는 가게 알려주기", "__newshop")); }

// ---------- 마커 ----------
function addMarker(item, isLandmark) {
  const c = CATEGORIES[item.cat];
  const el = document.createElement("div");
  el.className = "pin";
  el.style.background = c.color;
  if (isLandmark) el.style.outline = "2px solid #fff";
  const when = item.ts ? `<br><small>${timeAgo(item.ts)} · ${new Date(item.ts).toLocaleString("ko-KR")}</small>` : "";
  const popup = new maplibregl.Popup({ offset: 20 }).setHTML(
    `<strong>${esc(item.name || item.title)}</strong> <small>(${c.icon} ${c.label})</small><br>${esc(item.desc || "")}${when}` + (item.photo ? `<a href="${esc(item.photo)}" target="_blank" rel="noopener"><img class="pop-photo" src="${esc(item.photo)}" loading="lazy"></a>` : "") + navLinks(item.name || item.title, item.coord[0], item.coord[1]) + (item.id && item.ts ? `<div class="shop-act">${rxHtml("report", item.id)}</div>` : "")
  );
  popup.on("open", () => hydrateRx(popup.getElement()));
  el.addEventListener("click", () => playFx(item.cat, el));      // 클릭 연출 (1~2초)
  const m = new maplibregl.Marker({ element: el }).setLngLat(item.coord).setPopup(popup).addTo(map);
  m._item = item; markers.push(m);
}
function addOffice(o) {                    // 관공서: 큰 남색 배지 + 굵은 이름
  const el = document.createElement("div");
  el.className = "office-pin";
  el.innerHTML = `<span class="op-ic">🏛</span><span class="op-nm">${esc(o.name)}</span>`;
  const popup = new maplibregl.Popup({ offset: 24, className: "office-popup" }).setHTML(
    `<div class="op-type">${esc(o.type)}</div><div class="op-title">${esc(o.name)}</div><div class="op-addr">📍 ${esc(o.addr)}</div>` +
    (o.tel ? `<a class="op-tel" href="tel:${esc(o.tel)}">📞 ${esc(o.tel)}</a>` : "") +
    (o.approx ? `<div class="op-note">위치가 대략적이에요. 정확하지 않으면 🛠 정보 수정으로 알려주세요.</div>` : "") +
    navLinks(o.name, o.coord[0], o.coord[1]));
  const m = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(o.coord).setPopup(popup).addTo(map);
  m._item = { name: o.name, coord: o.coord }; markers.push(m);
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
  if (showOffices) OFFICES.forEach(addOffice);
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
    row.innerHTML = `<span class="feed-dot" style="background:${c.color}"></span><div><div class="feed-title">${r.photo ? "📷 " : ""}${esc(r.title)}</div>` +
      `<div class="feed-meta">${c.icon} ${c.label} · ${timeAgo(r.ts)}${r.desc ? " · " + esc(r.desc) : ""}</div></div>`;
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
  setupRoads();
  setupBasePoi();
  loadBoundary();
  mark("지도준비");
  loadLocalBuildings().then(() => { mark("건물끝"); bldReady = true; setBuildingNight(nightOn); loadShops().then(() => mark("가게끝")); loadSignals(); });   // 건물 레이어 뒤에 올려야 가려지지 않음
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
      const res = await usePre(z.id, `data/${z.id}.geojson`);
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
let EDITS = { edits: {}, added: [] };   // 이름 수정/숨김 (data/shop_edits.json, tools/serve.py 가 저장) + 관리자 화면 수정(Supabase)
let EDITS_FILE = { edits: {}, added: [] }, REMOTE_ROWS = [];
let editMode = false, editShowHidden = false;   // 관리자 편집 모드(로그인한 관리자만)
function mergeRemote() {                // 파일 수정 위에 관리자 화면(Supabase)의 수정을 덮어씀
  const E = { edits: { ...(EDITS_FILE.edits || {}) }, added: [...(EDITS_FILE.added || [])] };
  for (const r of REMOTE_ROWS) {
    if (r.is_new) {
      E.added = E.added.filter(s => s.id !== r.id);
      E.added.push({ id: r.id, name: r.name, category: r.category || "기타", address: "", coord: [r.lon, r.lat] });
      E.edits[r.id] = { ...(E.edits[r.id] || {}), hidden: !!r.hidden };
    } else {
      const e = { ...(E.edits[r.id] || {}), hidden: !!r.hidden };
      if (r.name) e.name = r.name;
      if (r.category) e.category = r.category;
      if (r.lon != null && r.lat != null) e.coord = [r.lon, r.lat];
      E.edits[r.id] = e;
    }
  }
  EDITS = E;
}
let REMOTE_JSON = "";
async function fetchShopEdits() {
  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/shop_edits?select=*", { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } });
    if (!res.ok) return false;                      // 표가 아직 없으면(SQL 전) 조용히 무시
    const rows = await res.json(), js = JSON.stringify(rows);
    if (js === REMOTE_JSON) return true;
    REMOTE_JSON = js; REMOTE_ROWS = rows; mergeRemote();
    const src = map.getSource("shops");
    if (src) {
      const feats = shopFeatures();
      src.setData({ type: "FeatureCollection", features: feats });
      const chip = document.getElementById("shop-chip"); if (chip) chip.textContent = SHOP_CHIP_LABEL;
    }
    return true;
  } catch (e) { return false; }
}

// 지도에는 음식점·카페·술집만 표시 (관리자 편집 모드에서는 전부). 진출입 지점·스터디카페 제외, 이름+주소가 같은 중복은 하나만
function isFoodCafe(cat) { cat = cat || ""; return /음식점|카페|주점|아동복지급식/.test(cat) && !/진출입|독서실|스터디/.test(cat); }
function shopFeatures() {
  const out = [], seen = new Set();
  for (const s of SHOPS.concat(EDITS.added || [])) {
    const e = (EDITS.edits || {})[s.id] || {};
    if (e.hidden && !(editMode && editShowHidden)) continue;
    const co = e.coord || s.coord, cat = e.category || s.category;
    if (!editMode) {
      if (!isFoodCafe(cat)) continue;
      const k = (e.name || s.name) + "|" + (s.address || "") + "|" + co[0].toFixed(4) + "," + co[1].toFixed(4);
      if (seen.has(k)) continue; seen.add(k);
    }
    out.push({ type: "Feature", geometry: { type: "Point", coordinates: co },
      properties: { id: s.id, name: (e.name || s.name) + (e.hidden ? " (숨김)" : ""), category: cat, address: s.address, lon: co[0], lat: co[1],
                    color: e.hidden ? "#bbbbbb" : shopColor(cat) } });
  }
  return out;
}

async function sendEdit(payload) {
  const r = await fetch("/api/edit", { method: "POST", headers: { "Content-Type": "application/json" },
                                       body: JSON.stringify(payload) });
  if (!r.ok) throw new Error("저장 실패 (run_map.bat 으로 연 지도에서만 수정이 저장됩니다)");
  EDITS = EDITS_FILE = await r.json(); mergeRemote();
  const feats = shopFeatures();
  map.getSource("shops").setData({ type: "FeatureCollection", features: feats });
  const chip = document.getElementById("shop-chip");
  if (chip) chip.textContent = SHOP_CHIP_LABEL;
}

async function loadShops() {
  try {
    const res = await usePre("shops", "data/shops.json");
    if (!res.ok) return;
    SHOPS = await res.json();
    try { const er = await fetch("data/shop_edits.json"); if (er.ok) { EDITS_FILE = await er.json(); EDITS = EDITS_FILE; } } catch (e) {}
    await fetchShopEdits();
    if (!SHOPS.length) return;
    const feats = shopFeatures();
    map.addSource("shops", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
    map.addLayer({ id: "shops-dot", type: "circle", source: "shops", minzoom: 14,
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2, 16, 3.5, 18, 7],   // 멀리서는 작고 얇게 → 겹침 완화
               "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 14, 0.4, 16, 1, 18, 1.5] } });
    map.addLayer({ id: "shops-hit", type: "circle", source: "shops", minzoom: 14,      // 눈에 안 보이는 넓은 터치 영역
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 12, 17, 18, 19, 22], "circle-color": "#000", "circle-opacity": 0 } });
    map.addLayer({ id: "shops-label", type: "symbol", source: "shops", minzoom: 16.5,
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11,
                "text-offset": [0, 1.1], "text-anchor": "top", "text-max-width": 8 },
      paint: { "text-color": "#1b1b1b", "text-halo-color": "#fff", "text-halo-width": 1.4 } });
    const nearShops = pt => {                          // 터치 지점에서 가장 가까운 가게(와 거의 같은 거리의 겹친 가게)만
      const fs = map.queryRenderedFeatures([[pt.x - 26, pt.y - 26], [pt.x + 26, pt.y + 26]], { layers: ["shops-dot"] });
      const arr = fs.map(f => { const p = map.project(f.geometry.coordinates); return { f, d: Math.hypot(p.x - pt.x, p.y - pt.y) }; }).sort((a, b) => a.d - b.d);
      return arr.length ? arr.filter(o => o.d <= arr[0].d + 8).map(o => o.f) : [];
    };
    map.on("click", "shops-hit", e => {
      if (editMode) {                                   // 관리자 편집 모드: 팝업 대신 수정 창
        const f0 = nearShops(e.point);
        const ids = [...new Set(f0.map(x => x.properties.id))];
        if (ids.length) openEditSheet(ids);
        return;
      }
      // 같은 위치에 겹친 가게도 모두 찾는다 (건물 하나에 여러 가게가 있는 경우)
      const pt = e.point;
      const found = nearShops(pt);
      const seen = new Set(), list = [];
      for (const f of found) {
        const id = f.properties.id;
        if (seen.has(id)) continue;
        seen.add(id); list.push(f.properties);
      }
      if (!list.length) return;
      const rows = list.map((p, i) =>
        `<div class="shop-row" data-i="${i}"><strong>${esc(p.name)}</strong><br>${esc(p.category)}<br>` +
        `<small>${esc(p.address)}</small>` + navLinks(p.name, p.lon, p.lat) + `<div class="shop-act">${rxHtml("shop", p.id)}<button class="fix-btn" data-id="${esc(p.id)}" data-name="${esc(p.name)}">✏ 정보가 틀렸어요</button></div>` + (IS_LOCAL ? `<div class="edit-row">` +
        `<button data-a="rename">이름 수정</button><button data-a="hide">없는 가게</button></div>` : "") + `</div>`).join("");
      const head = list.length > 1 ? `<div class="shop-head">이 위치에 가게 ${list.length}곳</div>` : "";
      const pop = new maplibregl.Popup({ offset: 10, maxWidth: "300px" }).setLngLat(e.lngLat)
        .setHTML(`${head}<div class="shop-list">${rows}</div>`).addTo(map);
      hydrateRx(pop.getElement());
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
    map.on("mouseenter", "shops-hit", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "shops-hit", () => { map.getCanvas().style.cursor = ""; });
    const chip = document.createElement("button");
    chip.id = "shop-chip"; chip.className = "chip cat-chip on"; chip.style.flex = "none"; chip.style.setProperty("--c", "#8D5524"); chip.style.setProperty("--cf", "#fff"); chip.textContent = SHOP_CHIP_LABEL;
    chip.onclick = () => {
      const on = chip.classList.toggle("on"); sfx(on ? "on" : "off");
      for (const id of ["shops-dot", "shops-hit", "shops-label"]) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      try { if (map.getLayer("shops-glow")) map.setLayoutProperty("shops-glow", "visibility", on && nightOn ? "visible" : "none"); } catch (e) {}   // 밤 후광도 같이
    };
    document.getElementById("filters").appendChild(chip);
    if (nightOn) setBuildingNight(true);   // 가게 후광 레이어는 가게가 올라온 뒤에 만든다
  } catch (e) { /* 파일 없음: 무시 */ }
}

// ---------- 기본 지도(OpenStreetMap)의 상호/시설 글자 ----------
// 옛 이름이나 없는 가게가 섞여 있어 고칠 수 없으므로, 기본은 끄고 우리 가게 데이터만 보여준다.
function setupBasePoi() {
  const ids = map.getStyle().layers.filter(l => l["source-layer"] === "poi").map(l => l.id);
  if (!ids.length) return;
  const set = on => ids.forEach(id => map.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
  set(false);
  // (v85: "지도 상호" 칩 제거. 기본 지도 상호 글자는 항상 숨김)
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
    take(e.name || s.name, e.coord || s.coord, 30, "상가");
  }
  for (const p of PLACES_IDX) take(p.name, p.coord, 40, "장소");
  for (const n of NAMED) take(n.name, n.coord, 60, "건물");
  for (const l of LANDMARKS) take(l.name, l.coord, 60, "명소");
  for (const o of OFFICES) take(o.name, o.coord, 60, "관공서");
  return best;
}
function setPos(lngLat) {
  pending = [lngLat.lng, lngLat.lat];
  pendingPlace = nearestPlace(pending[0], pending[1]);
  const posEl = document.getElementById("pos");
  posEl.textContent = pendingPlace ? `📍 선택한 장소: ${pendingPlace.name}` :
    ((pickMode ? "👆 지도를 움직여 📍 핀 끝을 일어난 장소에 맞추세요" : "위치") + `: ${pending[1].toFixed(5)}, ${pending[0].toFixed(5)}`);
  posEl.style.fontWeight = pendingPlace ? "700" : "";
  const rpl = document.getElementById("rp-place"); if (rpl) rpl.textContent = pendingPlace ? `📍 ${pendingPlace.name}` : "👆 지도를 움직여 📍 핀 끝을 일어난 장소에 맞추세요";
  const nm = document.getElementById("ch-name");
  if (nm) { nm.textContent = pendingPlace ? pendingPlace.name : ""; nm.hidden = !(pickMode && pendingPlace); }
}
// ---- 제보 흐름: ① 헤더가 위로 올라가고 지도 전체 화면에서 핀 맞추기 → ② 입력 창이 아래에서 올라옴 ----
let rpStep = "none";                                   // none | pick | form
const sbox = document.getElementById("searchbox"), sbHome = document.createComment("sb");
sbox.before(sbHome);
const rpBar = document.getElementById("rp-bar"), rpPick = document.getElementById("rp-pick");
function rpSet(step) {
  rpStep = step;
  document.body.classList.toggle("rp-pick", step === "pick");
  document.body.classList.toggle("rp-form", step === "form");
  if (step === "pick") rpBar.querySelector(".rp-slot").appendChild(sbox);     // 검색칸만 위에 얇게 남김
  else if (sbox.parentNode !== sbHome.parentNode) sbHome.after(sbox);
}
function showPanel(on) {
  if (on) { panel.hidden = false; panel.getBoundingClientRect(); panel.classList.add("up"); }
  else { panel.classList.remove("up"); setTimeout(() => { if (!panel.classList.contains("up")) panel.hidden = true; }, 350); }
}
function openPanel(lngLat, pick) {
  if (editMode) return;
  setPos(lngLat);
  if (pick) { pickMode = true; crosshair.hidden = false; rpSet("pick"); setPos(map.getCenter()); }
  else { pickMode = false; crosshair.hidden = true; rpSet("form"); showPanel(true); }   // 길게 누른 경우: 바로 입력
}
function closePanel() {
  if (typeof syncCat === "function" && catSel.value === "__newshop") { catSel.selectedIndex = 0; syncCat(); }
  if (typeof clearPhoto === "function") clearPhoto();
  showPanel(false); rpSet("none"); pickMode = false; crosshair.hidden = true;
  const nm = document.getElementById("ch-name"); if (nm) nm.hidden = true;
}
document.getElementById("rp-go").onclick = () => { crosshair.hidden = true; const nm = document.getElementById("ch-name"); if (nm) nm.hidden = true; rpSet("form"); showPanel(true); };
document.getElementById("rp-cancel").onclick = closePanel;
document.getElementById("rp-back").onclick = () => { showPanel(false); pickMode = true; crosshair.hidden = false; rpSet("pick"); setPos(map.getCenter()); };
map.on("move", () => { if (pickMode && rpStep === "pick") setPos(map.getCenter()); });
document.getElementById("fab").onclick = () => openPanel(map.getCenter(), true);
map.on("contextmenu", e => openPanel(e.lngLat));            // PC: 우클릭
let pressTimer;                                              // 모바일: 길게 누르기
map.on("touchstart", e => { if (e.points.length === 1) pressTimer = setTimeout(() => openPanel(e.lngLat), 600); });
["touchend", "touchmove", "touchcancel"].forEach(t => map.on(t, () => clearTimeout(pressTimer)));

document.getElementById("cancel").onclick = closePanel;
const modeSel = document.getElementById("mode");
function syncMode() {
  const shop = modeSel.value === "shop";
  document.getElementById("photo-row").hidden = shop;
  document.getElementById("cat").hidden = shop;
  document.getElementById("shopcat").hidden = !shop;
  document.getElementById("title").placeholder = shop ? "가게 이름" : "제목 (예: 내장산 입구 정체)";
  document.getElementById("desc").placeholder = shop ? "주소/설명 (선택)" : "내용 (선택)";
}
modeSel.onchange = syncMode;
let catPrev = "";
function syncCat() {
  const v = catSel.value, ns = v === "__newshop";
  if (v === "__fix") {                         // 가게 정보 수정 → 지도에서 가게 점을 누르도록 안내
    catSel.selectedIndex = 0; closePanel();
    const m = document.getElementById("notice-modal");
    m.innerHTML = `<div class="nm"><b>🛠 가게 정보 수정</b><div style="margin:8px 0 12px;color:#555;font-size:15px;line-height:1.5">지도에서 <b>고칠 가게의 점</b>을 눌러 보세요.<br>팝업 아래 <b>✏ 정보가 틀렸어요</b> 버튼으로 보낼 수 있어요.<br><small>점이 없는 가게는 ➕ 없는 가게 알려주기를 이용해 주세요.</small></div><div style="display:flex;gap:8px"><button id="nm-x" style="flex:1">확인</button></div></div>`;
    m.hidden = false; document.getElementById("nm-x").onclick = () => m.hidden = true;
    return;
  }
  document.getElementById("photo-row").hidden = ns;
  document.getElementById("title").placeholder = ns ? "가게 이름" : "제목 (예: 내장산 입구 정체)";
  document.getElementById("desc").placeholder = ns ? "업종·주소 (예: 카페, 수성동 123)" : "내용 (선택)";
}
catSel.onchange = syncCat;
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
  if (catSel.value === "__newshop") {
    const btn0 = document.getElementById("save"); btn0.disabled = true;
    try {
      const r = await fetch(SUPABASE_URL + "/rest/v1/shop_corrections", { method: "POST", headers: { ...rxHdr, Prefer: "return=minimal" },
        body: JSON.stringify({ shop_id: "new:" + pending[0].toFixed(6) + "," + pending[1].toFixed(6), shop_name: title.slice(0, 40), kind: "없는 가게예요(추가 요청)", note: document.getElementById("desc").value.trim().slice(0, 100) || null }) });
      if (!r.ok) throw new Error("보내지 못했어요 (" + r.status + "). 잠시 뒤 다시 해 주세요.");
      try { localStorage.setItem("jeongeup-last-report", String(Date.now())); } catch {}
      document.getElementById("title").value = ""; document.getElementById("desc").value = ""; catSel.selectedIndex = 0; syncCat();
      closePanel(); sfx("done"); alert("알려주셔서 고마워요! 확인 후 지도에 추가할게요 🙏");
    } catch (err) { alert(err.message); }
    btn0.disabled = false; return;
  }
  const btn = document.getElementById("save"); btn.disabled = true;
  try {
    let photoUrl = "";
    if (photoBlob) {
      btn.textContent = "사진 올리는 중…";
      const name = Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".jpg";
      const up = await fetch(SUPABASE_URL + "/storage/v1/object/report-photos/" + name, { method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "image/jpeg" }, body: photoBlob });
      if (!up.ok) throw new Error("사진 올리기 실패 (" + up.status + "). 사진 없이 다시 시도해 보세요.");
      photoUrl = SUPABASE_URL + "/storage/v1/object/public/report-photos/" + name;
    }
    const res = await fetch(SUPABASE_URL + "/rest/v1/reports", {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY,
                 "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ category: catSel.value, title: title.slice(0, 60),
        description: ((document.getElementById("desc").value.trim() + (pendingPlace ? "\n📍 " + pendingPlace.name : "")).trim()).slice(0, 300),
        lon: pending[0], lat: pending[1], ...(photoUrl ? { photo_url: photoUrl } : {}) }),
    });
    if (!res.ok) throw new Error("제보 전송 실패 (" + res.status + ")");
    try { localStorage.setItem("jeongeup-last-report", String(Date.now())); } catch {}
    document.getElementById("title").value = ""; document.getElementById("desc").value = ""; clearPhoto();
    closePanel(); sfx("done");
    alert("제보가 접수됐어요! 확인 후 지도에 표시됩니다.");
  } catch (err) { alert(err.message); }
  btn.disabled = false; btn.textContent = "등록";
};

// 승인된 제보를 서버에서 받아옴 (15초마다 갱신)
const knownIds = new Set(); let started = false;
async function fetchReports() {
  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/reports?select=*&order=created_at.desc&limit=200",
      { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } });
    if (!res.ok) return false;
    const rows = await res.json();
    const next = rows.filter(r => CATEGORIES[r.category] && reportExpMs(r.created_at, r.category, r.expires_at) > Date.now()).map(r => ({
      id: r.id, title: r.title, desc: r.description || "", cat: r.category,
      coord: [r.lon, r.lat], ts: r.created_at, exp: r.expires_at || null, photo: r.photo_url || "" }));
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
const APT_PATTERN_ZOOM = 16.5;   // 창문 패턴은 가까이서만 (성능)
const APT_WALL = ["#f2e3c6", "#cfe0f1", "#e9d2d2", "#d5e6d0", "#e0dbee"];
const BLD_DAY = ["interpolate", ["linear"], ["coalesce", ["get", "height"], 6],
  0, "#eadcc0", 8, "#e2c29e", 15, "#d4a283", 25, "#c8bdb2", 40, "#c4cad2", 70, "#b3bcc9"];   // 저층=베이지·테라코타, 고층=쿨실버
const BLD_NIGHT = ["interpolate", ["linear"], ["coalesce", ["get", "height"], 6],
  0, "#5c5659", 8, "#59545a", 15, "#565359", 25, "#4f5664", 40, "#485a74", 70, "#42597c"];   // 저층=따뜻한 차콜, 고층=푸른 슬레이트   // 딥 슬레이트·차콜
const APT_FAR_DAY = ["match", ["%", ["floor", ["/", ["to-number", ["coalesce", ["get", "id"], "0"], 0], 1000]], 5],
  0, APT_WALL[0], 1, APT_WALL[1], 2, APT_WALL[2], 3, APT_WALL[3], APT_WALL[4]];
const APT_FAR_NIGHT = "#4a5c7a";
const BLD_NIGHT_DS = ["interpolate", ["linear"], ["coalesce", ["get", "height"], 6],
  0, "#2e334d", 10, "#2b3050", 25, "#282d52", 45, "#252a54", 70, "#222758"];
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
// 32x16 타일 = 2층 x 4칸 창문 격자. 낮: 옅은 유리(벽색 유지)+프레임 음영, 밤: 약 30% 칸만 따뜻한 불빛
function windowTile(wall, glass, mix, lit, litColors) {
  const W = 32, Hh = 16, d = new Uint8Array(W * Hh * 4), wr = hex2rgb(wall), gr = hex2rgb(glass);
  const px = (x, y, c) => { const o = (y * W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; };
  const sh = (c, k) => c.map(v => Math.round(v * k));
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) px(x, y, y % 8 === 7 ? sh(wr, 0.9) : wr);   // 벽 + 층 구분선
  for (let fy = 0; fy < 2; fy++) for (let fx = 0; fx < 4; fx++) {
    const x0 = fx * 8 + 1, y0 = fy * 8 + 1, idx = fy * 4 + fx;       // 유리 6x5, 프레임 1px
    for (let y = y0 - 1; y <= y0 + 5; y++) for (let x = x0 - 1; x <= x0 + 6; x++) {
      if (y < 0 || x < 0 || x >= W || y >= Hh) continue;
      if (x === x0 - 1 || x === x0 + 6 || y === y0 - 1 || y === y0 + 5) { px(x, y, sh(wr, 0.8)); continue; }
      let c;
      if (lit && lit[idx]) c = litColors[idx % litColors.length];
      else {
        const m = mix * (1.15 - 0.3 * (y - y0) / 4);                  // 위쪽이 살짝 더 반사
        c = wr.map((v, k) => Math.round(v * (1 - m) + gr[k] * m));
      }
      px(x, y, c);
    }
  }
  return { width: W, height: Hh, data: d };
}
const NIGHT_LIT = [[0, 1, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 1, 0], [0, 0, 1, 0, 1, 0, 0, 1], [0, 0, 0, 1, 0, 1, 0, 0], [1, 0, 0, 0, 0, 0, 1, 0]];
// 화면 전체 필터(0.74)에 깎이는 만큼 더 밝고 채도 높은 노란빛
const NIGHT_LIT_COLORS = [[[255, 208, 84], [255, 224, 120]], [[255, 196, 64], [255, 216, 100]], [[255, 214, 96], [255, 190, 58]], [[255, 222, 112], [255, 202, 76]], [[255, 200, 70], [255, 220, 108]]];
function makeWindowImage(wall, band, alpha) { return windowTile(wall, band, alpha, null, null); }
function makeNightImage(wall, i) { return windowTile(wall, "#222b3c", 0.5, NIGHT_LIT[i % 5], NIGHT_LIT_COLORS[i % 5]); }
function addAptImages() {
  const dark = (h, k) => "#" + hex2rgb(h).map(v => Math.round(v * k).toString(16).padStart(2, "0")).join("");
  APT_WALL.forEach((w, i) => {
    try {
      map.addImage(`apt${i}-day`, makeWindowImage(w, "#8fa6bc", 0.28));
      map.addImage(`apt${i}-night`, makeNightImage(dark(w, 0.33), i));
    } catch (e) {}
  });
  try { aptPatterns = APT_WALL.every((_, i) => map.hasImage(`apt${i}-day`) && map.hasImage(`apt${i}-night`)) && !/[?&]stripes=0/.test(location.search); } catch (e) {}
}
let nightOn = false, bldReady = false, aptPatterns = false;
// 밤 조명: 도로 빛, 가게 후광, 하늘 쪽 안개
function ensureNightLights() {
  try {
    if (!map.getLayer("night-road-core")) {
      const firstExt = map.getStyle().layers.find(l => l.type === "fill-extrusion");
      const flt = ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary"]]];
      map.addLayer({ id: "night-road-core", type: "line", source: vecSrc(), "source-layer": "transportation", minzoom: 15, filter: flt,
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#FDE68A", "line-dasharray": [0.5, 3], "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1.4, 18, 3.2], "line-opacity": 0.85 } }, firstExt && firstExt.id);
    }
    if (map.getSource("shops") && !map.getLayer("shops-glow")) {
      map.addLayer({ id: "shops-glow", type: "circle", source: "shops", minzoom: 14,
        layout: { visibility: "none" },
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.6, 16, 5.5, 18, 13], "circle-color": "#ffcf7a", "circle-blur": 0.3, "circle-opacity": 0.8 } }, "shops-dot");
    }
  } catch (e) {}
}

// ---------- 도로 톤 + 큰 도로 중앙선 + 밤 라벨 ----------
const ROAD_ORIG = {};
function roadTier(id) { return /(motorway|trunk|primary)/.test(id) ? 1 : /(secondary|tertiary)/.test(id) ? 2 : 3; }
const ROAD_DAY = { 1: "#b4b4b9", 2: "#cacace", 3: "#e3e2df" };
const ROAD_DAY_CASE = { 1: "#8f8a84", 2: "#a9a49e", 3: "#c4c0ba" };
const ROAD_NIGHT = { 1: "#8a929f", 2: "#7c8591", 3: "#6f7782" };   // 밤 땅(night-dim)보다 밝게
const ROAD_NIGHT_CASE = "#20252d";
function setupRoads() {
  try {
    const firstRoad = map.getStyle().layers.find(l => /^(road|bridge|tunnel)_/.test(l.id));
    if (!map.getLayer("night-dim")) map.addLayer({ id: "night-dim", type: "background", layout: { visibility: "none" },
      paint: { "background-color": "#101c34", "background-opacity": 0.6 } }, firstRoad && firstRoad.id);   // 도로 아래, 땅·물·숲 위
  } catch (e) {}
  try {
    const firstExt = map.getStyle().layers.find(l => l.type === "fill-extrusion");
    if (!map.getLayer("road-centerline")) {
      map.addLayer({ id: "road-centerline", type: "line", source: vecSrc(), "source-layer": "transportation", minzoom: 14,
        filter: ["all", ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary"]]], ["!=", ["get", "brunnel"], "tunnel"], ["==", ["coalesce", ["get", "oneway"], 0], 0]],
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: { "line-color": "#e2b52f", "line-opacity": 0.9, "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.6, 16, 1.2, 18, 2.2, 20, 3.2] } }, firstExt && firstExt.id);
    }
  } catch (e) {}
  applyRoadTone(nightOn);
}
function applyRoadTone(on) {
  try {
    for (const l of map.getStyle().layers) {
      if (l.type !== "line" || !/^(road|bridge)_/.test(l.id) || /(tunnel|rail|oneway|arrow|path|pier|track|steps|ferry)/.test(l.id)) continue;
      if (!(l.id in ROAD_ORIG)) ROAD_ORIG[l.id] = map.getPaintProperty(l.id, "line-color");
      const casing = /casing/.test(l.id), t = roadTier(l.id);
      if (casing) map.setPaintProperty(l.id, "line-color", on ? ROAD_NIGHT_CASE : ROAD_DAY_CASE[t]);
      else map.setPaintProperty(l.id, "line-color", on ? ROAD_NIGHT[t] : ROAD_DAY[t]);
    }
    if (map.getLayer("night-dim")) map.setLayoutProperty("night-dim", "visibility", on ? "visible" : "none");   // 밤 땅·물·숲을 한 겹으로 푸르게 어둡게
    if (map.getLayer("road-centerline")) map.setPaintProperty("road-centerline", "line-color", on ? "#f0c850" : "#e2b52f");
  } catch (e) {}
}
const LABEL_ORIG = {};
function applyLabelTone(on) {          // 밤: 밝은 글씨 + 어두운 halo (전체 필터를 줄인 대신)
  try {
    for (const l of map.getStyle().layers) {
      if (l.type !== "symbol" || !map.getLayoutProperty(l.id, "text-field")) continue;
      if (!(l.id in LABEL_ORIG)) LABEL_ORIG[l.id] = ["text-color", "text-halo-color", "text-halo-width"].map(k => map.getPaintProperty(l.id, k));
      const o = LABEL_ORIG[l.id];
      map.setPaintProperty(l.id, "text-color", on ? "#eef2f8" : o[0]);
      map.setPaintProperty(l.id, "text-halo-color", on ? "#131a27" : o[1]);
      map.setPaintProperty(l.id, "text-halo-width", on ? 0.9 : o[2]);
    }
  } catch (e) {}
}
function setBuildingNight(on) {
  nightOn = !!on;
  if (!bldReady) return;
  try {                                   // 땅·길·물·글씨까지 한꺼번에 어둡게 (건물만 어두워 보이던 문제)
    const cv = map.getCanvas(); cv.style.transition = "filter 1.5s ease";
    cv.style.filter = "none";   // 성능: 화면 전체 필터 제거. 밤 땅은 night-dim 레이어로 어둡게
  } catch (e) {}
  document.body.classList.toggle("night", !!on);
  applyRoadTone(on); applyLabelTone(on);
  if (on) ensureNightLights();
  const shopsOn = !(document.getElementById("shop-chip") && !document.getElementById("shop-chip").classList.contains("on"));   // 상가 필터가 꺼져 있으면 후광도 숨김
  for (const id of ["night-road-glow", "night-road-core", "shops-glow"]) { try { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on && (id !== "shops-glow" || shopsOn) ? "visible" : "none"); } catch (e) {} }
  try { map.setLight(on ? { anchor: "viewport", position: [1.4, 210, 62], intensity: 0.5, color: "#cdd8ee" } : { anchor: "viewport", position: [1.4, 210, 45], intensity: 0.55, color: "#fff4e0" }); } catch (e) {}
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
  if (wx.night) return "rgba(10,22,44," + (wx.kind === "clear" ? 0.22 : 0.3) + ")";
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
  if (typeof updateAmbience === "function") updateAmbience();
  wxTint.style.backgroundColor = wxTintColor();
  wxSeed();
  const b = document.getElementById("wx-badge");
  b.textContent = `${wx.night && wx.kind === "clear" ? "🌙" : WX_ICON[wx.kind]} 정읍 ${wx.temp != null ? Math.round(wx.temp) + "°C · " : ""}${wx.night && wx.kind === "clear" ? "맑은 밤" : wx.label}`;
  b.hidden = false;
}

let wxMoving = false;
map.on("movestart", () => { wxMoving = true; });
map.on("moveend", () => { wxMoving = false; });
function wxDraw(t) {
  wxCtx.clearRect(0, 0, wxCanvas.width, wxCanvas.height);
  const w = wxCanvas.width, h = wxCanvas.height, step = wxMoving ? 2 : 1;   // 지도를 움직이는 동안은 입자 절반만 (성능)
  if (wx.kind === "rain" || wx.kind === "storm") {
    wxCtx.strokeStyle = wx.night ? "rgba(190,205,235,0.55)" : "rgba(120,140,170,0.6)";
    wxCtx.lineWidth = 1.2; wxCtx.beginPath();
    for (let i = 0; i < wxParticles.length; i += step) {
      const p = wxParticles[i];
      const len = 12 + 16 * p.v, sp = 14 + 14 * p.v;
      wxCtx.moveTo(p.x, p.y); wxCtx.lineTo(p.x - 3, p.y + len);
      p.y += sp; p.x -= 1.2;
      if (p.y > h) { p.y = -20; p.x = Math.random() * (w + 40); }
    }
    wxCtx.stroke();
  } else if (wx.kind === "snow") {
    wxCtx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < wxParticles.length; i += step) {
      const p = wxParticles[i];
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
let WXO = null;                                   // 관리자가 정한 날씨 (모든 사용자에게 적용, 만료되면 자동 복귀)
async function fetchWxOverride() {
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/weather_override?select=*&id=eq.1", { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } });
    if (!r.ok) return;
    const row = (await r.json())[0];
    const next = row && row.kind && new Date(row.expires_at) > new Date() && WX_PRESET[row.kind] ? row.kind : null;
    if (next !== WXO) { WXO = next; fetchWeather(); }
  } catch (e) {}
}
async function fetchWeather() {
  if (wxManual) return;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_POINT.lat}&longitude=${WEATHER_POINT.lon}` +
      `&current=temperature_2m,weather_code,is_day&timezone=Asia%2FSeoul`;
    const r = await fetch(url); if (!r.ok) return;
    const cur = (await r.json()).current; if (!cur) return;
    let base = WX_CODE(cur.weather_code);
    if (cur.temperature_2m <= 1 && base.kind === "rain" && base.i <= 0.6) base = { kind: "snow", label: "진눈깨비", i: base.i };   // 영하권 약한 비는 진눈깨비로 보정
    if (WXO) { applyWeather({ ...WX_PRESET[WXO], night: cur.is_day === 0, temp: cur.temperature_2m }); return; }
    applyWeather({ ...base, night: cur.is_day === 0, temp: cur.temperature_2m });
  } catch (e) {}
}
fetchWeather(); setInterval(fetchWeather, 600000);
setTimeout(fetchWxOverride, 1500); setInterval(fetchWxOverride, 60000);

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
    const res = await usePre("signals", "data/signals.json?" + Date.now());
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
    out.push({ name: e.name || s.name, sub: (e.category || s.category || "").split(">").pop().trim() + (s.address ? " · " + s.address.replace("전북특별자치도 ", "") : ""),
               addr: s.address || "", coord: e.coord || s.coord, kind: "상가" });
  }
  for (const p of PLACES_IDX) out.push({ name: p.name, sub: p.address ? p.address.replace("전북특별자치도 ", "") : "", addr: p.address || "", coord: p.coord, kind: "장소" });
  for (const n of NAMED) out.push({ name: n.name, sub: "건물", addr: "", coord: n.coord, kind: "건물" });
  for (const l of LANDMARKS) out.push({ name: l.name, sub: "명소", addr: "", coord: l.coord, kind: "명소" });
  for (const o of OFFICES) out.push({ name: o.name, sub: "관공서 · " + o.addr, addr: o.addr, coord: o.coord, kind: "관공서" });
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
// 검색창을 누르면 크게 보이기 (끝나면 원래 헤더로)
qEl.addEventListener("focus", () => { document.body.classList.add("searching"); qEl.placeholder = "🔍 가게·아파트·주소 검색"; });
qEl.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== qEl) { document.body.classList.remove("searching"); qEl.placeholder = "🔍 검색"; } }, 250));

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
  const KAKAO_OPEN = "kakaotalk://web/openExternal?url=" + encodeURIComponent(url);
  if (inapp) {            // 카톡·인스타·스레드 등 안에서 열면 안내 띠 → 외부 브라우저(크롬/사파리)로 열기
    let hid = false; try { hid = sessionStorage.getItem("kk_bar") === "1"; } catch (e) {}
    if (!hid) {
      const bar = document.createElement("div"); bar.id = "kk-bar";
      bar.innerHTML = '<span>🌐 크롬·사파리로 열면 앱처럼 <b>설치</b>할 수 있어요</span><button id="kk-go">' + (/KAKAOTALK/i.test(ua) || android ? "브라우저로 열기" : "여는 방법 보기") + '</button><button id="kk-x" aria-label="닫기">✕</button>';
      document.body.appendChild(bar);
      document.getElementById("kk-go").onclick = () => {
        if (/KAKAOTALK/i.test(ua)) location.href = KAKAO_OPEN;
        else if (android) location.href = "intent://" + url.replace(/^https?:\/\//, "") + "#Intent;scheme=https;package=com.android.chrome;end";
        else btn.click();
      };
      document.getElementById("kk-x").onclick = () => { bar.remove(); try { sessionStorage.setItem("kk_bar", "1"); } catch (e) {} };
    }
  }
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
      if (/KAKAOTALK/i.test(ua)) acts.push(["브라우저로 열기", () => { location.href = KAKAO_OPEN; }]);
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


// ===== 친구에게 알려주기 (기기 공유창 → 안 되면 주소 복사) =====
(function shareBtn() {
  const b = document.getElementById("share-btn"); if (!b || LIVE) return;
  b.hidden = false;
  const url = location.origin + location.pathname;
  b.onclick = async () => {
    const old = b.textContent;
    try {
      if (navigator.share) { await navigator.share({ title: "정읍 지금", text: "정읍 사람들이 지금 올리는 실시간 제보 지도", url }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); b.textContent = "✓ 주소 복사됨"; }
    catch (e) { b.textContent = "주소창에서 복사해 주세요"; }
    setTimeout(() => { b.textContent = old; }, 2000);
  };
})();

// ===== 새로고침 버튼 + 앱으로 돌아올 때 자동 갱신 =====
async function manualRefresh(btn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = "⏳";
  const [ok] = await Promise.all([fetchReports(), fetchShopEdits(), fetchNotices(), fetchWxOverride()]);
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
let commTab = "news";
const SOON = {
  job: ["💼", "알바 구인·구직", "급하게 사람이 필요할 때, 일자리를 찾을 때.<br>정읍 동네 알바를 지도에서 바로 찾는 곳이에요."],
  used: ["🛒", "중고 거래", "이웃끼리 편하게 사고파는 곳.<br>가까운 동네 물건을 지도에서 바로 찾아요."],
  home: ["🏠", "부동산", "정읍 아파트·상가·원룸 정보를<br>3D 지도 위에서 한눈에 볼 수 있어요."],
};
document.querySelectorAll("#comm-tabs button").forEach(b => b.onclick = () => {
  commTab = b.dataset.t;
  document.querySelectorAll("#comm-tabs button").forEach(x => x.classList.toggle("on", x === b));
  commBody.scrollTop = 0; renderComm();
});
function renderComm() {
  if (!commBody) return;
  if (commTab !== "news") {
    const s = SOON[commTab];
    commBody.innerHTML = `<div class="soon"><div class="soon-ic">${s[0]}</div><div class="soon-t">${s[1]}</div><div class="soon-d">${s[2]}</div><div class="soon-b">🛠 곧 열려요 · 업데이트 예정</div></div>`;
    return;
  }
  let html = `<button class="comm-topic food-go" id="food-go">🍚 오늘의 맛집 순위 보러가기 <span>지도 아래에서 확인 ▴</span></button>`;
  html += `<div class="comm-note">💬 이야기 글쓰기는 곧 열려요. 지금은 지도 제보로 참여할 수 있어요.</div>`;
  if (pushReady()) html += `<div class="comm-note" id="push-card"></div>`;
  html += `<div class="comm-head">실시간 제보 ${reports.length}건</div>`;
  if (!reports.length) html += `<div class="feed-empty">아직 제보가 없어요. 첫 제보를 남겨 보세요!</div>`;
  commBody.innerHTML = html;
  const fg = document.getElementById("food-go"); if (fg) fg.onclick = () => { closeComm(); setTimeout(() => foodSheet.set(true), 260); };
  setupPushCard();
  for (const r of reports) {
    const c = CATEGORIES[r.cat];
    if (expAt(r) <= Date.now()) continue;
    const card = document.createElement("div"); card.className = "comm-card";
    card.innerHTML = `<div class="comm-meta"><span class="cat-badge" style="background:${c.color};color:${c.fg || '#fff'}">${c.icon} ${c.label}</span><span>${timeAgo(r.ts)}</span><span class="exp-badge" data-exp="${expAt(r)}"></span></div>` +
      `<div class="comm-title">${esc(r.title)}</div>` + (r.desc ? `<div class="comm-desc">${esc(r.desc)}</div>` : "") + (r.photo ? `<a href="${esc(r.photo)}" target="_blank" rel="noopener"><img class="comm-photo" src="${esc(r.photo)}" loading="lazy"></a>` : "") +
      `<div class="shop-act">${rxHtml("report", r.id)}<button class="chip comm-go">📍 지도에서 보기</button></div>`;
    card.querySelector(".comm-go").onclick = () => {
      closeComm();
      focusReport(r);
    };
    commBody.appendChild(card);
  }
  hydrateRx(commBody);
  tickExp();
}
async function setupPushCard() {              // 손님 알림 켜기/끄기
  const box = document.getElementById("push-card"); if (!box) return;
  let sub = null; try { sub = await pushGetSub(false); } catch (e) {}
  const on = !!sub && Notification.permission === "granted";
  box.innerHTML = on ? `🔔 알림이 켜져 있어요 <button class="chip" id="push-btn">끄기</button>` : `🔔 긴급 공지·동네 소식을 알림으로 받아보세요 <button class="chip" id="push-btn">알림 받기</button>`;
  document.getElementById("push-btn").onclick = async () => {
    try {
      if (on) { await sub.unsubscribe(); }
      else {
        const s = await pushGetSub(true);
        const r = await fetch(SUPABASE_URL + "/rest/v1/push_subscriptions", { method: "POST", headers: { ...rxHdr, Prefer: "return=minimal" }, body: JSON.stringify(pushRow(s, "guest")) });
        if (!r.ok && r.status !== 409) throw new Error("알림 등록에 실패했어요. 잠시 뒤 다시 해 주세요.");
      }
    } catch (e) { alert(e.message || "알림을 켜지 못했어요."); }
    refreshBell(); setupPushCard();
  };
}
// ----- 제보 만료 배지: 1분 간격, 배지 텍스트만 갱신, 숨김/닫힘이면 정지 -----
function expAt(r) { return reportExpMs(r.ts, r.cat, r.exp); }
function expText(ms) { const m = Math.ceil(ms / 60000); return m <= 10 ? "곧 만료" : m < 60 ? m + "분 남음" : Math.floor(m / 60) + "시간" + (m % 60 >= 30 && m < 600 ? " 30분" : "") + " 남음"; }
let expTimer = 0;
function tickExp() {
  if (!commEl || commEl.hidden || document.hidden) return;
  const now = Date.now();
  commBody.querySelectorAll(".exp-badge").forEach(el => {
    const left = +el.dataset.exp - now;
    if (left <= 0) { const c = el.closest(".comm-card"); if (c) c.remove(); return; }
    const t = expText(left); if (el.textContent !== t) el.textContent = t;
    el.classList.toggle("warn", left <= 10 * 60000);
  });
}
function startExp() { stopExp(); tickExp(); expTimer = setInterval(tickExp, 60000); }
function stopExp() { if (expTimer) { clearInterval(expTimer); expTimer = 0; } }
document.addEventListener("visibilitychange", () => { if (document.hidden) stopExp(); else if (commEl && !commEl.hidden) startExp(); });
let commPushed = false, ignorePop = false, jgReady = false;   // 커뮤니티 전용 뒤로가기 기록
function openComm() { if (jgReady && !commPushed) { try { history.pushState({ jg: 2 }, ""); commPushed = true; } catch (e) {} } renderComm(); commEl.hidden = false; startExp(); requestAnimationFrame(() => commEl.classList.add("open")); document.body.style.overflow = "hidden"; fetchReports(); }
function closeComm(fromPop) { if (commPushed && fromPop !== true) { commPushed = false; ignorePop = true; try { history.back(); } catch (e) { ignorePop = false; } } stopExp(); commEl.classList.remove("open"); setTimeout(() => { commEl.hidden = true; }, 220); document.body.style.overflow = ""; }
if (commEl) {
  document.getElementById("comm-btn").onclick = openComm;
  document.getElementById("comm-back").onclick = closeComm;
  addEventListener("keydown", e => { if (e.key === "Escape" && !commEl.hidden) closeComm(); });
  let sy = 0, fromGrip = false;                       // 아래로 당겨서 새로고침 (위쪽 줄에서 시작한 끌기는 "닫기"이므로 제외)
  commEl.addEventListener("touchstart", e => { sy = e.touches[0].clientY; fromGrip = !!(e.target.closest && e.target.closest(".comm-top, .comm-grab")); }, { passive: true });
  commEl.addEventListener("touchend", e => { if (!fromGrip && commBody.scrollTop <= 0 && e.changedTouches[0].clientY - sy > 90) manualRefresh(document.getElementById("comm-refresh")); }, { passive: true });
  // 위쪽 줄(손잡이·제목줄)을 아래로 끌어서 닫기: 따라 내려오다가 충분히 끌거나 빠르게 쓸면 닫히고, 아니면 제자리로 돌아온다
  let gy = 0, gt = 0, gdy = 0, gActive = false;
  commEl.addEventListener("touchstart", e => {
    if (!(e.target.closest && e.target.closest(".comm-top, .comm-grab")) || e.touches.length !== 1) return;
    gActive = true; gy = e.touches[0].clientY; gt = Date.now(); gdy = 0;
  }, { passive: true });
  commEl.addEventListener("touchmove", e => {
    if (!gActive) return;
    gdy = Math.max(0, e.touches[0].clientY - gy);
    if (gdy > 6) { commEl.style.transition = "none"; commEl.style.transform = `translateY(${gdy}px)`; }
  }, { passive: true });
  const gripEnd = () => {
    if (!gActive) return; gActive = false;
    const dt = Math.max(1, Date.now() - gt), far = gdy > Math.max(110, innerHeight * 0.22), flick = gdy > 50 && gdy / dt > 0.6;
    if (far || flick) {
      commEl.style.transition = "transform .2s ease"; commEl.style.transform = "translateY(100%)";
      closeComm();
      setTimeout(() => { commEl.style.transition = ""; commEl.style.transform = ""; }, 320);
    } else if (gdy > 0) {
      commEl.style.transition = "transform .2s ease"; commEl.style.transform = "";
      setTimeout(() => { commEl.style.transition = ""; }, 240);
    }
  };
  commEl.addEventListener("touchend", gripEnd, { passive: true });
  commEl.addEventListener("touchcancel", gripEnd, { passive: true });
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


// ===== 배경 환경음 (🔊 버튼, 기본 꺼짐): 바람 + 날씨에 따른 빗소리·천둥, 파일 없이 코드로 합성 =====
let AC = null, amb = null, sndOn = false;
function noiseBuffer(ctx, color) {
  const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else { b0 = 0.97 * b0 + 0.03 * w; d[i] = w * 0.5 + b0 * 0.5; }
  }
  return buf;
}
function startAmbience() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const master = AC.createGain(); master.gain.value = 0; master.connect(AC.destination);
    const mk = (color, build) => { const s = AC.createBufferSource(); s.buffer = noiseBuffer(AC, color); s.loop = true; const g = AC.createGain(); g.gain.value = 0; build(s, g); s.start(); return g; };
    const wind = mk("brown", (s, g) => { const f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500; s.connect(f); f.connect(g); g.connect(master);
      const lfo = AC.createOscillator(); lfo.frequency.value = 0.07; const lg = AC.createGain(); lg.gain.value = 0.03; lfo.connect(lg); lg.connect(g.gain); lfo.start(); });
    const rain = mk("white", (s, g) => { const h = AC.createBiquadFilter(); h.type = "highpass"; h.frequency.value = 900; const l = AC.createBiquadFilter(); l.type = "lowpass"; l.frequency.value = 7500; s.connect(h); h.connect(l); l.connect(g); g.connect(master); });
    amb = { master, wind, rain, thunderT: 0 };
  }
  AC.resume && AC.resume();
  updateAmbience();
}
function updateAmbience() {
  if (!amb || !sndOn) return;
  const t = AC.currentTime, rainy = wx.kind === "rain" || wx.kind === "storm", i = wx.i || 0.5;
  amb.master.gain.setTargetAtTime(0.5, t, 0.8);
  amb.wind.gain.setTargetAtTime(wx.kind === "snow" ? 0.05 : (wx.night ? 0.06 : 0.09) + (wx.kind === "storm" ? 0.08 : 0), t, 1.5);
  amb.rain.gain.setTargetAtTime(rainy ? 0.04 + 0.16 * i : 0, t, 1.5);
}
function thunderLoop() {                       // 천둥번개 날씨에서만, 가끔 낮게 울리는 소리
  if (sndOn && AC && wx.kind === "storm" && !document.hidden) {
    const t = AC.currentTime, s = AC.createBufferSource(); s.buffer = noiseBuffer(AC, "brown");
    const f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 160; const g = AC.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.15); g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    s.connect(f); f.connect(g); g.connect(amb.master); s.start(t); s.stop(t + 2.8);
  }
  setTimeout(thunderLoop, 9000 + Math.random() * 12000);
}
thunderLoop();
(function sndBtn() {
  const b = document.getElementById("snd-btn"); if (!b || LIVE) return;
  const label = () => { b.textContent = sndOn ? "🔊" : "🔇"; b.classList.toggle("on", sndOn); };
  b.onclick = () => {
    sndOn = !sndOn; try { localStorage.setItem("snd", sndOn ? "1" : "0"); } catch (e) {}
    if (sndOn) { startAmbience(); sfx("on"); } else if (amb) amb.master.gain.setTargetAtTime(0, AC.currentTime, 0.3);
    label();
  };
  document.addEventListener("visibilitychange", () => { if (!AC) return; if (document.hidden) AC.suspend(); else if (sndOn) AC.resume(); });
  label();
})();

// ===== 효과음 (파일 없이 브라우저가 직접 만드는 짧은 소리). 🔊 소리가 켜져 있을 때만 난다 =====
const SFX_VOL = 0.1;                                  // 전체 크기 (0~1, 배경음보다 작게)
const SFX = {                                         // [시작 Hz, 끝 Hz, 길이(초), 크기, 파형, 시작 지연(초)] 들의 목록
  open:  [[380, 620, 0.16, 1, "sine", 0]],            // 서랍 열기: 올라가는 "퐁"
  close: [[560, 360, 0.16, 0.9, "sine", 0]],          // 서랍 닫기: 내려가는 "퐁"
  on:    [[620, 880, 0.08, 0.8, "triangle", 0]],      // 칩 켜기: 가벼운 "톡↑"
  off:   [[760, 520, 0.08, 0.7, "triangle", 0]],      // 칩 끄기: 가벼운 "톡↓"
  done:  [[660, 660, 0.14, 1, "sine", 0], [880, 880, 0.24, 1, "sine", 0.11]],   // 제보 완료: "딩-동"
};
function sfx(kind) {
  if (!sndOn || !AC || !SFX[kind]) return;
  try {
    const t = AC.currentTime;
    for (const [f0, f1, dur, vol, type, delay] of SFX[kind]) {
      const o = AC.createOscillator(), g = AC.createGain(); o.type = type;
      o.frequency.setValueAtTime(f0, t + delay); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(SFX_VOL * vol, t + delay + 0.012);   // 딱 소리가 나지 않게 부드럽게 시작·끝
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(g); g.connect(AC.destination); o.start(t + delay); o.stop(t + delay + dur + 0.03);
    }
  } catch (e) {}
}

setInterval(fetchShopEdits, 60000);   // 관리자가 고친 가게 정보를 1분마다 반영


// ===== 관리자 편집 모드: 일반 지도 그대로에서 가게 이름·위치·숨김·새 가게 수정 (저장: Supabase shop_edits, 관리자만) =====
const EDIT_CATS = ["음식점", "카페", "숙박", "편의점/마트", "주차장", "기타"];
let sbAdmin = null, edState = "none", edSel = null;
const edEl = id => document.getElementById(id);
function edToast(t) { const el = edEl("ed-toast"); el.textContent = t; el.hidden = false; clearTimeout(edToast.t); edToast.t = setTimeout(() => el.hidden = true, 2200); }
function shopInfo(id) {
  const s = SHOPS.concat(EDITS.added || []).find(x => x.id === id); if (!s) return null;
  const e = (EDITS.edits || {})[id] || {};
  return { id, name: e.name || s.name, category: e.category || s.category || "기타", coord: e.coord || s.coord, hidden: !!e.hidden };
}
function edRefresh() {
  const feats = shopFeatures(); map.getSource("shops").setData({ type: "FeatureCollection", features: feats });
  const chip = document.getElementById("shop-chip"); if (chip) chip.textContent = SHOP_CHIP_LABEL;
}
async function edSave(id, patch, msg) {
  const cur = shopInfo(id) || { id, hidden: false, category: "기타" };
  const o = Object.assign(cur, patch);
  const prev = REMOTE_ROWS.find(r => r.id === id);
  const row = { id, name: o.name, category: o.category, lon: o.coord[0], lat: o.coord[1], hidden: !!o.hidden, is_new: !!(patch.isNew || (prev && prev.is_new)), updated_at: new Date().toISOString() };
  const { error } = await sbAdmin.from("shop_edits").upsert(row);
  if (error) { edToast("저장 실패: " + error.message); alert("저장 실패: " + error.message + "\n(관리자 계정으로 로그인했는지 확인하세요)"); return; }
  REMOTE_ROWS = REMOTE_ROWS.filter(r => r.id !== id).concat([row]); REMOTE_JSON = "";
  mergeRemote(); edRefresh(); edToast(msg); edClose();
}
function edClose() { edEl("ed-sheet").hidden = true; crosshair.hidden = true; edState = "none"; edSel = null; }
const edOpts = cur => (EDIT_CATS.includes(cur) ? EDIT_CATS : [cur].concat(EDIT_CATS)).map(c => `<option${c === cur ? " selected" : ""}>${esc(c)}</option>`).join("");
function openEditSheet(ids) {
  edState = "sheet"; crosshair.hidden = true; edSel = ids[0];
  const o = shopInfo(edSel); if (!o) return;
  const sh = edEl("ed-sheet"); sh.hidden = false;
  sh.innerHTML = (ids.length > 1 ? `<div class="ed-h">이 위치에 가게 ${ids.length}곳 · 고칠 가게를 고르세요</div><select id="ed-pick">${ids.map(i => `<option value="${esc(i)}">${esc((shopInfo(i) || {}).name || i)}</option>`).join("")}</select>` : "") +
    `<input id="ed-name" value="${esc(o.name)}" maxlength="40"><select id="ed-cat">${edOpts(o.category)}</select>` +
    `<div class="ed-r"><button id="ed-save" class="ok">저장</button><button id="ed-move">위치 옮기기</button></div>` +
    `<div class="ed-r"><button id="ed-gone" class="${o.hidden ? "ok" : "red"}">${o.hidden ? "되살리기" : "없어진 가게(숨기기)"}</button><button id="ed-x" class="g">닫기</button></div>`;
  if (ids.length > 1) edEl("ed-pick").onchange = e => openEditSheet([e.target.value].concat(ids.filter(i => i !== e.target.value)));
  edEl("ed-x").onclick = edClose;
  edEl("ed-save").onclick = () => edSave(edSel, { name: edEl("ed-name").value.trim() || o.name, category: edEl("ed-cat").value }, "저장됨");
  edEl("ed-gone").onclick = () => edSave(edSel, { hidden: !o.hidden }, o.hidden ? "되살렸어요" : "숨겼어요 (지도에서 사라져요)");
  edEl("ed-move").onclick = () => {
    edState = "move"; crosshair.hidden = false; const id = edSel;
    map.flyTo({ center: o.coord, zoom: Math.max(map.getZoom(), 18), duration: 600 });
    edEl("ed-sheet").innerHTML = `<b>${esc(o.name)}</b><div>지도를 움직여 📍 끝을 새 위치에 맞춘 뒤 <b>여기로 이동</b>을 누르세요</div><div class="ed-r"><button id="ed-here" class="ok">여기로 이동</button><button id="ed-x2" class="g">취소</button></div>`;
    edEl("ed-x2").onclick = edClose;
    edEl("ed-here").onclick = () => { const c = map.getCenter(); edSave(id, { coord: [c.lng, c.lat] }, "위치를 옮겼어요"); };
  };
}
function edAddNew() {
  edState = "add"; crosshair.hidden = false; const sh = edEl("ed-sheet"); sh.hidden = false;
  sh.innerHTML = `<b>새 가게 추가</b><div>지도를 움직여 📍 끝을 가게 위치에 맞추세요</div><input id="ed-nn" placeholder="가게 이름" maxlength="40"><select id="ed-nc">${edOpts("음식점")}</select><div class="ed-r"><button id="ed-do" class="ok">여기에 추가</button><button id="ed-x3" class="g">취소</button></div>`;
  edEl("ed-x3").onclick = edClose;
  edEl("ed-do").onclick = () => { const nm = edEl("ed-nn").value.trim(); if (!nm) { edToast("가게 이름을 써 주세요"); return; } const c = map.getCenter();
    edSave("n-" + Date.now(), { name: nm, category: edEl("ed-nc").value, coord: [c.lng, c.lat], isNew: true, hidden: false }, "추가했어요"); };
}
function setEditMode(on) {
  editMode = !!on; document.body.classList.toggle("editing", editMode);
  edEl("edit-btn").classList.toggle("on", editMode); edEl("edit-btn").textContent = editMode ? "✏️ 편집 끝내기" : "✏️ 편집";
  edEl("ed-bar").hidden = !editMode; if (!editMode) { edClose(); editShowHidden = false; edEl("ed-hid").classList.remove("on"); }
  if (map.getSource("shops")) edRefresh();
}
(async function adminInit() {
  try {
    if (!window.supabase || LIVE || IS_LOCAL) return;
    sbAdmin = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data } = await sbAdmin.auth.getSession();
    const u = data && data.session && data.session.user;
    if (!u || u.email !== ADMIN_EMAIL) return;             // 관리자가 아니면 편집 버튼 자체가 안 보임 (서버에서도 막힘)
    edEl("edit-btn").hidden = false;
    { const bb = document.getElementById("bell-btn"); if (bb && bb.parentElement) bb.parentElement.hidden = true; }   // 관리자 폰은 admin.html에서 알림 관리
    edEl("edit-btn").onclick = () => setEditMode(!editMode);
    edEl("ed-add").onclick = edAddNew;
    edEl("ed-hid").onclick = () => { editShowHidden = !editShowHidden; edEl("ed-hid").classList.toggle("on", editShowHidden); if (map.getSource("shops")) edRefresh(); };
    edEl("ed-end").onclick = () => setEditMode(false);
    const focusId = new URLSearchParams(location.search).get("shop");
    if (focusId) { let tries = 0; const tryOpen = () => { const s = shopInfo(focusId); if (!s) { if (++tries < 15) setTimeout(tryOpen, 800); return; } setEditMode(true); map.flyTo({ center: s.coord, zoom: 18, duration: 800 }); setTimeout(() => openEditSheet([focusId]), 900); }; setTimeout(tryOpen, 1500); return; }
    if (/[?&]edit=1/.test(location.search)) { const go = () => setEditMode(true); if (map.getSource("shops")) go(); else map.once("idle", go); }
  } catch (e) {}
})();


// ===== 헤더 필터 접기 =====
(function () {
  const b = document.getElementById("filter-btn"), f = document.getElementById("filters");
  b.onclick = () => toolsToggle();   // 👀 골라보기 = 상단 서랍 열기/닫기 (서랍 안에 종류별 칩이 같이 펼쳐진다)
})();

// ===== 공지사항 띠 (긴급=빨강, 일반=파랑 / 관리자 "공지" 탭에서 등록) =====
let NOTICES = [];
async function fetchNotices() {
  try {
    const now = new Date().toISOString();
    const res = await fetch(SUPABASE_URL + "/rest/v1/notices?select=*&expires_at=gt." + encodeURIComponent(now) + "&order=created_at.desc", { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } });
    if (!res.ok) return false;                       // 표가 아직 없으면 조용히 무시
    NOTICES = await res.json(); renderTicker(); return true;
  } catch (e) { return false; }
}
function renderTicker() {
  const t = document.getElementById("ticker"), inn = document.getElementById("tk-in");
  const list = NOTICES.slice().sort((x, y) => (y.level === "urgent") - (x.level === "urgent"));
  if (!list.length) { t.hidden = true; document.body.classList.remove("has-notice"); return; }
  const txt = list.map(n => (n.level === "urgent" ? "🚨 긴급  " : "📢 ") + n.body).join("      ·      ");
  if (inn.textContent !== txt) { inn.textContent = txt; inn.style.animationDuration = Math.max(14, txt.length * 0.3) + "s"; }
  t.classList.toggle("urgent", list.some(n => n.level === "urgent"));
  t.hidden = false; document.body.classList.add("has-notice");
}
document.getElementById("ticker").onclick = () => {
  const m = document.getElementById("notice-modal");
  m.innerHTML = '<div class="nm">' + NOTICES.slice().sort((x, y) => (y.level === "urgent") - (x.level === "urgent")).map(n => `<p class="${n.level === "urgent" ? "u" : ""}">${n.level === "urgent" ? "🚨 " : "📢 "}${esc(n.body)}</p>`).join("") + '<button id="nm-x">닫기</button></div>';
  m.hidden = false; document.getElementById("nm-x").onclick = () => m.hidden = true;
};
fetchNotices(); setInterval(fetchNotices, 60000);


// ===== 처음 방문 안내 (4단계, 한 번 보면 다시 안 뜸 / ❓ 로 다시 보기) =====
(function () {
  const tut = document.getElementById("tut"), hole = document.getElementById("tut-hole"), tip = document.getElementById("tut-tip");
  const txt = document.getElementById("tut-txt"), nEl = document.getElementById("tut-n");
  const center = () => ({ x: innerWidth / 2 - 60, y: innerHeight * 0.5 - 60, w: 120, h: 120 });
  const rectOf = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const STEPS = [
    { t: "어서 와! 👋<br>정읍에서 지금 무슨 일이 있는지 한눈에 볼 수 있어.", r: () => rectOf("top") },
    { t: "이 점을 눌러봐. 가게 정보나 누가 올린 소식이 떠.", r: center },
    { t: "여기 <b>제보</b>를 누르면 지금 올라온 소식 목록이 쭉 나와. 하나 누르면 그 위치로 날아가!", r: () => rectOf("feed-btn") },
    { t: "길 막히거나 웨이팅 길면 이걸 눌러서 알려줘.", r: () => rectOf("fab") },
    { t: "제보할 땐 지도를 <b>손으로 움직여서</b> 📍 핀 끝을 일어난 장소에 딱 맞춘 다음 등록하면 돼!", r: center },
    { t: "이웃 이야기는 💬 커뮤니티, 보고 싶은 정보만 고르려면 👀 골라보기를 눌러봐.", r: () => { const a = rectOf("comm-btn"), b = rectOf("filter-btn"); const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; } },
  ];
  let i = 0;
  function show() {
    const s = STEPS[i], r = s.r(), p = 6;
    Object.assign(hole.style, { left: r.x - p + "px", top: r.y - p + "px", width: r.w + p * 2 + "px", height: r.h + p * 2 + "px" });
    txt.innerHTML = s.t; nEl.textContent = (i + 1) + " / " + STEPS.length;
    document.getElementById("tut-next").textContent = i === STEPS.length - 1 ? "시작하기" : "다음";
    const below = r.y + r.h / 2 < innerHeight / 2;
    tip.style.top = below ? Math.min(r.y + r.h + p + 14, innerHeight - 190) + "px" : "auto";
    tip.style.bottom = below ? "auto" : innerHeight - r.y + p + 14 + "px";
  }
  function end() { tut.hidden = true; try { localStorage.setItem("tut_done", "1"); } catch (e) {} }
  function start() { i = 0; tut.hidden = false; show(); }
  document.getElementById("tut-next").onclick = () => { if (++i >= STEPS.length) end(); else show(); };
  document.getElementById("tut-skip").onclick = end;
  document.getElementById("help-btn").onclick = start;
  addEventListener("resize", () => { if (!tut.hidden) show(); });
  let done = false; try { done = localStorage.getItem("tut_done") === "1"; } catch (e) {}
  if (!done && !LIVE && !/[?&]edit=1/.test(location.search)) setTimeout(start, 1800);
})();


// ===== 제보 사진 첨부 (폰에서 1280px로 줄여 올림) =====
let photoBlob = null;
function clearPhoto() { photoBlob = null; const p = document.getElementById("photo-prev"); p.hidden = true; p.removeAttribute("src"); document.getElementById("photo").value = ""; document.getElementById("photo-btn").textContent = "📷 사진 첨부 (선택)"; }
document.getElementById("photo-btn").onclick = () => document.getElementById("photo").click();
document.getElementById("photo").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const bmp = await createImageBitmap(f), k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    photoBlob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.7));
    const p = document.getElementById("photo-prev"); p.src = URL.createObjectURL(photoBlob); p.hidden = false;
    document.getElementById("photo-btn").textContent = "📷 사진 바꾸기";
  } catch (err) { alert("사진을 불러오지 못했어요. 다른 사진으로 해 보세요."); clearPhoto(); }
};


// ===== 오늘의 맛집 TOP 3 (하루 한 표 / 한국시간 자정 초기화) =====
const kstDay = (off = 0) => new Date(Date.now() + 9 * 3600e3 + off * 864e5).toISOString().slice(0, 10);
function voterId() { try { let v = localStorage.getItem("voter_id"); if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)); localStorage.setItem("voter_id", v); } return v; } catch (e) { return "anon-" + Math.random().toString(36).slice(2, 12); } }
const foodRpc = d => fetch(SUPABASE_URL + "/rest/v1/rpc/food_top", { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ d }) }).then(r => r.ok ? r.json() : null).catch(() => null);
function myVote() { try { const v = JSON.parse(localStorage.getItem("food_vote") || "null"); return v && v.day === kstDay() ? v : null; } catch (e) { return null; } }
async function loadFood() {
  const list = document.getElementById("food-list"); if (!list) return;
  const [today, yday] = await Promise.all([foodRpc(kstDay()), foodRpc(kstDay(-1))]);
  if (!document.getElementById("food-list")) return;
  const medal = ["🥇", "🥈", "🥉"];
  const tot = today ? today.reduce((a, r) => a + (+r.cnt || 0), 0) : 0, top = today && today.length ? Math.max(...today.map(r => +r.cnt || 0)) || 1 : 1;
  const ft = document.getElementById("food-total"); if (ft) ft.textContent = tot ? "총 " + tot + "표" : "";
  list.innerHTML = !today ? "<small>투표 준비 중이에요</small>" : today.length ? today.slice(0, 3).map((r, i) => { const p = tot ? Math.round(r.cnt / tot * 100) : 0; return `<div class="food-row r${i + 1}" data-id="${esc(r.shop_id)}"><div class="food-line"><span class="food-rank">${i + 1}</span><b>${esc(r.shop_name)}</b>${yday && yday.length && String(yday[0].shop_id) === String(r.shop_id) ? '<span class="yd-badge">어제 1등</span>' : ""}<span class="food-cnt">${r.cnt}표 · ${p}%</span></div><div class="food-bar"><i data-s="${(r.cnt / top).toFixed(3)}"></i></div></div>`; }).join("") : "<small>아직 투표가 없어요. 첫 표를 남겨 보세요!</small>";
  requestAnimationFrame(() => requestAnimationFrame(() => list.querySelectorAll(".food-bar i").forEach(el => { el.style.transform = "scaleX(" + el.dataset.s + ")"; })));
  list.querySelectorAll(".food-row").forEach(el => el.onclick = () => { const s = shopInfo(el.dataset.id); if (!s) return; closeComm(); foodSheet.set(false); map.flyTo({ center: s.coord, zoom: 18, pitch: 55, duration: 1500 }); });
  const y = document.getElementById("food-yday"); if (y) y.innerHTML = yday && yday.length ? `<span class="yday">👑 어제의 1위 <b>${esc(yday[0].shop_name)}</b> · ${yday[0].cnt}표</span>` : "";
  foodTop = today && today.length ? today[0] : null; foodDay = kstDay(); foodClock();
  const btn = document.getElementById("food-vote"), mv = myVote();
  if (mv) { btn.textContent = "✔ 투표 완료 · " + mv.name + " (내일 0시에 새로 시작)"; btn.disabled = true; } else { btn.textContent = "투표하기"; btn.disabled = false; btn.onclick = openFoodVote; }
  foodSheet.refit();
}
function openFoodVote() {
  const m = document.getElementById("notice-modal");
  m.innerHTML = '<div class="nm"><b>오늘 제일 맛있게 먹은 식당은?</b><input id="fv-q" placeholder="식당 이름 검색" style="width:100%;padding:10px;margin:8px 0;font-size:16px;border:1px solid #ccc;border-radius:8px"><div id="fv-res"></div><button id="nm-x">닫기</button></div>';
  m.hidden = false; document.getElementById("nm-x").onclick = () => m.hidden = true;
  const q = document.getElementById("fv-q"), res = document.getElementById("fv-res");
  const pool = SHOPS.concat((EDITS && EDITS.added) || []).map(s => shopInfo(s.id)).filter(s => s && !s.hidden && /음식점/.test(s.category || ""));
  const draw = () => {
    const t = q.value.trim().replace(/\s/g, ""); res.innerHTML = "";
    if (!t) { res.innerHTML = "<small>가게 이름을 입력하면 후보가 나와요</small>"; return; }
    for (const s of pool.filter(s => s.name.replace(/\s/g, "").includes(t)).slice(0, 8)) {
      const b = document.createElement("button"); b.className = "fv-item"; b.textContent = s.name;
      b.onclick = async () => {
        if (!confirm(`오늘의 맛집으로 "${s.name}"에 투표할까요? (하루 한 번만 가능해요)`)) return;
        const r = await fetch(SUPABASE_URL + "/rest/v1/food_votes", { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ day: kstDay(), voter: voterId(), shop_id: s.id, shop_name: s.name }) });
        if (r.ok || r.status === 409) { try { localStorage.setItem("food_vote", JSON.stringify({ day: kstDay(), name: s.name })); } catch (e) {} m.hidden = true; loadFood(); alert(r.ok ? "투표 완료! 내일 또 만나요 🍚" : "오늘은 이미 투표하셨어요"); }
        else alert("투표에 실패했어요. 잠시 뒤 다시 해 주세요.");
      };
      res.appendChild(b);
    }
    if (!res.children.length) res.innerHTML = "<small>검색 결과가 없어요</small>";
  };
  q.oninput = draw; draw(); q.focus();
}


// ===== 👍/👎 반응 (한 사람당 하나, 다시 누르면 취소) + "정보가 틀렸어요" 수정 요청 =====
const rxMine = () => { try { return JSON.parse(localStorage.getItem("rx") || "{}"); } catch (e) { return {}; } };
const rxSave = o => { try { localStorage.setItem("rx", JSON.stringify(o)); } catch (e) {} };
const rxHdr = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" };
function rxHtml(type, id) { return `<span class="rx" data-t="${type}" data-id="${esc(id)}"><button class="rx-b" data-v="1">👍 맞아요 <i>0</i></button><button class="rx-b" data-v="-1">👎 글쎄요 <i>0</i></button></span>`; }
async function hydrateRx(root) {
  const els = [...root.querySelectorAll(".rx")]; if (!els.length) return;
  const mine = rxMine();
  els.forEach(el => el.querySelectorAll(".rx-b").forEach(b => b.classList.toggle("mine", mine[el.dataset.t + ":" + el.dataset.id] === +b.dataset.v)));
  for (const t of ["shop", "report"]) {
    const ids = [...new Set(els.filter(e => e.dataset.t === t).map(e => e.dataset.id))]; if (!ids.length) continue;
    try {
      const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/reaction_counts", { method: "POST", headers: rxHdr, body: JSON.stringify({ p_type: t, p_ids: ids }) });
      if (!r.ok) continue;
      const map_ = {}; (await r.json()).forEach(x => map_[x.item_id] = x);
      els.filter(e => e.dataset.t === t).forEach(e => { const c = map_[e.dataset.id] || { up: 0, down: 0 }; const i = e.querySelectorAll("i"); i[0].textContent = c.up; i[1].textContent = c.down; });
    } catch (e) {}
  }
}
document.addEventListener("click", async e => {
  const b = e.target.closest(".rx-b");
  if (b) {
    const el = b.closest(".rx"), key = el.dataset.t + ":" + el.dataset.id, mine = rxMine(), v = +b.dataset.v, cur = mine[key] || 0, nv = cur === v ? 0 : v;
    const i = el.querySelectorAll("i");
    if (cur) i[cur === 1 ? 0 : 1].textContent = Math.max(0, +i[cur === 1 ? 0 : 1].textContent - 1);
    if (nv) i[nv === 1 ? 0 : 1].textContent = +i[nv === 1 ? 0 : 1].textContent + 1;
    if (nv) mine[key] = nv; else delete mine[key]; rxSave(mine);
    el.querySelectorAll(".rx-b").forEach(x => x.classList.toggle("mine", +x.dataset.v === nv));
    try { await fetch(SUPABASE_URL + "/rest/v1/rpc/react", { method: "POST", headers: rxHdr, body: JSON.stringify({ p_type: el.dataset.t, p_id: el.dataset.id, p_voter: voterId(), p_val: nv }) }); } catch (err) {}
    return;
  }
  const f = e.target.closest(".fix-btn");
  if (f) openFix(f.dataset.id, f.dataset.name);
});
function openFix(id, name) {
  const m = document.getElementById("notice-modal");
  m.innerHTML = `<div class="nm"><b>${esc(name)}</b><div style="margin:6px 0;color:#555;font-size:14px">어떤 점이 틀렸나요?</div>
    <select id="fx-kind" style="width:100%;padding:10px;font-size:16px;margin-bottom:8px;background:#fff;color:#222"><option>가게 이름이 틀려요</option><option>위치가 틀려요</option><option>없어진 가게예요</option><option>그 밖에 틀려요</option></select>
    <input id="fx-note" maxlength="100" placeholder="올바른 이름·내용 (선택)" style="width:100%;padding:10px;font-size:16px;border:1px solid #ccc;border-radius:8px;margin-bottom:10px;background:#fff;color:#222">
    <div style="display:flex;gap:8px"><button id="nm-x" style="flex:1">닫기</button><button id="fx-send" style="flex:2;background:#1f6feb">보내기</button></div></div>`;
  m.hidden = false; document.getElementById("nm-x").onclick = () => m.hidden = true;
  document.getElementById("fx-send").onclick = async () => {
    const r = await fetch(SUPABASE_URL + "/rest/v1/shop_corrections", { method: "POST", headers: { ...rxHdr, Prefer: "return=minimal" },
      body: JSON.stringify({ shop_id: id, shop_name: name, kind: document.getElementById("fx-kind").value, note: document.getElementById("fx-note").value.trim() || null }) });
    m.hidden = true; alert(r.ok ? "알려주셔서 고마워요! 확인 후 고칠게요 🙏" : "보내지 못했어요. 잠시 뒤 다시 해 주세요.");
  };
}


// ===== 뒤로가기: 열린 화면이 있으면 그것만 닫고, 지도만 보이면 "한 번 더 누르면 종료" (v64) =====
(function backNav() {
  if (LIVE) return;
  let armed = false, timer = null;
  const toast = document.createElement("div"); toast.id = "exit-toast"; toast.hidden = true; toast.textContent = "두 번 터치 시 앱이 종료됩니다";
  document.body.appendChild(toast);
  const vis = id => { const e = document.getElementById(id); return e && !e.hidden; };
  function closeTop() {
    try {
      if (vis("tut")) { document.getElementById("tut-skip").click(); return true; }
      if (vis("notice-modal")) { document.getElementById("notice-modal").hidden = true; return true; }
      if (vis("ed-sheet")) { edClose(); return true; }
      if (!commEl.hidden) { closeComm(); return true; }
      if (foodSheet.isOpen()) { foodSheet.set(false); return true; }
      if (rpStep !== "none" || !panel.hidden) { closePanel(); return true; }
      if (document.body.classList.contains("tools-open")) { toolsClose(); return true; }
      if (vis("feed")) { document.getElementById("feed").hidden = true; return true; }
      if (document.body.classList.contains("searching") || !resEl.hidden) { resEl.hidden = true; qEl.blur(); return true; }
      if (document.querySelector(".maplibregl-popup")) { closePopups(); return true; }
      if (vis("filters")) { document.getElementById("filter-btn").click(); return true; }
    } catch (e) {}
    return false;
  }
  // 크롬은 사용자 조작(손가락을 뗄 때 pointerup/click) 없이 쌓은 기록은 뒤로가기 때 건너뛴다 → 첫 터치를 뗄 때 쌓는다
  let armedInit = false;
  function initHistory() {
    if (armedInit) return; armedInit = true;
    ["pointerup", "touchend", "click", "keydown"].forEach(t => removeEventListener(t, initHistory, true));
    try { history.pushState({ jg: 1 }, ""); jgReady = true; } catch (e) {}
  }
  try { history.replaceState({ jg: 0 }, ""); } catch (e) { return; }
  ["pointerup", "touchend", "click", "keydown"].forEach(t => addEventListener(t, initHistory, { capture: true, passive: true }));
  addEventListener("popstate", () => {
    if (ignorePop) { ignorePop = false; return; }
    if (!armedInit) return;
    if (commPushed && !commEl.hidden) { commPushed = false; closeComm(true); return; }   // 커뮤니티 기록 한 칸 소비
    if (closeTop()) { history.pushState({ jg: 1 }, ""); return; }
    if (armed) { armed = false; clearTimeout(timer); toast.hidden = true; history.back(); return; }   // 두 번째: 종료
    armed = true; toast.hidden = false;
    timer = setTimeout(() => { armed = false; toast.hidden = true; }, 2000);
    history.pushState({ jg: 1 }, "");
  });
})();


// ===== 로딩 시간 확인용: 주소 끝에 ?debug=1 을 붙이면 화면 왼쪽 아래에 단계별 시간(ms)이 보인다 =====
if (new URLSearchParams(location.search).get("debug") === "1") {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:6px;bottom:24px;z-index:99;background:rgba(0,0,0,.75);color:#fff;font:12px/1.5 monospace;padding:6px 10px;border-radius:8px;pointer-events:none";
  document.body.appendChild(box);
  const tick = () => { box.textContent = Object.entries(TM).map(([k, v]) => k + " " + v).join("\n"); box.style.whiteSpace = "pre"; };
  setInterval(tick, 500);
}


// ===== 상단 도구 서랍: 손잡이를 아래로 끌거나 누르면 도구가 여러 줄로 펼쳐져 글자까지 보인다 =====
let toolsClose = () => {}, toolsToggle = () => {};
(function toolsDrawer() {
  const g = document.getElementById("tools-grab"), tx = document.getElementById("tools-grab-t"); if (!g || LIVE) return;
  const top = document.getElementById("top"), body = document.body, fb = document.getElementById("filter-btn");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let state = false, timer = 0;                       // state: 논리적 열림 여부 (애니메이션 중에도 즉시 바뀐다)
  const isOpen = () => state;
  const settle = () => {                              // 진행 중인 애니메이션을 바로 끝낸다
    clearTimeout(timer); timer = 0;
    top.style.height = ""; top.style.overflow = ""; top.style.transition = "";
    body.classList.remove("tools-closing"); body.classList.toggle("tools-open", state);
  };
  const set = on => {
    on = !!on; if (on === state) return;
    settle(); state = on; sfx(on ? "open" : "close");
    g.setAttribute("aria-expanded", on ? "true" : "false"); tx.textContent = on ? "접기 ▴" : "더 보기 ▾";
    if (fb) fb.textContent = on ? "👀 골라보기 ▴" : "👀 골라보기 ▾";
    if (calm) { body.classList.toggle("tools-open", on); return; }
    const h0 = top.getBoundingClientRect().height;
    let h1;
    if (on) {                                         // 열기: 펼친 모양으로 바꾼 뒤 높이를 0.3초 동안 늘린다 (내용은 서서히 나타남)
      body.classList.add("tools-open");
      top.style.height = "auto"; h1 = top.getBoundingClientRect().height;
    } else {                                          // 닫기: 내용을 서서히 지우며 높이를 줄인 뒤, 끝에서 접힌 모양으로 바꾼다
      body.classList.remove("tools-open"); top.style.height = "auto"; h1 = top.getBoundingClientRect().height; body.classList.add("tools-open");
      body.classList.add("tools-closing");
    }
    top.style.height = h0 + "px"; top.style.overflow = "hidden"; void top.offsetHeight;
    top.style.transition = "height .3s ease"; top.style.height = h1 + "px";
    timer = setTimeout(settle, 320);
  };
  toolsClose = () => set(false); toolsToggle = () => set(!isOpen());
  let y0 = null;
  g.addEventListener("touchstart", e => { y0 = e.touches[0].clientY; }, { passive: true });
  g.addEventListener("touchend", e => {
    if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null;
    if (dy > 18) { set(true); e.preventDefault(); } else if (dy < -18) { set(false); e.preventDefault(); }   // 쓸어내리기=열기, 쓸어올리기=닫기 (짧게 누르면 아래 click 이 처리)
  }, { passive: false });
  g.addEventListener("click", () => set(!isOpen()));
  g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set(!isOpen()); } });
  document.addEventListener("pointerdown", e => { if (isOpen() && !(e.target.closest && e.target.closest("#top"))) set(false); }, true);   // 지도를 누르면 닫힘
})();


// ===== 🍚 오늘의 맛집 바텀시트 (아래에서 슬라이드로 올라옴 · 손가락을 따라 움직임) =====
const foodSheet = (function () {
  const el = document.createElement("div"); el.id = "food-sheet";
  el.innerHTML = `<div id="fs-head"><i class="fs-grab"></i><div id="fs-sum">🍚 오늘의 맛집 · 불러오는 중…</div><span id="fs-hint">▴ 더보기</span></div>` +
    `<div id="fs-body"><div class="food-hd"><b>🍚 오늘의 맛집 TOP 3</b><span id="food-total"></span></div><div id="food-clock"></div><div id="food-list">불러오는 중…</div>` +
    `<button id="food-vote" class="chip">투표하기</button><button id="food-roulette" class="chip" disabled>🎰 오늘 뭐 먹지? · 곧 열려요</button><div id="food-yday"></div></div>`;
  document.body.appendChild(el);
  const head = el.querySelector("#fs-head");
  let open = false, dragging = false, y0 = 0, off0 = 0, curOff = 0, moved = 0, t0 = 0;
  const peek = () => head.offsetHeight;
  const closedOff = () => Math.max(0, el.offsetHeight - peek());
  function apply(off, anim) { el.style.transition = anim ? "transform .3s cubic-bezier(.22,.8,.3,1)" : "none"; el.style.transform = "translateY(" + off + "px)"; curOff = off; }
  function set(v) { open = !!v; el.classList.toggle("open", open); const hn = document.getElementById("fs-hint"); if (hn) hn.textContent = open ? "▾ 접기" : "▴ 더보기"; apply(open ? 0 : closedOff(), true); if (open) { sfx("open"); if (typeof loadFood === "function") loadFood(); } else if (v === false) sfx("close"); }
  head.addEventListener("touchstart", e => { if (e.touches.length !== 1) return; dragging = true; moved = 0; y0 = e.touches[0].clientY; t0 = Date.now(); off0 = open ? 0 : closedOff(); apply(off0, false); }, { passive: true });
  head.addEventListener("touchmove", e => { if (!dragging) return; const dy = e.touches[0].clientY - y0; moved = Math.max(moved, Math.abs(dy)); apply(Math.min(closedOff(), Math.max(0, off0 + dy)), false); }, { passive: true });
  const end = () => { if (!dragging) return; dragging = false; if (moved < 6) return;
    const v = (curOff - off0) / Math.max(1, Date.now() - t0);                      // 아래로 빠르게 쓸면 +, 위로 빠르게 쓸면 -
    set(Math.abs(v) > 0.4 ? v < 0 : curOff < closedOff() / 2); ignoreClick = true; setTimeout(() => ignoreClick = false, 50); };
  let ignoreClick = false;
  head.addEventListener("touchend", end); head.addEventListener("touchcancel", end);
  head.addEventListener("click", () => { if (ignoreClick) return; set(!open); });
  // 지도를 누르면 접힘
  const hookMap = () => { if (typeof map === "undefined" || !map.on) return setTimeout(hookMap, 300); map.on("mousedown", () => { if (open) set(false); }); map.on("touchstart", () => { if (open) set(false); }); };
  hookMap();
  // 다른 창(제보창·커뮤니티·편집 등)이 열려 있으면 시트를 숨김
  setInterval(() => {
    const busy = !panel.hidden || rpStep !== "none" || !commEl.hidden || ["ed-sheet", "tut", "notice-modal"].some(id => { const e = document.getElementById(id); return e && !e.hidden; });
    el.classList.toggle("away", busy); document.body.classList.toggle("sheet-away", busy);
    if (busy && open) set(false);
  }, 300);
  addEventListener("resize", () => { if (!dragging) apply(open ? 0 : closedOff(), false); });
  requestAnimationFrame(() => apply(closedOff(), false));
  return { set, isOpen: () => open, summary(t) { const e = document.getElementById("fs-sum"); if (e) e.innerHTML = t; }, refit() { if (!open && !dragging) apply(closedOff(), false); } };
})();
// 집계 시간: 한국시간 0시~24시. 남은 시간은 폰 시계로만 계산(서버 요청 없음), 순위는 화면이 켜져 있을 때만 1분마다 새로 불러옴
let foodTop = null, foodDay = "";
function foodLeft() { const ms = 864e5 - ((Date.now() + 9 * 3600e3) % 864e5), m = Math.max(1, Math.ceil(ms / 60000)), h = Math.floor(m / 60); return h ? h + "시간 " + (m % 60) + "분" : m + "분"; }
function foodClock() {
  const left = foodLeft(), c = document.getElementById("food-clock");
  if (c) c.innerHTML = `🕛 오늘 0시~24시 집계 · <b>${left}</b> 후 마감`;
  foodSheet.summary(foodTop ? `🍚 <b>🥇 ${esc(foodTop.shop_name)}</b> ${foodTop.cnt}표 · ⏰ ${left} 남음` : `🍚 오늘의 맛집 · 첫 표를 남겨 보세요 · ⏰ ${left}`);
}
loadFood();
setInterval(() => { if (document.hidden) return; if (kstDay() !== foodDay) loadFood(); else { foodClock(); loadFood(); } }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadFood(); });
