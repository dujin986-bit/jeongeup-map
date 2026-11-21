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
let pastReports = [];            // 최근 7일 안에 마감된 제보 (종류 게시판의 "지난 소식")
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
    sfx(activeCats.has(key) ? "on" : "off");
    render();
  };
  filtersEl.appendChild(b);
  const pb = document.createElement("button");
  pb.className = "pill"; pb.dataset.k = key; pb.textContent = c.icon + " " + c.label;
  pb.onclick = () => { sfx("on"); (activeCats.size === 1 && activeCats.has(key)) ? resetCats() : setOnlyCat(key, true); };
  document.getElementById("pills").appendChild(pb);
  catSel.add(new Option(c.icon + " " + c.label, key));
}
function syncCatUI() {
  const keys = Object.keys(CATEGORIES), all = activeCats.size === keys.length;
  [...filtersEl.querySelectorAll(".cat-chip")].forEach((b, i) => b.classList.toggle("on", activeCats.has(keys[i])));
  document.querySelectorAll("#pills .pill").forEach(b => b.classList.toggle("on", !all && activeCats.size === 1 && activeCats.has(b.dataset.k)));
  const bn = document.getElementById("cat-banner"); if (!bn) return;
  bn.hidden = all;
  if (!all) bn.firstChild.textContent = activeCats.size === 1 ? CATEGORIES[[...activeCats][0]].icon + " " + CATEGORIES[[...activeCats][0]].label + "만 보는 중 · " : "일부만 보는 중 · ";
}
document.getElementById("cat-banner").onclick = () => { sfx("off"); resetCats(); };
function resetCats() { activeCats = new Set(Object.keys(CATEGORIES)); render(); }
let showOffices = true;
// (관공서 필터 칩은 v84에서 제거. 관공서 배지는 항상 표시)
if (!IS_LOCAL) { catSel.add(new Option("🛠 가게 정보 수정", "__fix")); catSel.add(new Option("➕ 없는 가게 알려주기", "__newshop")); }

// ---------- 마커 ----------
function addMarker(item, isLandmark) {
  const c = CATEGORIES[item.cat];
  const el = document.createElement("div");
  el.className = "pin";
  el.style.background = c.color;
  el.textContent = c.icon;                // 카테고리 이모지를 핀으로
  if (isLandmark) el.style.outline = "2px solid #fff";
  const when = item.ts ? `<div class="pop-time">${timeAgo(item.ts)}</div>` : "";
  const popup = new maplibregl.Popup({ offset: 20 }).setHTML(
    `<div class="pop-cat" style="background:${c.color};color:${c.fg || "#fff"}">${c.icon} ${c.label}</div><div class="pop-title">${esc(item.name || item.title)}</div>${item.desc ? `<div class="pop-desc">${esc(item.desc)}</div>` : ""}${when}` + (item.photo ? `<a href="${esc(item.photo)}" target="_blank" rel="noopener"><img class="pop-photo" src="${esc(item.photo)}" loading="lazy"></a>` : "") + navLinks(item.name || item.title, item.coord[0], item.coord[1]) + (item.id && item.ts ? `<div class="shop-act">${rxHtml("report", item.id)}<button class="chip share-r">🔗 공유</button></div>` : "")
  );
  popup.on("open", () => { hydrateRx(popup.getElement()); popup.getElement().querySelectorAll(".share-r").forEach(b => b.onclick = () => shareReport(item)); });
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
// ---------- 제보 공유 (?r=제보번호) : 카톡 등으로 보내면 받은 사람이 열자마자 그 제보 위치로 이동 ----------
const SHARED_R = new URLSearchParams(location.search).get("r");
let sharedDone = false;
function shareToast(t) { let el = document.getElementById("share-toast"); if (!el) { el = document.createElement("div"); el.id = "share-toast"; document.body.appendChild(el); } el.textContent = t; el.classList.add("on"); clearTimeout(shareToast.t); shareToast.t = setTimeout(() => el.classList.remove("on"), 2600); }
async function shareReport(r) {
  const url = location.origin + location.pathname + "?r=" + encodeURIComponent(r.id), c = CATEGORIES[r.cat] || {};
  const text = `📍 ${r.title || r.name}${c.label ? " (" + c.icon + " " + c.label + ")" : ""} · 정읍 지금`;
  try { if (navigator.share) { await navigator.share({ title: "정읍 지금", text, url }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text + "\n" + url); shareToast("링크를 복사했어요! 카톡에 붙여넣기 하세요"); } catch (e) { prompt("이 링크를 복사해서 보내세요", url); }
}
function openShared() {
  if (!SHARED_R || sharedDone) return; sharedDone = true;
  const r = reports.find(x => String(x.id) === String(SHARED_R));
  if (r) { setTimeout(() => focusReport(r, 1800), 900); try { history.replaceState(null, "", location.pathname); } catch (e) {} }
  else shareToast("공유된 제보가 이미 끝났거나 찾을 수 없어요");
}
function esc(s) { return String(s).replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch])); }

function render() {
  if (typeof syncCatUI === "function") try { syncCatUI(); } catch (e) {}
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
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const brandOf = r => r.brand_color ? { color: r.brand_color, name: r.brand_name || "", link: r.brand_link || "", from: r.brand_from || "", until: r.brand_until || "" } : null;
const brandActive = b => { const t = kstToday(); return !!(b && b.color && (!b.from || b.from <= t) && (!b.until || b.until >= t)); };   // 노출 기간 안일 때만 간판 표시
const safeLink = u => /^https?:\/\//i.test(u || "") ? u : "";
function mergeRemote() {                // 파일 수정 위에 관리자 화면(Supabase)의 수정을 덮어씀
  const E = { edits: { ...(EDITS_FILE.edits || {}) }, added: [...(EDITS_FILE.added || [])] };
  for (const r of REMOTE_ROWS) {
    if (r.is_new) {
      E.added = E.added.filter(s => s.id !== r.id);
      E.added.push({ id: r.id, name: r.name, category: r.category || "기타", address: "", coord: [r.lon, r.lat] });
      E.edits[r.id] = { ...(E.edits[r.id] || {}), hidden: !!r.hidden, brand: brandOf(r) };
    } else {
      const e = { ...(E.edits[r.id] || {}), hidden: !!r.hidden, brand: brandOf(r) };
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
    const b = e.brand, bOn = brandActive(b);
    if (!editMode && !bOn) {
      if (!isFoodCafe(cat)) continue;
      const k = (e.name || s.name) + "|" + (s.address || "") + "|" + co[0].toFixed(4) + "," + co[1].toFixed(4);
      if (seen.has(k)) continue; seen.add(k);
    }
    out.push({ type: "Feature", geometry: { type: "Point", coordinates: co },
      properties: { id: s.id, name: (e.name || s.name) + (e.hidden ? " (숨김)" : ""), category: cat, address: s.address, lon: co[0], lat: co[1],
                    color: e.hidden ? "#bbbbbb" : shopColor(cat),
                    brand: bOn ? 1 : 0, bcolor: bOn ? b.color : "", bink: bOn ? brandInk(b.color) : "#fff", bname: bOn ? (b.name || e.name || s.name) : "", blink: bOn ? safeLink(b.link) : "" } });
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
    map.addLayer({ id: "shops-brand-glow", type: "circle", source: "shops", minzoom: 14, filter: ["==", ["get", "brand"], 1],   // 🎨 간판 꾸미기: 은은한 빛 + 큰 색 동그라미 + ★ + 색 알약 이름표
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 16, 17, 24, 19, 30], "circle-color": ["get", "bcolor"], "circle-opacity": 0.35, "circle-blur": 0.7 } });
    map.addLayer({ id: "shops-brand-dot", type: "circle", source: "shops", minzoom: 14, filter: ["==", ["get", "brand"], 1],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 10, 17, 14, 19, 18], "circle-color": ["get", "bcolor"], "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
    map.addLayer({ id: "shops-brand-star", type: "symbol", source: "shops", minzoom: 14, filter: ["==", ["get", "brand"], 1],
      layout: { "text-field": "★", "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 14, 12, 18, 18], "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": ["get", "bink"] } });
    map.addLayer({ id: "shops-brand-label", type: "symbol", source: "shops", minzoom: 14, filter: ["==", ["get", "brand"], 1],
      layout: { "text-field": ["get", "bname"], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 14, 13, 18, 17], "text-offset": [0, 1.5], "text-anchor": "top", "text-max-width": 9, "text-allow-overlap": true, "symbol-sort-key": 1 },
      paint: { "text-color": ["get", "bink"], "text-halo-color": ["get", "bcolor"], "text-halo-width": 5, "text-halo-blur": 0.3 } });   // 글씨 둘레를 색으로 두껍게 → 색 알약 모양
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
        `<div class="shop-row" data-i="${i}"><strong>${p.brand == 1 ? "⭐ " + esc(p.bname) : esc(p.name)}</strong>${p.brand == 1 && p.bname !== p.name ? `<br><small>(${esc(p.name)})</small>` : ""}<br>${esc(p.category)}<br>` +
        `<small>${esc(p.address)}</small>` + navLinks(p.name, p.lon, p.lat) + (p.blink ? `<a class="brand-link" href="${esc(p.blink)}" target="_blank" rel="noopener noreferrer">🔗 가게 소식 보기</a>` : "") + (VD_CAT.test(p.category || "") ? vdBlock(p.id) : "") + `<div class="shop-act">${rxHtml("shop", p.id)}<button class="fix-btn" data-id="${esc(p.id)}" data-name="${esc(p.name)}">✏ 정보가 틀렸어요</button></div>` + (IS_LOCAL ? `<div class="edit-row">` +
        `<button data-a="rename">이름 수정</button><button data-a="hide">없는 가게</button></div>` : "") + `</div>`).join("");
      const head = list.length > 1 ? `<div class="shop-head">이 위치에 가게 ${list.length}곳</div>` : "";
      const pop = new maplibregl.Popup({ offset: 10, maxWidth: "300px" }).setLngLat(e.lngLat)
        .setHTML(`${head}<div class="shop-list">${rows}</div>`).addTo(map);
      hydrateRx(pop.getElement()); vdHydrate(pop.getElement());
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
  const rz = document.getElementById("rp-zoom"); if (rz) rz.hidden = !(pickMode && typeof map !== "undefined" && map.getZoom && map.getZoom() < 15.5);   // 너무 멀면 확대 안내
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
  const qi = document.getElementById("q"); if (qi) qi.placeholder = step === "pick" ? "🔍 장소·주소 검색 (예: 꽃길슈퍼)" : "🔍 검색";
  if (step === "pick") rpBar.querySelector(".rp-slot").appendChild(sbox);     // 검색칸만 위에 얇게 남김
  else if (sbox.parentNode !== sbHome.parentNode) sbHome.after(sbox);
}
function showPanel(on) {
  if (on) { try { cpSyncReal(); } catch (e) {} panel.hidden = false; panel.getBoundingClientRect(); panel.classList.add("up"); }
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
document.getElementById("rp-me").onclick = () => {
  if (!navigator.geolocation) { shareToast("이 폰에서는 내 위치를 쓸 수 없어요"); return; }
  shareToast("내 위치를 찾는 중이에요…");
  navigator.geolocation.getCurrentPosition(p => map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: Math.max(map.getZoom(), 17), duration: 1200 }),
    () => shareToast("위치를 못 찾았어요. 폰 설정에서 위치를 허용해 주세요"), { enableHighAccuracy: true, timeout: 8000 });
};
document.getElementById("rp-find").onclick = () => { const qi = document.getElementById("q"); if (qi) { qi.focus(); qi.select(); } };
document.getElementById("rp-help").onclick = () => openHelp("report");
try { document.body.classList.toggle("rp-seen", (+localStorage.getItem("rp_n") || 0) >= 1); } catch (e) {}   // 제보해 본 사람은 안내를 작게
document.getElementById("rp-back").onclick = () => { showPanel(false); pickMode = true; crosshair.hidden = false; rpSet("pick"); setPos(map.getCenter()); };
map.on("move", () => { if (pickMode && rpStep === "pick") setPos(map.getCenter()); });
document.getElementById("fab").onclick = () => {
  openPanel(map.getCenter(), true);
  if (!navigator.geolocation) return;                         // 제보를 시작하면 내 위치로 자동 이동 (실패하면 조용히 그대로)
  navigator.geolocation.getCurrentPosition(p => { if (rpStep === "pick") map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: Math.max(map.getZoom(), 17), duration: 900 }); }, () => {}, { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 });
};
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
  try { cpSyncReal(); } catch (e) {}
  document.getElementById("title").placeholder = ns ? "가게 이름" : "제목 (예: 내장산 입구 정체)";
  document.getElementById("desc").placeholder = ns ? "업종·주소 (예: 카페, 수성동 123)" : "내용 (선택)";
}
catSel.onchange = syncCat;
const catPick = document.getElementById("cat-pick");
for (const [key, c] of Object.entries(CATEGORIES)) {
  const b = document.createElement("button"); b.type = "button"; b.className = "cp"; b.dataset.k = key;
  b.innerHTML = `<span>${c.icon}</span><b>${c.label}</b>`;
  b.onclick = () => { catSel.value = key; syncCat(); document.getElementById("title").focus(); };
  catPick.appendChild(b);
}
function cpSyncReal() {
  const v = catSel.value, real = !!CATEGORIES[v];
  catPick.hidden = !real; catSel.classList.toggle("cat-hide", real);
  catPick.querySelectorAll(".cp").forEach(b => b.classList.toggle("on", b.dataset.k === v));
}

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
    if (!res.ok) { const tx = await res.text().catch(() => ""); throw new Error(/badword/.test(tx) ? "욕설이나 비속어가 들어 있어요. 순화해서 다시 적어 주세요 🙏" : "제보 전송 실패 (" + res.status + ")"); }
    try { localStorage.setItem("jeongeup-last-report", String(Date.now())); } catch {}
    document.getElementById("title").value = ""; document.getElementById("desc").value = ""; clearPhoto();
    closePanel(); sfx("done");
    try { localStorage.setItem("rp_n", String((+localStorage.getItem("rp_n") || 0) + 1)); document.body.classList.add("rp-seen"); } catch (e) {}
    alert("✅ 제보가 접수됐어요!\n확인 후 지도에 표시돼요. 고마워요 🙏");
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
    pastReports = rows.filter(r => CATEGORIES[r.category] && reportExpMs(r.created_at, r.category, r.expires_at) <= Date.now() && Date.now() - new Date(r.created_at).getTime() < 7 * 864e5).map(r => ({
      id: r.id, title: r.title, desc: r.description || "", cat: r.category, coord: [r.lon, r.lat], ts: r.created_at, exp: r.expires_at || null }));
    const next = rows.filter(r => CATEGORIES[r.category] && reportExpMs(r.created_at, r.category, r.expires_at) > Date.now()).map(r => ({
      id: r.id, title: r.title, desc: r.description || "", cat: r.category,
      coord: [r.lon, r.lat], ts: r.created_at, exp: r.expires_at || null, photo: r.photo_url || "" }));
    // 새로 승인된 제보 감지 (방송 모드: 그 위치로 카메라 이동). 첫 로딩은 제외
    const fresh = next.filter(r => !knownIds.has(r.id));
    const firstLoad = !started; started = true;
    next.forEach(r => knownIds.add(r.id));
    if (JSON.stringify(next) === JSON.stringify(reports)) { openShared(); return true; }   // 변화 없으면 다시 그리지 않음(열린 팝업 유지)
    reports = next;
    render(); openShared(); if (typeof renderSheetNews === "function") renderSheetNews();
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
      if (l.type !== "symbol" || !map.getLayoutProperty(l.id, "text-field") || /^shops-brand-/.test(l.id)) continue;   // 간판 이름표는 밤/낮과 상관없이 항상 밝은 색 유지
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
  if (IS_LOCAL) b.hidden = false;                 // 낮/밤 버튼은 내 PC·관리자에게만 (손님은 시각에 따라 자동)
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
function startAddShop(name) {
  resEl.hidden = true; qEl.blur();
  if (typeof rpStep === "undefined" || rpStep === "none") document.getElementById("fab").click();
  catSel.value = "__newshop"; syncCat();
  const t = document.getElementById("title"); if (t) t.value = name || "";
  shareToast("➕ 가게 위치를 지도에서 맞추고 '여기로 정했어요'를 눌러요");
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
  const addQ = qEl.value.trim();
  for (const it of top) {
    const row = document.createElement("div"); row.className = "res-row";
    row.innerHTML = `<b>${esc(it.name)}</b><small>${esc(it.sub)}</small>`;
    row.onclick = () => goTo(it);
    resEl.appendChild(row);
  }
  if (!IS_LOCAL && addQ) {
    const ad = document.createElement("div"); ad.className = "res-row res-add";
    ad.innerHTML = `<b>➕ 찾는 곳이 없나요? '${esc(addQ)}' 가게 추가하기</b><small>지도에서 위치를 맞춰 알려주세요</small>`;
    ad.onclick = () => startAddShop(addQ); resEl.appendChild(ad);
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
  const url = location.origin + location.pathname + (SHARED_R ? "?r=" + encodeURIComponent(SHARED_R) : "");   // 공유 링크로 들어왔으면 크롬으로 넘어가도 같은 제보로
  const KAKAO_OPEN = "kakaotalk://web/openExternal?url=" + encodeURIComponent(url);
  if (inapp) {            // 카톡·인스타·스레드 등 안에서 열면 안내 띠 → 외부 브라우저(크롬/사파리)로 열기
    let hid = false; try { hid = !SHARED_R && sessionStorage.getItem("kk_bar") === "1"; } catch (e) {}
    if (!hid) {
      const bar = document.createElement("div"); bar.id = "kk-bar";
      bar.innerHTML = '<span>' + (SHARED_R ? '🌐 크롬·사파리로 열면 <b>더 빠르고 편해요</b>' : '🌐 크롬·사파리로 열면 앱처럼 <b>설치</b>할 수 있어요') + '</span><button id="kk-go">' + (/KAKAOTALK/i.test(ua) || android ? "브라우저로 열기" : "여는 방법 보기") + '</button><button id="kk-x" aria-label="닫기">✕</button>';
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
  const ver = ((document.getElementById("ver") || {}).textContent || "").replace(/\D/g, "");
  const url = location.origin + location.pathname + (ver ? "?v=" + ver : "");   // 버전을 붙여서, 업데이트할 때마다 카톡이 미리보기를 새로 읽게 함
  b.onclick = async () => {
    const old = b.textContent;
    try {
      if (navigator.share) { await navigator.share({ title: "정읍 지금", text: "정읍 사람들이 실시간으로 알려주는 진짜 이야기", url }); return; }
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
// ---------- 🛠 고쳐줘 (베타 의견함: 관리자만 읽음. 욕설은 서버에서 차단) ----------
let fbKind = "bug";
function renderFeedbackForm() {
  const K = [["bug", "🐞 오류"], ["idea", "💡 아이디어"], ["etc", "💬 기타"]];
  commBody.innerHTML = `<div class="comm-topic"><b style="font-size:18px">🛠 고쳐줘</b><div style="margin-top:6px;color:var(--muted);font-size:14px;line-height:1.5">지금은 베타 테스트 중이에요. 불편한 점이나 바라는 점을 남겨 주세요.<br><b>운영자만</b> 볼 수 있고, 다른 사람에게는 보이지 않아요.</div></div>` +
    `<div class="fb-kinds">${K.map(([k, t]) => `<button class="chip fb-k${k === fbKind ? " on" : ""}" data-k="${k}">${t}</button>`).join("")}</div>` +
    `<textarea id="fb-body" maxlength="300" placeholder="예: 제보 올릴 때 사진이 안 올라가요 / 이런 기능이 있으면 좋겠어요"></textarea><div id="fb-cnt">0 / 300</div>` +
    `<input id="fb-contact" maxlength="60" placeholder="답장 받을 연락처 (선택 · 안 적어도 돼요)">` +
    `<button id="fb-send" class="chip fb-send">보내기</button>`;
  commBody.querySelectorAll(".fb-k").forEach(b => b.onclick = () => { fbKind = b.dataset.k; commBody.querySelectorAll(".fb-k").forEach(x => x.classList.toggle("on", x === b)); });
  const ta = document.getElementById("fb-body"); ta.oninput = () => { document.getElementById("fb-cnt").textContent = ta.value.length + " / 300"; };
  document.getElementById("fb-send").onclick = async () => {
    const body = ta.value.trim(); if (body.length < 2) { alert("내용을 두 글자 이상 적어 주세요"); return; }
    const btn = document.getElementById("fb-send"); btn.disabled = true; btn.textContent = "보내는 중…";
    try {
      const res = await fetch(SUPABASE_URL + "/rest/v1/feedback", { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ kind: fbKind, body: body.slice(0, 300), contact: document.getElementById("fb-contact").value.trim().slice(0, 60) || null, voter: voterId() }) });
      if (res.ok) { sfx("done"); ta.value = ""; document.getElementById("fb-cnt").textContent = "0 / 300"; alert("접수됐어요! 고맙습니다 🙏 빠르게 확인할게요."); }
      else { const tx = await res.text().catch(() => ""); alert(/badword/.test(tx) ? "욕설이나 비속어가 들어 있어요. 순화해서 다시 적어 주세요 🙏" : /ratelimit/.test(tx) ? "오늘 보낼 수 있는 횟수를 넘었어요. 내일 다시 남겨 주세요 🙏" : "아직 의견함이 준비 중이에요. 잠시 뒤 다시 시도해 주세요."); }
    } catch (e) { alert("전송에 실패했어요. 인터넷을 확인해 주세요."); }
    btn.disabled = false; btn.textContent = "보내기";
  };
}
// ---------- 🗣 얘기방 / ❓ 지금 정읍 (실시간 글. 욕설·도배는 서버에서 막고, 🚩 3번이면 자동 숨김) ----------
let talkCh = null, talkSb = null, talkTimer = 0, talkFirst = true;
const TALK_URL = SUPABASE_URL + "/rest/v1/talk_posts";
function talkNick() { try { let n = localStorage.getItem("talk_nick"); if (!n) { n = "정읍 주민" + (1000 + Math.floor(Math.random() * 9000)); localStorage.setItem("talk_nick", n); } return n; } catch (e) { return "정읍 주민" + (1000 + Math.floor(Math.random() * 9000)); } }
function talkLiked() { try { return JSON.parse(localStorage.getItem("talk_liked") || "[]"); } catch (e) { return []; } }
function talkStop() { clearTimeout(talkTimer); if (talkCh && talkSb) { try { talkSb.removeChannel(talkCh); } catch (e) {} } talkCh = null; }
function talkStart() {
  talkStop();
  if (!window.supabase) return;
  try {
    talkSb = talkSb || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    talkCh = talkSb.channel("talk-" + commTab).on("postgres_changes", { event: "*", schema: "public", table: "talk_posts" }, () => { clearTimeout(talkTimer); talkTimer = setTimeout(loadTalk, 400); }).subscribe();
  } catch (e) {}
}
function talkRpc(fn, args) { return fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then(r => r.ok ? r.json() : null).catch(() => null); }
function renderTalk() {
  const chat = commTab === "chat";
  talkFirst = true;
  commBody.innerHTML = `<div class="comm-topic"><b style="font-size:18px">${chat ? "🗣 정읍 얘기방" : "❓ 지금 정읍"}</b><div style="margin-top:6px;color:var(--muted);font-size:14px;line-height:1.5">${chat ? "지금 정읍 사람들이 실시간으로 나누는 한 줄 얘기예요." : "지금 정읍 날씨·교통·웨이팅이 궁금하면 물어보고, 아는 건 답해 주세요."}<br>욕설·광고는 막혀요. 이상한 글은 🚩로 알려 주세요. <b>시험 운영 중</b>이에요.</div></div>` +
    `<div id="talk-list" class="talk-list"><div class="vd-empty">불러오는 중…</div></div>` +
    `<div class="talk-form"><div class="talk-nick">내 이름 <button id="talk-nick-b" class="chip">${esc(talkNick())} ✏</button></div><div class="talk-row"><input id="talk-in" maxlength="200" placeholder="${chat ? "지금 정읍 어때요? 한마디 남겨요" : "예: 지금 정읍 눈 와요? / 터미널 주차 자리 있어요?"}"><button id="talk-send" class="chip fb-send">올리기</button></div></div>`;
  document.getElementById("talk-nick-b").onclick = () => {
    const v = (prompt("바꿀 이름을 적어 주세요 (2~12글자)", talkNick()) || "").trim().slice(0, 12);
    if (v.length < 2) return;
    try { localStorage.setItem("talk_nick", v); } catch (e) {}
    document.getElementById("talk-nick-b").textContent = v + " ✏";
  };
  const inp = document.getElementById("talk-in");
  const send = () => postTalk(chat ? "chat" : "ask", null, inp, document.getElementById("talk-send"));
  document.getElementById("talk-send").onclick = send;
  inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); send(); } };
  loadTalk(); talkStart();
}
async function postTalk(kind, parent, inp, btn) {
  const body = inp.value.trim(); if (!body) return;
  btn.disabled = true;
  try {
    const res = await fetch(TALK_URL, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ kind, parent_id: parent, body: body.slice(0, 200), nick: talkNick(), voter: voterId() }) });
    if (res.ok) { inp.value = ""; sfx("done"); await loadTalk(); }
    else { const tx = await res.text().catch(() => ""); alert(/badword/.test(tx) ? "욕설이나 비속어가 들어 있어요. 순화해서 다시 적어 주세요 🙏" : /ratelimit/.test(tx) ? "너무 빨리 올리고 있어요. 잠시 뒤에 다시 올려 주세요 🙏" : "아직 준비 중이에요. 잠시 뒤 다시 시도해 주세요."); }
  } catch (e) { alert("전송에 실패했어요. 인터넷을 확인해 주세요."); }
  btn.disabled = false;
}
function talkMsg(p, canReply) {
  const liked = talkLiked().includes(p.id);
  return `<div class="talk-msg" data-id="${p.id}"><div class="talk-meta"><b>${esc(p.nick)}</b> · ${timeAgo(p.created_at)}</div><div class="talk-body">${esc(p.body)}</div>` +
    `<div class="talk-act"><button class="chip tk-like${liked ? " on" : ""}">👍 도움돼요 <i>${p.likes || 0}</i></button>${canReply ? `<button class="chip tk-rep">💬 답하기</button>` : ""}<button class="chip tk-flag" title="신고">🚩</button></div>` +
    (canReply ? `<div class="talk-reply-box" hidden><input maxlength="200" placeholder="답을 적어 주세요"><button class="chip fb-send">답 올리기</button></div>` : "") + `</div>`;
}
async function loadTalk() {
  const list = document.getElementById("talk-list"); if (!list) return;
  const chat = commTab === "chat";
  const q = TALK_URL + "?select=id,kind,parent_id,body,nick,likes,created_at&hidden=eq.false&" + (chat ? "kind=eq.chat&order=created_at.desc&limit=50" : "kind=in.(ask,reply)&order=created_at.desc&limit=150");
  let rows = null;
  try { const r = await fetch(q, { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } }); if (r.ok) rows = await r.json(); } catch (e) {}
  if (!document.getElementById("talk-list")) return;
  if (!rows) { list.innerHTML = `<div class="vd-empty">아직 준비 중이에요. 곧 열려요 🛠</div>`; return; }
  const atBottom = commBody.scrollHeight - commBody.scrollTop - commBody.clientHeight < 120;
  const open = new Set([...list.querySelectorAll(".talk-reply-box:not([hidden])")].map(b => b.closest(".talk-msg").dataset.id));
  const drafts = {}; list.querySelectorAll(".talk-reply-box input").forEach(i => { if (i.value) drafts[i.closest(".talk-msg").dataset.id] = i.value; });
  if (chat) {
    rows.reverse();
    list.innerHTML = rows.length ? rows.map(p => talkMsg(p, false)).join("") : `<div class="vd-empty">아직 글이 없어요. 첫 한마디를 남겨 보세요!</div>`;
  } else {
    const asks = rows.filter(p => p.kind === "ask"), reps = {};
    rows.filter(p => p.kind === "reply").reverse().forEach(p => (reps[p.parent_id] = reps[p.parent_id] || []).push(p));
    list.innerHTML = asks.length ? asks.map(p => `<div class="talk-thread">${talkMsg(p, true)}${(reps[p.id] || []).map(r => `<div class="talk-re">↳ ${talkMsg(r, false)}</div>`).join("")}</div>`).join("") : `<div class="vd-empty">아직 질문이 없어요. 궁금한 걸 물어보세요!</div>`;
  }
  list.querySelectorAll(".talk-msg").forEach(m => {
    const id = +m.dataset.id;
    m.querySelector(".tk-like").onclick = async e => {
      const b = e.currentTarget, i = b.querySelector("i"), prev = +i.textContent;
      const n = await talkRpc("talk_like", { p_id: id, p_voter: voterId() }); if (n == null) return;
      i.textContent = n; const on = n > prev; b.classList.toggle("on", on);
      try { const a = talkLiked().filter(x => x !== id); if (on) a.push(id); localStorage.setItem("talk_liked", JSON.stringify(a.slice(-300))); } catch (er) {}
    };
    m.querySelector(".tk-flag").onclick = async () => { if (!confirm("이 글을 신고할까요?\n여러 명이 신고하면 자동으로 숨겨져요.")) return; await talkRpc("talk_flag", { p_id: id, p_voter: voterId() }); alert("신고했어요. 고맙습니다 🙏"); loadTalk(); };
    const rep = m.querySelector(".tk-rep");
    if (rep) {
      const box = m.querySelector(".talk-reply-box"), inp = box.querySelector("input");
      if (open.has(String(id))) { box.hidden = false; inp.value = drafts[id] || ""; }
      rep.onclick = () => { box.hidden = !box.hidden; if (!box.hidden) inp.focus(); };
      const go = () => postTalk("reply", id, inp, box.querySelector("button"));
      box.querySelector("button").onclick = go; inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); go(); } };
    }
  });
  if (chat && (talkFirst || atBottom)) commBody.scrollTop = commBody.scrollHeight;
  talkFirst = false;
}
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
  if (commTab !== "chat" && commTab !== "ask") talkStop();
  if (commTab === "chat" || commTab === "ask") { renderTalk(); return; }
  if (commTab === "board") { renderBoard(); return; }
  if (commTab === "fb") { renderFeedbackForm(); return; }
  if (commTab !== "news") {
    const s = SOON[commTab];
    commBody.innerHTML = `<div class="soon"><div class="soon-ic">${s[0]}</div><div class="soon-t">${s[1]}</div><div class="soon-d">${s[2]}</div><div class="soon-b">🛠 곧 열려요 · 업데이트 예정</div></div>`;
    return;
  }
  let html = `<div class="vd-card"><div class="vd-card-hd"><b>🔥 오늘의 찐맛집 판정</b><span>자정 초기화</span></div><div id="vd-sum" class="vd-sum"><div class="vd-empty">불러오는 중…</div></div><button class="vd-go" id="vd-go">🍚 오늘 맛있게 먹은 곳 알려주기</button><div class="vd-foot">재미로 보는 정읍 주민의 주관적 판정이에요 (자정 초기화)</div></div>`;
  html += `<button class="comm-topic food-go" id="food-go">🍚 오늘의 맛집 순위 보러가기 <span>지도 아래에서 확인 ▴</span></button>`;
  if (pushReady()) html += `<div class="comm-note" id="push-card"></div>`;
  html += `<div class="comm-head">실시간 제보 ${reports.length}건</div>`;
  if (!reports.length) html += `<div class="feed-empty">아직 제보가 없어요. 첫 제보를 남겨 보세요!</div>`;
  commBody.innerHTML = html;
  const vg = document.getElementById("vd-go"); if (vg) vg.onclick = () => { closeComm(); setTimeout(enterJudge, 260); };
  vdSummary(true);
  const fg = document.getElementById("food-go"); if (fg) fg.onclick = () => { closeComm(); setTimeout(() => foodSheet.set(true), 260); };
  setupPushCard();
  for (const r of reports) {
    const c = CATEGORIES[r.cat];
    if (expAt(r) <= Date.now()) continue;
    const card = document.createElement("div"); card.className = "comm-card";
    card.innerHTML = `<div class="comm-meta"><span class="cat-badge" style="background:${c.color};color:${c.fg || '#fff'}">${c.icon} ${c.label}</span><span>${timeAgo(r.ts)}</span><span class="exp-badge" data-exp="${expAt(r)}"></span></div>` +
      `<div class="comm-title">${esc(r.title)}</div>` + (r.desc ? `<div class="comm-desc">${esc(r.desc)}</div>` : "") + (r.photo ? `<a href="${esc(r.photo)}" target="_blank" rel="noopener"><img class="comm-photo" src="${esc(r.photo)}" loading="lazy"></a>` : "") +
      `<div class="shop-act">${rxHtml("report", r.id)}<button class="chip comm-go">📍 지도에서 보기</button><button class="chip comm-share">🔗 공유</button></div>`;
    card.querySelector(".comm-share").onclick = () => shareReport(r);
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
function closeComm(fromPop) { if (commTab === "board") { commTab = "news"; document.querySelectorAll("#comm-tabs button").forEach(x => x.classList.toggle("on", x.dataset.t === "news")); } if (commPushed && fromPop !== true) { commPushed = false; ignorePop = true; try { history.back(); } catch (e) { ignorePop = false; } } talkStop(); stopExp(); commEl.classList.remove("open"); setTimeout(() => { commEl.hidden = true; }, 220); document.body.style.overflow = ""; }
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
    if (sndOn) { startAmbience(); sfx("on"); bgmSync(); } else { if (amb) amb.master.gain.setTargetAtTime(0, AC.currentTime, 0.3); bgmStop(); }
    label();
  };
  document.addEventListener("visibilitychange", () => { if (!AC) return; if (document.hidden) { AC.suspend(); if (bgm) bgm.pause(); } else if (sndOn) { AC.resume(); bgmSync(); } });
  label();
})();

// ===== 🎵 배경음악: 낮엔 day.mp3, 밤 지도에선 night.mp3 (freepd.com · 퍼블릭 도메인/CC0). 🔊를 켰을 때만 재생, 낮밤이 바뀌면 부드럽게 교체 =====
const BGM_FILES = { day: "sounds/music/day.mp3", night: "sounds/music/night.mp3" }, BGM_VOL = 0.3;   // BGM_VOL: 음악 크기(0~1)
let bgm = null, bgmKind = "";
function bgmFade(a, to, ms, done) { const from = a.volume, t0 = Date.now(); const id = setInterval(() => { const k = Math.min(1, (Date.now() - t0) / ms); try { a.volume = from + (to - from) * k; } catch (e) {} if (k >= 1) { clearInterval(id); if (done) done(); } }, 50); }
function bgmSync() {
  if (!sndOn) return;
  const kind = document.body.classList.contains("night") ? "night" : "day";
  if (bgm && bgmKind === kind) { if (bgm.paused) bgm.play().catch(() => {}); return; }
  const old = bgm; bgmKind = kind;
  bgm = new Audio(BGM_FILES[kind] + "?v=110"); bgm.loop = true; bgm.volume = 0;
  const cur = bgm; cur.play().then(() => bgmFade(cur, BGM_VOL, 1800)).catch(() => {});
  if (old) bgmFade(old, 0, 1200, () => old.pause());
}
function bgmStop() { if (!bgm) return; const o = bgm; bgm = null; bgmKind = ""; bgmFade(o, 0, 500, () => o.pause()); }
new MutationObserver(bgmSync).observe(document.body, { attributes: true, attributeFilter: ["class"] });

// ===== 효과음 (파일 없이 브라우저가 직접 만드는 짧은 소리). 🔊 소리가 켜져 있을 때만 난다 =====
const SFX_VOL = 0.1;                                  // 전체 크기 (0~1, 배경음보다 작게)
const SFX = {                                         // [시작 Hz, 끝 Hz, 길이(초), 크기, 파형, 시작 지연(초)] 들의 목록
  open:  [[380, 620, 0.16, 1, "sine", 0]],            // 서랍 열기: 올라가는 "퐁"
  close: [[560, 360, 0.16, 0.9, "sine", 0]],          // 서랍 닫기: 내려가는 "퐁"
  on:    [[620, 880, 0.08, 0.8, "triangle", 0]],      // 칩 켜기: 가벼운 "톡↑"
  off:   [[760, 520, 0.08, 0.7, "triangle", 0]],      // 칩 끄기: 가벼운 "톡↓"
  done:  [[660, 660, 0.14, 1, "sine", 0], [880, 880, 0.24, 1, "sine", 0.11]],   // 제보 완료: "딩-동"
};
const SFX_FILES = { open: "open", close: "close", on: "on", off: "off", done: "done", win: "win", tick: "tick" };   // sounds/*.mp3 (Kenney CC0)
const SFX_GAIN = { open: 0.7, close: 0.7, on: 0.8, off: 0.8, done: 0.9, win: 1, tick: 0.6 };
const sfxBuf = {}; let sfxLoading = false;
function sfxLoad() {
  if (sfxLoading || !AC) return; sfxLoading = true;
  for (const k in SFX_FILES) fetch("sounds/" + SFX_FILES[k] + ".mp3?v=140").then(r => r.arrayBuffer()).then(b => new Promise((ok, no) => AC.decodeAudioData(b, ok, no))).then(buf => { sfxBuf[k] = buf; }).catch(() => {});
}
function sfx(kind) {
  if (!sndOn || !AC) return;
  sfxLoad();
  if (sfxBuf[kind]) {   // 진짜 효과음 파일이 준비됐으면 그걸 재생
    try { const src = AC.createBufferSource(), g = AC.createGain(); src.buffer = sfxBuf[kind]; g.gain.value = (SFX_GAIN[kind] || 1) * 0.9; src.connect(g); g.connect(AC.destination); src.start(); return; } catch (e) {}
  }
  if (!SFX[kind]) return;   // 아직 못 불러왔으면 합성음(예비)
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
const EDIT_CATS = ["음식점", "카페", "주점/술집", "정육점", "반찬/식료품", "옷집/의류", "신발/잡화", "편의점/마트", "약국", "꽃집", "안경점", "학원", "교습소", "미용실/헤어", "세탁소", "병원/의원", "부동산", "자동차(정비/세차)", "숙박", "주차장", "기타"];   // 관리자 업종 목록
let sbAdmin = null, edState = "none", edSel = null;
const edEl = id => document.getElementById(id);
function edToast(t) { const el = edEl("ed-toast"); el.textContent = t; el.hidden = false; clearTimeout(edToast.t); edToast.t = setTimeout(() => el.hidden = true, 2200); }
function shopInfo(id) {
  const s = SHOPS.concat(EDITS.added || []).find(x => x.id === id); if (!s) return null;
  const e = (EDITS.edits || {})[id] || {};
  return { id, name: e.name || s.name, category: e.category || s.category || "기타", coord: e.coord || s.coord, hidden: !!e.hidden, brand: e.brand || null };
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
  const bc = patch.brandCols || (prev && "brand_color" in prev ? { brand_color: prev.brand_color, brand_name: prev.brand_name, brand_link: prev.brand_link, brand_from: prev.brand_from, brand_until: prev.brand_until } : null);
  if (bc) Object.assign(row, bc);   // SQL(shop_brand.sql) 실행 전에는 간판 칸을 건드리지 않음
  const { error } = await sbAdmin.from("shop_edits").upsert(row);
  if (error) { edToast("저장 실패: " + error.message); alert("저장 실패: " + error.message + (patch.brandCols ? "\n(Supabase에서 sql/shop_brand.sql 을 먼저 실행했는지 확인하세요)" : "\n(관리자 계정으로 로그인했는지 확인하세요)")); return; }
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
    `<div class="ed-r"><button id="ed-brand" class="brandbtn">🎨 간판 꾸미기${brandActive(o.brand) ? " ⭐" : ""}</button></div>` +
    `<div class="ed-r"><button id="ed-gone" class="${o.hidden ? "ok" : "red"}">${o.hidden ? "되살리기" : "없어진 가게(숨기기)"}</button><button id="ed-x" class="g">닫기</button></div>`;
  if (ids.length > 1) edEl("ed-pick").onchange = e => openEditSheet([e.target.value].concat(ids.filter(i => i !== e.target.value)));
  edEl("ed-x").onclick = edClose;
  edEl("ed-brand").onclick = () => openBrandSheet(edSel);
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
const BRAND_COLORS = ["#FF4D4F", "#FF9F1C", "#FFD60A", "#2ECC71", "#35A7FF", "#9B6BFF", "#FF5FA2", "#00D1C1", "#A3E635", "#FFB38A", "#3B5BDB", "#C2255C", "#12B886", "#8B5E3C", "#868E96", "#F783AC"];   // 밝고 선명한 16색
const brandInk = hex => { const n = parseInt((hex || "#000").slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#1B1B1B" : "#FFFFFF"; };   // 밝은 색엔 검정, 진한 색엔 흰 글씨
async function openBrandSheet(id) {
  const o = shopInfo(id); if (!o) return; const b = o.brand || {}; let color = b.color || "";
  const sh = edEl("ed-sheet"); sh.hidden = false; edState = "sheet";
  sh.innerHTML = `<div class="ed-h">🎨 간판 꾸미기 · ${esc(o.name)}</div>` +
    `<div id="bd-prev"></div>` +
    `<div class="bd-sw">${BRAND_COLORS.map(c => `<button class="sw" data-c="${c}" style="background:${c}"></button>`).join("")}<input type="color" id="bd-pick" value="${color || BRAND_COLORS[0]}"><button class="sw none" data-c="">해제</button></div>` +
    `<input id="bd-name" placeholder="지도에 보일 이름 (예: 백프로부동산)" maxlength="30" value="${esc(b.name || "")}">` +
    `<input id="bd-link" type="url" placeholder="🔗 홍보 링크 (http:// 또는 https://)" value="${esc(b.link || "")}">` +
    `<div class="bd-dates"><label>시작일<input type="date" id="bd-from" value="${esc(b.from || "")}"></label><label>종료일<input type="date" id="bd-until" value="${esc(b.until || "")}"></label></div>` +
    `<textarea id="bd-memo" placeholder="📝 메모 (관리자만 볼 수 있어요 · 계약자·금액·연락처 등)" maxlength="500"></textarea>` +
    `<div class="ed-r"><button id="bd-save" class="ok">저장</button><button id="bd-x" class="g">닫기</button></div>`;
  const prev = () => { const p = edEl("bd-prev"); if (!p) return; const nm = edEl("bd-name").value.trim() || o.name; p.innerHTML = color ? `<span style="background:${color};color:${brandInk(color)}">★ ${esc(nm)}</span>` : `<small>색을 고르면 지도 모양을 미리 볼 수 있어요</small>`; };
  const mark = () => { sh.querySelectorAll(".sw").forEach(x => x.classList.toggle("on", (x.dataset.c || "") === color)); prev(); };
  edEl("bd-name").oninput = prev;
  sh.querySelectorAll(".sw").forEach(x => x.onclick = () => { color = x.dataset.c; if (color) edEl("bd-pick").value = color; mark(); });
  edEl("bd-pick").oninput = e => { color = e.target.value; mark(); }; mark();
  edEl("bd-x").onclick = edClose;
  try { const { data } = await sbAdmin.from("shop_brand_memo").select("memo").eq("id", id).maybeSingle(); if (data && edEl("bd-memo")) edEl("bd-memo").value = data.memo || ""; } catch (e) {}
  edEl("bd-save").onclick = async () => {
    const link = edEl("bd-link").value.trim(), nm = edEl("bd-name").value.trim(), from = edEl("bd-from").value, until = edEl("bd-until").value;
    if (link && !safeLink(link)) { edToast("링크는 http:// 또는 https:// 로 시작해야 해요"); return; }
    if (color && !nm) { edToast("지도에 보일 이름을 써 주세요"); return; }
    if (from && until && from > until) { edToast("종료일이 시작일보다 빨라요"); return; }
    const memo = edEl("bd-memo").value.trim();
    const mr = await sbAdmin.from("shop_brand_memo").upsert({ id, memo, updated_at: new Date().toISOString() });
    if (mr.error) { alert("메모 저장 실패: " + mr.error.message + "\n(Supabase에서 sql/shop_brand.sql 을 먼저 실행했는지 확인하세요)"); return; }
    edSave(id, { brandCols: { brand_color: color || null, brand_name: color ? nm : null, brand_link: link || null, brand_from: from || null, brand_until: until || null } }, color ? "간판을 저장했어요 ⭐" : "간판을 해제했어요");
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
    { const nb = document.getElementById("night-btn"); if (nb) nb.hidden = false; }
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
  const list = NOTICES.slice().sort((x, y) => noticeType(y.level).rank - noticeType(x.level).rank);
  if (!list.length) { t.hidden = true; document.body.classList.remove("has-notice"); return; }
  const txt = list.map(n => noticeType(n.level).icon + " " + (n.level === "urgent" ? "긴급  " : "") + n.body).join("      ·      ");
  if (inn.textContent !== txt) { inn.textContent = txt; inn.style.animationDuration = Math.max(14, txt.length * 0.3) + "s"; }
  t.classList.toggle("urgent", list.some(n => n.level === "urgent"));
  const top = noticeType(list[0].level); t.style.background = top.color; t.style.color = top.fg || "#fff";     // 가장 급한 종류의 색
  t.hidden = false; document.body.classList.add("has-notice");
}
document.getElementById("ticker").onclick = () => {
  const m = document.getElementById("notice-modal");
  m.innerHTML = '<div class="nm">' + NOTICES.slice().sort((x, y) => noticeType(y.level).rank - noticeType(x.level).rank).map(n => { const ty = noticeType(n.level); return `<p style="border-left-color:${ty.color};background:${ty.soft}">${ty.icon} ${esc(n.body)}</p>`; }).join("") + '<button id="nm-x">닫기</button></div>';
  m.hidden = false; document.getElementById("nm-x").onclick = () => m.hidden = true;
};
fetchNotices(); setInterval(fetchNotices, 60000);


// 한 줄 소개: 처음 10번 방문까지만 보임 (익숙해지면 접힘)
(function () { const t = document.getElementById("tagline"); if (!t) return; let n = 0; try { n = (+localStorage.getItem("visit_n") || 0) + 1; localStorage.setItem("visit_n", String(n)); } catch (e) {} if (n > 10) t.hidden = true; })();
// ===== 처음 방문 안내 (3단계로 가볍게) + 🙋 도움말 (기능별 카드) =====
const HELP = [
  { id: "report", ic: "📍", t: "제보하기", s: "길 막힘·웨이팅·행사를 이웃에게 알려요",
    b: `<ol class="hp-steps"><li><b>＋ 제보하기</b> 버튼을 눌러요 <small>(지도 오른쪽 아래)</small></li><li><b>지도를 손으로 움직여서</b> 가운데 📍 핀 <b>끝</b>을 일어난 장소에 맞춰요.<br>지금 있는 곳이면 <b>📍 내 위치로 이동</b>을 눌러요.</li><li><b>여기로 정했어요 ▶</b>를 누르고, 종류를 고른 뒤 한 줄만 쓰면 끝! 사진은 안 넣어도 돼요.</li></ol><p>🔍 지도가 너무 멀리 보이면 손가락 두 개를 벌려서 확대하세요. 더 정확해져요.<br>⏳ 제보는 시간이 지나면 저절로 사라져요.<br>🚫 욕설이 들어 있으면 올라가지 않아요.</p>`,
    a: ["지금 제보해보기", () => setTimeout(() => document.getElementById("fab").click(), 250)] },
  { id: "food", ic: "🍚", t: "오늘의 찐맛집 판정", s: "가게마다 하루 한 번, 🔥👴😅 중 하나",
    b: `<ol class="hp-steps"><li>아래 <b>맛집 시트</b>를 위로 끌어올리거나, 커뮤니티의 <b>판정 카드</b>를 열어요.</li><li><b>🍚 오늘 맛있게 먹은 곳 알려주기</b>를 누르고 음식점·카페를 눌러요.</li><li>팝업에서 <b>🔥 또 갈 거임 · 👴 토박이 단골 · 😅 한 번으로 족함</b> 중 하나를 눌러요.</li></ol><p>가게마다 하루 한 번이에요. 같은 날엔 마음을 바꿔 다시 눌러도 돼요. 자정이 지나면 처음부터 다시 시작해요. 재미로 보는 주민 판정이에요.</p>`,
    a: ["지금 판정해보기", () => enterJudge()] },
  { id: "sound", ic: "🔊", t: "소리·배경음악", s: "낮엔 밝은 피아노, 밤엔 차분한 피아노",
    b: `<ol class="hp-steps"><li>위쪽 <b>더 보기</b>를 열면 <b>🔇</b> 버튼이 있어요.</li><li>누르면 <b>🔊</b>로 바뀌면서 소리와 배경음악이 켜져요.</li><li>다시 누르면 꺼져요.</li></ol><p>소리가 안 나면 폰이 <b>무음(진동)</b> 모드인지, <b>미디어 볼륨</b>이 0인지 확인해 보세요.</p>`,
    a: ["소리 켜보기", () => { const b = document.getElementById("snd-btn"); if (b) b.click(); }] },
  { id: "push", ic: "🔔", t: "알림 받기", s: "새 공지가 오면 폰이 알려줘요",
    b: `<ol class="hp-steps"><li><b>💬 커뮤니티</b>를 열어요.</li><li>맨 위쪽 <b>알림 받기</b> 카드의 버튼을 눌러요.</li><li>폰에서 <b>허용</b>을 눌러요.</li></ol><p>허용 창이 안 뜨면: 크롬·삼성 인터넷 주소창 왼쪽 <b>자물쇠 → 권한(사이트 설정) → 알림 → 허용</b>으로 바꿔 주세요.</p>`,
    a: ["커뮤니티 열어보기", () => setTimeout(openComm, 250)] },
  { id: "filter", ic: "👀", t: "골라보기", s: "보고 싶은 정보만 켜기",
    b: `<ol class="hp-steps"><li>검색창 아래 <b>🚗 교통 · 🎉 행사 · ⏳ 웨이팅</b> 버튼을 눌러요.</li><li>그 종류만 지도에 보여요. 다시 누르거나 <b>전체 보기 ✕</b>를 누르면 돌아와요.</li></ol><p>꺼진 종류는 지도에서 사라져서 지도가 깔끔해져요.</p>`,
    a: ["더 보기 열어보기", () => setTimeout(() => toolsToggle(), 250)] },
  { id: "install", ic: "🏠", t: "홈 화면에 추가", s: "앱처럼 바로 열어요",
    b: `<p><b>갤럭시(크롬):</b> 오른쪽 위 <b>⋮</b> → <b>홈 화면에 추가</b></p><p><b>아이폰(사파리):</b> 아래 <b>공유 버튼</b> → <b>홈 화면에 추가</b></p><p>인스타·카톡 안에서 열었다면 먼저 위쪽 <b>크롬으로 열기</b> 안내를 눌러요.</p>`,
    a: ["설치 안내 열기", () => { const b = document.getElementById("install-btn"); if (b && !b.hidden) b.click(); else shareToast("브라우저 메뉴에서 '홈 화면에 추가'를 눌러 주세요"); }] },
  { id: "fix", ic: "🛠", t: "틀린 정보·불편한 점", s: "가게 정보 수정, 앱 의견 남기기",
    b: `<p><b>가게 정보가 틀리면:</b> 지도에서 그 가게를 눌러 <b>✏ 정보가 틀렸어요</b>를 눌러요.</p><p><b>앱이 불편하거나 바라는 게 있으면:</b> 💬 커뮤니티 → <b>🛠 고쳐줘</b>에 써 주세요. 관리자가 바로 확인해요.</p>`,
    a: ["의견 남기러 가기", () => setTimeout(() => { openComm(); const b = document.querySelector('#comm-tabs button[data-t="fb"]'); if (b) b.click(); }, 250)] },
  { id: "share", ic: "🔗", t: "친구에게 공유", s: "카톡·인스타로 보내기",
    b: `<p>제보 팝업이나 커뮤니티 글의 <b>🔗 공유</b>를 누르면 카톡·인스타로 보낼 수 있어요.</p><p>받은 사람이 누르면 <b>그 제보로 바로 이동</b>해요.</p>` },
];
const helpPulse = on => ["help-btn", "help-ctl"].forEach(id => { const e = document.getElementById(id); if (e) e.classList.toggle("pulse", on); });
function closeHelp() { const h = document.getElementById("help"); if (h) h.hidden = true; document.body.classList.remove("help-open"); }
function openHelp(id) {
  const h = document.getElementById("help"); if (!h) return;
  try { localStorage.setItem("help_seen", "1"); } catch (e) {}
  helpPulse(false);
  h.innerHTML = `<div class="hp-top"><b>🙋 도움말</b><button id="hp-x" aria-label="닫기">✕</button></div><div class="hp-scroll"><button id="hp-tour" class="hp-tour">👋 처음이세요? 시작 화면 다시 보기</button><p class="hp-lead">궁금한 칸을 눌러 보세요. <b>[지금 해보기]</b> 버튼으로 바로 따라 할 수 있어요.</p>` +
    HELP.map(c => `<details class="hp-c" id="hp-${c.id}"><summary><span class="hp-ic">${c.ic}</span><span class="hp-st"><b>${c.t}</b><small>${c.s}</small></span></summary><div class="hp-b">${c.b}${c.a ? `<button class="hp-go" data-id="${c.id}">▶ ${c.a[0]}</button>` : ""}</div></details>`).join("") + `<p class="hp-end">그래도 모르겠으면 💬 커뮤니티 → 🛠 고쳐줘에 물어보세요.</p></div>`;
  h.hidden = false; document.body.classList.add("help-open");
  document.getElementById("hp-x").onclick = closeHelp;
  document.getElementById("hp-tour").onclick = () => { closeHelp(); setTimeout(() => window.showWelcome && window.showWelcome(), 250); };
  h.querySelectorAll("details.hp-c").forEach(d => d.addEventListener("toggle", () => { if (d.open) h.querySelectorAll("details.hp-c").forEach(o => { if (o !== d) o.open = false; }); }));
  h.querySelectorAll(".hp-go").forEach(b => b.onclick = () => { const c = HELP.find(x => x.id === b.dataset.id); closeHelp(); if (c && c.a) c.a[1](); });
  const d = id && document.getElementById("hp-" + id); if (d) { d.open = true; setTimeout(() => d.scrollIntoView({ block: "start" }), 60); }
}
(function () {
  const tut = document.getElementById("tut"), hole = document.getElementById("tut-hole"), tip = document.getElementById("tut-tip");
  const txt = document.getElementById("tut-txt"), nEl = document.getElementById("tut-n");
  if (!LIVE && typeof map !== "undefined") map.addControl({ onAdd() { const c = document.createElement("div"); c.className = "maplibregl-ctrl maplibregl-ctrl-group"; c.innerHTML = '<button type="button" id="help-ctl" title="도움말" aria-label="도움말"><span>🙋</span><small>도움말</small></button>'; c.firstChild.onclick = () => openHelp(); return c; }, onRemove() {} }, "top-right");
  const hand = document.createElement("div"); hand.id = "tut-hand"; hand.textContent = "👆"; hand.hidden = true; tut.appendChild(hand);
  const center = () => ({ x: innerWidth / 2 - 60, y: innerHeight * 0.5 - 60, w: 120, h: 120 });
  const rectOf = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const helpVisible = () => { const e = document.getElementById("help-ctl"); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; };
  const STEPS = [
    { t: "어서 와요! 👋<br>정읍에서 <b>지금 무슨 일이 있는지</b> 한눈에 볼 수 있어요.", r: () => rectOf("top") },
    { t: "지도 위 <b>점을 직접 눌러보세요.</b><br>가게 정보나 이웃 소식이 떠요.", r: center, hand: true },
    { t: () => helpVisible() ? "어려운 건 오른쪽 위 <b>🙋 도움말</b>에서 알려드려요.<br>제보하는 법, 소리, 알림까지 한곳에 있어요." : "어려운 건 <b>🙋 도움말</b>에서 알려드려요.<br>제보하는 법, 소리, 알림까지 한곳에 있어요.", r: () => helpVisible() ? rectOf("help-ctl") : rectOf("top") },
  ];
  let i = 0;
  function show() {
    const s = STEPS[i], r = s.r(), p = 6;
    Object.assign(hole.style, { left: r.x - p + "px", top: r.y - p + "px", width: r.w + p * 2 + "px", height: r.h + p * 2 + "px" });
    txt.innerHTML = typeof s.t === "function" ? s.t() : s.t; nEl.textContent = (i + 1) + " / " + STEPS.length;
    document.getElementById("tut-next").textContent = i === STEPS.length - 1 ? "시작하기" : "다음";
    hand.hidden = !s.hand; if (s.hand) { hand.style.left = r.x + r.w / 2 - 20 + "px"; hand.style.top = r.y + r.h / 2 + "px"; }
    const below = r.y + r.h / 2 < innerHeight / 2;
    tip.style.top = below ? Math.min(r.y + r.h + p + 14, innerHeight - 190) + "px" : "auto";
    tip.style.bottom = below ? "auto" : innerHeight - r.y + p + 14 + "px";
  }
  // 👋 환영 카드: 첫 방문에 큰 버튼 3개로 "여기서 뭘 하는지"를 알려줌 (기존 말풍선 3단계 안내를 대체)
  const wl = document.getElementById("welcome");
  function closeWelcome() {
    if (wl) wl.hidden = true;
    try { localStorage.setItem("tut_done", "1"); localStorage.setItem("welcome_done", "1"); } catch (e) {}
    try { if (localStorage.getItem("help_seen") !== "1") helpPulse(true); } catch (e) {}
  }
  function showWelcome() { if (!wl) { start(); return; } wl.hidden = false; }
  window.showWelcome = showWelcome;
  if (wl) {
    document.getElementById("wl-skip").onclick = closeWelcome;
    document.getElementById("wl-now").onclick = () => {
      closeWelcome();
      const live = (typeof reports !== "undefined" ? reports : []).filter(r => expAt(r) > Date.now()).sort((a, b) => new Date(b.ts) - new Date(a.ts));
      setTimeout(() => { if (live.length) focusReport(live[0]); else openComm(); }, 250);
    };
    document.getElementById("wl-food").onclick = () => { closeWelcome(); setTimeout(() => foodSheet.set(true), 260); };
    document.getElementById("wl-report").onclick = () => { closeWelcome(); setTimeout(() => document.getElementById("fab").click(), 250); };
  }
  function end() { tut.hidden = true; hand.hidden = true; try { localStorage.setItem("tut_done", "1"); } catch (e) {} try { if (localStorage.getItem("help_seen") !== "1") helpPulse(true); } catch (e) {} }
  function start() { i = 0; tut.hidden = false; show(); }
  window.startTour = start;
  document.getElementById("tut-next").onclick = () => { if (++i >= STEPS.length) end(); else show(); };
  document.getElementById("tut-skip").onclick = end;
  document.getElementById("help-btn").onclick = () => openHelp();
  addEventListener("resize", () => { if (!tut.hidden) show(); });
  let done = false; try { done = localStorage.getItem("tut_done") === "1"; } catch (e) {}
  if (!done && !LIVE && !/[?&]edit=1/.test(location.search)) { if (!SHARED_R && !/[?&]shop=/.test(location.search)) setTimeout(showWelcome, 1500); }
  else { try { if (localStorage.getItem("help_seen") !== "1" && (+localStorage.getItem("slide_n") || 0) <= 6) setTimeout(() => helpPulse(true), 800); } catch (e) {} }
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
  const btn = document.getElementById("food-vote"), nj = vdMineCount();
  if (btn) { btn.textContent = nj ? "🍚 오늘 맛있게 먹은 곳 알려주기 · " + nj + "곳 알려줌" : "🍚 오늘 맛있게 먹은 곳 알려주기"; btn.disabled = false; btn.onclick = () => openVotePick(); }
  foodSheet.refit();
}
// ===== 🔥 오늘의 찐맛집 판정 (가게별 하루 1표 · 3가지 중 하나 · 한국시간 자정 초기화) =====
const VD = [["again", "🔥", "또 갈 거임"], ["local", "👴", "토박이 단골"], ["meh", "😅", "한 번으로 족함"]];
const VD_MIN = 3;                       // 이 인원 이상 모여야 비율을 공개 (한두 명 장난으로 가게가 낙인찍히지 않게)
const VD_CAT = /음식점|카페|주점/;
const vdHdr = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" };
let vdData = { day: "", t: 0, rows: {} }, judging = false;
function vdMine() { try { const v = JSON.parse(localStorage.getItem("vd_mine") || "null"); return v && v.day === kstDay() ? v : { day: kstDay(), m: {} }; } catch (e) { return { day: kstDay(), m: {} }; } }
function vdMineSave(v) { try { localStorage.setItem("vd_mine", JSON.stringify(v)); } catch (e) {} }
const vdMineCount = () => Object.keys(vdMine().m).length;
async function vdLoad(force) {
  const day = kstDay();
  if (!force && vdData.day === day && Date.now() - vdData.t < 20000) return vdData.rows;
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/food_verdict", { method: "POST", headers: vdHdr, body: JSON.stringify({ d: day }) });
    if (r.ok) { const rows = {}; for (const x of await r.json()) rows[x.shop_id] = { again: +x.n_again || 0, local: +x.n_local || 0, meh: +x.n_meh || 0 }; vdData = { day, t: Date.now(), rows }; }
  } catch (e) {}
  return vdData.day === day ? vdData.rows : {};
}
function vdBars(c) {
  const n = c.again + c.local + c.meh;
  if (!n) return `<div class="vd-empty">아직 아무도 안 알려줬어요. 첫 번째가 되어 보세요!</div>`;
  if (n < VD_MIN) return `<div class="vd-empty">👥 ${n}명 참여 중 · ${VD_MIN}명부터 비율이 공개돼요</div>`;
  return `<div class="vd-stack">` + VD.filter(([k]) => c[k]).map(([k]) => `<i class="vd-${k}" style="flex:${c[k]}"></i>`).join("") + `</div><div class="vd-legend">` + VD.map(([k, ic]) => `<span class="vd-${k}">${ic} ${Math.round(c[k] / n * 100)}%</span>`).join("") + `<em>👥 ${n}명 참여</em></div>`;
}
function vdBlock(id) {
  return `<div class="vd" data-id="${esc(id)}"><div class="vd-hd">🔥 오늘 어땠어요? <small>자정 초기화</small></div><div class="vd-btns">` +
    VD.map(([k, ic, tx]) => `<button class="vd-b vd-${k}" data-k="${k}"><span>${ic}</span>${tx}</button>`).join("") + `</div><div class="vd-res"></div></div>`;
}
async function vdHydrate(root) {
  const boxes = [...root.querySelectorAll(".vd")]; if (!boxes.length) return;
  const mine = vdMine().m;
  boxes.forEach(b => b.querySelectorAll(".vd-b").forEach(x => x.classList.toggle("on", mine[b.dataset.id] === x.dataset.k)));
  const rows = await vdLoad();
  boxes.forEach(b => { const r = b.querySelector(".vd-res"); if (r) r.innerHTML = vdBars(rows[b.dataset.id] || { again: 0, local: 0, meh: 0 }); });
}
const vdRefreshAll = () => { vdHydrate(document); vdSummary(false); };
async function vdSummary(force) {
  if (!document.getElementById("vd-sum")) return;
  const rows = await vdLoad(force), el = document.getElementById("vd-sum"); if (!el) return;
  const list = Object.entries(rows).map(([id, c]) => ({ id, c, n: c.again + c.local + c.meh, s: shopInfo(id) })).filter(x => x.s && !x.s.hidden && x.n > 0)
    .sort((a, b) => b.n - a.n || (b.c.again + b.c.local) - (a.c.again + a.c.local)).slice(0, 3);
  el.innerHTML = list.length ? list.map((x, i) => `<div class="vd-row" data-id="${esc(x.id)}"><div class="vd-name"><span>${["🥇", "🥈", "🥉"][i]}</span><b>${esc(x.s.name)}</b></div>${vdBars(x.c)}</div>`).join("") : `<div class="vd-empty">오늘 첫 번째 판정의 주인공이 되어보세요!</div>`;
  el.querySelectorAll(".vd-row").forEach(r => r.onclick = () => { const s = shopInfo(r.dataset.id); if (!s) return; closeComm(); map.flyTo({ center: s.coord, zoom: 18, pitch: 55, duration: 1500 }); });
}
function enterJudge() {
  judging = true;
  let bar = document.getElementById("vd-bar");
  if (!bar) { bar = document.createElement("div"); bar.id = "vd-bar"; bar.innerHTML = `<span>🗺 지도를 움직여 가게를 눌러 주세요</span><button id="vd-x">취소 ✕</button>`; document.body.appendChild(bar); bar.querySelector("#vd-x").onclick = exitJudge; }
  bar.hidden = false;
}
// ----- 🍚 가게 고르기 창: 검색 · 목록 · 지도에서 찾기 -----
function openVotePick() {
  foodSheet.set(false);
  let m = document.getElementById("vp");
  if (!m) { m = document.createElement("div"); m.id = "vp"; document.body.appendChild(m); }
  m.hidden = false;
  const draw = async q => {
    const rows = await vdLoad();
    let shops = SHOPS.concat(EDITS.added || []).map(x => shopInfo(x.id)).filter(x => x && !x.hidden && VD_CAT.test(x.category));
    const n = x => { const c = rows[x.id]; return c ? c.again + c.local + c.meh : 0; };
    shops.sort((a, b) => n(b) - n(a) || a.name.localeCompare(b.name, "ko"));
    const qq = (q || "").trim();
    if (qq) shops = shops.filter(x => x.name.includes(qq));
    const hot = !qq ? shops.filter(x => n(x) > 0).slice(0, 3) : [];
    const item = x => `<button class="vp-it" data-id="${esc(x.id)}"><b>${esc(x.name)}</b><small>${esc(x.category)}${n(x) ? " · " + n(x) + "명" : ""}</small></button>`;
    const list = m.querySelector("#vp-list");
    const rs = qq ? (roadSearch(qq) || jibunSearch(qq)) : null;
    list.innerHTML = (rs ? `<div class="vp-t">📍 주소</div><button class="vp-it vp-addr"><b>${esc(rs.name)}</b><small>지도에서 보기</small></button>` : "") +
      (qq ? `<div class="vp-t">검색 결과</div>` + (shops.length ? shops.slice(0, 40).map(item).join("") : `<div class="vd-empty">찾는 가게가 없어요.</div>`)
          : (hot.length ? `<div class="vp-t">🔥 오늘 인기</div>` + hot.map(item).join("") : `<div class="vd-empty">가게 이름을 검색해 보세요</div>`)) +
      (qq ? `<button class="vp-it vp-new"><b>➕ 찾는 곳이 없나요? '${esc(qq)}' 가게 추가하기</b></button>` : "");
    list.querySelectorAll(".vp-it[data-id]").forEach(b => b.onclick = () => pick(b.dataset.id));
    const ad = list.querySelector(".vp-addr"); if (ad) ad.onclick = () => { m.hidden = true; goTo(rs); };
    const nw = list.querySelector(".vp-new"); if (nw) nw.onclick = () => { m.hidden = true; startAddShop(qq); };
  };
  const pick = id => {
    const s = shopInfo(id); if (!s) return;
    m.querySelector("#vp-main").hidden = true; const d = m.querySelector("#vp-one"); d.hidden = false;
    d.innerHTML = `<button id="vp-back" type="button">↩ 다시 고르기</button><div class="vp-nm">${esc(s.name)}</div>` + vdBlock(id) + `<button id="vp-done" type="button">닫기</button>`;
    vdHydrate(d);
    d.querySelector("#vp-back").onclick = () => { d.hidden = true; m.querySelector("#vp-main").hidden = false; };
    d.querySelector("#vp-done").onclick = () => { m.hidden = true; };
  };
  m.innerHTML = `<div class="vp-box"><div class="vp-hd"><b>🍚 오늘 맛있게 먹은 곳</b><button id="vp-x" type="button">✕</button></div><div id="vp-main"><input id="vp-q" type="search" placeholder="🔍 가게 이름 검색 (예: 안나감성)" autocomplete="off"><div id="vp-list">불러오는 중…</div><button id="vp-map" type="button">🗺 지도에서 직접 찾기</button></div><div id="vp-one" hidden></div></div>`;
  m.querySelector("#vp-x").onclick = () => { m.hidden = true; };
  m.querySelector("#vp-q").oninput = e => draw(e.target.value);
  m.querySelector("#vp-map").onclick = () => { m.hidden = true; enterJudge(); };
  draw("");
}
function exitJudge() { judging = false; const bar = document.getElementById("vd-bar"); if (bar) bar.hidden = true; }
document.addEventListener("click", async e => {
  const b = e.target.closest(".vd-b"); if (!b) return;
  const box = b.closest(".vd"), id = box.dataset.id, k = b.dataset.k, s = shopInfo(id); if (!s) return;
  const mine = vdMine(), prev = mine.m[id];
  if (prev === k) { shareToast("이미 이렇게 알려줬어요 (바꾸려면 다른 버튼을 눌러요)"); return; }
  box.querySelectorAll(".vd-b").forEach(x => x.disabled = true);
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/food_judge", { method: "POST", headers: vdHdr, body: JSON.stringify({ p_shop_id: id, p_shop_name: s.name, p_voter: voterId(), p_choice: k }) });
    if (!r.ok) { const t = await r.text(); shareToast(/ratelimit/.test(t) ? "오늘은 많이 알려주셨어요. 내일 또 해 주세요!" : "전송에 실패했어요. 잠시 뒤 다시 해 주세요."); return; }
    mine.m[id] = k; vdMineSave(mine);
    if (vdData.day !== kstDay()) vdData = { day: kstDay(), t: 0, rows: {} };
    const row = vdData.rows[id] || (vdData.rows[id] = { again: 0, local: 0, meh: 0 });
    if (prev) row[prev] = Math.max(0, row[prev] - 1); row[k]++; vdData.t = 0;
    vdRefreshAll(); shareToast(prev ? "바꿨어요!" : "알려줘서 고마워요! 커뮤니티에서 확인해 보세요");
    if (judging) exitJudge();
    loadFood(); vdLoad(true).then(vdRefreshAll);
  } catch (err) { shareToast("전송에 실패했어요. 인터넷을 확인해 주세요."); }
  finally { box.querySelectorAll(".vd-b").forEach(x => x.disabled = false); vdHydrate(box.parentNode || document); }
});


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
      if (vis("help")) { closeHelp(); return true; }
      if (vis("tut")) { document.getElementById("tut-skip").click(); return true; }
      if (vis("notice-modal")) { document.getElementById("notice-modal").hidden = true; return true; }
      if (vis("ed-sheet")) { edClose(); return true; }
      if (!commEl.hidden) { closeComm(); return true; }
      if (foodSheet.isOpen()) { foodSheet.setLevel(1); return true; }
      if (rpStep !== "none" || !panel.hidden) { closePanel(); return true; }
      if (document.body.classList.contains("tools-open")) { toolsClose(); return true; }
      if (vis("feed")) { document.getElementById("feed").hidden = true; return true; }
      if (document.body.classList.contains("searching") || !resEl.hidden) { resEl.hidden = true; qEl.blur(); return true; }
      if (document.querySelector(".maplibregl-popup")) { closePopups(); return true; }
      if (vis("filters")) { toolsClose(); return true; }
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
const SLIDE_N = (() => { try { const n = (+localStorage.getItem("slide_n") || 0) + 1; localStorage.setItem("slide_n", n); return n; } catch (e) { return 1; } })();
const SLIDE_LEARNED = SLIDE_N > 6;     // 여섯 번 넘게 쓰셨으면 안내 글씨를 짧게
const toolsTxt = on => on ? "▴ 접기" : "▾ 더 보기 · 보고 싶은 것만 골라보기";
let toolsClose = () => {}, toolsToggle = () => {};
(function toolsDrawer() {
  const g = document.getElementById("tools-grab"), tx = document.getElementById("tools-grab-t"); if (!g || LIVE) return;
  const top = document.getElementById("top"), body = document.body;
  tx.textContent = toolsTxt(false);
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
    g.setAttribute("aria-expanded", on ? "true" : "false"); tx.textContent = toolsTxt(on);
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
  const hintTxt = l => l ? "▾ 접기" : "▴ 더보기";
  const el = document.createElement("div"); el.id = "food-sheet";
  const icons = Object.entries(CATEGORIES).map(([k, c]) => `<button class="fm-ic" data-k="${k}"><span>${c.icon}</span><b>${c.label}</b></button>`).join("") +
    `<button class="fm-ic" data-k="food"><span>🍚</span><b>맛집</b></button><button class="fm-ic" data-k="comm"><span>💬</span><b>커뮤니티</b></button><button class="fm-ic" data-k="more"><span>⋯</span><b>더보기</b></button>`;
  el.innerHTML = `<div id="fs-head"><i class="fs-grab"></i><div id="fs-sum">🍚 오늘의 맛집 · 불러오는 중…</div><span id="fs-hint">${hintTxt(0)}</span></div>` +
    `<div id="fs-body"><div id="fs-mid"><div class="fm-hd"><b>지금 정읍</b><span id="fm-wx"></span></div><div id="fm-icons">${icons}</div><div id="fm-news-t">지금 정읍 소식</div><div id="fm-news"></div></div>` +
    `<div id="food-sec"><div class="food-hd"><b>🍚 오늘의 맛집 TOP 3</b><span id="food-total"></span></div><div id="food-clock"></div><div id="food-list">불러오는 중…</div>` +
    `<button id="food-vote" class="chip">🍚 오늘 맛있게 먹은 곳 알려주기</button><button id="food-roulette" class="chip">🎰 오늘 뭐 먹지? 룰렛 돌리기</button><div id="food-yday"></div></div></div>`;
  document.body.appendChild(el);
  const head = el.querySelector("#fs-head"), mid = el.querySelector("#fs-mid"), bodyEl = el.querySelector("#fs-body");
  const verEl = document.getElementById("ver"); if (verEl) head.appendChild(verEl);   // 버전 글씨가 시트에 가려지지 않게 손잡이 줄 왼쪽으로
  let lvl = 0, dragging = false, y0 = 0, off0 = 0, curOff = 0, moved = 0, t0 = 0, ignoreClick = false;   // lvl: 0 접힘 · 1 반쯤 · 2 끝까지
  const peek = () => { const ic = el.querySelector(".fm-ic"); return head.offsetHeight + (ic ? ic.offsetHeight + 16 + mid.querySelector(".fm-hd").offsetHeight : 0); };   // 접혀도 첫 아이콘 줄까지 걸쳐 보이게
  const closedOff = () => Math.max(0, el.offsetHeight - peek());
  const halfOff = () => Math.max(0, Math.min(closedOff(), el.offsetHeight - peek() - mid.offsetHeight - 14));
  const offs = () => [closedOff(), halfOff(), 0];
  function apply(off, anim) {
    el.style.transition = anim ? "transform .3s cubic-bezier(.22,.8,.3,1)" : "none"; el.style.transform = "translateY(" + off + "px)"; curOff = off;
    document.documentElement.style.setProperty("--sheet-vis", Math.max(0, el.offsetHeight - off) + "px");   // 제보 버튼 등이 시트 위로 올라가게
  }
  function setLevel(n, user, toFood) {
    n = Math.max(0, Math.min(2, n)); const prev = lvl; lvl = n;
    el.classList.toggle("open", n === 2); el.classList.toggle("half", n === 1);
    const hn = document.getElementById("fs-hint"); if (hn) hn.textContent = hintTxt(n);
    apply(offs()[n], true);
    if (n !== prev) sfx(n > prev ? "open" : "close");
    if (n !== 2) bodyEl.scrollTop = 0;                 // 접거나 반쯤으로 돌아오면 맨 위(지금 정읍 칸)부터 보이게
    if (n === 2) {
      if (typeof loadFood === "function") loadFood();
      setTimeout(() => { const f = document.getElementById("food-sec"); bodyEl.scrollTop += toFood && f ? f.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - 4 : -bodyEl.scrollTop; }, 60);
    }
    if (user) { try { localStorage.setItem("sheet_lvl", n === 0 ? "0" : "1"); } catch (e) {} }   // 마지막에 둔 상태 기억 (끝까지 열림은 반쯤으로 저장)
  }
  function bindDrag(h) {
    h.addEventListener("touchstart", e => { if (e.touches.length !== 1) return; dragging = true; moved = 0; y0 = e.touches[0].clientY; t0 = Date.now(); off0 = offs()[lvl]; apply(off0, false); }, { passive: true });
    h.addEventListener("touchmove", e => { if (!dragging) return; const dy = e.touches[0].clientY - y0; moved = Math.max(moved, Math.abs(dy)); apply(Math.min(closedOff(), Math.max(0, off0 + dy)), false); }, { passive: true });
    const end = () => {
      if (!dragging) return; dragging = false; if (moved < 6) { apply(off0, false); return; }
      const v = (curOff - off0) / Math.max(1, Date.now() - t0), o = offs();            // 아래로 빠르게 쓸면 +, 위로 빠르게 쓸면 -
      let target;
      if (Math.abs(v) > 0.4) target = v < 0 ? lvl + 1 : lvl - 1;
      else target = [0, 1, 2].reduce((best, i) => Math.abs(o[i] - curOff) < Math.abs(o[best] - curOff) ? i : best, 0);
      setLevel(target, true); ignoreClick = true; setTimeout(() => ignoreClick = false, 50);
    };
    h.addEventListener("touchend", end); h.addEventListener("touchcancel", end);
  }
  bindDrag(head); bindDrag(mid.querySelector(".fm-hd"));
  head.addEventListener("click", () => { if (ignoreClick) return; setLevel(lvl === 0 ? 1 : lvl === 1 ? 0 : 1, true); });
  mid.querySelectorAll(".fm-ic").forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === "food") setLevel(2, true, true);
    else if (k === "comm") openComm();
    else if (k === "more") toolsToggle();
    else openBoard(k);
  });
  if (SLIDE_N <= 3 && !matchMedia("(prefers-reduced-motion: reduce)").matches) setTimeout(() => {   // 접혀 있을 때만 "끌어올리는 곳"이라고 몸으로 알려주기
    const bump = k => { if (lvl !== 0 || dragging || el.classList.contains("away")) return; apply(Math.max(0, closedOff() - 18), true); setTimeout(() => { if (lvl === 0 && !dragging) apply(closedOff(), true); }, 260); if (k) setTimeout(() => bump(0), 620); };
    bump(1);
  }, 2600);
  // 지도를 누르면: 끝까지 열린 시트는 반쯤으로 (반쯤 열린 시트는 지도를 쓰는 동안 그대로 둠)
  const hookMap = () => { if (typeof map === "undefined" || !map.on) return setTimeout(hookMap, 300); const f = () => { if (lvl === 2) setLevel(1, true); }; map.on("mousedown", f); map.on("touchstart", f); };
  hookMap();
  // 다른 창(제보창·커뮤니티·편집 등)이 열려 있으면 시트를 숨김
  setInterval(() => {
    const busy = !panel.hidden || rpStep !== "none" || !commEl.hidden || ["ed-sheet", "tut", "notice-modal", "welcome"].some(id => { const e = document.getElementById(id); return e && !e.hidden; });
    el.classList.toggle("away", busy); document.body.classList.toggle("sheet-away", busy);
    if (busy && lvl === 2) setLevel(1);
    const wx = document.getElementById("wx-badge"), fw = document.getElementById("fm-wx"); if (fw && wx && fw.textContent !== wx.textContent) fw.textContent = wx.textContent;
  }, 300);
  addEventListener("resize", () => { if (!dragging) apply(offs()[lvl], false); });
  let init = LIVE ? 0 : 1;                      // 처음 5번 방문까지는 반쯤 열어 두고, 그 뒤에는 마지막에 둔 상태로 시작
  try { const n = +localStorage.getItem("visit_n") || 1;  } catch (e) {}
  const settle = () => { if (dragging) return; lvl = init; el.classList.toggle("half", lvl === 1); const hn = document.getElementById("fs-hint"); if (hn) hn.textContent = hintTxt(lvl); apply(offs()[lvl], false); };
  requestAnimationFrame(settle); setTimeout(() => { if (lvl === init) settle(); }, 800);
  return { set(v) { v ? setLevel(2, false, true) : setLevel(0); }, setLevel, isOpen: () => lvl === 2, level: () => lvl,
    summary(t) { const e = document.getElementById("fs-sum"); if (e && e.dataset.t !== t) { e.dataset.t = t; e.innerHTML = t; } }, refit() { if (!dragging) apply(offs()[lvl], false); } };
})();
// ----- 시트 소식 전광판 (최근 제보 4개 + 맛집 1위, 위로 계속 올라감) -----
function sheetSum() {
  const live = reports.filter(r => expAt(r) > Date.now()).sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 5);
  const parts = live.map(r => CATEGORIES[r.cat].icon + " " + esc(r.title));
  if (foodTop) parts.push("🍚 오늘 맛집 1위 " + esc(foodTop.shop_name) + " " + foodTop.cnt + "표");
  if (!parts.length) parts.push("🍚 오늘의 맛집 · 첫 표를 남겨 보세요");
  const txt = parts.join("　　　　");
  foodSheet.summary(`<span class="fs-mq" style="animation-duration:${Math.max(12, txt.length * 0.32)}s">${txt}</span>`);
}
function renderSheetNews() {
  try { sheetSum(); } catch (e) {}
  const box = document.getElementById("fm-news"); if (!box) return;
  const live = reports.filter(r => expAt(r) > Date.now()).sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 4);
  const items = live.map(r => ({ ic: CATEGORIES[r.cat].icon, t: r.title, m: timeAgo(r.ts), go: () => { foodSheet.setLevel(1); focusReport(r); } }));
  if (typeof foodTop !== "undefined" && foodTop) items.push({ ic: "🍚", t: "오늘 맛집 1위 " + foodTop.shop_name, m: foodTop.cnt + "표", go: () => foodSheet.setLevel(2, true, true) });
  if (!items.length) { box.classList.remove("roll"); box.innerHTML = `<div class="fm-empty">아직 소식이 없어요. 첫 소식을 알려주세요 📣</div>`; return; }
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches, roll = items.length > 3 && !calm;
  const row = (it, i) => `<div class="fm-row" data-i="${i}"><span>${it.ic}</span><b>${esc(it.t)}</b><small>${esc(it.m)}</small></div>`;
  const shown = calm ? items.slice(0, 3) : items;
  box.innerHTML = `<div class="fm-track" style="--n:${items.length}">${shown.map((it, i) => row(it, i)).join("")}${roll ? items.map((it, i) => row(it, i)).join("") : ""}</div>`;
  box.classList.toggle("roll", roll);
  box.querySelectorAll(".fm-row").forEach(r => r.onclick = () => items[+r.dataset.i].go());
}
// ----- 종류 게시판 (🚗 🎉 ⏳ 🚨 💡 아이콘 → 살아 있는 제보 + 지난 소식) -----
let boardCat = "traffic";
function openBoard(key) {
  boardCat = key; commTab = "board";
  document.querySelectorAll("#comm-tabs button").forEach(x => x.classList.remove("on"));
  if (commEl.hidden) openComm(); else { commBody.scrollTop = 0; renderComm(); }
}
function setOnlyCat(key, quiet) {
  activeCats = new Set([key]);
  render();
  if (!quiet) shareToast(CATEGORIES[key].icon + " " + CATEGORIES[key].label + "만 보여요 · 위쪽 '전체 보기 ✕'로 돌아와요");
}
function renderBoard() {
  const c = CATEGORIES[boardCat], byNew = (a, b) => new Date(b.ts) - new Date(a.ts);
  const live = reports.filter(r => r.cat === boardCat && expAt(r) > Date.now()).sort(byNew);
  const past = pastReports.filter(r => r.cat === boardCat).sort(byNew).slice(0, 30);
  commBody.innerHTML = `<div class="bd-hd"><span class="cat-badge" style="background:${c.color};color:${c.fg || "#fff"}">${c.icon} ${c.label}</span><b>게시판</b></div>` +
    (live.length ? "" : `<div class="feed-empty">지금 ${esc(c.label)} 소식이 없어요.<br>첫 소식을 알려주세요!</div>`);
  for (const r of live) {
    const card = document.createElement("div"); card.className = "comm-card";
    card.innerHTML = `<div class="comm-meta"><span>${timeAgo(r.ts)}</span><span class="exp-badge" data-exp="${expAt(r)}"></span></div>` +
      `<div class="comm-title">${esc(r.title)}</div>` + (r.desc ? `<div class="comm-desc">${esc(r.desc)}</div>` : "") + (r.photo ? `<a href="${esc(r.photo)}" target="_blank" rel="noopener"><img class="comm-photo" src="${esc(r.photo)}" loading="lazy"></a>` : "") +
      `<div class="shop-act">${rxHtml("report", r.id)}<button class="chip comm-go">📍 지도에서 보기</button><button class="chip comm-share">🔗 공유</button></div>`;
    card.querySelector(".comm-share").onclick = () => shareReport(r);
    card.querySelector(".comm-go").onclick = () => { closeComm(); focusReport(r); };
    commBody.appendChild(card);
  }
  if (past.length) {
    const t = document.createElement("div"); t.className = "bd-past-t"; t.innerHTML = `지난 소식 <small>최근 7일</small>`; commBody.appendChild(t);
    for (const r of past) {
      const card = document.createElement("div"); card.className = "comm-card past";
      card.innerHTML = `<div class="comm-meta"><span>${new Date(r.ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><span class="exp-badge done">마감됨</span></div>` +
        `<div class="comm-title">${esc(r.title)}</div>` + (r.desc ? `<div class="comm-desc">${esc(r.desc)}</div>` : "") + `<div class="shop-act"><button class="chip comm-go">📍 위치 보기</button></div>`;
      card.querySelector(".comm-go").onclick = () => { closeComm(); setTimeout(() => map.flyTo({ center: r.coord, zoom: 17, duration: 1200 }), 250); };
      commBody.appendChild(card);
    }
  }
  const act = document.createElement("div"); act.className = "bd-act";
  act.innerHTML = `<button id="bd-map" class="chip">🗺 지도에서만 보기</button><button id="bd-add" class="chip">📣 ${esc(c.label)} 알려주기</button>`;
  commBody.appendChild(act);
  document.getElementById("bd-map").onclick = () => { closeComm(); setOnlyCat(boardCat); };
  document.getElementById("bd-add").onclick = () => { closeComm(); setTimeout(() => { document.getElementById("fab").click(); catSel.value = boardCat; if (typeof syncCat === "function") syncCat(); }, 260); };
  hydrateRx(commBody); tickExp();
}
// 집계 시간: 한국시간 0시~24시. 남은 시간은 폰 시계로만 계산(서버 요청 없음), 순위는 화면이 켜져 있을 때만 1분마다 새로 불러옴
let foodTop = null, foodDay = "";
renderSheetNews(); setInterval(renderSheetNews, 120000);
function foodLeft() { const ms = 864e5 - ((Date.now() + 9 * 3600e3) % 864e5), m = Math.max(1, Math.ceil(ms / 60000)), h = Math.floor(m / 60); return h ? h + "시간 " + (m % 60) + "분" : m + "분"; }
function foodClock() {
  const left = foodLeft(), c = document.getElementById("food-clock");
  if (c) c.innerHTML = `🕛 오늘 0시~24시 집계 · <b>${left}</b> 후 마감`;
  if (typeof renderSheetNews === "function") renderSheetNews();
  try { sheetSum(); } catch (e) {}
}
loadFood();
setInterval(() => { if (document.hidden) return; if (kstDay() !== foodDay) loadFood(); else { foodClock(); loadFood(); } }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadFood(); });


// ===== 🎰 오늘 뭐 먹지? 룰렛 (오늘 맛집 투표가 많을수록 칸이 넓음 · 부족하면 최근 7일·정읍 음식점으로 채움) =====
const RL_COLORS = ["#C83E2B", "#E09F3E", "#2E8B6A", "#7A5BC4", "#D9622B", "#3C7DC4", "#B8447A", "#8C6A3F"];
async function rlCandidates() {
  const pool = SHOPS.concat((EDITS && EDITS.added) || []).map(x => shopInfo(x.id)).filter(x => x && !x.hidden && /음식점/.test(x.category || ""));
  const w = new Map();   // id → 가중치
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/food_votes?select=day,shop_id,choice&day=gte." + kstDay(-6) + "&limit=2000", { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } });
    if (r.ok) for (const v of await r.json()) if (v.choice !== "meh") w.set(v.shop_id, (w.get(v.shop_id) || 0) + (v.day === kstDay() ? 3 : 1));   // 오늘 표는 3배
  } catch (e) {}
  let list = [...w].map(([id, wt]) => ({ s: shopInfo(id), wt })).filter(c => c.s && !c.s.hidden).sort((a, b) => b.wt - a.wt).slice(0, 8);
  const have = new Set(list.map(c => c.s.id)), rest = pool.filter(x => !have.has(x.id));
  while (list.length < 6 && rest.length) list.push({ s: rest.splice(Math.floor(Math.random() * rest.length), 1)[0], wt: 1 });
  return list;
}
async function openRoulette() {
  const m = document.getElementById("notice-modal");
  m.innerHTML = '<div class="nm rl"><b>🎰 오늘 뭐 먹지?</b><div id="rl-wrap"><i id="rl-pin">▼</i><canvas id="rl-cv" width="560" height="560"></canvas></div><div id="rl-res">후보를 불러오는 중…</div><div class="rl-btns"><button id="rl-spin" class="chip" disabled>돌리기!</button><button id="nm-x">닫기</button></div></div>';
  m.hidden = false; document.getElementById("nm-x").onclick = () => m.hidden = true;
  const list = await rlCandidates(), cv = document.getElementById("rl-cv"), res = document.getElementById("rl-res"), spin = document.getElementById("rl-spin");
  if (!cv || !list.length) { if (res) res.textContent = "후보가 아직 없어요. 맛있게 먹은 곳을 알려 주세요!"; return; }
  const tot = list.reduce((a, c) => a + c.wt, 0), g = cv.getContext("2d"), R = 280; let a0 = 0;
  list.forEach((c, i) => { c.a0 = a0; c.a1 = a0 + c.wt / tot * Math.PI * 2; a0 = c.a1; g.beginPath(); g.moveTo(R, R); g.arc(R, R, R - 4, c.a0, c.a1); g.closePath(); g.fillStyle = RL_COLORS[i % RL_COLORS.length]; g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 4; g.stroke();
    g.save(); g.translate(R, R); g.rotate((c.a0 + c.a1) / 2); g.fillStyle = "#fff"; g.font = "bold 30px Pretendard, sans-serif"; g.textAlign = "right"; g.textBaseline = "middle";
    let n = c.s.name; if (n.length > 8) n = n.slice(0, 7) + "…"; g.fillText(n, R - 26, 0); g.restore(); });
  res.innerHTML = "오늘 투표가 많은 가게일수록 칸이 넓어요"; spin.disabled = false;
  let rot = 0, busy = false;
  spin.onclick = () => {
    if (busy) return; busy = true; spin.disabled = true; res.textContent = "두근두근…";
    let x = Math.random() * tot, win = list[list.length - 1]; for (const c of list) { if (x < c.wt) { win = c; break; } x -= c.wt; }
    const mid = (win.a0 + win.a1) / 2 + (Math.random() - .5) * (win.a1 - win.a0) * .6, targetDeg = (-90 - mid * 180 / Math.PI) % 360;
    rot += 360 * 5 + (((targetDeg - rot) % 360) + 360) % 360;
    cv.style.transition = "transform 4s cubic-bezier(.12,.7,.15,1)"; cv.style.transform = "rotate(" + rot + "deg)";
    const tks = []; for (let t = 0, gap = 55; t < 3900; t += gap, gap *= 1.13) tks.push(setTimeout(() => sfx("tick"), t));   // 점점 느려지는 틱틱 소리
    setTimeout(() => {
      tks.forEach(clearTimeout); sfx("win"); busy = false; spin.disabled = false; spin.textContent = "🔄 다시 돌리기";
      res.innerHTML = `<div class="rl-win">🎉 오늘은 <b>${esc(win.s.name)}</b>!</div><div class="rl-act"><button id="rl-go" class="chip">📍 지도에서 보기</button><button id="rl-share" class="chip">💌 친구에게 보내기</button></div>`;
      document.getElementById("rl-go").onclick = () => { m.hidden = true; foodSheet.set(false); map.flyTo({ center: win.s.coord, zoom: 18, pitch: 55, duration: 1500 }); };
      document.getElementById("rl-share").onclick = async () => { const text = `오늘은 "${win.s.name}" 어때? 🍚 정읍 지금 룰렛이 골라줬어!`, url = location.origin + location.pathname; try { if (navigator.share) await navigator.share({ title: "정읍 지금", text, url }); else { await navigator.clipboard.writeText(text + " " + url); alert("복사했어요! 카톡에 붙여넣기 하세요"); } } catch (e) {} };
    }, 4100);
  };
}
document.getElementById("food-roulette").onclick = openRoulette;
