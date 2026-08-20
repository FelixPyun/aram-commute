# 아람출퇴근 v0.18

## 변경사항
- v0.17 모바일 컴팩트 UI 유지
- Vercel 환경에서 공공데이터 인증키 전달 방식 보강
- `ServiceKey`/`serviceKey`, Encoding/Decoding 인증키 조합 자동 대응
- 인천 BIS 요청 8초 타임아웃 및 재시도 처리
- 전체 조회 실패 시 실제 노선/API 오류를 화면에 표시
- API/PWA 캐시 갱신(v0.18)

## 배포
현재 Git 연결 기준 폴더에 `app`, `public`, `package.json`, `README.md`를 덮어쓴 뒤:

```powershell
git add .
git commit -m "v0.18 production api fix"
git push
```

`.env.local`은 덮어쓰거나 Git에 올리지 않습니다. Vercel의 `DATA_GO_KR_SERVICE_KEY` 환경변수를 사용합니다.
