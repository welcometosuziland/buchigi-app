// 자녀 앱
const view = document.getElementById("view");
const tabs = document.getElementById("tabs");
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function show(...nodes) { view.replaceChildren(...nodes); window.scrollTo(0, 0); }
function header() {
  return el("header", { class: "header" },
    el("span", { class: "logo" }, "부치기 바치기"),
    el("button", { class: "textbtn", onclick: () => go("settings") }, "설정"));
}
function page(title, sub, ...body) {
  return el("div", {}, header(),
    el("div", { class: "page-title" }, el("h1", {}, title), sub ? el("p", { class: "sub", style: "margin-top:6px" }, sub) : null),
    el("div", { class: "gap" }, ...body));
}
function loading() { show(header(), el("p", { class: "sub", style: "padding:24px 4px" }, "불러오는 중")); }
function errorBox(e) { return el("p", { class: "error", role: "alert" }, e.message || String(e)); }
function parentLink() {
  const u = new URL("parent.html", location.href);
  u.hash = "code=" + encodeURIComponent(familyCode()) + "&api=" + encodeURIComponent(apiBase());
  return u.toString();
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); btn.textContent = "링크를 복사했어요"; }
  catch { prompt("아래 링크를 복사해 부모님께 보내 주세요", text); }
}
const md = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
const short = (s, n = 18) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");

/* 변화 판단: 부모님 본인의 첫 주와 최근 주를 비교 */
function trend(weekly, key, higherIsBetter) {
  const vals = weekly.map((w) => w[key]).filter((v) => v != null);
  if (!vals.length) return { label: "기록 전", tone: "t-lav", pct: 30, last: null };
  const last = vals.at(-1);
  const pct = higherIsBetter
    ? (last / Math.max(...vals, 0.0001)) * 100
    : (Math.min(...vals) / Math.max(last, 0.0001)) * 100;
  if (vals.length < 2) return { label: "기록 중", tone: "t-lav", pct, last };
  const base = vals[0] || 0.0001;
  const r = (last - base) / base;
  const worse = higherIsBetter ? r < -0.15 : r > 0.15;
  const better = higherIsBetter ? r > 0.15 : r < -0.15;
  if (worse) return { label: "살펴봐요", tone: "t-pink", pct, last };
  return { label: better ? "좋아요" : "비슷해요", tone: "t-mint", pct, last };
}
function meter(label, t) {
  return el("div", { class: "meter" },
    el("span", { class: "label" }, label),
    el("div", { class: "track", role: "img", "aria-label": `${label}: ${t.label}` },
      el("div", { class: `fill ${t.tone}`, style: `width:${Math.max(t.pct, 22)}%` }, el("span", { class: "chip" }, t.label))));
}

/* ---------- 처음 연결 ---------- */
function setup(message) {
  tabs.hidden = true;
  const apiInput = el("input", { type: "url", id: "api", value: apiBase(), autocomplete: "off" });
  const code = el("input", { type: "text", id: "code", value: familyCode(), autocomplete: "off" });
  const btn = el("button", { class: "btn block", onclick: async () => {
    store.set("buchigi_api", apiInput.value.trim());
    store.set("buchigi_code", code.value.trim());
    btn.disabled = true; btn.textContent = "확인하는 중";
    try { await api("/settings"); go("home"); } catch (e) { setup(e.message); }
  } }, "연결하기");
  show(el("div", { style: "padding-top:40px" }, el("div", { class: "gap" },
    el("div", { class: "panel hero" },
      el("p", { class: "sub" }, "우리 엄마 기억 저장소"),
      el("h1", { style: "font-size:30px;margin-top:6px" }, "부모님의 새로운 말동무"),
      el("p", { style: "margin-top:10px" }, "가족 코드를 입력하면 부모님과의 추억 대화를 시작할 수 있어요.")),
    el("div", { class: "field" }, el("label", { for: "api" }, "서버 주소"), apiInput),
    el("div", { class: "field" }, el("label", { for: "code" }, "가족 코드"), code),
    message ? errorBox(new Error(message)) : null,
    btn)));
}

/* ---------- 홈 ---------- */
async function home() {
  loading();
  try {
    const [st, rep] = await Promise.all([api("/settings"), api("/report")]);
    const now = new Date();
    const cards = [];
    if (!st.consented) {
      cards.push(el("section", { class: "panel hero stack" },
        el("h2", {}, "부모님 동의를 기다리고 있어요"),
        el("p", {}, "부모님이 링크를 열고 함께 나눌 범위를 정하시면 대화가 시작돼요. 동의 전에는 아무것도 저장되지 않아요."),
        el("button", { class: "btn", onclick: (e) => copy(parentLink(), e.target) }, "부모님 화면 링크 복사")));
    } else {
      const dates = rep.dates || [];
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const monthCount = dates.filter((d) => d.startsWith(ym)).length;
      const w = rep.weekly || [];
      cards.push(el("section", { class: "panel" },
        el("h2", {}, "이번 달 대화 기록"),
        el("p", { class: "sub" }, `${now.getFullYear()}년 ${now.getMonth() + 1}월`),
        el("div", { class: "big-num" }, el("strong", {}, String(monthCount)), el("span", {}, "번 대화했어요")),
        el("div", { style: "margin-top:16px" },
          meter("대화 참여", trend(w, "count", true)),
          meter("대답 속도", trend(w, "avg_delay_sec", false)),
          meter("이야기 양", trend(w, "avg_chars", true))),
        el("p", { class: "note", style: "margin-top:16px" }, "진단이 아닌 대화 기록이에요. 부모님 본인의 지난 기록과 비교해요.")));

      const latest = (rep.recent || []).find((r) => r.transcript);
      if (latest) {
        cards.push(el("section", { class: "panel stack" },
          el("h2", {}, "오늘의 대화 거리"),
          el("p", { class: "bubble ask" }, latest.question),
          el("p", { class: "bubble say" }, latest.transcript),
          el("p", { class: "sub" }, `${md(latest.date)}에 이렇게 말씀하셨어요. 전화해서 더 여쭤보는 건 어떨까요?`)));
      }

      const recent = (rep.recent || []).slice(0, 3);
      if (recent.length) {
        cards.push(el("section", { class: "panel" }, el("h2", { style: "margin-bottom:14px" }, "최근 대화"),
          el("div", { class: "stack" }, recent.map((r) => el("div", { class: "card item" },
            el("span", { class: `dot ${r.check ? "t-pink" : "t-mint"}` }),
            el("div", {}, el("h3", {}, short(r.question, 22)),
              el("p", { class: "sub" }, `${md(r.date)} · ${r.check ? "다시 살펴볼 만한 대화예요" : "이야기를 나누셨어요"}`)))))));
      }

      const start = new Date(now); start.setDate(now.getDate() - now.getDay());
      const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
      const set = new Set(dates);
      const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      cards.push(el("section", { class: "panel" },
        el("h2", {}, "이번 주 가족 달력"),
        el("div", { class: "week" },
          DOW.map((d) => el("span", { class: "dow" }, d)),
          days.map((d) => el("span", { class: `day${set.has(key(d)) ? " on" : ""}${key(d) === key(now) ? " today" : ""}` }, String(d.getDate())))),
        el("div", { class: "legend" }, el("span", {}, el("i", { class: "t-mint" }), "추억 대화한 날"))));
    }
    cards.push(el("button", { class: "btn block", onclick: () => go("add") }, "새 추억 올리기"));
    show(el("div", {}, header(), el("div", { class: "gap", style: "padding-top:6px" }, ...cards)));
  } catch (e) { show(header(), errorBox(e)); }
}

/* ---------- 추억 올리기 ---------- */
function add() {
  const file = el("input", { type: "file", accept: "image/*", hidden: true });
  const pick = el("button", { class: "photo-pick", onclick: () => file.click() }, "사진 고르기");
  file.addEventListener("change", () => {
    const f = file.files[0];
    if (f) pick.replaceChildren(el("img", { src: URL.createObjectURL(f), alt: "고른 사진 미리보기" }));
  });
  const field = (id, label, hint, multi) => el("div", { class: "field" },
    el("label", { for: id }, label, el("span", { class: "hint" }, hint)),
    multi ? el("textarea", { id }) : el("input", { type: "text", id }));
  const msg = el("div");
  const submit = el("button", { class: "btn block", onclick: async () => {
    if (!file.files[0]) { msg.replaceChildren(errorBox(new Error("사진을 먼저 골라 주세요."))); return; }
    const fd = new FormData();
    fd.append("image", file.files[0]);
    for (const id of ["taken_when", "place", "people", "story", "keywords"]) fd.append(id, document.getElementById(id).value.trim());
    submit.disabled = true; submit.textContent = "질문 후보를 만들고 있어요";
    try { const r = await api("/photos", { method: "POST", form: fd }); pickQuestions(r.photo, r.candidates); }
    catch (e) { msg.replaceChildren(errorBox(e)); submit.disabled = false; submit.textContent = "추억 보내기"; }
  } }, "추억 보내기");
  show(page("추억 올리기", "적어주신 내용으로 부모님께 드릴 질문을 만들어요.",
    pick, file,
    field("taken_when", "언제", "예: 2019년 여름"),
    field("place", "어디서", "예: 제주도"),
    field("people", "누구와", "예: 엄마, 아빠, 민준이"),
    field("story", "어떤 날이었나요", "예: 손주가 처음 바다에 들어간 날", true),
    field("keywords", "꼭 알아들어야 할 이름", "쉼표로 구분, 3글자 이상"),
    msg, submit));
}

const TYPE_TONE = { "기분": "t-pink", "감각": "t-blue", "사람": "t-lav", "재미있던 일": "t-lime", "요즘 이야기": "t-mint", "가볍게": "t-coral" };

function pickQuestions(photo, candidates) {
  const list = el("div", { class: "stack" });
  const count = el("span", {});
  const send = el("button", { class: "btn block" });
  const update = () => {
    const n = list.querySelectorAll("input:checked").length;
    send.textContent = n ? `고른 질문 ${n}개 보내기` : "질문을 골라 주세요";
    send.disabled = !n;
    count.textContent = `${n}개 골랐어요`;
  };
  const addCard = (c, checked = false) => {
    const box = el("input", { type: "checkbox", checked, "aria-label": "이 질문 고르기" });
    const card = el("label", { class: `pick${checked ? " on" : ""}` }, box,
      el("div", {}, el("span", { class: `type ${TYPE_TONE[c.type] || "t-lav"}` }, c.type || "직접 쓴 질문"),
        el("p", { class: "qtext" }, c.text)));
    box.addEventListener("change", () => { card.classList.toggle("on", box.checked); update(); });
    list.append(card);
  };
  candidates.forEach((c) => addCard(c));
  update();

  const msg = el("div");
  const more = el("button", { class: "btn line block", onclick: async () => {
    more.disabled = true; more.textContent = "질문을 더 만들고 있어요";
    try {
      const avoid = [...list.querySelectorAll(".qtext")].map((x) => x.textContent);
      const { candidates: extra } = await api(`/photos/${photo.id}/candidates`, { method: "POST", json: { avoid } });
      extra.forEach((c) => addCard(c));
    } catch (e) { msg.replaceChildren(errorBox(e)); }
    more.disabled = false; more.textContent = "다른 질문 더 보기";
  } }, "다른 질문 더 보기");

  const own = el("input", { type: "text", id: "own", placeholder: "예: 그날 먹은 회 맛있었죠?" });
  const addOwn = el("button", { class: "btn line small", onclick: () => {
    if (!own.value.trim()) return;
    addCard({ type: "", text: own.value.trim() }, true); own.value = ""; update();
  } }, "추가");

  send.onclick = async () => {
    const texts = [...list.querySelectorAll(".pick")].filter((c) => c.querySelector("input").checked).map((c) => c.querySelector(".qtext").textContent);
    send.disabled = true; send.textContent = "보내는 중";
    try { await api(`/photos/${photo.id}/questions`, { method: "POST", json: { texts } }); go("album"); }
    catch (e) { msg.replaceChildren(errorBox(e)); update(); }
  };

  show(page("어떤 질문을 드릴까요?", "부모님이 편하게 이야기를 시작하실 수 있는 질문을 골라 주세요. 2~4개를 추천해요.",
    el("div", { class: "photo" }, el("img", { src: photo.photo_url, alt: "올린 사진" }), el("span", { class: "tag" }, photo.caption)),
    el("div", { class: "panel stack" },
      el("div", { style: "display:flex;justify-content:space-between;align-items:center" }, el("h2", {}, "질문 후보"), el("span", { class: "sub" }, count)),
      list, more),
    el("div", { class: "panel stack" },
      el("h3", {}, "직접 쓰기"),
      el("p", { class: "sub" }, "가족만 아는 이야기를 넣으면 더 반가워하세요."),
      el("div", { style: "display:flex;gap:8px" }, own, addOwn)),
    msg, send));
}

/* ---------- 앨범 ---------- */
async function album() {
  loading();
  try {
    const photos = await api("/photos");
    if (!photos.length) {
      show(page("우리 가족 앨범", "올린 사진과 부모님의 이야기가 여기에 쌓여요.",
        el("div", { class: "panel stack" }, el("p", {}, "아직 올린 추억이 없어요."),
          el("button", { class: "btn", onclick: () => go("add") }, "첫 추억 올리기"))));
      return;
    }
    const cards = photos.map((p) => {
      const thread = (p.questions || []).sort((a, b) => a.id - b.id).flatMap((q) => {
        const out = [el("p", { class: "bubble ask" }, q.text)];
        for (const a of q.answers || []) {
          out.push(a.transcript ? el("p", { class: "bubble say" }, a.transcript)
            : el("p", { class: "bubble hidden" }, "부모님이 내용 공유를 허락하지 않으셨어요"));
          const play = a.can_play ? el("button", { class: "textbtn", onclick: async (e) => {
            try { const { url } = await api(`/answers/${a.id}/audio`); new Audio(url).play(); }
            catch (err) { e.target.textContent = err.message; }
          } }, "목소리 듣기") : null;
          out.push(el("p", { class: "meta" }, md(a.created_at), play ? " · " : "", play));
        }
        if (!(q.answers || []).length) out.push(el("p", { class: "meta" }, "아직 여쭤보지 않았어요"));
        return out;
      });
      const pickBtn = (p.questions || []).length ? null : el("button", { class: "btn block", onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = "질문 후보를 만들고 있어요";
        try { const { candidates } = await api(`/photos/${p.id}/candidates`, { method: "POST", json: { avoid: [] } }); pickQuestions(p, candidates); }
        catch (err) { e.target.textContent = err.message; }
      } }, "질문 고르기");
      return el("article", { class: "panel stack" },
        el("div", { class: "photo" }, el("img", { src: p.photo_url, alt: p.caption, loading: "lazy" }), el("span", { class: "tag" }, p.caption)),
        ...thread, pickBtn);
    });
    show(page("우리 가족 앨범", "사진마다 부모님이 들려주신 이야기예요.", ...cards));
  } catch (e) { show(header(), errorBox(e)); }
}

/* ---------- 리포트 ---------- */
async function report() {
  loading();
  try {
    const rep = await api("/report");
    if (!rep.consented || !rep.weekly.length) {
      show(page("변화 기록", null, el("div", { class: "panel" },
        el("p", {}, rep.consented ? "아직 나눈 이야기가 없어요. 추억을 올리면 부모님 화면에 질문이 나가요." : "부모님이 동의하시면 대화 기록이 쌓이기 시작해요."))));
      return;
    }
    const w = rep.weekly;
    const rows = w.map((x) => el("tr", {},
      el("td", {}, x.week.replace(/^\d{4}-W/, "") + "주"), el("td", {}, String(x.count)),
      el("td", {}, x.avg_delay_sec == null ? "-" : x.avg_delay_sec + "초"),
      el("td", {}, x.avg_chars == null ? "-" : Math.round(x.avg_chars) + "자"),
      el("td", {}, x.mention_rate == null ? "-" : Math.round(x.mention_rate * 100) + "%")));
    const recent = rep.recent.map((r) => el("div", { class: "card stack" },
      el("div", { style: "display:flex;justify-content:space-between;align-items:center" },
        el("span", { class: "sub" }, md(r.date)), r.check ? el("span", { class: "flag" }, "살펴볼 대화") : null),
      el("p", { class: "bubble ask" }, r.question),
      r.transcript ? el("p", { class: "bubble say" }, r.transcript) : null,
      el("p", { class: "sub" }, `대답까지 ${r.delay_sec ?? "-"}초 · ${r.duration_sec ?? "-"}초 동안 말씀`,
        r.keywords.length ? ` · 사진 속 이름 ${r.mentioned.length}/${r.keywords.length}` : "")));
    show(page("변화 기록", "부모님 본인의 첫 기록과 최근 기록을 비교해요.",
      el("section", { class: "panel" },
        meter("대화 참여", trend(w, "count", true)),
        meter("대답 속도", trend(w, "avg_delay_sec", false)),
        meter("이야기 양", trend(w, "avg_chars", true)),
        meter("이름·장소", trend(w, "mention_rate", true)),
        el("details", { style: "margin-top:18px" }, el("summary", {}, "주별 숫자로 보기"),
          el("table", {}, el("thead", {}, el("tr", {}, ["주", "횟수", "대답까지", "말씀 양", "이름·장소"].map((h) => el("th", {}, h)))), el("tbody", {}, rows)))),
      el("h2", { style: "padding:0 4px" }, "최근 대화"),
      el("div", { class: "panel stack" }, ...recent),
      el("p", { class: "panel note" }, "이 기록은 진단이 아님을 밝힙니다.")));
  } catch (e) { show(header(), errorBox(e)); }
}

/* ---------- 설정 ---------- */
async function settingsView() {
  const parts = [];
  try {
    const st = await api("/settings");
    const row = (label, ok, yes, no) => el("div", { class: "card item" },
      el("span", { class: `dot ${ok ? "t-mint" : "t-pink"}` }),
      el("div", {}, el("h3", {}, label), el("p", { class: "sub" }, ok ? yes : no)));
    parts.push(el("section", { class: "panel stack" },
      el("h2", { style: "margin-bottom:4px" }, "부모님이 정한 공유 범위"),
      row("동의", st.consented, "동의하셨어요", "아직 동의하지 않으셨어요"),
      row("대화 내용", st.share_transcript, "글로 보여줘도 좋다고 하셨어요", "보여주지 않아요"),
      row("목소리", st.share_audio, "들려줘도 좋다고 하셨어요", "들려주지 않아요"),
      el("p", { class: "note" }, "공유 범위는 부모님 화면에서만 바꿀 수 있어요.")));
  } catch (e) { parts.push(errorBox(e)); }
  parts.push(el("section", { class: "panel stack" },
    el("h2", {}, "부모님 화면"),
    el("p", {}, "링크를 부모님 휴대폰이나 태블릿으로 보내 주세요. 처음 열면 동의 화면이 나와요."),
    el("button", { class: "btn block", onclick: (e) => copy(parentLink(), e.target) }, "부모님 화면 링크 복사"),
    el("a", { class: "btn line block", href: parentLink(), target: "_blank" }, "부모님 화면 미리보기")));
  parts.push(el("button", { class: "textbtn", onclick: () => setup() }, "서버 주소와 가족 코드 바꾸기"));
  show(page("설정", null, ...parts));
}

/* ---------- 이동 ---------- */
const routes = { home, add, album, report, settings: settingsView };
function go(name) {
  tabs.hidden = false;
  for (const b of tabs.querySelectorAll("button")) {
    if (b.dataset.tab === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  routes[name]();
}
tabs.addEventListener("click", (e) => { const t = e.target.closest("button"); if (t) go(t.dataset.tab); });
if (!familyCode()) setup(); else go("home");
