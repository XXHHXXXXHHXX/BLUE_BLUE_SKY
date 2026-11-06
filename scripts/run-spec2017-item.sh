#!/usr/bin/env bash
# 跑 SPECCPU2017 的单个子项并取回结果
#
# 服务: http://141.61.5.137:7000  (可用 FE_RUNNER_BASE 覆盖)
# 依赖: curl, python
#
# 用法:
#   ./run-spec2017-item.sh --list-items
#   ./run-spec2017-item.sh <队列> <子项> [选项]
#
# 参数:
#   队列         bluesky-queue-000 ~ 004
#   子项         SPEC 子项名, 可写 505 / 505_mcf_r / mcf_r (见 --list-items)
#
# 选项:
#   --target NAME    目标机, 默认 133
#   --copies N       线程数, 默认 192
#   --config NAME    配置文件, 默认 v200_baseline
#   --chroot PATH    复用已有 SPEC chroot 环境(跳过解压+编译), 如 /home/spec2017_env
#   --no-chroot      不使用已有 chroot, 走完整解压+编译流程
#   --timeout SEC    等待超时, 默认 14400 (4h)
#   --outdir DIR     结果下载目录, 默认 ./spec2017-results/<run_id>
#   --no-wait        只提交, 不等待结果
#   --dry-run        只校验, 不提交
#
# 示例:
#   # 跑 mcf_r 子项, 复用 133 上已有的 spec2017 环境
#   ./run-spec2017-item.sh bluesky-queue-000 505 --chroot /home/spec2017_env
#
#   # 跑 x264_r, 在 9755 上, 16 线程, 完整流程
#   ./run-spec2017-item.sh bluesky-queue-001 x264_r --target 9755 --copies 16 --no-chroot
set -euo pipefail

BASE="${FE_RUNNER_BASE:-http://141.61.5.137:7000}"
CLIENT_ID="${FE_RUNNER_CLIENT_ID:-bluesky-cli}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

QUEUE=""; ITEM=""
TARGET="133"; COPIES="192"; CONFIG="v200_baseline"
CHROOT="/home/spec2017_env"; USE_CHROOT=1
TIMEOUT=14400; OUTDIR=""; WAIT=1; DRY=0; LIST=0

usage() { sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list-items) LIST=1; shift ;;
    --target)     TARGET="$2"; shift 2 ;;
    --copies)     COPIES="$2"; shift 2 ;;
    --config)     CONFIG="$2"; shift 2 ;;
    --chroot)     CHROOT="$2"; USE_CHROOT=1; shift 2 ;;
    --no-chroot)  USE_CHROOT=0; shift ;;
    --timeout)    TIMEOUT="$2"; shift 2 ;;
    --outdir)     OUTDIR="$2"; shift 2 ;;
    --no-wait)    WAIT=0; shift ;;
    --dry-run)    DRY=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    --*)          echo "未知选项: $1" >&2; usage >&2; exit 2 ;;
    *)            if   [[ -z "$QUEUE" ]]; then QUEUE="$1"
                  elif [[ -z "$ITEM" ]];  then ITEM="$1"
                  else echo "多余参数: $1" >&2; exit 2; fi
                  shift ;;
  esac
done

command -v curl   >/dev/null || { echo "需要 curl"   >&2; exit 1; }
command -v python >/dev/null || { echo "需要 python" >&2; exit 1; }

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

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

# ---------- --list-items ----------
if [[ $LIST -eq 1 ]]; then
  cat <<'EOF'
SPECCPU2017 子项 (r = rate/多核, s = speed/单核)
  整数 rate:  500_perlbench_r  502_gcc_r    505_mcf_r      520_omnetpp_r
              523_xalancbmk_r  525_x264_r   531_deepsjeng_r 541_leela_r
              548_exchange2_r  557_xz_r
  浮点 rate:  503_bwaves_r     507_cactuBSSN_r 508_namd_r   510_parest_r
              511_povray_r     519_lbm_r    521_wrf_r       526_blender_r
              527_cam4_r       538_imagick_r 544_nab_r      549_fotonik3d_r
              554_roms_r
  整数 speed: 600_perlbench_s  602_gcc_s    605_mcf_s      620_omnetpp_s
              623_xalancbmk_s  625_x264_s   631_deepsjeng_s 641_leela_s
              648_exchange2_s  657_xz_s
  浮点 speed: 603_bwaves_s     607_cactuBSSN_s 619_lbm_s    621_wrf_s
              627_cam4_s       628_pop2_s   638_imagick_s   644_nab_s
              649_fotonik3d_s  654_roms_s

特殊值: intrate (整数 rate 全部) / fprate / intspeed / fpspeed
EOF
  exit 0
fi

[[ -n "$QUEUE" ]] || { usage >&2; exit 2; }
[[ -n "$ITEM" ]]  || { usage >&2; exit 2; }

# 归一化子项名: 505 -> 505 ; 505_mcf_r -> 505 ; mcf_r -> mcf_r
ITEM_NORM=$(python -c "
import sys
v=sys.argv[1].strip()
# runcpu 接受 505 / 505.mcf_r / mcf_r 等; 统一成编号形式更稳
if '_' in v and v.split('_')[0].isdigit():
    print(v.split('_')[0])
else:
    print(v)
" "$ITEM")

echo "==> 队列=$QUEUE  子项=$ITEM (归一化: $ITEM_NORM)  目标=$TARGET  copies=$COPIES  config=$CONFIG" >&2
[[ $USE_CHROOT -eq 1 ]] && echo "==> 复用 chroot: $CHROOT" >&2 || echo "==> 完整流程(解压+编译)" >&2

# ---------- 1. 定位队列 ----------
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
" "$QUEUE" "$TMPD/queues.json")
[[ -n "$QID" ]] || { echo "找不到队列 '$QUEUE'" >&2; exit 1; }

api GET "/api/v1/queues/$QID" > "$TMPD/queue.json"

# ---------- 2. 组装 candidate ----------
printf '%s' "$ITEM_NORM" > "$TMPD/item.txt"
printf '%s' "$TARGET"    > "$TMPD/target.txt"
printf '%s' "$COPIES"    > "$TMPD/copies.txt"
printf '%s' "$CONFIG"    > "$TMPD/config.txt"
printf '%s' "$CHROOT"    > "$TMPD/chroot.txt"
printf '%s' "$USE_CHROOT" > "$TMPD/usechroot.txt"

python -c "
import json,sys
q=json.load(open(sys.argv[1],encoding='utf-8'))
item=open(sys.argv[2],encoding='utf-8').read()
target=open(sys.argv[3],encoding='utf-8').read()
copies=int(open(sys.argv[4],encoding='utf-8').read())
config=open(sys.argv[5],encoding='utf-8').read()
chroot=open(sys.argv[6],encoding='utf-8').read()
use_chroot=open(sys.argv[7],encoding='utf-8').read().strip()=='1'

items=[]
for it in q['items']:
    s=it['spec']
    items.append({
        'item_id': it['item_id'],
        'definition_id': s['definition']['definition_id'],
        'arguments': s.get('arguments',[]),
        'bindings': s.get('bindings',[]),
        'plugins': s.get('plugins',[]),
        'comment': it.get('comment',''),
    })
items.append({
    'definition_id': 'kunpeng.spec.speccpu:SPECCPU2017',
    'arguments': [
        {'name':'copies','value':copies},
        {'name':'config','value':config},
        {'name':'_item','value':item},
        {'name':'_use_existing_chroot','value':(chroot if use_chroot else None)},
    ],
    'bindings': [{'role':'target','target_name':target}],
    'plugins': [],
    'comment': 'SPEC2017 %s @%s' % (item,target),
})
open(sys.argv[8],'w',encoding='utf-8').write(json.dumps({
    'candidate': {
        'name': q['name'],
        'remark': q.get('remark',''),
        'scheduled_for': q.get('scheduled_for'),
        'paused': q['status']=='paused',
        'items': items,
    },
    'expected_revision': q['revision'],
    'queue_id': q['queue_id'],
},ensure_ascii=False))
" "$TMPD/queue.json" "$TMPD/item.txt" "$TMPD/target.txt" "$TMPD/copies.txt" \
  "$TMPD/config.txt" "$TMPD/chroot.txt" "$TMPD/usechroot.txt" "$TMPD/payload.json"

# ---------- 3. prepare ----------
api POST "/api/v1/queues/$QID/prepare" "$TMPD/payload.json" > "$TMPD/prep.json" || exit 1

python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'));pc=d['prepared_change']
w=pc.get('warnings') or []
issues=[i for r in (pc.get('prerequisite_reports') or []) for i in (r.get('issues') or [])]
blocking=[i for i in issues if i.get('effect')=='fail_benchmark']
if w:
    print('⚠️  %d 条警告:' % len(w),file=sys.stderr)
    for x in w: print('   [%s] %s' % (x['code'],x['message']),file=sys.stderr)
if issues:
    print('⚠️  %d 条前置检查问题:' % len(issues),file=sys.stderr)
    for x in issues: print('   [%s] %s effect=%s' % (x['check_id'],x['message'],x['effect']),file=sys.stderr)
if blocking:
    print('❌ 存在会直接失败的检查项, 中止。',file=sys.stderr)
    sys.exit(3)
print('准备完成: 新增 item_id=%s' % pc['item_ids'][-1],file=sys.stderr)
" "$TMPD/prep.json" || { echo "prepare 未通过, 已中止" >&2; exit 1; }

if [[ $DRY -eq 1 ]]; then
  echo "dry-run: 校验通过, 未提交。" >&2
  exit 0
fi

# ---------- 4. commit ----------
python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'));pc=d['prepared_change']
open(sys.argv[2],'w',encoding='utf-8').write(json.dumps({
  'preparation_id': d['preparation_id'],
  'accepted_warning_digest': pc['warning_digest'] if pc.get('warnings') else None,
},ensure_ascii=False))
" "$TMPD/prep.json" "$TMPD/commit.json"

api POST /api/v1/queues/commit "$TMPD/commit.json" "$(newkey)" > "$TMPD/commit-resp.json" || exit 1

ITEM_ID=$(python -c "
import json,sys;d=json.load(open(sys.argv[1],encoding='utf-8'));print(d['items'][-1]['item_id'])" "$TMPD/commit-resp.json")
STATUS=$(python -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8'))['status'])" "$TMPD/commit-resp.json")
echo "✅ 已提交到 $QID  item=$ITEM_ID  队列状态=$STATUS" >&2

# ---------- 5. 必要时 resume ----------
case "$STATUS" in
  paused|failed|cancelled|missed)
    api POST "/api/v1/queues/$QID/resume" "" "$(newkey)" > "$TMPD/resume.json" || {
      echo "resume 失败" >&2; exit 1; }
    echo "▶️  已 resume" >&2
    ;;
esac

[[ $WAIT -eq 1 ]] || { echo "已提交, 未等待 (--no-wait)。item_id=$ITEM_ID" >&2; exit 0; }

# ---------- 6. 等待 item 结束 ----------
echo "==> 等待运行完成 (超时 ${TIMEOUT}s)..." >&2
DEADLINE=$(( $(date +%s) + TIMEOUT ))
RUN_ID=""
LAST=""
DONE=0
while [[ $(date +%s) -lt $DEADLINE && $DONE -eq 0 ]]; do
  api GET "/api/v1/queues/$QID" > "$TMPD/q.json" 2>/dev/null || { sleep 5; continue; }
  python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
for it in d['items']:
    if it['item_id']==sys.argv[2]:
        print(it['status'], it.get('run_id') or '-')
        break
else:
    print('missing','-')
" "$TMPD/q.json" "$ITEM_ID" > "$TMPD/st.txt"
  read -r ITEM_STATUS RUN_ID < "$TMPD/st.txt"
  # Windows 下 python 输出 CRLF, read 会保留 \r, 必须剥掉否则 URL 带 %0D
  ITEM_STATUS="${ITEM_STATUS%$'\r'}"
  RUN_ID="${RUN_ID%$'\r'}"
  RUN_ID="${RUN_ID%$'\r'}"

  if [[ "$ITEM_STATUS" != "$LAST" ]]; then
    if [[ "$RUN_ID" == "-" ]]; then
      echo "    [$(date +%H:%M:%S)] $ITEM_STATUS" >&2
    else
      echo "    [$(date +%H:%M:%S)] $ITEM_STATUS $RUN_ID" >&2
    fi
    LAST="$ITEM_STATUS"
  fi

  case "$ITEM_STATUS" in
    completed|failed|skipped|cancelled|interrupted) DONE=1 ;;
  esac
  [[ $DONE -eq 1 ]] || sleep 10
done

if [[ "$ITEM_STATUS" == "missing" || -z "$RUN_ID" || "$RUN_ID" == "-" ]]; then
  echo "❌ 超时或未拿到 run_id (最后状态: $ITEM_STATUS)" >&2
  exit 1
fi

echo "==> run_id = $RUN_ID" >&2

# ---------- 7. 取结果 ----------
api GET "/api/v1/runs/$RUN_ID" > "$TMPD/run.json" || exit 1

python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
print()
print('='*60)
print('状态   :', d['status'])
print('run_id :', d['run_id'])
m=d.get('metrics') or {}
if m:
    print('指标   :')
    for k,v in m.items():
        print('   %-24s %s' % (k, v))
else:
    print('指标   : (无)')
f=d.get('failures') or []
if f:
    print('失败   :')
    for x in f:
        print('   [%s/%s] %s' % (x.get('phase'), x.get('owner'), x.get('message')))
if d.get('error'):
    print('错误   :', d['error'])
c=d.get('command') or {}
if c.get('started_at'):
    print('起止   :', c.get('started_at'), '->', c.get('ended_at'), 'exit', c.get('exit_code'))
print('='*60)
" "$TMPD/run.json"

# 下载产物
OUT="${OUTDIR:-./spec2017-results/$RUN_ID}"
mkdir -p "$OUT"
api GET "/api/v1/runs/$RUN_ID/artifacts" > "$TMPD/arts.json" || exit 1

python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
for a in d.get('artifacts',[]):
    p=a['path']
    if p.startswith('result.') or p in ('run_stdout.log','run_stderr.log'):
        print(p)
" "$TMPD/arts.json" > "$TMPD/want.txt"

if [[ -s "$TMPD/want.txt" ]]; then
  echo "==> 下载结果文件到 $OUT" >&2
  while IFS= read -r rel; do
    rel="${rel%$'\r'}"
    [[ -z "$rel" ]] && continue
    mkdir -p "$OUT/$(dirname "$rel")"
    if curl -sS -m 300 -f -o "$OUT/$rel" \
         "$BASE/api/v1/runs/$RUN_ID/artifacts/$rel" 2>/dev/null; then
      echo "   ✓ $rel" >&2
    else
      echo "   ✗ $rel (下载失败)" >&2
    fi
  done < "$TMPD/want.txt"
else
  echo "==> 该 run 无 result.* 产物 (可能未产生报告)" >&2
  echo "    可用: curl -s $BASE/api/v1/runs/$RUN_ID/artifacts" >&2
fi

# 从 result.rsf 提取分数
if [[ -f "$OUT/result.rsf" ]]; then
  echo
  echo "==> result.rsf 解析:"
  python -c "
import sys
path=sys.argv[1]
scores={}
name=None
for line in open(path,encoding='utf-8',errors='replace'):
    line=line.strip()
    if not line or ':' not in line: continue
    k,v=line.split(':',1); k=k.strip(); v=v.strip()
    if k=='spec.cpu2017.name': name=v
    elif k=='spec.cpu2017.basemean': scores['basemean']=v
    elif k.startswith('spec.cpu2017.results.') and k.endswith('.ratio'):
        parts=k.split('.')
        if len(parts)>=6 and parts[4]=='base' and parts[5]=='000':
            scores[parts[3]]=v
print('  指标集:', name)
for k,v in scores.items(): print('  %-24s %s' % (k,v))
" "$OUT/result.rsf"
fi

echo
echo "结果目录: $OUT"
echo "复查: curl -s $BASE/api/v1/runs/$RUN_ID | python -m json.tool"
