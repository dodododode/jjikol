// ─────────────────────────────────────────────
// 여기만 고치면 됩니다.
// 1) name: 앱 이름 (나중에 바꿔도 이 한 줄만 고치면 전체에 반영)
// 2) firebase: Firebase 콘솔 > 프로젝트 설정 > 내 앱 에 나오는 값 그대로 붙여넣기
// ─────────────────────────────────────────────
window.APP = {
  name: "찍올",
  maxPhotos: 100,          // 한 번에 올릴 수 있는 최대 장수
  firebase: {
    apiKey: "여기에_apiKey",
    authDomain: "여기에_authDomain",
    projectId: "여기에_projectId",
    storageBucket: "여기에_storageBucket",
    messagingSenderId: "여기에_messagingSenderId",
    appId: "여기에_appId"
  }
};
