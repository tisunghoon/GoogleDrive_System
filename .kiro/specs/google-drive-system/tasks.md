# Implementation Plan: Google Drive System

## Overview

Next.js 16(App Router, TypeScript) 하나로 웹 화면과 API를 구현합니다.
프로젝트 골격과 실행 환경 → DB 스키마 → 공통 인프라(오류·캐시·객체 저장소) → 인증 → 경로·폴더 → 블록 코덱 → 업로드·충돌 → Block_Server → 다운로드·이력 → 공유 → 알림 → 헬스체크 → 브라우저 Sync_Client → 웹 화면 → 정리 작업 → 통합·E2E·부하 테스트 순서로 진행하며, 각 단계는 앞 단계 위에 쌓입니다.

## Tasks

- [ ] 1. 프로젝트 초기 설정과 실행 환경
  - [ ] 1.1 Next.js 프로젝트 골격과 의존성 설정
    - `create-next-app`(TypeScript, App Router, `src/` 디렉터리, ESLint)으로 생성하고 `@/*` 경로 별칭 설정
    - 의존성: drizzle-orm, postgres, ioredis, @aws-sdk/client-s3, jose, bcryptjs, zod, idb, hash-wasm
    - 개발 의존성: drizzle-kit, vitest, fast-check, @testing-library/react, jsdom, fake-indexeddb, @playwright/test, tsx
    - `vitest.config.ts`에 `unit`, `property`, `integration` 프로젝트 정의, `tests/`·`e2e/` 디렉터리 생성
    - `src/server/config.ts`에 zod로 검증하는 환경 변수 로더 작성 (DATABASE_URL, REDIS_URL, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, JWT_SECRET, BLOCK_ENCRYPTION_KEY, LONG_POLL_MAX_CONNECTIONS, 만료·보관 기간 값)
    - _Requirements: 3.8, 16.4_

  - [ ] 1.2 Docker Compose와 로드밸런서 구성
    - `Dockerfile`(Next.js standalone 출력), `docker-compose.yml`에 app ×2, nginx, postgres:16, redis:7, SeaweedFS(S3 게이트웨이), aws-cli 버킷 초기화(`drive-region-a`, `drive-region-b`, `drive-cold`) 정의. jobs 서비스는 17.1에서 추가
    - `nginx.conf`: 두 app 인스턴스로 라운드로빈, 롱 폴링을 위해 `/api/notifications/poll`의 `proxy_read_timeout` 75초, `client_max_body_size` 5m
    - `docker-compose.test.yml`: 통합 테스트용 postgres, redis, SeaweedFS
    - `.env.example` 작성
    - _Requirements: 16.1, 16.4_

  - [ ] 1.3 CI 워크플로 구성
    - `.github/workflows/ci.yml`: lint, typecheck, `vitest --project unit --project property` 잡과 `docker-compose.test.yml`로 postgres·redis·SeaweedFS를 띄우는 `integration` 잡
    - _Requirements: 16.4_

- [ ] 2. 메타데이터 DB 스키마와 마이그레이션
  - [ ] 2.1 Drizzle 스키마와 초기 마이그레이션 작성
    - `src/server/db/schema.ts`에 users, devices, namespaces, files, file_versions, file_version_keeps, blocks, block_objects, upload_sessions, upload_session_blocks, shares, events 정의
    - design.md DDL의 CHECK 제약, 부분 유니크 인덱스 `files_live_path_uniq`, `(status = 'uploaded') = (version_number IS NOT NULL)` 제약 포함
    - drizzle-kit으로 SQL 마이그레이션 생성 후, uploaded 버전 수정 금지 트리거(`forbid_uploaded_version_update`)를 커스텀 마이그레이션으로 추가
    - _Requirements: 2.1, 7.4, 7.5, 8.6, 12.5_

  - [ ] 2.2 DB 클라이언트와 트랜잭션 헬퍼 구현
    - `src/server/db/client.ts`: `postgres` 드라이버 싱글턴, `withTransaction(fn)`, 직렬화 실패·교착 상태 시 최대 3회 재시도
    - _Requirements: 13.1, 15.3_

  - [ ]* 2.3 스키마 제약 테스트 작성
    - `tests/integration/schema.int.test.ts`: 경로 중복 거부, uploaded 행 UPDATE 거부, 블록 크기 CHECK
    - **Property 10: uploaded 버전 불변** - `fc.record`로 임의 컬럼 변경을 생성해 UPDATE가 항상 실패하고 행이 그대로인지 검증
    - _Requirements: 2.1, 7.4_

- [ ] 3. 공통 인프라: 오류 처리, 캐시, 객체 저장소
  - [ ] 3.1 표준 오류와 요청 검증 구현
    - `src/server/http/errors.ts`: `AppError(code, status, message, details)`, `withErrorHandling()` 래퍼(처리하지 못한 예외는 500 `INTERNAL_ERROR` + JSON 로그)
    - `src/server/http/validation.ts`: zod 스키마로 바디·쿼리 파싱, 실패 시 400과 필드별 사유
    - `src/server/http/logger.ts`: JSON 한 줄 로그, 민감 값 제외
    - _Requirements: 2.3, 15.3_

  - [ ] 3.2 Redis 클라이언트와 Metadata_Cache 구현
    - `src/server/cache/redis.ts`: 명령용·구독용 연결 분리
    - `src/server/cache/metadataCache.ts`: `getOrLoad(key, loader, versionKey)`, `invalidate(keys, versionKeys)`; TTL 600초; 버전 카운터 비교 후 저장하는 Lua 스크립트; Redis 오류 시 로그 후 loader 결과 반환
    - _Requirements: 13.2, 13.4, 13.5_

  - [ ] 3.3 객체 저장소 BlockStore 구현
    - `src/server/storage/objectStorage.ts`: `putReplicated`(region-a, region-b 모두 성공해야 resolve), `getWithFallback`(a 실패 시 b, tier가 cold면 cold 버킷), `moveToCold`, `moveToHot`, `delete`
    - _Requirements: 3.5, 14.5, 14.6, 15.1_

  - [ ]* 3.4 공통 인프라 단위 테스트 작성
    - `tests/unit/errors.test.ts`, `tests/unit/metadata-cache.test.ts`(Redis 대역으로 적중·미스·장애), `tests/unit/object-storage.test.ts`(S3 클라이언트 대역으로 복제 기록·대체 읽기)
    - _Requirements: 13.4, 15.1_

- [ ] 4. 인증과 단말 등록
  - [ ] 4.1 비밀번호·JWT·인증 래퍼 구현
    - `src/server/auth/password.ts`(bcryptjs cost 10), `jwt.ts`(jose HS256, 60분), `guard.ts`의 `withAuth(handler, { requireDevice })`: Bearer 또는 `access_token` 쿠키 검증, `X-Device-Id` 소유 확인
    - _Requirements: 1.1, 1.2, 1.3, 1.7_

  - [ ] 4.2 가입·로그인·단말 등록 API 구현
    - `POST /api/auth/signup`: 사용자와 루트 namespace를 한 트랜잭션으로 생성, quota 10GB
    - `POST /api/auth/login`: 토큰 발급과 httpOnly 쿠키 설정
    - `POST /api/devices`: 사용자당 10대 초과 시 409 `DEVICE_LIMIT`
    - _Requirements: 1.1, 1.4, 1.5, 1.6_

  - [ ]* 4.3 토큰 검증 속성 테스트 작성
    - **Property 22: 토큰 검증** - `fc.oneof`로 다른 키 서명·만료·변조·빈 문자열 토큰을 생성해 보호된 핸들러가 항상 401인지 검증
    - _Requirements: 1.2, 1.3_

  - [ ]* 4.4 인증 단위 테스트 작성
    - `tests/unit/auth.test.ts`: 로그인 성공·실패, 등록되지 않은 단말 403, 11번째 단말 409
    - _Requirements: 1.4, 1.5, 1.7_

- [ ] 5. 경로 규칙, 접근 제어, 폴더·목록·삭제
  - [ ] 5.1 경로 규칙 순수 함수 구현
    - `src/server/files/pathRules.ts`: `normalizePath`, `parentOf`, `fileNameOf`, `isUnder`
    - _Requirements: 2.2, 2.3_

  - [ ] 5.2 접근 제어 구현
    - `src/server/sharing/access.ts`: `resolveAccess(userId, namespaceId, path)` → `owner | editor | viewer | none`; `none`이면 404, 쓰기 요청에 viewer면 403
    - _Requirements: 2.6, 10.3, 10.5_

  - [ ] 5.3 폴더 생성·목록·삭제 서비스와 API 구현
    - `src/server/files/fileService.ts`: `createFolder`, `listChildren`(latest_version이 NULL인 파일 제외, 캐시 사용), `deletePath`(폴더면 하위 전체 soft delete, `file_deleted` 이벤트, 사용량 차감)
    - `GET/DELETE /api/files`, `POST /api/folders`
    - _Requirements: 2.2, 2.4, 2.5, 9.1, 9.2, 4.9_

  - [ ]* 5.4 경로 속성 테스트 작성
    - **Property 14: 경로 유일성과 형식** - `fc.array(fc.string())`로 세그먼트를 조합해 `.`·`..`·빈 세그먼트·길이 초과 경로는 거부되고 정상 경로만 통과하는지 검증
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 5.5 접근 제어 속성 테스트 작성
    - **Property 15: 접근 제어** - 사용자·소유 관계·공유 role·경로를 생성해 조회 허용, viewer 쓰기 403, 권한 없는 경로 404를 검증
    - _Requirements: 2.6, 10.3, 10.5_

- [ ] 6. 블록 코덱
  - [ ] 6.1 압축·암호화 코덱 구현
    - `src/server/block/blockCodec.ts`: `encodeBlock`/`decodeBlock`, `deflateRawSync`, 압축 결과가 원본 이상이면 원본 저장(플래그 1바이트), AES-256-GCM(iv 12B, tag 16B)
    - _Requirements: 3.4, 3.6, 3.8_

  - [ ]* 6.2 블록 코덱 속성 테스트 작성
    - **Property 2: 블록 인코딩 라운드트립** - `fc.uint8Array`와 32바이트 키로 라운드트립과 다른 키 복호화 실패를 검증
    - _Requirements: 3.4, 3.6, 3.7_

- [ ] 7. 업로드 세션과 완료·충돌 처리
  - [ ] 7.1 충돌 사본 이름 규칙 구현
    - `src/server/files/conflict.ts`: `conflictedCopyName(fileName, userName, date, existing)`
    - _Requirements: 8.3, 8.4_

  - [ ] 7.2 업로드 시작과 상태 조회 구현
    - `src/server/files/uploadService.ts`의 `startUpload`: 크기 413, 할당량 507, 블록 목록 검증(합계 = size, 각 ≤4MB), 파일 행 확보, file_version(pending), upload_session·upload_session_blocks 생성, `upload_started` 이벤트, missingHashes 계산(계정의 block_objects에 없는 서로 다른 hash)
    - missingHashes가 비면 그 자리에서 `completeUpload` 호출
    - `getUploadStatus`: 남은 hash 목록, 만료 세션 410
    - `POST /api/files/uploads`, `GET /api/files/uploads/[uploadId]`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1_

  - [ ] 7.3 업로드 완료와 충돌 판정 구현
    - `completeUpload(uploadId)`: 세션 `FOR UPDATE`로 멱등 처리, files `FOR UPDATE`, base_version 비교, version_number 부여 또는 충돌 사본 생성, blocks 행 기록, 사용량 조정, `file_added`/`file_updated` 이벤트, 커밋 후 캐시 무효화·발행
    - _Requirements: 4.6, 4.7, 7.5, 8.1, 8.2, 8.3, 8.6, 13.1, 13.2, 14.7_

  - [ ]* 7.4 업로드 순수 로직 속성 테스트 작성
    - **Property 5: 델타 전송 최소성** - `fc.array(fc.hexaString)`로 이전·새 해시 목록과 계정 보유 집합을 생성해 missingHashes가 정확히 차집합인지 검증
    - **Property 13: 충돌 사본 이름 규칙과 유일성** - 확장자 유무·점이 여러 개인 이름·기존 이름 집합을 생성해 형식과 유일성 검증
    - **Property 21: 파일 크기 상한** - `fc.bigInt`로 경계 주변 크기를 생성해 413 여부 검증
    - _Requirements: 4.2, 4.5, 5.3, 5.5, 8.3, 8.4_

  - [ ]* 7.5 업로드 서비스 단위 테스트 작성
    - `tests/unit/upload-service.test.ts`: 새 파일, 수정, 507, 413, 블록 크기 합 불일치 400, 만료 세션 410, 완료 결과 멱등 재응답
    - _Requirements: 4.1, 4.3, 4.8_

- [ ] 8. Block_Server
  - [ ] 8.1 블록 업로드 API 구현
    - `PUT /api/blocks/[hash]?uploadId=`: 본문 4MB 초과 413, SHA-256 불일치 400, 계정 중복이면 저장 생략, 아니면 encode 후 `putReplicated`, `block_objects` upsert, `upload_session_blocks.received = true`, 마지막 블록이면 `completeUpload` 결과(200 또는 409) 반환
    - _Requirements: 3.3, 3.4, 3.5, 4.6, 5.2, 14.1_

  - [ ] 8.2 블록 다운로드 API 구현
    - `GET /api/blocks/[hash]?namespaceId=`: 접근 가능한 파일 버전이 hash를 참조하는지 확인, tier에 따라 읽기와 region-b 대체, decode, `last_accessed_at` 갱신, cold였으면 hot으로 복귀
    - _Requirements: 3.6, 14.6, 15.1_

  - [ ]* 8.3 Block_Server 속성 테스트 작성
    - **Property 3: 해시 불일치 블록 거부** - 임의 바이트와 다른 해시로 400 반환과 버킷 쓰기 0회를 BlockStore 대역으로 검증
    - **Property 6: 이어 올리기 단조성과 멱등성** - `fc.shuffledSubarray`와 중복 삽입으로 전송 열을 만들어 남은 집합 단조 감소, 완료 호출 정확히 1회 검증
    - _Requirements: 3.3, 4.6, 5.1, 5.2_

- [ ] 9. Checkpoint - 업로드 경로 완료
  - `vitest --project unit --project property` 통과 확인
  - 문의사항이 있으면 사용자에게 질문하세요.

- [ ] 10. 다운로드와 갱신 이력
  - [ ] 10.1 다운로드 메타데이터 API 구현
    - `GET /api/files/download`: 최신 또는 지정 version의 uploaded 버전과 순서 있는 블록 목록, 캐시 사용, 없거나 삭제되면 404
    - _Requirements: 6.1, 6.2, 6.3, 4.9_

  - [ ] 10.2 갱신 이력과 보관 표시 API 구현
    - `GET /api/files/revisions`: limit 1~100(기본 20), version_number 내림차순, kept 여부 포함
    - `POST /api/files/revisions/keep`: file_version_keeps 추가·삭제
    - _Requirements: 7.1, 7.2, 7.3, 14.4_

  - [ ]* 10.3 다운로드·이력 속성 테스트 작성
    - **Property 9: 갱신 이력 정렬과 개수** - 버전 수와 limit을 생성해 정렬·길이·400 검증
    - **Property 11: 완료되지 않은 버전 비노출** - pending·expired가 섞인 버전 목록에서 응답에 uploaded만 나오는지 검증
    - _Requirements: 4.9, 7.1, 7.2_

- [ ] 11. 파일 공유
  - [ ] 11.1 공유 서비스와 API 구현
    - `src/server/sharing/shareService.ts`: 공유 생성(대상 없음·자기 자신 400, namespaces.is_shared = true, `share_created` 이벤트), 해제, 공유받은 폴더 목록
    - `POST/GET /api/shares`, `DELETE /api/shares/[shareId]`
    - _Requirements: 10.1, 10.2, 10.4, 10.5_

  - [ ]* 11.2 공유 단위 테스트 작성
    - `tests/unit/share-service.test.ts`: viewer 업로드 403, 해제 후 404, 공유 폴더 밖 경로 404
    - _Requirements: 10.2, 10.3, 10.5_

- [ ] 12. Notification_Service
  - [ ] 12.1 이벤트 로그와 발행 구현
    - `src/server/notification/eventLog.ts`: 트랜잭션 안에서 `appendEvent(tx, event)`, `readAfter(namespaceIds, cursor, excludeDeviceId, sharedScopes)`, `oldestRetainedId()`
    - `publisher.ts`: 커밋 후 `PUBLISH ns:{id}`, 실패 시 최대 5회 재시도
    - _Requirements: 11.3, 11.4, 12.1, 12.5, 15.4_

  - [ ] 12.2 롱 폴링 API 구현
    - `GET /api/notifications/poll?cursor=`: 410 커서 만료, 즉시 응답 경로, Redis 구독 대기(60초·abort), Redis 장애 시 5초 간격 DB 재조회, 프로세스별 연결 상한 503 + `Retry-After`
    - _Requirements: 11.1, 11.2, 11.7, 12.2, 12.4_

  - [ ]* 12.3 알림 속성 테스트 작성
    - **Property 16: 이벤트 전달 순서와 중복 없음** - 이벤트 열과 폴링 시점 열을 생성해 커서를 이어 받은 결과가 엄격히 증가·중복 없음·누락 없음인지 검증
    - **Property 17: 자기 이벤트 제외** - 받은 이벤트에 자기 device_id가 없는지 검증
    - _Requirements: 11.1, 11.4, 11.6, 12.2_

  - [ ]* 12.4 롱 폴링 단위 테스트 작성
    - `tests/unit/long-poll.test.ts`: 가짜 타이머로 60초 빈 응답, 이벤트 도착 시 즉시 응답, 연결 상한 503, 410
    - _Requirements: 11.2, 11.7, 12.4_

- [ ] 13. 헬스체크
  - [ ] 13.1 헬스체크 API 구현
    - `GET /api/health`: DB `select 1`, Redis `PING`, 두 지역 버킷 `HeadBucket`, 알림(Redis 구독 연결) 상태, 하나라도 비정상이면 503
    - _Requirements: 15.6_

  - [ ]* 13.2 헬스체크 속성 테스트 작성
    - **Property 23: 헬스체크 완전성** - `fc.boolean()` 4개 조합으로 응답 항목과 상태 코드 검증
    - _Requirements: 15.6_

- [ ] 14. Checkpoint - 백엔드 API 완료
  - 모든 단위·속성 테스트 통과 확인
  - 문의사항이 있으면 사용자에게 질문하세요.

- [ ] 15. 브라우저 Sync_Client
  - [ ] 15.1 분할기와 해시 계산 구현
    - `src/client/sync/chunker.ts`: `chunk(bytes, blockSize)` 순수 함수와 `File` 대상 async iterator
    - `hasher.ts`: 블록 SHA-256(Web Crypto), 파일 checksum(hash-wasm 증분)
    - _Requirements: 3.1, 3.2_

  - [ ] 15.2 IndexedDB 로컬 사본 구현
    - `blockCache.ts`: `blocks`, `files`, `meta`(deviceId, cursor, 일시 중지된 업로드) 저장소
    - _Requirements: 6.4, 17.3_

  - [ ] 15.3 업로더 구현
    - `uploader.ts`: 업로드 시작, missingHashes 동시 4개 전송, 진행률 콜백, 네트워크 오류 시 일시 중지 상태 저장, 재개 시 상태 조회 후 남은 블록만 전송, 409 충돌 결과 전달
    - _Requirements: 5.1, 5.2, 5.3, 17.2, 17.3, 17.5_

  - [ ] 15.4 다운로더 구현
    - `downloader.ts`: 메타데이터 조회, 캐시에 없는 블록만 받기, 조립, checksum 검증 실패 시 최대 3회 재시도
    - _Requirements: 6.4, 6.5, 17.7_

  - [ ] 15.5 롱 폴링 루프 구현
    - `poller.ts`: 응답 처리 후 즉시 재요청, 오류·503 시 1초에서 2배씩 최대 60초 백오프, 410이면 전체 동기화, 삭제 이벤트 시 로컬 사본 제거
    - _Requirements: 9.4, 11.5, 12.4, 15.5_

  - [ ]* 15.6 Sync_Client 속성·단위 테스트 작성
    - **Property 1: 블록 분할 경계와 복원** - `fc.uint8Array`와 작은 blockSize로 경계·복원 검증, 실제 4MB 경계는 단위 테스트로 확인
    - **Property 4: 업로드·다운로드 라운드트립** - 서버 API 대역으로 업로드 후 다운로드 재구성 결과가 원본과 같은지 검증
    - `tests/unit/poller.test.ts`: 백오프 간격, 410 전체 동기화 (fake-indexeddb, 가짜 타이머)
    - _Requirements: 3.1, 6.4, 6.6, 15.5_

- [ ] 16. Web_App 화면
  - [ ] 16.1 로그인·가입 화면과 단말 등록
    - `(auth)/login`, `(auth)/signup`; 첫 로그인 시 Device 등록 후 IndexedDB에 deviceId 저장
    - _Requirements: 1.1, 1.4_

  - [ ] 16.2 내 드라이브 화면
    - `(drive)/drive/[[...path]]`: 사이드 메뉴, 폴더 탐색, 드래그 앤 드롭·파일 선택 업로드, 진행률·일시 중지·재개, 폴더 생성, 삭제, 롱 폴링 이벤트로 목록 갱신, 충돌 안내
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ] 16.3 파일 상세 패널
    - 갱신 이력 목록, 버전 다운로드, 보관 표시, 공유 대화상자
    - _Requirements: 7.1, 10.1, 14.4, 17.6, 17.7_

  - [ ] 16.4 공유 문서함·최근 문서함·휴지통 화면
    - _Requirements: 17.1_

  - [ ]* 16.5 화면 컴포넌트 테스트 작성
    - `tests/unit/components/*.test.tsx`: 업로드 진행률 표시, 충돌 안내, 이벤트 수신 시 목록 갱신
    - _Requirements: 17.2, 17.4, 17.5_

- [ ] 17. 정리 작업(jobs)
  - [ ] 17.1 주기 작업 구현
    - `src/server/jobs/`: `expireUploads`, `pruneVersions`, `purgeDeleted`, `archiveColdBlocks`, `purgeEvents`; `pg_try_advisory_lock`으로 단일 실행
    - `scripts/run-jobs.ts`: 작업별 주기 스케줄러
    - _Requirements: 4.8, 9.3, 12.3, 14.3, 14.5_

  - [ ]* 17.2 버전 정리 속성 테스트 작성
    - **Property 20: 버전 상한과 보관 표시** - 버전 수·kept 집합·상한을 생성해 정리 결과 검증
    - _Requirements: 14.3, 14.4_

- [ ] 18. 통합 테스트
  - [ ] 18.1 통합 테스트 기반 구성
    - `tests/support/`: 테스트 DB 마이그레이션·초기화, 객체 저장소 버킷 초기화, 사용자·단말 팩토리, Route Handler 호출 헬퍼
    - _Requirements: 16.4_

  - [ ] 18.2 DB 의존 속성 통합 테스트 작성
    - **Property 7: 계정 단위 중복 제거** - 같은 블록을 포함한 업로드를 반복해 block_objects 행과 객체 수 1개 검증
    - **Property 8: 버전 번호 연속성** - 성공·만료·충돌 업로드 열에서 version_number 연속성 검증
    - **Property 12: 동시 업로드 충돌 판정** - 같은 base_version 완료 요청 N개를 `Promise.all`로 동시에 보내 1개 최신, N-1개 충돌 사본 검증
    - **Property 18: 커밋 후 읽기 일관성** - 캐시 적중·미스·Redis 중지 상태에서 커밋 후 조회 검증
    - **Property 19: 사용량과 할당량** - 업로드·수정·삭제 열 후 used_bytes 합 검증과 507 무변경 검증
    - _Requirements: 4.3, 7.5, 8.5, 13.3, 14.2, 14.7_

  - [ ] 18.3 장애·흐름 통합 테스트 작성
    - 업로드→다운로드 라운드트립, 델타 업로드 전송 블록 수, 이어 올리기
    - region-a 객체 삭제 후 region-b 읽기, Redis 중지 시 롱 폴링 DB 재조회, 오프라인 단말 재접속 이벤트 전달, 만료 커서 410
    - jobs: 업로드 만료, cold 이동과 다운로드 시 복귀 (기간 환경 변수로 단축)
    - _Requirements: 4.8, 5.2, 5.3, 6.6, 12.2, 12.4, 14.5, 14.6, 15.1_

- [ ] 19. E2E 테스트
  - [ ] 19.1 다중 단말 E2E 시나리오 작성
    - Playwright 브라우저 컨텍스트 2개: A 업로드가 B 목록에 새로 고침 없이 표시, 동시 수정 시 충돌 안내, 업로드 중 오프라인 전환 후 재개 시 남은 블록만 전송
    - _Requirements: 8.3, 17.3, 17.4, 17.5_

- [ ] 20. 성능 측정과 문서
  - [ ]* 20.1 부하 테스트 작성과 결과 기록
    - k6 스크립트로 업로드 시작 API 480 QPS, 메타데이터 조회 p95 측정 후 `docs/load-test.md`에 기록
    - _Requirements: 16.2, 16.3_

  - [ ] 20.2 README 작성
    - 아키텍처 요약, 실행 방법(`docker compose up`), 테스트 실행 방법, 책 설계와 다르게 구현한 지점(클라이언트 분할, 이벤트 로그 기반 백업 큐, 완료 콜백 대체)
    - _Requirements: 16.4_

- [ ] 21. Final Checkpoint - 전체 시스템 완료
  - `vitest run` 전체, `playwright test` 통과 확인
  - `docker compose up`으로 전체 스택 기동과 `/api/health` 200 확인
  - 문의사항이 있으면 사용자에게 질문하세요.

## Notes

- `*` 표시 서브태스크는 선택 사항으로 빠른 MVP 구현 시 건너뛸 수 있습니다
- 각 태스크는 특정 요구사항을 참조하여 추적 가능성을 보장합니다
- 속성 기반 테스트(fast-check)는 설계 문서의 23개 Property를 모두 커버합니다. DB가 필요한 속성은 18.2에서 실제 PostgreSQL로 검증합니다
- 체크포인트(Task 9, 14, 21)에서 점진적 검증을 수행합니다
- Next.js 16에서 동적 세그먼트 `params`는 Promise이므로 `await params`로 읽습니다
- 같은 Next.js 이미지를 app 인스턴스 2개로 띄워 무상태 수평 확장을 시연합니다

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3", "5.1", "6.1", "7.1"] },
    { "id": 3, "tasks": ["3.4", "4.1", "5.4", "6.2"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4", "5.2", "12.1", "13.1"] },
    { "id": 5, "tasks": ["5.3", "5.5", "7.2", "13.2"] },
    { "id": 6, "tasks": ["7.3", "7.4"] },
    { "id": 7, "tasks": ["7.5", "8.1", "8.2"] },
    { "id": 8, "tasks": ["8.3", "10.1", "10.2", "11.1", "12.2"] },
    { "id": 9, "tasks": ["10.3", "11.2", "12.3", "12.4", "15.1", "15.2", "17.1"] },
    { "id": 10, "tasks": ["15.3", "15.4", "15.5", "17.2", "18.1"] },
    { "id": 11, "tasks": ["15.6", "16.1", "18.2", "18.3"] },
    { "id": 12, "tasks": ["16.2", "16.3", "16.4"] },
    { "id": 13, "tasks": ["16.5", "19.1", "20.1", "20.2"] }
  ]
}
```
