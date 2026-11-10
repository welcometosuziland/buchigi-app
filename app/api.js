// 서버와 주고받는 공통 함수 (자녀 앱, 부모님 화면 함께 사용)
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};

function apiBase() {
  return (store.get("buchigi_api") || window.BUCHIGI_CONFIG.API_BASE).replace(/\/$/, "");
}
function familyCode() {
  return store.get("buchigi_code") || "";
}

async function api(path, { method = "GET", json, form, blob = false } = {}) {
  const headers = { "x-device-token": familyCode() };
  let body;
  if (json) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  let res;
  try {
    res = await fetch(apiBase() + path, { method, headers, body });
  } catch {
    throw new Error("서버에 연결할 수 없어요. 서버 주소와 인터넷 연결을 확인해 주세요.");
  }
  if (!res.ok) {
    let msg = `요청이 실패했어요 (${res.status})`;
    try { const d = await res.json(); if (d.detail) msg = d.detail; } catch { /* 본문 없음 */ }
    if (res.status === 401) msg = "가족 코드가 맞지 않아요. 설정에서 다시 입력해 주세요.";
    throw new Error(msg);
  }
  return blob ? res.blob() : res.json();
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}
