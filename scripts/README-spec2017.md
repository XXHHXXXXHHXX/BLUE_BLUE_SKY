# 跑 SPECCPU2017 单个子项并取结果

## 一、先看清楚有哪些子项

```bash
./scripts/run-spec2017-item.sh --list-items
```

子项可以用三种写法，脚本会自动归一化成编号：

| 写法 | 例子 | 归一化 |
|---|---|---|
| 编号 | `505` | `505` |
| 编号_名称 | `505_mcf_r` | `505` |
| 名称 | `mcf_r` | `mcf_r` |

特殊值：`intrate`（整数 rate 全套）、`fprate`、`intspeed`、`fpspeed`。

## 二、最常用：复用已有 chroot 跑一个子项

133 上已有 `/home/spec2017_env`，复用它可跳过解压 + 编译，几分钟出结果：

```bash
./scripts/run-spec2017-item.sh bluesky-queue-000 505 \
    --chroot /home/spec2017_env \
    --copies 192 \
    --target 133
```

## 三、完整流程（解压 + 编译 + 跑）

目标机上没有现成 chroot 时：

```bash
./scripts/run-spec2017-item.sh bluesky-queue-001 525_x264_r \
    --no-chroot \
    --copies 16 \
    --target 9755
```

首次会从仓库拉 `spec2017_oe2403-sp2_<arch>.tgz` 并编译，耗时较长（编译超时 1h，运行超时 4h）。

## 四、只看校验不提交

```bash
./scripts/run-spec2017-item.sh bluesky-queue-000 505 \
    --chroot /home/spec2017_env --dry-run
```

会打印 warnings / 前置检查问题。若 chroot 路径非法，会直接中止：

```
⚠️  1 条前置检查问题:
   [existing_chroot_valid] /home/no_such_env不是合法的 SPECCPU chroot 环境 effect=skip_benchmark
❌ 存在会直接失败的检查项, 中止。
```

## 五、只提交不等待（长任务）

```bash
./scripts/run-spec2017-item.sh bluesky-queue-002 intrate \
    --chroot /home/spec2017_env --copies 192 --no-wait
```

拿到 `item_id` 后自己轮询：

```bash
curl -s http://141.61.5.137:7000/api/v1/queues/bluesky-queue-002 | python -m json.tool
```

## 六、结果怎么看

脚本在运行结束后打印：

```
============================================================
状态   : succeeded
run_id : SPECCPU2017_2026-11-06_06-44-33-809424Z_c6d37c5b
指标   :
   505_mcf_r                5.843296
   intrate                  5.843296
起止   : 2026-11-06T06:44:39Z -> 2026-11-06T06:53:58Z exit 0
============================================================
```

> 实测记录（2026-11-06，133，copies=2，复用 `/home/spec2017_env`）：
> `505.mcf_r` 单子项耗时约 9 分钟，`result.rsf` 解析出 `505_mcf_r=5.843296`、
> `intrate=5.843296`，与 API `metrics` 完全一致。

单子项跑时，只有该子项有 ratio，其它子项在 `result.txt` 里显示 `NR`
（Not Run），`intrate` 的 basemean 就等于这一个子项的分数。
跑全套 `intrate` 才会得到各子项分数和总 basemean。

指标含义（来自 `_SPECCPU.parse_score_from_rsf`）：

- `<子项名>`：该子项 base ratio
- `intrate` / `fprate` / `intspeed` / `fpspeed`：对应指标集的 basemean 总分

结果文件下载到 `./spec2017-results/<run_id>/`：

| 文件 | 内容 |
|---|---|
| `result.rsf` | 原始分数（脚本会自动解析打印） |
| `result.txt` | SPEC 官方报告（人类可读） |
| `result.log` | 运行日志 |
| `result.cfg` | 本次实际使用的配置 |
| `run_stdout.log` / `run_stderr.log` | 框架侧输出 |

## 七、手工用 API 取结果

```bash
BASE=http://141.61.5.137:7000
RUN=SPECCPU2017_2026-11-06_06-44-33-809424Z_c6d37c5b

# 状态与指标
curl -s $BASE/api/v1/runs/$RUN | python -m json.tool

# 本次运行的完整输入（可复现）
curl -s $BASE/api/v1/runs/$RUN/spec | python -m json.tool

# 产物清单
curl -s $BASE/api/v1/runs/$RUN/artifacts | python -m json.tool

# 下载单个产物
curl -s -o result.rsf $BASE/api/v1/runs/$RUN/artifacts/result.rsf

# 打包下载全部
curl -s -OJ $BASE/api/v1/runs/$RUN/artifacts/archive

# 实时终端输出
curl -N "$BASE/api/v1/runs/$RUN/terminal/stream?after_seq=0"
```

## 八、参数说明

| 参数 | 默认 | 说明 |
|---|---|---|
| `copies` | 192 | 线程数。`r` 类子项按此并行；`s` 类通常 1 |
| `config` | `v200_baseline` | 配置文件名，可选 `v100_baseline` |
| `_item` | `intrate` | runcpu 最后的位置参数 |
| `_use_existing_chroot` | `null` | 指定路径则跳过解压+编译，直接用该 chroot |

注意 `_use_existing_chroot` 是**字符串**参数，脚本里用 `--chroot` 传即可；如果值形如 `505` 会被当成数字导致 422。

## 九、关于 result.txt 里的 INVALID RUN

`_SPECCPU._run` 固定用 `--iterations=1`，SPEC 官方要求至少 3 次迭代才判定有效，所以
`result.txt` 里会看到：

```
# 505.mcf_r (base) did not have enough runs!     #
#   INVALID RUN -- INVALID RUN -- INVALID RUN    #
505.mcf_r             2        553       5.84  *
```

**这不代表跑失败**。`*` 号标记的是本次实测值，`run.status` 仍是 `succeeded`，
`metrics` 里的 ratio 也是真实测量结果。只有需要出正式 SPEC 报告时才需要多迭代。

## 十、常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `dependency checksum verification failed on <target>` | 目标机依赖包校验失败 | 清理目标机 `/home/.fe-runner` 后重试 |
| `could not remove prerequisite workspace on: <target>` | 上次运行残留目录 | 同上 |
| `SPECCPU 没有正常产生报告` | 跑完但 lock 文件 id 没变 | 看 `result.log`，通常是编译或运行失败 |
| `编译失败，详见控制台` | runsetup 退出码非 0 | 看 `commands/cmd-*/stdout.log` |
| `existing_chroot_valid` 警告 | chroot 路径不合法 | 确认路径下存在 `chroot.sh` 且能 `cd /home/spec2017; source shrc` |
| `target_overlap` 警告 | 同目标机被其他队列占用 | 等对方跑完，或换目标机 |

## 十、实测结果（2026-11-06，target 133，copies=2，复用 /home/spec2017_env）

| 项 | 值 |
|---|---|
| 子项 | `505` (505.mcf_r) |
| run_id | `SPECCPU2017_2026-11-06_07-29-20-622999Z_4141e758` |
| 状态 | `succeeded`，exit 0 |
| 耗时 | 07:29:26 → 07:38:44（约 9 分 18 秒） |
| 指标 | `505_mcf_r = 5.850008`，`intrate = 5.850008` |
| 产物 | result.cfg / result.log / result.rsf / result.txt 全部下载成功 |

注意：`result.txt` 里会出现 `505.mcf_r (base) did not have enough runs!`，这是 SPEC 对 `--iterations=1` 的常规提示，不影响分数提取。
