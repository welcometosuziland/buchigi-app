"""부치기 바치기 서버 v2 (자녀 앱 + 부모님 화면 연결용)

실행:  python -m uvicorn main:app --host 0.0.0.0 --port 8000
문서:  http://localhost:8000/docs
"""
import array
import json
import os
import re
import subprocess
import tempfile
import wave
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import imageio_ffmpeg
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel
from supabase import create_client

load_dotenv()
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
ai = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")
CLOVA_URL = "https://clovaspeech-gw.ncloud.com/recog/v1/stt"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
KST = timezone(timedelta(hours=9))

app = FastAPI(title="Buchigi server v2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


def check(token: str | None):
    """가족 코드 확인 (프로토타입용 단순 인증)"""
    if token != os.environ["DEVICE_TOKEN"]:
        raise HTTPException(401, "가족 코드가 올바르지 않습니다")


def settings() -> dict:
    return sb.table("family_settings").select("*").eq("id", 1).single().execute().data


def photo_url(path: str) -> str:
    return sb.storage.from_("photos").get_public_url(path)


QUESTION_TYPES = ["기분", "감각", "사람", "재미있던 일", "요즘 이야기", "가볍게"]


def make_candidates(photo: dict, n: int = 8, avoid: list[str] | None = None) -> list[dict]:
    """자녀가 고를 수 있도록 질문 후보를 여러 종류로 만들기"""
    detail = "\n".join(f"{k}: {v}" for k, v in [
        ("언제", photo.get("taken_when")), ("어디서", photo.get("place")),
        ("누구와", photo.get("people")), ("이야기", photo.get("story") or photo.get("caption")),
    ] if v)
    avoid_txt = ("\n이미 나온 질문과 겹치지 않게 해 주세요:\n" + "\n".join(avoid)) if avoid else ""
    prompt = f"""다음은 자녀가 부모님(70~90대)과의 추억 사진에 적은 정보입니다.
{detail}

이 사진을 보며 부모님께 드릴 질문 후보 {n}개를 만들어 주세요.

꼭 지킬 것
- 정답을 떠올려야 하는 질문은 하지 않아요. 언제였는지, 어디였는지, 이름이 뭔지 묻지 않아요.
- 사진 정보는 질문 안에서 먼저 알려드려요. 예: "제주도 바다 사진이네요."
- 가장 기억에 남는 것처럼 여러 기억 중에 골라야 하는 질문은 피해요.
- 한 번에 하나만, 25자 안팎의 쉬운 말로 써요.
- 짧게 "네", "좋았지" 정도로도 대답을 시작할 수 있게 해요.
- 종류를 골고루 섞어요: 기분, 감각(날씨·음식·소리·냄새), 사람, 재미있던 일, 요즘 이야기, 가볍게(예/아니요로 시작 가능)

나쁜 예: "그 여행에서 가장 마음에 남는 순간은 언제였어요?"
좋은 예: "제주도 바다 보시니까 기분이 어떠세요?", "그날 바람이 시원했을 것 같아요. 그렇죠?",
"민준이가 바다를 무척 좋아했죠?", "요즘도 바다 보러 가고 싶으세요?"
{avoid_txt}

설명 없이 JSON 배열로만 답하세요. 형식: [{{"type": "기분", "text": "질문"}}]
type은 {", ".join(QUESTION_TYPES)} 중 하나예요."""
    res = ai.chat.completions.create(model=MODEL, messages=[{"role": "user", "content": prompt}])
    raw = res.choices[0].message.content.strip().strip("`")
    raw = raw[raw.find("["): raw.rfind("]") + 1] if "[" in raw else raw
    try:
        items = [{"type": i.get("type", "가볍게"), "text": i["text"].strip()} for i in json.loads(raw) if i.get("text")]
    except (ValueError, KeyError, TypeError, AttributeError):
        items = [{"type": "가볍게", "text": t.strip(" -•\"")} for t in raw.splitlines() if t.strip()]
    return items[:n]


# ---------------- 공통 ----------------
@app.get("/health")
def health():
    return {"ok": True}


class SettingsIn(BaseModel):
    consented: bool
    share_transcript: bool
    share_audio: bool
    share_trend: bool = True


@app.get("/settings")
def get_settings(x_device_token: str | None = Header(None)):
    check(x_device_token)
    return settings()


@app.post("/settings")
def save_settings(body: SettingsIn, x_device_token: str | None = Header(None)):
    """부모님 화면에서 동의와 공유 범위를 저장"""
    check(x_device_token)
    row = body.model_dump()
    row["consented_at"] = datetime.now(timezone.utc).isoformat() if body.consented else None
    sb.table("family_settings").update(row).eq("id", 1).execute()
    return settings()


# ---------------- 자녀 앱 ----------------
@app.post("/photos")
async def upload_photo(
    image: UploadFile = File(...),
    taken_when: str = Form(""),
    place: str = Form(""),
    people: str = Form(""),
    story: str = Form(""),
    keywords: str = Form(""),
    x_device_token: str | None = Header(None),
):
    """추억 올리기: 사진 저장 → 기록 → 질문 후보 생성 (자녀가 고름)"""
    check(x_device_token)
    data = await image.read()
    ext = os.path.splitext(image.filename or "")[1].lower() or ".jpg"
    path = f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}{ext}"
    sb.storage.from_("photos").upload(path, data, {"content-type": image.content_type or "image/jpeg"})

    kw = [k.strip() for k in keywords.replace("，", ",").split(",") if k.strip()]
    caption = " / ".join(v for v in [taken_when, place, people, story] if v)
    photo = sb.table("photos").insert({
        "image_path": path, "caption": caption or "가족 사진", "keywords": kw,
        "taken_when": taken_when, "place": place, "people": people, "story": story,
    }).execute().data[0]

    return {"photo": {**photo, "photo_url": photo_url(path)}, "candidates": make_candidates(photo)}


class AvoidIn(BaseModel):
    avoid: list[str] = []


@app.post("/photos/{photo_id}/candidates")
def more_candidates(photo_id: int, body: AvoidIn, x_device_token: str | None = Header(None)):
    """질문 후보 더 보기"""
    check(x_device_token)
    photo = sb.table("photos").select("*").eq("id", photo_id).single().execute().data
    return {"candidates": make_candidates(photo, n=6, avoid=body.avoid)}


class ChosenIn(BaseModel):
    texts: list[str]


@app.post("/photos/{photo_id}/questions")
def choose_questions(photo_id: int, body: ChosenIn, x_device_token: str | None = Header(None)):
    """자녀가 고른 질문만 부모님 화면에 보내기"""
    check(x_device_token)
    texts = [t.strip() for t in body.texts if t.strip()]
    if not texts:
        raise HTTPException(400, "질문을 하나 이상 골라 주세요")
    return sb.table("questions").insert([{"photo_id": photo_id, "text": t} for t in texts]).execute().data


@app.get("/photos")
def list_photos(x_device_token: str | None = Header(None)):
    """추억 앨범: 사진 + 질문 + (공유 허락된 범위의) 부모님 이야기"""
    check(x_device_token)
    st = settings()
    photos = sb.table("photos").select("*, questions(*, answers(*))").order("id", desc=True).execute().data
    for p in photos:
        p["photo_url"] = photo_url(p["image_path"])
        for q in p.get("questions", []):
            for a in q.get("answers", []):
                if not (st["consented"] and st["share_transcript"]):
                    a["transcript"] = None
                a["can_play"] = bool(st["consented"] and st["share_audio"] and a.get("audio_path"))
                a.pop("audio_path", None)
    return photos


class QuestionEdit(BaseModel):
    text: str


@app.patch("/questions/{question_id}")
def edit_question(question_id: int, body: QuestionEdit, x_device_token: str | None = Header(None)):
    """자녀가 AI가 만든 질문을 고치기"""
    check(x_device_token)
    return sb.table("questions").update({"text": body.text}).eq("id", question_id).execute().data[0]


@app.get("/answers/{answer_id}/audio")
def answer_audio(answer_id: int, x_device_token: str | None = Header(None)):
    """부모님이 목소리 공유를 허락한 경우에만 재생 주소 제공"""
    check(x_device_token)
    st = settings()
    if not (st["consented"] and st["share_audio"]):
        raise HTTPException(403, "부모님이 목소리 공유를 허락하지 않았습니다")
    a = sb.table("answers").select("audio_path").eq("id", answer_id).single().execute().data
    signed = sb.storage.from_("audio").create_signed_url(a["audio_path"], 3600)
    return {"url": signed.get("signedURL") or signed.get("signedUrl")}


# ---- 변화 신호: 부모님 본인의 처음 기록(기준선)과 최근 기록을 비교 ----
# 판단 기준(지표, 비중, 점수 구간)은 판단 기준 팀이 정한 값으로 이 아래만 바꾸면 돼요.
# 지금 값은 화면 시연을 위한 임시 값이에요.
MIN_ANSWERS = int(os.getenv("SIGNAL_MIN_ANSWERS", "8"))      # 점수를 보여주기 위한 최소 대화 수
BASELINE_ANSWERS = int(os.getenv("SIGNAL_BASELINE", "4"))     # 기준선으로 쓸 처음 대화 수
WEIGHTS = {"onset": 0.30, "length": 0.25, "mention": 0.25, "repeat": 0.20}
LABELS = {"onset": "대답까지", "length": "이야기 양", "mention": "이름·장소 언급", "repeat": "반복 이야기"}


def tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[가-힣A-Za-z0-9]+", text or "") if len(w) >= 2}


def avg(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def spread(xs, floor):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return floor
    m = sum(xs) / len(xs)
    return max((sum((x - m) ** 2 for x in xs) / (len(xs) - 1)) ** 0.5, floor)


def part_scores(base: list[dict], recent: list[dict]) -> dict:
    """각 지표가 기준선보다 나빠진 정도를 0~100으로. 기준선의 2배 표준편차만큼 나빠지면 100"""
    def bad(base_vals, recent_vals, floor, worse_if_higher):
        b, r = avg(base_vals), avg(recent_vals)
        if b is None or r is None:
            return None
        z = (r - b) / spread(base_vals, floor)
        if not worse_if_higher:
            z = -z
        return round(min(max(z / 2, 0), 1) * 100)
    return {
        "onset": bad([i["onset"] for i in base], [i["onset"] for i in recent], 0.5, True),
        "length": bad([i["chars"] for i in base], [i["chars"] for i in recent], 10, False),
        "mention": bad([i["mention"] for i in base], [i["mention"] for i in recent], 0.15, False),
        "repeat": bad([i["repeat"] for i in base], [i["repeat"] for i in recent], 0.2, True),
    }


def total(parts: dict) -> int | None:
    used = {k: v for k, v in parts.items() if v is not None}
    if not used:
        return None
    w = sum(WEIGHTS[k] for k in used)
    return round(sum(WEIGHTS[k] * v for k, v in used.items()) / w)


def signal(items: list[dict]) -> dict:
    if len(items) < MIN_ANSWERS:
        return {"ready": False, "have": len(items), "need": MIN_ANSWERS}
    base, after = items[:BASELINE_ANSWERS], items[BASELINE_ANSWERS:]
    weeks = defaultdict(list)
    for i in after:
        weeks[i["week"]].append(i)
    weekly = [{"week": k, "score": total(part_scores(base, v))} for k, v in sorted(weeks.items())]
    recent = sorted(weeks.items())[-1][1] if weeks else after
    parts = part_scores(base, sorted(weeks.items())[-1][1] if weeks else after)
    score = total(parts) or 0
    two_high = len(weekly) >= 2 and all((w["score"] or 0) >= 70 for w in weekly[-2:])
    if score >= 70 and two_high:
        level, message = "consult", "몇 주째 이야기하시는 방식에 변화가 이어지고 있어요. 진단은 아니지만, 전문가와 한번 이야기해 보면 안심이 될 수 있어요."
    elif score >= 40:
        level, message = "watch", "최근 대화에 조금 달라진 점이 보여요. 이번 주엔 전화로 안부를 여쭤보는 건 어떨까요?"
    else:
        level, message = "stable", "평소와 비슷하게 이야기 나누고 계세요."
    return {
        "ready": True, "score": score, "level": level, "message": message, "weekly": weekly,
        "parts": [{"key": k, "label": LABELS[k], "score": v} for k, v in parts.items()],
        "recent_count": len(recent),
    }


@app.get("/report")
def report(x_device_token: str | None = Header(None)):
    """주별 변화 기록과 변화 신호. 진단이 아니라 부모님 본인의 변화 추세를 보여주기 위한 지표"""
    check(x_device_token)
    st = settings()
    if not st["consented"]:
        return {"consented": False}

    rows = (sb.table("answers").select("*, questions(text, photos(id, keywords, place, image_path))")
            .order("created_at").execute().data)
    weeks = defaultdict(list)
    items, seen = [], []
    for a in rows:
        t = a.get("transcript") or ""
        q = a.get("questions") or {}
        ph = q.get("photos") or {}
        kws = [k for k in (ph.get("keywords") or []) if k]
        hit = [k for k in kws if k in t]
        delay = None
        if a.get("question_end_at") and a.get("answer_start_at"):
            d = (datetime.fromisoformat(a["answer_start_at"]) - datetime.fromisoformat(a["question_end_at"])).total_seconds()
            delay = round(max(d, 0), 1)
        tk = tokens(t)
        repeat = 1 if len(tk) >= 4 and any(len(tk & s) / len(tk | s) >= 0.5 for s in seen) else 0
        seen.append(tk)
        created = datetime.fromisoformat(a["created_at"])
        y, w, _ = created.isocalendar()
        item = {
            "id": a["id"], "date": created.astimezone(KST).date().isoformat(), "question": q.get("text"),
            "photo_url": photo_url(ph["image_path"]) if ph.get("image_path") else None,
            "delay_sec": delay, "onset": delay, "chars": len(t.replace(" ", "")),
            "duration_sec": a.get("duration_sec"), "keywords": kws, "mentioned": hit,
            "mention": (len(hit) / len(kws)) if kws else None, "repeat": repeat,
            "transcript": t if st["share_transcript"] else None,
            "can_play": bool(st["share_audio"] and a.get("audio_path")),
            "week": f"{y}-W{w:02d}",
        }
        item["check"] = bool(kws and not hit) or item["chars"] < 10 or bool(repeat)
        items.append(item)
        weeks[item["week"]].append(item)

    weekly = [{
        "week": k, "count": len(v),
        "avg_delay_sec": round(avg([i["delay_sec"] for i in v]) or 0, 1) if v else None,
        "avg_chars": round(avg([i["chars"] for i in v]) or 0, 1),
        "mention_rate": avg([i["mention"] for i in v]),
    } for k, v in sorted(weeks.items())]
    sig = signal(items) if st.get("share_trend", True) else {"ready": False, "hidden": True}
    dates = [i["date"] for i in items]
    return {"consented": True, "settings": st, "weekly": weekly, "signal": sig,
            "recent": list(reversed(items))[:10], "dates": dates}


# ---------------- 부모님 화면 ----------------
@app.get("/today")
def today(x_device_token: str | None = Header(None)):
    check(x_device_token)
    q = (sb.table("questions").select("*, photos(*)").eq("asked", False)
         .order("id").limit(1).execute().data)
    if not q:
        return {"message": "no question"}
    q = q[0]
    return {"question_id": q["id"], "question": q["text"], "caption": q["photos"].get("caption"),
            "photo_url": photo_url(q["photos"]["image_path"])}


@app.get("/questions/{question_id}/audio")
def question_audio(question_id: int, x_device_token: str | None = Header(None)):
    check(x_device_token)
    q = sb.table("questions").select("text").eq("id", question_id).single().execute().data
    speech = ai.audio.speech.create(
        model="gpt-4o-mini-tts", voice="alloy", input=q["text"],
        instructions="어르신께 말씀드리듯 천천히, 또박또박, 따뜻한 목소리로 말하세요.",
    )
    return Response(content=speech.read(), media_type="audio/mpeg")


def to_wav(data: bytes) -> tuple[bytes, float]:
    """브라우저 녹음(webm, mp4 등)을 CLOVA가 받는 16kHz 모노 wav로 변환"""
    with tempfile.TemporaryDirectory() as d:
        src, dst = os.path.join(d, "in"), os.path.join(d, "out.wav")
        open(src, "wb").write(data)
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "16000", dst], check=True)
        with wave.open(dst) as w:
            duration = w.getnframes() / w.getframerate()
        return open(dst, "rb").read(), round(duration, 1)


@app.post("/answers")
async def receive_answer(
    question_id: int = Form(...),
    question_end_at: str = Form(...),
    answer_start_at: str = Form(...),
    audio: UploadFile = File(...),
    x_device_token: str | None = Header(None),
):
    check(x_device_token)
    st = settings()
    if not st["consented"]:
        raise HTTPException(403, "부모님 동의 전에는 대화를 저장하지 않습니다")
    try:
        wav, duration = to_wav(await audio.read())
    except subprocess.CalledProcessError:
        raise HTTPException(400, "녹음 파일을 변환하지 못했습니다")

    q = sb.table("questions").select("photos(keywords)").eq("id", question_id).single().execute().data
    keywords = [k for k in (q["photos"]["keywords"] or []) if len(k) >= 3]
    params = {"lang": "Kor"}
    if keywords:
        params["boostings"] = "\t".join(keywords)
    r = requests.post(CLOVA_URL, params=params, data=wav, timeout=30,
                      headers={"Content-Type": "application/octet-stream",
                               "X-CLOVASPEECH-API-KEY": os.environ["CLOVA_SECRET"]})
    if r.status_code != 200:
        raise HTTPException(502, f"음성 인식 오류 {r.status_code}: {r.text}")
    transcript = r.json().get("text", "")

    path = f"q{question_id}/{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.wav"
    sb.storage.from_("audio").upload(path, wav, {"content-type": "audio/wav"})
    sb.table("answers").insert({
        "question_id": question_id, "transcript": transcript, "audio_path": path,
        "question_end_at": question_end_at, "answer_start_at": answer_start_at, "duration_sec": duration,
    }).execute()
    sb.table("questions").update({"asked": True}).eq("id", question_id).execute()
    return {"transcript": transcript}
