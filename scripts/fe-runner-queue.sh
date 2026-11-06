#!/usr/bin/env bash
# 往火眼(fe-runner)的指定队列追加用例并触发运行
#
# 服务: http://141.61.5.137:7000  (可用 FE_RUNNER_BASE 覆盖)
# 依赖: curl, python (用于 JSON 处理, 不依赖 jq)
#
# 用法:
#   ./fe-runner-queue.sh --list
#   ./fe-runner-queue.sh --targets
#   ./fe-runner-queue.sh --catalog [关键字]
#   ./fe-runner-queue.sh <队列> <definition_id> [选项]
#
# 选项:
#   --arg name=value      构造参数, 可重复; value 会按 JSON 解析(1->数字, true->布尔), 解析失败当字符串
#   --argstr name=value   构造参数, 强制字符串
#   --bind role=target    角色绑定, 可重复; 角色名见 --catalog 输出的 roles
#   --comment "文本"      该 item 的备注 (支持中文)
#   --dry-run             只 prepare 校验并打印警告, 不提交
#   --no-resume           提交后不自动 resume(队列为 paused/failed 等时)
#
# 示例:
#   ./fe-runner-queue.sh bluesky-queue-000 kunpeng.sleep_case:SleepBench \
#       --arg seconds=60 --bind target=133
#
#   ./fe-runner-queue.sh bluesky-queue-002 kunpeng.spec.speccpu:SPECCPU2026 \
#       --arg copies=16 --arg config=v200_baseline --arg _item=intrate \
#       --bind target=100 --comment "回归" --dry-run
set -euo pipefail

BASE="${FE_RUNNER_BASE:-http://141.61.5.137:7000}"
CLIENT_ID="${FE_RUNNER_CLIENT_ID:-bluesky-cli}"

QUEUE_REF=""; DEF=""; COMMENT=""; DRY=0; RESUME=1; MODE=""
ARGS=(); BINDS=(); CATALOG_FILTER=""

usage() { sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)      MODE=list; shift ;;
    --targets)   MODE=targets; shift ;;
    --catalog)   MODE=catalog; shift
                 if [[ $# -gt 0 && "$1" != --* ]]; then CATALOG_FILTER="$1"; shift; fi ;;
    --arg)       ARGS+=("$2"); shift 2 ;;
    --argstr)    ARGS+=("str:$2"); shift 2 ;;
    --bind)      BINDS+=("$2"); shift 2 ;;
    --comment)   COMMENT="$2"; shift 2 ;;
    --dry-run)   DRY=1; shift ;;
    --no-resume) RESUME=0; shift ;;
    -h|--help)   usage; exit 0 ;;
    --*)         echo "未知选项: $1" >&2; usage >&2; exit 2 ;;
    *)           if   [[ -z "$QUEUE_REF" ]]; then QUEUE_REF="$1"
                 elif [[ -z "$DEF" ]];       then DEF="$1"
                 else echo "多余参数: $1" >&2; exit 2; fi
                 shift ;;
  esac
done

command -v curl   >/dev/null || { echo "需要 curl"   >&2; exit 1; }
command -v python >/dev/null || { echo "需要 python" >&2; exit 1; }

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# ---- HTTP: api METHOD PATH [BODY_FILE] [IDEMPOTENCY_KEY] ----
# BODY_FILE 为空表示无请求体。响应体写 stdout; 非 2xx 打印错误并返回非零。
api() {
  local method="$1" path="$2" bodyfile="${3:-}" key="${4:-}"
  local code resp
  resp="$TMPD/resp.$$"
  local -a args=(-sS -m 300 -X "$method" "$BASE$path" -o "$resp" -w '%{http_code}')
  [[ -n "$key" ]] && args+=(-H "Idempotency-Key: $key")
  args+=(-H "X-Fe-Runner-Client-ID: $CLIENT_ID")
  if [[ -n "$bodyfile" ]]; then
    args+=(-H 'Content-Type: application/json' --data-binary "@$bodyfile")
  fi
  code=$(curl "${args[@]}" 2>/dev/null) || {
    echo "无法连接 $BASE" >&2; rm -f "$resp"; return 1
  }
  if [[ "$code" != 2* ]]; then
    echo "HTTP $code  $method $path" >&2
    python -c "
import json,sys
try:
    d=json.load(open(sys.argv[1],encoding='utf-8'))
    print(json.dumps(d,ensure_ascii=False,indent=1))
except Exception:
    print(open(sys.argv[1],encoding='utf-8',errors='replace').read()[:2000])
" "$resp" >&2 || true
    rm -f "$resp"
    return 1
  fi
  cat "$resp"
  rm -f "$resp"
}

newkey() { python -c "import uuid;print(uuid.uuid4().hex)"; }

# ---------- 只读模式 ----------
if [[ "$MODE" == "list" ]]; then
  api GET "/api/v1/queues?page=1&page_size=200" | python -c "
import json,sys
d=json.load(sys.stdin)
print('%-24s %-24s %-10s %6s %6s' % ('queue_id','name','status','rev','items'))
for q in d.get('items',[]):
    print('%-24s %-24s %-10s %6d %6d' % (q['queue_id'],q['name'],q['status'],q['revision'],len(q['items'])))
print('total',d.get('total'))
"
  exit 0
fi

if [[ "$MODE" == "targets" ]]; then
  api GET /api/v1/targets | python -c "
import json,sys
for t in json.load(sys.stdin):
    print('%-8s %-16s conn=%-12s activity=%-6s lease=%s' % (
        t['name'],t['model'],t['connectivity'],t['activity'],t['lease']))
"
  exit 0
fi

if [[ "$MODE" == "catalog" ]]; then
  api GET /api/v1/catalog > "$TMPD/catalog.json"
  python -c "
import json,sys
f=sys.argv[1].lower()
for d in json.load(open(sys.argv[2],encoding='utf-8'))['definitions']:
    if f and f not in d['definition_id'].lower() and f not in d['name'].lower():
        continue
    req=[p['name'] for p in d.get('parameters',[]) if p.get('required')]
    opt=[p['name'] for p in d.get('parameters',[]) if not p.get('required')]
    print('%-9s %s' % (d['kind'],d['definition_id']))
    print('          roles=%s  required=%s  optional=%s' % (d.get('roles') or [], req, opt))
" "$CATALOG_FILTER" "$TMPD/catalog.json"
  exit 0
fi

[[ -n "$QUEUE_REF" ]] || { usage >&2; exit 2; }
[[ -n "$DEF" ]]       || { usage >&2; exit 2; }

# ---------- 1. 定位队列 (先 queue_id 精确匹配, 再 name) ----------
api GET "/api/v1/queues?page=1&page_size=200" > "$TMPD/queues.json"
QID=$(python -c "
import json,sys
ref=sys.argv[1]
rows=json.load(open(sys.argv[2],encoding='utf-8')).get('items',[])
for q in rows:
    if q['queue_id']==ref: print(q['queue_id']); break
else:
    for q in rows:
        if q['name']==ref: print(q['queue_id']); break
" "$QUEUE_REF" "$TMPD/queues.json")

if [[ -z "$QID" ]]; then
  echo "找不到队列 '$QUEUE_REF'。现有队列:" >&2
  python -c "
import json,sys
for q in json.load(open(sys.argv[1],encoding='utf-8')).get('items',[]):
    print('  %-24s %-24s [%s]' % (q['queue_id'],q['name'],q['status']))
" "$TMPD/queues.json" >&2
  exit 1
fi

# 编辑必须用未过滤的队列 (不带 active_only)
api GET "/api/v1/queues/$QID" > "$TMPD/queue.json"

# ---------- 2. 组装 candidate: 保留全部旧 item(带 item_id) + 追加新 item ----------
# 参数/绑定/备注一律写文件, 避免 Windows argv 编码损坏中文
: > "$TMPD/args.txt"
for a in ${ARGS[@]+"${ARGS[@]}"}; do printf '%s\n' "$a" >> "$TMPD/args.txt"; done
: > "$TMPD/binds.txt"
for b in ${BINDS[@]+"${BINDS[@]}"}; do printf '%s\n' "$b" >> "$TMPD/binds.txt"; done
printf '%s' "$COMMENT" > "$TMPD/comment.txt"
printf '%s' "$DEF" > "$TMPD/def.txt"

python -c "
import json,sys
q=json.load(open(sys.argv[1],encoding='utf-8'))
defn=open(sys.argv[2],encoding='utf-8').read()
comment=open(sys.argv[3],encoding='utf-8').read()

args=[]
for raw in open(sys.argv[4],encoding='utf-8').read().splitlines():
    if not raw: continue
    force_str=raw.startswith('str:')
    pair=raw[4:] if force_str else raw
    if '=' not in pair:
        print('参数格式应为 name=value: '+raw,file=sys.stderr); sys.exit(2)
    name,val=pair.split('=',1)
    if force_str:
        v=val
    else:
        try: v=json.loads(val)
        except Exception: v=val
    args.append({'name':name,'value':v})

binds=[]
for raw in open(sys.argv[5],encoding='utf-8').read().splitlines():
    if not raw: continue
    if '=' not in raw:
        print('绑定格式应为 role=target: '+raw,file=sys.stderr); sys.exit(2)
    role,tgt=raw.split('=',1)
    binds.append({'role':role,'target_name':tgt})

items=[]
for it in q['items']:
    s=it['spec']
    items.append({
        'item_id': it['item_id'],              # 保留已有 item 身份(编辑必需)
        'definition_id': s['definition']['definition_id'],
        'arguments': s.get('arguments',[]),
        'bindings': s.get('bindings',[]),
        'plugins': s.get('plugins',[]),
        'comment': it.get('comment',''),
    })
items.append({
    'definition_id': defn,
    'arguments': args,
    'bindings': binds,
    'plugins': [],
    'comment': comment,
})
payload={
    'candidate': {
        'name': q['name'],
        'remark': q.get('remark',''),
        'scheduled_for': q.get('scheduled_for'),
        'paused': q['status']=='paused',
        'items': items,
    },
    'expected_revision': q['revision'],
    'queue_id': q['queue_id'],
}
open(sys.argv[6],'w',encoding='utf-8').write(json.dumps(payload,ensure_ascii=False))
" "$TMPD/queue.json" "$TMPD/def.txt" "$TMPD/comment.txt" \
  "$TMPD/args.txt" "$TMPD/binds.txt" "$TMPD/payload.json"

# ---------- 3. prepare ----------
api POST "/api/v1/queues/$QID/prepare" "$TMPD/payload.json" > "$TMPD/prep.json" || exit 1

python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
pc=d['prepared_change']
w=pc.get('warnings') or []
issues=[i for r in (pc.get('prerequisite_reports') or []) for i in (r.get('issues') or [])]
if w:
    print('⚠️  %d 条警告:' % len(w),file=sys.stderr)
    for x in w: print('   [%s] %s targets=%s' % (x['code'],x['message'],x.get('target_names')),file=sys.stderr)
if issues:
    print('⚠️  %d 条前置检查问题:' % len(issues),file=sys.stderr)
    for x in issues: print('   [%s] %s effect=%s' % (x['check_id'],x['message'],x['effect']),file=sys.stderr)
print('准备完成: 共 %d 个 item, 新增 item_id=%s' % (len(pc['specs']), pc['item_ids'][-1]),file=sys.stderr)
" "$TMPD/prep.json"

if [[ $DRY -eq 1 ]]; then
  echo "dry-run: 校验通过, 未提交。" >&2
  python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'));pc=d['prepared_change']
print(json.dumps({
 'preparation_id':d['preparation_id'],
 'queue_id':pc['queue_id'],
 'expected_revision':pc['expected_revision'],
 'item_ids':pc['item_ids'],
 'warnings':pc.get('warnings'),
 'warning_digest':pc['warning_digest'],
 'specs':[{'definition_id':s['definition']['definition_id'],
           'arguments':s.get('arguments'),
           'targets':[t['name'] for t in s.get('targets',[])]} for s in pc['specs']],
},ensure_ascii=False,indent=1))
" "$TMPD/prep.json"
  exit 0
fi

# ---------- 4. commit ----------
python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'));pc=d['prepared_change']
body={
  'preparation_id': d['preparation_id'],
  'accepted_warning_digest': pc['warning_digest'] if pc.get('warnings') else None,
}
open(sys.argv[2],'w',encoding='utf-8').write(json.dumps(body,ensure_ascii=False))
" "$TMPD/prep.json" "$TMPD/commit.json"

api POST /api/v1/queues/commit "$TMPD/commit.json" "$(newkey)" > "$TMPD/commit-resp.json" || exit 1

python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
last=d['items'][-1]
print('✅ 已加入 %s  item=%s  队列状态=%s  revision=%d' % (
    d['queue_id'], last['item_id'], d['status'], d['revision']))
" "$TMPD/commit-resp.json"

STATUS=$(python -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8'))['status'])" "$TMPD/commit-resp.json")

# ---------- 5. 必要时恢复调度 ----------
case "$STATUS" in
  paused|failed|cancelled|missed)
    if [[ $RESUME -eq 1 ]]; then
      if api POST "/api/v1/queues/$QID/resume" "" "$(newkey)" > "$TMPD/resume.json"; then
        python -c "import json,sys;print('▶️  resume 后状态=%s' % json.load(open(sys.argv[1],encoding='utf-8'))['status'])" "$TMPD/resume.json"
      else
        echo "resume 失败。手动: curl -X POST $BASE/api/v1/queues/$QID/resume -H 'Idempotency-Key: $(newkey)'" >&2
        exit 1
      fi
    else
      echo "队列状态为 $STATUS, 未自动 resume (--no-resume)" >&2
    fi
    ;;
esac

echo
echo "跟踪:"
echo "  $0 --list"
echo "  curl -s $BASE/api/v1/queues/$QID | python -m json.tool"
