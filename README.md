# 독서노트

하루에 여러 권을 나란히 읽으며, 직접 쓰는 독서 기록장이에요. 컴퓨터와 휴대폰에서 같은 기록을 이어 쓸 수 있어요.

## 기록하는 순서

1. **책 목록**: 읽기 시작한 날, 며칠째 읽는 중인지, 책 이름, 저자, 종이책/전자책
2. **이 책을 읽게 된 이유**
3. **발췌한 문장**과 그 문장을 고른 이유
4. **오늘 읽은 곳까지 내용 정리**
5. **현실에 적용하기** 1~3가지
6. **다음 날 실천 체크**: 실천했다면 무엇이 달라졌는지, 못 했다면 왜인지

## 쓰는 법

- 이 저장소의 GitHub Pages 주소로 접속해요. 휴대폰에서는 "홈 화면에 추가"를 해두면 앱처럼 열려요.
- 기록은 먼저 그 기기에 저장돼요.
- **설정**에서 GitHub 아이디, 기록 저장소 이름(`reading-notes-data`), 토큰을 넣으면 비공개 저장소의 `books/` 폴더로 동기화돼요. 기기마다 한 번씩 입력해요.
  - 토큰: GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
  - Repository access: `reading-notes-data` 하나만
  - Permissions: Contents → Read and write
- 설정 화면의 **백업 내려받기**로 모든 기록을 파일 하나로 받아둘 수 있어요.

## 구성

| 파일 | 내용 |
| --- | --- |
| `index.html` | 화면 틀 |
| `style.css` | 디자인 (밝은/어두운 모드) |
| `app.js` | 기록, 저장, GitHub 동기화 |

기록 파일 형식(`books/<책id>.json`)은 이후 블로그·Threads·영상 대본 변환 단계에서 그대로 읽어서 씁니다.
