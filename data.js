// 정읍 지도 기본 데이터. 구역/장소는 여기에 하나씩 추가하면 됩니다.
// 좌표는 [경도, 위도]. 대략적인 위치이므로 이후 정확히 보정하세요.

const JEONGEUP_CENTER = [126.8560, 35.5700];

const CATEGORIES = {
  traffic: { label: "교통",   icon: "🚗", color: "#EF4444" },
  event:   { label: "행사",   icon: "🎉", color: "#A855F7" },
  wait:    { label: "웨이팅", icon: "⏳", color: "#F59E0B", fg: "#1E1B18" },
  incident:{ label: "사건사고", icon: "🚨", color: "#C2410C" },
  info:    { label: "생활정보", icon: "💡", color: "#10B981", fg: "#06281D" },
};
const SHOP_CHIP_LABEL = "🍽 가게";   // 상가 칩 글자(여러 곳에서 같이 씀)

// 제보 자동 만료 (시간 단위). 지나면 지도·목록에서 자동으로 사라짐 (DB에는 남음)
const EXPIRE_HOURS = { traffic: 3, wait: 2, incident: 12, event: 48, info: 24 };
// 만료 시각(ms): 관리자가 정한 expires_at 이 있으면 그것, 없으면 작성 시각 + 분류별 기본 시간
function reportExpMs(createdAt, category, expiresAt) {
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(t) ? t : new Date(createdAt).getTime() + (EXPIRE_HOURS[category] || 72) * 3600e3;
}

// 큰 틀: 주요 거점 (이후 구역별로 채워나갈 곳)
const LANDMARKS = [
  { name: "내장산국립공원", coord: [126.8886, 35.4896], cat: "event", desc: "단풍 명소. 성수기 도로 정체 구간 (좌표 보정 필요)" },
];

// 관공서 (지도에 크게 표시). approx:true 는 위치가 대략적이라는 뜻 → 팝업에 안내. 전화번호는 확인된 것만 넣을 것
const OFFICES = [
  { name: "정읍시청",       type: "시청",   coord: [126.8560, 35.5700], addr: "정읍시 충정로 234 (수성동)", tel: "063-539-7114", approx: false },
  { name: "정읍시보건소",   type: "보건소", coord: [126.8545, 35.5780], addr: "정읍시 수성1로 61 (수성동)", approx: false },
  { name: "정읍역",         type: "역",     coord: [126.8424, 35.5755], addr: "정읍시 연지동 343-414", approx: false },
  { name: "내장산동 주민센터 내장출장소", type: "주민센터", coord: [126.89089, 35.53468], addr: "정읍시 대석1길 13-16", approx: false },
];

// 구역 로드맵 (진행 상황 표시용)
const ZONES = [
  { id: "naejangsan", name: "내장산 일대", status: "todo" },
  { id: "downtown",   name: "시내 중심가", status: "todo" },
  { id: "residential",name: "주거지",      status: "todo" },
];

// 제보 서버(Supabase). 공개해도 되는 publishable 키입니다. (secret 키는 절대 넣지 마세요)
const SUPABASE_URL = "https://ljluvdikyjgniyuvgotk.supabase.co";
const SUPABASE_KEY = "sb_publishable_5_Zs5kq3U3CGO1gWGDn7RQ_hyTRhybK";

// 방송 모드 자동 카메라 코스 (center=[경도,위도])
const TOUR = [
  { name: "정읍 시내",   center: [126.8575, 35.5700], zoom: 15.6, pitch: 62, bearing: 20 },
  { name: "내장산",      center: [126.8900, 35.4900], zoom: 14.6, pitch: 66, bearing: -30 },
  { name: "상동 · 수성", center: [126.8720, 35.5570], zoom: 15.8, pitch: 62, bearing: 140 },
  { name: "정읍역 일대", center: [126.8470, 35.5700], zoom: 15.6, pitch: 62, bearing: 250 },
];

const WEATHER_POINT = { lat: 35.57, lon: 126.856 };   // 날씨를 가져올 기준 위치(정읍 시내)

// 커뮤니티 화면 상단 "이번 주 주제" (바꾸려면 이 줄만 고치면 됨. 비우면 숨김)
const COMM_TOPIC = "내장산 단풍, 지금 어디가 제일 예뻐요?";

// 관리자 이메일 (화면에 편집 버튼을 보여 주는 용도. 실제 쓰기 권한은 서버(RLS)에서 따로 막는다)
const ADMIN_EMAIL = "dujin986@gmail.com";

// ===== 웹푸시 (공개키만 넣는 자리. 비공개 키는 절대 여기에 넣지 마세요) =====
const VAPID_PUBLIC_KEY = "BHv-8xukSXPJwfxQEQywKXs84vGhxm443JhfQ6VMcK-dHN41Z0rU_PQ7mAqN_Wx-g2R7csCG-6OQBJfbq6Vc5N8";   // npx web-push generate-vapid-keys 로 만든 Public Key
function pushReady() { return !!VAPID_PUBLIC_KEY && !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
function pushKeyBytes(b64) { const p = "=".repeat((4 - b64.length % 4) % 4), s = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function pushGetSub(create) {            // 이 기기의 푸시 구독을 가져오거나(create=true면) 새로 만든다
  // 허용창은 버튼을 누른 직후(다른 await 전에) 바로 요청해야 폰에서 뜬다
  const permP = (create && Notification.permission === "default") ? Notification.requestPermission() : null;
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) reg = await navigator.serviceWorker.register("sw.js");           // 등록이 안 돼 있으면 지금 등록
  reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error("서비스 워커가 준비되지 않았어요. 페이지를 새로고침한 뒤 다시 눌러 주세요.")), 8000))]);
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) {
    const to = (ms, msg) => new Promise((_, no) => setTimeout(() => no(new Error(msg)), ms));
    if (Notification.permission === "denied") throw new Error("이 사이트의 알림이 차단돼 있어요. 주소창 왼쪽 자물쇠(또는 ⓘ) → 권한/사이트 설정 → 알림을 '허용'으로 바꿔 주세요.");
    const perm = permP ? await Promise.race([permP, to(20000, "알림 허용창이 나타나지 않았어요. (현재 상태: " + Notification.permission + ") 주소창 오른쪽 위 ⋮ → 설정 → 사이트 설정 → 알림 에서 이 사이트(dujin986-bit.github.io)를 '허용'으로 바꾼 뒤 다시 눌러 주세요. (삼성 인터넷: ≡ → 설정 → 사이트 및 다운로드 → 알림)")]) : Notification.permission;
    if (perm !== "granted") throw new Error("알림이 허용되지 않았어요. (상태: " + perm + ")");
    try { sub = await Promise.race([reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKeyBytes(VAPID_PUBLIC_KEY) }), to(20000, "알림 서버(구글/삼성) 연결 응답이 없어요. 인터넷·절전 설정을 확인하고 다시 시도해 주세요.")]); }
    catch (e) { throw new Error("알림 등록에 실패했어요: " + (e && e.message ? e.message : e)); }
  }
  return sub;
}
function pushRow(sub, role) { const j = sub.toJSON(); return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, role }; }


// 공지 종류(색): 관리자 공지 올리기와 지도 위 띠·공지 창이 같이 씁니다. rank가 클수록 띠 색을 우선 차지합니다.
const NOTICE_TYPES = {
  normal:  { icon: "📢", label: "일반",       cname: "파랑",   color: "#2B6CD6", soft: "#EAF2FF", rank: 1 },
  urgent:  { icon: "🚨", label: "긴급",       cname: "빨강",   color: "#D9232D", soft: "#FDE9E4", rank: 5 },
  event:   { icon: "🎉", label: "행사·축제",  cname: "초록",   color: "#1F9D61", soft: "#E7F6EE", rank: 2 },
  traffic: { icon: "🚧", label: "교통·주의",  cname: "주황",   color: "#E8780E", soft: "#FFF0E0", rank: 4 },
  promo:   { icon: "🎁", label: "이벤트·할인", cname: "노랑",   color: "#F2C230", soft: "#FFF7D6", rank: 2, fg: "#1E1B18" },
  guide:   { icon: "🛠", label: "점검·안내",  cname: "보라",   color: "#7A5BC4", soft: "#EFE9FA", rank: 1 },
  season:  { icon: "🍂", label: "계절·날씨",  cname: "갈색",   color: "#8C5A2B", soft: "#F5ECE1", rank: 1 },
};
const noticeType = lv => NOTICE_TYPES[lv] || NOTICE_TYPES.normal;
