#!/usr/bin/env bash
# docs-only.sh — 変更が「docs だけ」かを判定する（instructions-docs-fastpath.md の定義）
#
# docs だけ = 変更ファイルがすべて docs/ の下にあり、docs/supplied/ の下を一つも含まない
# 判定できない場合（イベント不明・before が全ゼロ・git 失敗・一覧が空）は docs だけとみなさない
#
# 入力（環境変数）:
#   EVENT_NAME  github.event_name（pull_request | push）
#   BASE_SHA / HEAD_SHA   pull_request のとき
#   BEFORE_SHA / AFTER_SHA  push のとき
# 出力: 標準出力と $GITHUB_OUTPUT に docs_only=true|false

set -u

emit() {
  echo "docs_only=$1 ($2)"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "docs_only=$1" >> "$GITHUB_OUTPUT"; fi
  exit 0
}

case "${EVENT_NAME:-}" in
  pull_request)
    [ -n "${BASE_SHA:-}" ] && [ -n "${HEAD_SHA:-}" ] || emit false "base/head が無い"
    range="${BASE_SHA}...${HEAD_SHA}"
    ;;
  push)
    [ -n "${BEFORE_SHA:-}" ] && [ -n "${AFTER_SHA:-}" ] || emit false "before/after が無い"
    if [[ "${BEFORE_SHA}" =~ ^0+$ ]]; then emit false "before が全ゼロ"; fi
    range="${BEFORE_SHA}..${AFTER_SHA}"
    ;;
  *)
    emit false "イベント ${EVENT_NAME:-<none>} は判定しない"
    ;;
esac

if ! files="$(git diff --name-only "$range" 2>&1)"; then
  echo "$files"
  emit false "git diff が失敗"
fi
[ -n "$files" ] || emit false "変更ファイルの一覧が空"

echo "変更ファイル（$range）:"
echo "$files" | sed 's/^/  /'

while IFS= read -r f; do
  case "$f" in
    docs/supplied/*) emit false "docs/supplied/ を含む: $f" ;;
    docs/*) ;;
    *) emit false "docs/ 外を含む: $f" ;;
  esac
done <<< "$files"

emit true "すべて docs/ の下（docs/supplied/ を含まない）"
