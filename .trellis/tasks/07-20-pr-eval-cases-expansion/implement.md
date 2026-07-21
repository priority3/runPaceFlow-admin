# Implement:执行计划

## 顺序清单

### 阶段一:harness 前提(串行,改动小且互相依赖)

- [ ] 1. P1 冻结 today:dataset.ts 加 `freezeToday()/nowRef()`,isolate.ts 顶层调用;验证:临时脚本连续调用 `daysAgoDate` 与手动改系统时间无关(用 frozenNow 注入测试)。
- [ ] 2. P2 种子多档:dataset.ts(STALE_SHIFT_DAYS、factSummaryForJudge(profile))→ seed.ts(seed(profile))→ EvalCase 类型 + run.ts 分组重播。验证:`--case` 跑一条 empty 档,日志 build_context 里 recentActivityCount:0。
- [ ] 3. P3 资产:gen-images.ts + 4 张 PNG;run.sh 设 PR_UPLOAD_DIR;run.ts 启动拷贝;验证:本地 readImageUpload 能读到。
- [ ] 4. P4 并发:worker pool + `--concurrency/--serial`;验证:`--only=L1 --concurrency=3` 结果与串行一致(通过数一致)。
- [ ] 5. cases 拆目录:现有 45 条平移到 `cases/l{1..4}.ts`,cases.ts 变聚合入口 + id 唯一性断言;验证:`--smoke` 行为不变。

### 阶段二:新用例编写(R1–R11,可并行起草)

- [ ] 6. 用 Workflow 并行起草 11 个维度的用例(每维度一个 agent,输入=prd 维度要点 + dataset 常量清单 + 现有用例风格样例 + 判据红线);产出结构化 case 定义。
- [ ] 7. 汇总落盘到 `cases/*.ts`;人工(主会话)逐条过一遍:id 唯一、category 前缀、mustGround 引用常量、seedProfile 正确、轮次/延迟设置。
- [ ] 8. 语法/类型检查 + 数量核对(100–110)。

### 阶段三:验证与基线

- [ ] 9. 重建网关链路(SOCKS 1080 + hpts 8888 + 凭据导出——配方见 memory pr-eval-harness)。
- [ ] 10. 冒烟:每维度挑 1 条 `--case` 跑通(含 1 条 empty、1 条 stale、1 条 vision)。
- [ ] 11. 全量 ~105 条(--concurrency=3,预计 ~25-35 分钟)。
- [ ] 12. 失败分诊:对新增用例的失败逐条判真伪(参考上轮对抗复核法);裁判假阳性→修判据重跑该 case;真缺陷→写入报告。
- [ ] 13. 报告:新基线 summary + triage 结论;更新 triage-verification.md 附录与 memory;清理隧道/凭据。

## 校验命令

```bash
bun build --target=bun scripts/eval/run.ts --outdir /tmp/eval-typecheck   # 语法/导入检查
./scripts/eval/run.sh --smoke                                             # 管线冒烟(需链路)
./scripts/eval/run.sh --case=<id>                                         # 单条验证
```

## 回滚点

- 阶段一每步独立可回退(git 未跟踪目录,备份 `scripts/eval` 为 `scripts/eval.bak-<ts>` 后开工,完成后删)。
- 全量跑失败率异常(>20%)→ 先停,分诊是判据问题还是 harness 回归,不盲目改 agent。
