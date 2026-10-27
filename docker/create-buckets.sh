#!/bin/sh
# 저장소가 S3 요청을 받을 수 있을 때까지 기다린 뒤 버킷 3개를 만든다.
set -e
for i in $(seq 1 30); do
  aws --endpoint-url "$S3_ENDPOINT" s3api list-buckets >/dev/null 2>&1 && break
  sleep 2
done
for bucket in drive-region-a drive-region-b drive-cold; do
  aws --endpoint-url "$S3_ENDPOINT" s3api head-bucket --bucket "$bucket" 2>/dev/null \
    || aws --endpoint-url "$S3_ENDPOINT" s3api create-bucket --bucket "$bucket"
done
