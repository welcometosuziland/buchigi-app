// 부모님 화면: 동의 → 사진과 질문 → 말하기
const view = document.getElementById("view");
const MAX_SEC = 50; // 음성 인식은 60초까지라 여유를 둠

(function readLink() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("code")) store.set("buchigi_code", h.get("code"));
  if (h.get("api")) store.set("buchigi_api", h.get("api"));
  if (location.hash) history.replaceState(null, "", location.pathname);
})();

let cleanup = () => {};
function goStart() { cleanup(); cleanup = () => {}; start(); }
function topBar(title, sub, back = true) {
  return el("div", { class: back ? "topblock has-back" : "topblock" },
    back ? el("button", { class: "back", onclick: goStart }, "처음으로") : null,
    el("p", {}, sub), el("h1", {}, title));
}
function homeLink() {
  const url = (window.BUCHIGI_CONFIG && window.BUCHIGI_CONFIG.MAIN_URL) || "../";
  return el("p", { style: "text-align:center;margin-top:18px" },
    el("a", { class: "textbtn", href: url, style: "font-size:17px" }, "부치기 바치기 홈페이지로 가기"));
}
function dock(...buttons) { return el("div", { class: "dock" }, el("div", { class: `inner${buttons.length === 1 ? " one" : ""}` }, ...buttons)); }
function show(...nodes) { view.replaceChildren(...nodes); window.scrollTo(0, 0); }
function fail(e, retry) {
  show(topBar("잠시 문제가 생겼어요", "부치기 바치기"),
    el("p", { class: "lead" }, e.message || String(e)),
    dock(el("button", { class: "btn", onclick: retry }, "다시 해보기")));
}

/* ---------- 동의 ---------- */
function consent(st) {
  const text = el("input", { type: "checkbox", checked: st.share_transcript });
  const voice = el("input", { type: "checkbox", checked: st.share_audio });
  show(topBar("가족과 추억 이야기를 나눠요", "부치기 바치기", false),
    el("div", { class: "gap" },
      el("p", { class: "lead" }, "자녀가 올린 가족 사진을 보며 짧은 이야기를 나눠요. 시험이 아니니까 생각나는 대로 편하게 말씀해 주세요."),
      el("p", { class: "lead", style: "font-weight:700" }, "자녀에게 무엇을 보여줄지 정해 주세요"),
      el("label", { class: "check" }, text, el("span", {}, "제 이야기를 글로 보여줘도 좋아요")),
      el("label", { class: "check" }, voice, el("span", {}, "제 목소리를 들려줘도 좋아요")),
      el("p", { class: "status", style: "text-align:left" }, "언제든 바꾸거나 그만둘 수 있어요. 병을 진단하는 기록이 아니에요."),
      homeLink()),
    dock(el("button", { class: "btn", onclick: async () => {
      try {
        await api("/settings", { method: "POST", json: { consented: true, share_transcript: text.checked, share_audio: voice.checked } });
        start();
      } catch (e) { fail(e, init); }
    } }, "좋아요, 시작할게요")));
}

/* ---------- 시작 (소리를 내려면 한 번 눌러야 해요) ---------- */
function start() {
  show(topBar("우리 가족 이야기", "추억 대화", false),
    el("p", { class: "lead", style: "text-align:center;margin-top:30px" }, "준비되시면 아래 버튼을 눌러 주세요."),
    el("p", { style: "text-align:center;margin-top:24px" },
      el("button", { class: "textbtn", onclick: async () => {
        try { consent(await api("/settings")); } catch (e) { fail(e, init); }
      } }, "자녀에게 보여줄 범위 바꾸기")),
    homeLink(),
    dock(el("button", { class: "btn", onclick: next }, "이야기 시작하기")));
}

/* ---------- 질문과 대답 ---------- */
async function next() {
  let active = true;
  cleanup = () => { active = false; };
  show(topBar("우리 가족 이야기", "추억 대화"), el("p", { class: "status" }, "사진을 가져오고 있어요"));
  let q;
  try { q = await api("/today"); } catch (e) { return active && fail(e, next); }
  if (!active) return;
  if (!q.question_id) {
    return show(topBar("오늘 이야기는 여기까지예요", "추억 대화"),
      el("p", { class: "lead", style: "text-align:center;margin-top:30px" }, "들려주셔서 고마워요. 새 사진이 오면 또 여쭤볼게요."));
  }

  const status = el("p", { class: "status" }, "질문을 들려드릴게요");
  const talk = el("button", { class: "btn", disabled: true }, "말하기");
  const replay = el("button", { class: "btn line" }, "다시 듣기");
  const thread = el("div", { class: "stack" }, el("p", { class: "bubble ask" }, q.question));
  show(topBar("우리 가족 이야기", "추억 대화"),
    el("div", { class: "gap" },
      el("div", { class: "photo" }, el("img", { src: q.photo_url, alt: "가족 사진" }), q.caption ? el("span", { class: "tag" }, q.caption) : null),
      thread, status),
    dock(replay, talk));

  let questionEnd = null, audio;
  try { audio = new Audio(URL.createObjectURL(await api(`/questions/${q.question_id}/audio`, { blob: true }))); }
  catch { /* 소리를 못 받아도 글자로 진행 */ }
  if (!active) return;
  const ready = () => {
    questionEnd = questionEnd || new Date();
    status.textContent = "말씀하시려면 '말하기'를 눌러 주세요";
    talk.disabled = false;
  };
  if (audio) {
    audio.addEventListener("ended", ready);
    audio.play().catch(ready);
    replay.onclick = () => { audio.currentTime = 0; audio.play(); };
  } else { ready(); replay.disabled = true; }

  let recorder, stream, chunks = [], answerStart, timer, left;
  cleanup = () => {
    active = false;
    clearInterval(timer);
    if (audio) audio.pause();
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => stream && stream.getTracks().forEach((t) => t.stop());
      recorder.stop();
    }
  };
  talk.onclick = async () => {
    if (recorder) return stop();
    if (audio) audio.pause();
    if (!questionEnd) questionEnd = new Date();
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { status.textContent = "마이크를 쓸 수 있게 허락해 주세요"; return; }
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => { stream.getTracks().forEach((t) => t.stop()); send(); };
    recorder.start();
    answerStart = new Date();
    left = MAX_SEC;
    talk.classList.add("rec"); talk.textContent = "다 말했어요";
    replay.disabled = true;
    status.textContent = `듣고 있어요 · ${left}초`;
    timer = setInterval(() => { left -= 1; status.textContent = `듣고 있어요 · ${left}초`; if (left <= 0) stop(); }, 1000);
  };
  function stop() {
    clearInterval(timer);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    talk.disabled = true; talk.classList.remove("rec"); talk.textContent = "저장하고 있어요";
    status.textContent = "잘 들었어요";
  }
  async function send() {
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    const fd = new FormData();
    fd.append("question_id", q.question_id);
    fd.append("question_end_at", questionEnd.toISOString());
    fd.append("answer_start_at", answerStart.toISOString());
    fd.append("audio", blob, "answer." + (blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm"));
    try {
      const { transcript } = await api("/answers", { method: "POST", form: fd });
      if (!active) return;
      if (transcript) thread.append(el("p", { class: "bubble say" }, transcript));
      status.textContent = "고마워요. 다음 사진도 볼까요?";
      view.querySelector(".dock").replaceWith(dock(
        el("button", { class: "btn line", onclick: goStart }, "그만하기"),
        el("button", { class: "btn", onclick: next }, "다음 이야기")));
    } catch (e) { fail(e, next); }
  }
}

/* ---------- 처음 ---------- */
async function init() {
  if (!familyCode()) {
    return show(topBar("자녀가 보낸 링크로 열어 주세요", "부치기 바치기", false),
      el("p", { class: "lead" }, "가족 코드가 들어 있는 링크가 필요해요."));
  }
  show(topBar("우리 가족 이야기", "추억 대화", false), el("p", { class: "status" }, "준비하고 있어요"));
  try {
    const st = await api("/settings");
    if (st.consented) start(); else consent(st);
  } catch (e) { fail(e, init); }
}
init();
