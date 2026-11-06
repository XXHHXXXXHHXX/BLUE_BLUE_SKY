#!/usr/bin/env bash
# ============================================================
# SPECCPU2017 子项完整示例: 提交 -> 等待 -> 取结果
# 服务: http://141.61.5.137:7000
# 依赖: curl, python
# ============================================================
set -euo pipefail

BASE="http://141.61.5.137:7000"
QUEUE="bluesky-queue-000"     # 你的独占队列
ITEM="505"                    # 子项: 505 / 505_mcf_r / mcf_r
TARGET="133"                  # 目标机
COPIES=192                    # 线程数
CONFIG="v200_baseline"        # 配置文件
CHROOT="/home/spec2017_env"   # 已有 chroot, 跳过解压+编译

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# ---------- 1. 取队列当前状态 ----------
curl -sS "$BASE/api/v1/queues/$QUEUE" -o "$TMP/q.json"

# ---------- 2. 构造 candidate (保留旧 item + 追加新 item) ----------
python - "$TMP/q.json" "$TMP/payload.json" "$ITEM" "$TARGET" "$COPIES" "$CONFIG" "$CHROOT" <<'PY'
import json,sys
q=json.load(open(sys.argv[1],encoding='utf-8'))
item,target,copies,config,chroot=sys.argv[3],sys.argv[4],int(sys.argv[5]),sys.argv[6],sys.argv[7]
items=[{
    'item_id': it['item_id'],
    'definition_id': it['spec']['definition']['definition_id'],
    'arguments': it['spec'].get('arguments',[]),
    'bindings': it['spec'].get('bindings',[]),
    'plugins': it['spec'].get('plugins',[]),
    'comment': it.get('comment',''),
} for it in q['items']]
items.append({
    'definition_id': 'kunpeng.spec.speccpu:SPECCPU2017',
    'arguments': [
        {'name':'copies','value':copies},
        {'name':'config','value':config},
        {'name':'_item','value':item},
        {'name':'_use_existing_chroot','value':chroot},
    ],
    'bindings': [{'role':'target','target_name':target}],
    'plugins': [],
    'comment': 'SPEC2017 %s' % item,
})
json.dump({
    'candidate': {
        'name': q['name'], 'remark': q.get('remark',''),
        'scheduled_for': q.get('scheduled_for'),
        'paused': q['status']=='paused', 'items': items,
    },
    'expected_revision': q['revision'],
    'queue_id': q['queue_id'],
}, open(sys.argv[2],'w',encoding='utf-8'), ensure_ascii=False)
PY

# ---------- 3. prepare ----------
curl -sS -X POST "$BASE/api/v1/queues/$QUEUE/prepare" \
     -H 'Content-Type: application/json' --data-binary "@$TMP/payload.json" -o "$TMP/prep.json"

python - "$TMP/prep.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8')); pc=d['prepared_change']
for w in pc.get('warnings') or []: print('WARN', w['code'], w['message'])
for r in pc.get('prerequisite_reports') or []:
    for i in r.get('issues') or []: print('ISSUE', i['check_id'], i['message'], i['effect'])
PY

# ---------- 4. commit ----------
python - "$TMP/prep.json" "$TMP/commit.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8')); pc=d['prepared_change']
json.dump({'preparation_id': d['preparation_id'],
           'accepted_warning_digest': pc['warning_digest'] if pc.get('warnings') else None},
          open(sys.argv[2],'w',encoding='utf-8'))
PY

KEY=$(python -c "import uuid;print(uuid.uuid4().hex)")
curl -sS -X POST "$BASE/api/v1/queues/commit" \
     -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" \
     --data-binary "@$TMP/commit.json" -o "$TMP/commit-resp.json"

ITEM_ID=$(python -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8'))['items'][-1]['item_id'])" "$TMP/commit-resp.json")
STATUS=$(python -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8'))['status'])" "$TMP/commit-resp.json")
echo "submitted item=$ITEM_ID status=$STATUS"

# ---------- 5. resume (队列暂停时) ----------
case "$STATUS" in
  paused|failed|cancelled|missed)
    curl -sS -X POST "$BASE/api/v1/queues/$QUEUE/resume" \
         -H "Idempotency-Key: $(python -c 'import uuid;print(uuid.uuid4().hex)')" >/dev/null
    echo "resumed";;
esac

# ---------- 6. 等待完成 ----------
RUN_ID=""
for _ in $(seq 1 720); do   # 最多 2h (10s * 720)
  curl -sS "$BASE/api/v1/queues/$QUEUE" -o "$TMP/q.json" 2>/dev/null || { sleep 10; continue; }
  python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
for it in d['items']:
    if it['item_id']==sys.argv[2]: print(it['status'], it.get('run_id') or '-'); break
" "$TMP/q.json" "$ITEM_ID" > "$TMP/st.txt"
  read -r ST RID < "$TMP/st.txt"
  ST="${ST%$'\r'}"; RID="${RID%$'\r'}"   # Windows: 剥掉 CRLF 的 \r
  RID="${RID%$'\r'}"
  [ "$ST" != "${LAST:-}" ] && echo "$(date +%H:%M:%S) $ST" && LAST="$ST"
  case "$ST" in completed|failed|skipped|cancelled|interrupted) RUN_ID="$RID"; break;; esac
  sleep 10
done

[ -n "$RUN_ID" ] && [ "$RUN_ID" != "-" ] || { echo "no run_id"; exit 1; }
echo "run_id=$RUN_ID"

# ---------- 7. 结果 ----------
curl -sS "$BASE/api/v1/runs/$RUN_ID" -o "$TMP/run.json"
python - "$TMP/run.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
print('status:', d['status'])
for k,v in (d.get('metrics') or {}).items(): print('  %-24s %s' % (k,v))
for f in d.get('failures') or []: print('FAIL', f.get('phase'), f.get('message'))
if d.get('error'): print('ERROR', d['error'])
PY

# ---------- 8. 下载 result.* ----------
OUT="./spec2017-results/$RUN_ID"; mkdir -p "$OUT"
curl -sS "$BASE/api/v1/runs/$RUN_ID/artifacts" -o "$TMP/arts.json"
python -c "
import json,sys
for a in json.load(open(sys.argv[1],encoding='utf-8'))['artifacts']:
    if a['path'].startswith('result.') or a['path'].startswith('run_'): print(a['path'])
" "$TMP/arts.json" > "$TMP/want.txt"

while IFS= read -r rel; do
  rel="${rel%$'\r'}"
  [ -z "$rel" ] && continue
  mkdir -p "$OUT/$(dirname "$rel")"
  curl -sS -f -o "$OUT/$rel" "$BASE/api/v1/runs/$RUN_ID/artifacts/$rel" \
    && echo "  ✓ $rel" || echo "  ✗ $rel"
done < "$TMP/want.txt"

echo "results in $OUT"
