/* 아이밸런스 EDI 차트생성기 — 확장 아이콘을 누르면 사이드 패널을 연다. 그 밖의 일은 하지 않는다. */
function openPanelOnClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
chrome.runtime.onInstalled.addListener(openPanelOnClick);
chrome.runtime.onStartup.addListener(openPanelOnClick);
openPanelOnClick();
