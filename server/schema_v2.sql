-- 저번 schema.sql을 이미 실행했다면, 이 파일만 SQL Editor에서 추가로 실행하세요.
-- (Run and enable RLS 선택)

alter table photos add column if not exists taken_when text;   -- 언제 (예: 2019년 봄)
alter table photos add column if not exists place text;        -- 어디서 (예: 제주도)
alter table photos add column if not exists people text;       -- 누구와 (예: 엄마, 아빠, 민준이)
alter table photos add column if not exists story text;        -- 짧은 이야기 (예: 결혼 30주년 여행)

alter table answers add column if not exists duration_sec real; -- 대답 길이(초)

-- 부모님 동의와 공유 범위 (프로토타입은 한 가족만: id = 1)
create table if not exists family_settings (
  id int primary key,
  consented boolean default false,
  share_transcript boolean default true,   -- 대화 내용(글)을 자녀에게 보여줄지
  share_audio boolean default false,       -- 목소리 녹음을 자녀에게 들려줄지
  consented_at timestamptz
);
insert into family_settings (id) values (1) on conflict (id) do nothing;
