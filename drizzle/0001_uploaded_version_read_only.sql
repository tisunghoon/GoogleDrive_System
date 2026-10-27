-- uploaded 상태 버전은 갱신 이력이므로 고칠 수 없다 (요구사항 7.4). 정리 작업의 DELETE는 허용한다.
CREATE FUNCTION forbid_uploaded_version_update() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'uploaded' THEN
    RAISE EXCEPTION 'file_versions % is read-only', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER file_versions_read_only
  BEFORE UPDATE ON file_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_uploaded_version_update();
