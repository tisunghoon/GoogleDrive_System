# Requirements Document

## Introduction

구글 드라이브 시스템(Google Drive System) 토이 프로젝트는 파일 업로드·다운로드, 여러 단말 간 파일 동기화, 변경 알림을 지원하는
클라우드 파일 저장소의 핵심 아키텍처 패턴을 학습하기 위한 프로젝트입니다.

「가상 면접 사례로 배우는 대규모 시스템 설계 기초」 15장의 설계를 기준으로, 파일을 4MB 블록으로 나눠 압축·암호화해 저장하는 블록 저장소,
수정된 블록만 전송하는 델타 동기화, 강한 일관성을 갖는 메타데이터 데이터베이스, 롱 폴링 기반 알림 서비스, 오프라인 사용자 백업 큐,
동기화 충돌 처리, 저장 공간 절약 전략을 구현하고 검증합니다.

프런트엔드와 백엔드는 하나의 Next.js(App Router, TypeScript) 애플리케이션으로 구현합니다. 웹 화면은 React 컴포넌트로,
API_Server·Block_Server·Notification_Service는 Next.js Route Handler로 구현하되 모듈 경계를 나눠 책의 컴포넌트 구분을 유지합니다.
실제 Amazon S3·S3 Glacier 대신 S3 호환 객체 저장소(SeaweedFS)를 사용하고, 서로 다른 버킷으로 지역(region) 다중화와 아카이빙 저장소를 흉내 냅니다.
모바일 앱은 범위에서 제외하고, 브라우저 웹 클라이언트를 단말(Device)로 사용합니다. 브라우저 창(프로필)마다 별도 Device로 등록해 여러 단말 간 동기화를 시연합니다.
여러 사용자가 같은 문서를 동시에 편집하는 협업 편집 기능은 범위에서 제외합니다.

---

## Glossary

- **API_Server**: 사용자 인증, 단말 등록, 파일 메타데이터 갱신, 갱신 이력·공유 등 파일 전송을 제외한 거의 모든 요청을 처리하는 무상태 서버 컴포넌트
- **Block_Server**: 블록을 받아 압축·암호화한 뒤 Object_Storage에 저장하고, 다운로드 시 복호화·압축 해제해 돌려주는 서버 컴포넌트
- **Web_App**: Next.js로 만든 웹 화면. 파일 목록, 업로드, 다운로드, 갱신 이력, 공유, 휴지통 화면을 제공한다
- **Sync_Client**: Web_App 안에서 동작하는 브라우저 측 동기화 모듈. 파일을 블록으로 분할하고 해시를 계산하며, 알림을 받아 변경된 파일 메타데이터와 블록을 내려받아 로컬 사본(IndexedDB 블록 캐시)을 최신으로 유지한다
- **Object_Storage**: 블록을 독립 객체로 보관하는 S3 호환 저장소. 주 지역 버킷과 복제 지역 버킷으로 구성된다
- **Cold_Storage**: 오랫동안 접근되지 않은 블록을 옮겨 보관하는 아카이빙 저장소 (S3 Glacier 대체 버킷)
- **Metadata_DB**: 사용자, 단말, 네임스페이스, 파일, 파일 버전, 블록 메타데이터를 보관하는 관계형 데이터베이스
- **Metadata_Cache**: 자주 조회되는 메타데이터를 보관하는 인메모리 캐시
- **Notification_Service**: 파일 추가·편집·삭제·공유 이벤트를 롱 폴링으로 클라이언트에 전달하는 컴포넌트
- **Offline_Backup_Queue**: 접속하지 않은 단말에 전달하지 못한 이벤트를 보관했다가 재접속 시 전달하는 단말별 큐
- **User**: 서비스에 가입한 사용자
- **Device**: 사용자가 등록한 단말. 한 사용자는 여러 Device를 가질 수 있다
- **Namespace**: 사용자의 루트 디렉터리. 파일과 폴더는 Namespace와 상대 경로(relative path)의 조합으로 유일하게 식별된다
- **File**: Namespace 안의 파일 또는 폴더와 그 최신 상태
- **File_Version**: 파일의 갱신 이력 한 건. 생성 후에는 수정할 수 없는 읽기 전용 레코드다
- **Block**: 파일을 최대 4MB(4,194,304바이트) 단위로 나눈 조각. 압축 전 원본 내용의 SHA-256 해시로 식별된다
- **Upload_Session**: 하나의 파일 버전을 올리는 동안 필요한 블록 목록과 수신 상태를 추적하는 단위. 이어 올리기의 기준이 된다
- **Conflicted_Copy**: 동기화 충돌에서 나중에 처리된 변경을 보존하기 위해 만드는 별도 파일

---

## Requirements

### Requirement 1: 사용자 인증과 단말 등록

**User Story:** 사용자로서, 로그인한 뒤 내 단말을 등록하고 싶습니다. 그래야 여러 단말에서 같은 파일을 안전하게 동기화할 수 있습니다.

#### Acceptance Criteria

1. WHEN 사용자가 올바른 이메일과 비밀번호로 로그인을 요청할 때, THE API_Server SHALL 유효 기간 60분인 JWT 액세스 토큰을 발급한다
2. IF 요청에 JWT가 없거나 서명이 올바르지 않거나 만료된 경우, THEN THE API_Server SHALL HTTP 401 응답과 표준 오류 응답을 반환한다
3. THE API_Server SHALL 로그인과 회원 가입을 제외한 모든 API에 대해 유효한 JWT를 요구한다
4. WHEN 인증된 사용자가 단말 등록을 요청할 때, THE API_Server SHALL 고유한 device_id(UUID)를 발급하고 Device를 해당 사용자에 연결해 저장한다
5. THE API_Server SHALL 한 사용자당 최대 10대의 Device 등록을 허용하고, 초과하는 등록 요청에는 HTTP 409 응답을 반환한다
6. WHEN 사용자가 가입할 때, THE API_Server SHALL 해당 사용자의 루트 Namespace를 하나 생성하고 저장 공간 할당량을 10GB(10,737,418,240바이트)로 설정한다
7. THE API_Server SHALL 파일·블록·알림 관련 요청에서 요청 단말의 device_id를 헤더로 받아 해당 사용자에게 등록된 Device인지 검증하고, 아니면 HTTP 403 응답을 반환한다

---

### Requirement 2: 파일 메타데이터와 네임스페이스 관리

**User Story:** 사용자로서, 내 드라이브의 폴더 구조와 파일 목록을 보고 폴더를 만들고 싶습니다. 그래야 파일을 정리해서 관리할 수 있습니다.

#### Acceptance Criteria

1. THE Metadata_DB SHALL 같은 Namespace 안에서 삭제되지 않은 File의 relative_path가 중복되지 않도록 보장한다
2. WHEN 사용자가 폴더 생성을 요청할 때, THE API_Server SHALL 상대 경로(1자 이상 1,024자 이하, `/`로 시작)를 검증하고 is_directory가 참인 File을 생성한다
3. IF 상대 경로가 형식에 맞지 않거나 상위 폴더가 존재하지 않는 경우, THEN THE API_Server SHALL HTTP 400 응답과 함께 실패한 필드명과 사유를 반환한다
4. IF 같은 경로에 삭제되지 않은 File이 이미 존재하는 경우, THEN THE API_Server SHALL HTTP 409 응답을 반환한다
5. WHEN 사용자가 폴더의 하위 목록을 요청할 때, THE API_Server SHALL 해당 폴더 바로 아래의 삭제되지 않은 File 목록을 이름, is_directory, 크기, latest_version, last_modified와 함께 반환한다
6. THE API_Server SHALL 사용자가 소유하거나 공유받은 Namespace의 File에만 접근을 허용하고, 그 외 경로 요청에는 존재 여부를 노출하지 않도록 HTTP 404 응답을 반환한다

---

### Requirement 3: 블록 분할과 블록 저장

**User Story:** 사용자로서, 큰 파일을 올려도 안전하고 효율적으로 저장되기를 원합니다. 그래야 네트워크와 저장 공간을 낭비하지 않고 데이터가 보호됩니다.

#### Acceptance Criteria

1. THE Sync_Client SHALL 파일을 앞에서부터 최대 4MB(4,194,304바이트) 크기의 Block으로 나누고, 마지막 Block만 4MB보다 작을 수 있게 한다
2. THE Sync_Client SHALL 각 Block의 압축 전 원본 바이트로 SHA-256 해시를 계산하고, 파일 전체 바이트의 SHA-256을 파일 checksum으로 계산한다
3. WHEN Block_Server가 Block을 수신할 때, THE Block_Server SHALL 수신한 바이트의 SHA-256이 요청에 명시한 해시와 같은지 검증하고, 다르면 HTTP 400 응답을 반환하고 저장하지 않는다
4. WHEN Block 해시 검증이 통과할 때, THE Block_Server SHALL Block을 압축한 다음 AES-256-GCM으로 암호화해 Object_Storage에 저장한다
5. THE Block_Server SHALL Block을 저장할 때 Object_Storage의 주 지역 버킷과 복제 지역 버킷 모두에 기록이 끝난 뒤에만 저장 성공으로 응답한다
6. WHEN Block 다운로드 요청을 받을 때, THE Block_Server SHALL 저장된 객체를 복호화하고 압축을 해제해 원본 바이트를 반환한다
7. FOR ALL Block에 대해, 압축·암호화 후 복호화·압축 해제한 결과는 원본 바이트와 같아야 한다 (라운드트립)
8. THE Block_Server SHALL 암호화 키를 환경 변수로 주입받고, 키를 Metadata_DB나 Object_Storage에 저장하지 않는다

---

### Requirement 4: 파일 업로드 절차

**User Story:** 사용자로서, 파일을 드라이브에 올리면 내 다른 단말에도 그 사실이 전달되기를 원합니다. 그래야 어느 단말에서든 같은 파일을 볼 수 있습니다.

#### Acceptance Criteria

1. WHEN Sync_Client가 파일 업로드를 시작할 때, THE API_Server SHALL 경로, 파일 크기, checksum, 순서가 있는 Block 해시 목록, base_version(새 파일이면 없음)을 검증하고 Upload_Session을 생성한다
2. IF 파일 크기가 10GB(10,737,418,240바이트)를 초과하는 경우, THEN THE API_Server SHALL HTTP 413 응답을 반환한다
3. IF 업로드 후 사용자의 사용량이 저장 공간 할당량을 초과하게 되는 경우, THEN THE API_Server SHALL HTTP 507 응답과 함께 현재 사용량과 할당량을 반환한다
4. WHEN Upload_Session이 생성될 때, THE API_Server SHALL 새 File_Version의 메타데이터를 업로드 상태 pending으로 Metadata_DB에 저장하고 Notification_Service에 업로드 시작 이벤트를 통지한다
5. WHEN Upload_Session이 생성될 때, THE API_Server SHALL Block 해시 목록 중 해당 사용자의 계정에 아직 저장되지 않은 Block 해시 목록만 업로드 대상으로 반환한다
6. WHEN 업로드 대상 Block이 모두 Block_Server에 저장될 때, THE Block_Server SHALL API_Server에 완료 콜백을 호출한다
7. WHEN 완료 콜백을 받을 때, THE API_Server SHALL 하나의 트랜잭션 안에서 File_Version의 상태를 uploaded로 바꾸고 File의 latest_version, checksum, last_modified를 갱신한 뒤 Notification_Service에 파일 변경 이벤트를 통지한다
8. IF Upload_Session이 생성 후 24시간 안에 완료되지 않은 경우, THEN THE API_Server SHALL 해당 세션과 pending 상태 File_Version을 만료 처리하고 File의 latest_version을 바꾸지 않는다
9. THE API_Server SHALL 업로드 상태가 uploaded가 아닌 File_Version을 다운로드·갱신 이력 응답과 File의 latest_version에 포함하지 않는다

---

### Requirement 5: 이어 올리기와 델타 동기화

**User Story:** 사용자로서, 네트워크가 끊겨도 처음부터 다시 올리지 않고, 파일 일부만 고쳤을 때는 바뀐 부분만 보내고 싶습니다. 그래야 모바일 데이터와 시간을 아낄 수 있습니다.

#### Acceptance Criteria

1. WHEN Sync_Client가 Upload_Session의 상태를 조회할 때, THE API_Server SHALL 아직 수신되지 않은 Block 해시 목록을 반환한다
2. WHEN 업로드가 중단된 뒤 Sync_Client가 같은 Upload_Session으로 재개할 때, THE Sync_Client SHALL 이미 수신된 Block을 다시 전송하지 않고 남은 Block만 전송한다
3. WHEN 기존 파일을 수정해 업로드할 때, THE Sync_Client SHALL 이전 버전과 해시가 같은 Block은 전송하지 않고 해시가 달라진 Block만 전송한다
4. THE Metadata_DB SHALL 새 File_Version의 블록 목록에서 이전 버전과 같은 Block을 기존 블록 객체에 대한 참조로 기록한다
5. FOR ALL 파일 수정에 대해, 전송된 Block 수는 이전 버전에 없던 서로 다른 Block 해시의 수와 같아야 한다

---

### Requirement 6: 파일 다운로드와 재구성

**User Story:** 사용자로서, 다른 단말에서 바뀐 파일을 내 단말에서 자동으로 최신 상태로 받고 싶습니다. 그래야 항상 같은 파일을 보게 됩니다.

#### Acceptance Criteria

1. WHEN Sync_Client가 경로로 파일 다운로드를 요청할 때, THE API_Server SHALL 최신 uploaded File_Version의 version_number, checksum, 순서가 있는 Block 해시 목록을 반환한다
2. WHERE 요청에 version_number가 지정된 경우, THE API_Server SHALL 해당 File_Version의 Block 해시 목록을 반환한다
3. IF 경로에 해당하는 File이 없거나 삭제된 경우, THEN THE API_Server SHALL HTTP 404 응답을 반환한다
4. WHEN Sync_Client가 Block 목록을 받을 때, THE Sync_Client SHALL 로컬 블록 캐시에 없는 Block만 Block_Server에서 내려받고 block_order 순서대로 이어 붙여 파일을 재구성한다
5. IF 재구성한 파일의 SHA-256이 메타데이터의 checksum과 다른 경우, THEN THE Sync_Client SHALL 로컬 사본을 바꾸지 않고 다운로드를 최대 3회 다시 시도한다
6. FOR ALL 업로드된 파일에 대해, 업로드 후 다운로드해 재구성한 파일은 원본 파일과 바이트 단위로 같아야 한다 (라운드트립)

---

### Requirement 7: 파일 갱신 이력

**User Story:** 사용자로서, 파일이 언제 어느 단말에서 바뀌었는지 보고 이전 버전을 받고 싶습니다. 그래야 실수로 덮어쓴 내용을 되찾을 수 있습니다.

#### Acceptance Criteria

1. WHEN 사용자가 경로와 limit으로 갱신 이력을 요청할 때, THE API_Server SHALL 해당 File의 uploaded File_Version을 version_number 내림차순으로 최대 limit개 반환한다
2. THE API_Server SHALL limit을 1 이상 100 이하의 정수로 검증하고 생략 시 20을 적용하며, 범위를 벗어나면 HTTP 400 응답을 반환한다
3. THE API_Server SHALL 각 이력 항목에 version_number, 크기, checksum, 변경한 device_id, last_modified를 포함한다
4. THE Metadata_DB SHALL File_Version 레코드를 생성 후 수정할 수 없게 하고, 수정 시도는 거부한다
5. THE API_Server SHALL 한 File의 version_number를 1부터 시작해 새 버전마다 정확히 1씩 증가시킨다

---

### Requirement 8: 동기화 충돌 처리

**User Story:** 사용자로서, 두 단말에서 같은 파일을 동시에 고쳤을 때 어느 쪽 내용도 잃고 싶지 않습니다. 그래야 충돌을 확인하고 직접 합칠 수 있습니다.

#### Acceptance Criteria

1. WHEN 업로드 완료 시점에 요청의 base_version이 File의 latest_version과 같을 때, THE API_Server SHALL 해당 변경을 새 최신 버전으로 반영한다
2. IF 업로드 완료 시점에 요청의 base_version이 File의 latest_version과 다른 경우, THEN THE API_Server SHALL 먼저 반영된 변경을 유지하고 나중 변경을 충돌로 판정한다
3. WHEN 충돌로 판정될 때, THE API_Server SHALL 나중 변경의 내용을 `{원래 이름}_{사용자 이름}_conflicted_copy_{YYYY-MM-DD}{확장자}` 이름의 Conflicted_Copy로 같은 폴더에 저장하고 HTTP 409 응답과 함께 Conflicted_Copy 경로와 서버의 최신 version_number를 반환한다
4. IF 같은 이름의 Conflicted_Copy가 이미 있는 경우, THEN THE API_Server SHALL 이름 끝에 ` (2)`, ` (3)`처럼 증가하는 번호를 붙여 기존 파일을 덮어쓰지 않는다
5. FOR ALL 같은 base_version에서 출발한 동시 업로드 N건에 대해, 정확히 1건만 최신 버전이 되고 나머지 N-1건은 Conflicted_Copy로 보존되어야 한다
6. THE API_Server SHALL 같은 File에 대한 완료 처리들을 직렬화하여 latest_version 갱신이 유실되지 않도록 한다

---

### Requirement 9: 파일 삭제

**User Story:** 사용자로서, 필요 없는 파일을 지우면 다른 단말에서도 지워지기를 원합니다. 그래야 단말마다 정리할 필요가 없습니다.

#### Acceptance Criteria

1. WHEN 사용자가 파일 삭제를 요청할 때, THE API_Server SHALL File을 삭제 상태로 표시하고 Notification_Service에 삭제 이벤트를 통지한다
2. WHEN 사용자가 폴더 삭제를 요청할 때, THE API_Server SHALL 하위의 모든 File을 같은 트랜잭션 안에서 삭제 상태로 표시한다
3. THE API_Server SHALL 삭제된 File의 File_Version과 Block을 즉시 지우지 않고, 삭제 후 30일이 지난 뒤 다른 File_Version이 참조하지 않는 Block만 정리 대상으로 삼는다
4. WHEN 삭제 이벤트를 받을 때, THE Sync_Client SHALL 해당 파일의 로컬 사본을 지우고 Web_App 목록에서 제거한다

---

### Requirement 10: 파일 공유

**User Story:** 사용자로서, 내 폴더를 다른 사용자와 공유하고 싶습니다. 그래야 가족이나 동료와 파일을 함께 쓸 수 있습니다.

#### Acceptance Criteria

1. WHEN 소유자가 다른 사용자의 이메일과 권한(viewer/editor)을 지정해 폴더 공유를 요청할 때, THE API_Server SHALL 해당 폴더를 공유 Namespace로 표시하고 대상 사용자에게 접근 권한을 부여한다
2. IF 공유 대상 이메일의 사용자가 없거나 소유자 자신인 경우, THEN THE API_Server SHALL HTTP 400 응답을 반환한다
3. THE API_Server SHALL viewer 권한 사용자의 업로드·삭제 요청에 HTTP 403 응답을 반환하고 조회·다운로드만 허용한다
4. WHEN 공유가 생성되거나 공유 폴더 안의 파일이 추가·편집·삭제될 때, THE Notification_Service SHALL 소유자와 공유받은 사용자의 모든 Device에 이벤트를 전달한다
5. WHEN 소유자가 공유를 해제할 때, THE API_Server SHALL 대상 사용자의 접근 권한을 즉시 회수하고 이후 요청에 HTTP 404 응답을 반환한다

---

### Requirement 11: 알림 서비스 (롱 폴링)

**User Story:** 사용자로서, 다른 단말에서 파일이 바뀌면 곧바로 알고 싶습니다. 그래야 최신 파일을 내려받을 수 있습니다.

#### Acceptance Criteria

1. WHEN Sync_Client가 마지막으로 받은 이벤트 커서와 함께 롱 폴링 요청을 보낼 때, THE Notification_Service SHALL 커서 이후 이벤트가 있으면 즉시, 없으면 새 이벤트가 생길 때까지 연결을 유지한 뒤 응답한다
2. IF 롱 폴링 연결이 60초 동안 이벤트 없이 유지된 경우, THEN THE Notification_Service SHALL 빈 이벤트 목록과 현재 커서를 반환하고 연결을 끝낸다
3. THE Notification_Service SHALL 각 이벤트에 이벤트 ID, 유형(file_added/file_updated/file_deleted/upload_started/share_created), Namespace ID, 경로, version_number, 발생 device_id, 발생 시각을 포함한다
4. THE Notification_Service SHALL 이벤트를 발생시킨 Device 자신에게는 해당 이벤트를 전달하지 않는다
5. WHEN Sync_Client가 롱 폴링 응답을 받거나 연결이 끊길 때, THE Sync_Client SHALL 변경된 파일의 메타데이터를 받아 다운로드를 처리한 뒤 즉시 새 롱 폴링 요청으로 연결을 복구한다
6. FOR ALL 한 Device에 전달되는 이벤트 열에 대해, 이벤트 ID는 발생 순서대로 단조 증가하고 같은 이벤트가 두 번 전달되지 않아야 한다
7. THE Notification_Service SHALL 서버 한 대가 유지하는 동시 롱 폴링 연결 수를 설정값(기본 10,000)으로 제한하고, 초과 요청에는 HTTP 503 응답과 Retry-After 헤더를 반환한다

---

### Requirement 12: 오프라인 사용자 백업 큐

**User Story:** 사용자로서, 노트북을 며칠 꺼 두었다가 켜도 그동안의 변경이 빠짐없이 반영되기를 원합니다. 그래야 오래된 파일로 작업하지 않습니다.

#### Acceptance Criteria

1. WHILE Device에 활성 롱 폴링 연결이 없는 동안, THE Notification_Service SHALL 해당 Device로 보낼 이벤트를 Offline_Backup_Queue에 보관한다
2. WHEN Device가 이전 커서로 다시 롱 폴링을 요청할 때, THE Notification_Service SHALL Offline_Backup_Queue에 쌓인 이벤트를 발생 순서대로 먼저 전달한다
3. THE Offline_Backup_Queue SHALL 이벤트를 최대 30일 동안 보관하고, 30일이 지난 이벤트는 삭제한다
4. IF 요청한 커서가 보관 기간을 벗어나 이벤트를 이어서 전달할 수 없는 경우, THEN THE Notification_Service SHALL HTTP 410 응답을 반환하고, Sync_Client는 전체 파일 목록과 로컬 상태를 비교하는 전체 동기화를 수행한다
5. THE Offline_Backup_Queue SHALL 큐 저장소 장애 시에도 이벤트를 잃지 않도록 이벤트를 영속 저장소에 기록한 뒤에만 기록 성공으로 처리한다

---

### Requirement 13: 강한 일관성과 메타데이터 캐시

**User Story:** 사용자로서, 어느 단말에서 보더라도 같은 파일이 같은 내용으로 보이기를 원합니다. 그래야 버전 혼동 없이 작업할 수 있습니다.

#### Acceptance Criteria

1. THE API_Server SHALL 파일 메타데이터 변경(업로드 완료, 삭제, 공유 변경)을 Metadata_DB 트랜잭션으로 처리하고, 트랜잭션이 커밋된 뒤에만 성공 응답과 알림 통지를 한다
2. WHEN Metadata_DB의 메타데이터가 변경될 때, THE API_Server SHALL 커밋 직후 관련 Metadata_Cache 항목을 무효화한다
3. FOR ALL 메타데이터 변경에 대해, 변경 커밋 이후의 조회는 캐시 적중 여부와 관계없이 변경된 값을 반환해야 한다
4. IF Metadata_Cache 조회나 무효화에 실패한 경우, THEN THE API_Server SHALL 오류 로그를 남기고 Metadata_DB에서 직접 조회해 응답한다
5. THE Metadata_Cache SHALL 캐시 항목에 최대 10분의 TTL을 적용해 무효화 실패 시에도 오래된 값이 10분을 넘겨 남지 않게 한다

---

### Requirement 14: 저장 공간 절약

**User Story:** 운영자로서, 파일 버전이 쌓여도 저장 비용이 빠르게 늘지 않기를 원합니다. 그래야 서비스를 적은 비용으로 운영할 수 있습니다.

#### Acceptance Criteria

1. THE Block_Server SHALL 같은 사용자 계정 안에서 해시가 같은 Block을 한 번만 저장하고, 이후 업로드는 기존 객체를 참조한다 (계정 단위 중복 제거)
2. FOR ALL 같은 사용자의 업로드에 대해, 내용이 같은 Block이 여러 번 업로드되어도 Object_Storage의 해당 객체 수는 1개여야 한다
3. THE API_Server SHALL 파일당 보관하는 uploaded File_Version 수를 설정값(기본 100)으로 제한하고, 상한을 넘으면 가장 오래된 버전부터 정리한다
4. THE API_Server SHALL 사용자가 보관 표시한 File_Version은 버전 상한 정리 대상에서 제외한다
5. WHEN Block이 설정된 기간(기본 90일) 동안 어떤 다운로드에서도 읽히지 않았을 때, THE Block_Server SHALL 해당 Block을 Cold_Storage로 옮기고 블록 메타데이터에 저장 위치를 기록한다
6. WHEN Cold_Storage에 있는 Block의 다운로드가 요청될 때, THE Block_Server SHALL Cold_Storage에서 읽어 반환하고 해당 Block을 Object_Storage로 되돌린다
7. THE API_Server SHALL 사용자의 저장 공간 사용량을 중복 제거 전 파일 크기의 합(최신 버전 기준)으로 계산해 할당량 검사에 사용한다

---

### Requirement 15: 장애 처리

**User Story:** 운영자로서, 일부 컴포넌트에 장애가 나도 데이터를 잃지 않고 서비스가 계속되기를 원합니다. 그래야 사용자가 장애를 거의 느끼지 않습니다.

#### Acceptance Criteria

1. IF Object_Storage 주 지역 버킷에서 Block 읽기가 실패한 경우, THEN THE Block_Server SHALL 복제 지역 버킷에서 같은 Block을 읽어 반환한다
2. IF Block 저장 중 Block_Server 인스턴스가 중단된 경우, THEN THE Sync_Client SHALL 같은 Upload_Session으로 다른 Block_Server 인스턴스에 남은 Block을 이어서 올릴 수 있어야 한다
3. IF Metadata_DB 연결에 실패한 경우, THEN THE API_Server SHALL HTTP 503 응답과 표준 오류 응답을 반환하고 부분적으로 기록된 상태를 남기지 않는다
4. IF Notification_Service로의 이벤트 통지가 실패한 경우, THEN THE API_Server SHALL 파일 변경 커밋은 유지하고 이벤트를 재시도 가능한 저장소에 남겨 최대 5회 재전송한다
5. WHEN Notification_Service 인스턴스가 재시작될 때, THE Sync_Client SHALL 지수 백오프(1초부터 시작해 최대 60초)로 롱 폴링 재연결을 시도하고, 마지막 커서로 놓친 이벤트를 이어 받는다
6. THE API_Server SHALL `/health` 요청에 Metadata_DB, Metadata_Cache, Object_Storage, Notification_Service 각각의 상태를 포함해 응답하고, 하나라도 비정상이면 HTTP 503을 반환한다

---

### Requirement 16: 성능과 확장성

**User Story:** 운영자로서, 사용자 수가 늘어도 서버만 추가하면 처리량을 늘릴 수 있기를 원합니다. 그래야 DAU 1천만 규모로 성장할 수 있습니다.

#### Acceptance Criteria

1. THE API_Server, Block_Server, Notification_Service SHALL 요청 처리에 필요한 상태(업로드 세션, 이벤트, 커서)를 프로세스 메모리가 아닌 Metadata_DB와 Metadata_Cache에 두어, Next.js 인스턴스를 늘리는 것만으로 처리량을 늘릴 수 있게 한다
2. THE API_Server SHALL 캐시 적중 시 메타데이터 조회 API(목록, 다운로드 메타데이터, 갱신 이력)를 로컬 환경에서 p95 200ms 이내로 응답한다
3. THE 시스템 SHALL 업로드 API 기준 최대 480 QPS를 목표 처리량으로 삼고, 부하 테스트로 측정한 결과를 문서에 기록한다
4. THE 시스템 SHALL Docker Compose로 Next.js 애플리케이션(API_Server, Block_Server, Notification_Service, Web_App), Metadata_DB, Metadata_Cache, Object_Storage를 한 번에 기동할 수 있게 한다

---

### Requirement 17: 웹 화면

**User Story:** 사용자로서, 브라우저에서 파일을 끌어다 놓아 올리고 폴더를 탐색하고 싶습니다. 그래야 별도 프로그램 설치 없이 드라이브를 쓸 수 있습니다.

#### Acceptance Criteria

1. THE Web_App SHALL 내 드라이브, 공유 문서함, 최근 문서함, 휴지통 메뉴와 현재 폴더의 파일 목록(이름, 소유자, 마지막 수정 시각, 크기)을 표시한다
2. WHEN 사용자가 파일을 목록 영역에 끌어다 놓거나 파일 선택 버튼으로 고를 때, THE Web_App SHALL 해당 파일을 현재 폴더로 업로드하고 파일별 진행률(전송한 블록 수 / 전송 대상 블록 수)을 표시한다
3. IF 업로드 중 네트워크 오류가 발생한 경우, THEN THE Web_App SHALL 업로드를 일시 중지 상태로 표시하고, 사용자가 재개하면 같은 Upload_Session으로 남은 Block만 전송한다
4. WHEN 롱 폴링으로 현재 폴더에 해당하는 이벤트를 받을 때, THE Web_App SHALL 새로 고침 없이 목록을 갱신한다
5. WHEN 업로드가 충돌로 판정될 때, THE Web_App SHALL Conflicted_Copy가 생성되었음을 알리는 메시지와 두 파일의 경로를 표시한다
6. THE Web_App SHALL 파일별 갱신 이력 화면에서 버전 목록을 보여 주고, 선택한 버전을 내려받을 수 있게 한다
7. WHEN 사용자가 파일 다운로드를 요청할 때, THE Web_App SHALL Sync_Client로 재구성하고 checksum 검증을 통과한 파일만 브라우저 다운로드로 저장한다
