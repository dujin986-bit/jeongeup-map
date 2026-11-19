// 정읍 지도 기본 데이터. 구역/장소는 여기에 하나씩 추가하면 됩니다.
// 좌표는 [경도, 위도]. 대략적인 위치이므로 이후 정확히 보정하세요.

const JEONGEUP_CENTER = [126.8560, 35.5700];

const CATEGORIES = {
  traffic: { label: "교통",   color: "#e5484d" },
  event:   { label: "행사",   color: "#8e4ec6" },
  wait:    { label: "웨이팅", color: "#f76b15" },
  incident:{ label: "사건사고", color: "#111111" },
  info:    { label: "생활정보", color: "#1f6feb" },
};

// 제보 자동 만료 (시간 단위). 지나면 지도·목록에서 자동으로 사라짐 (DB에는 남음)
const EXPIRE_HOURS = { traffic: 6, wait: 3, incident: 24, event: 72, info: 72 };

// 큰 틀: 주요 거점 (이후 구역별로 채워나갈 곳)
const LANDMARKS = [
  { name: "정읍시청",   coord: [126.8560, 35.5700], cat: "info",  desc: "시내 중심" },
  { name: "정읍역",     coord: [126.8447, 35.5766], cat: "info",  desc: "KTX/SRT 정차역 (좌표 보정 필요)" },
  { name: "내장산국립공원", coord: [126.8886, 35.4896], cat: "event", desc: "단풍 명소. 성수기 도로 정체 구간 (좌표 보정 필요)" },
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
