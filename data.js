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
