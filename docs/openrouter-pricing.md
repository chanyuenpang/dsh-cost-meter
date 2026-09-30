# OpenRouter 目录定价

从 **1.7.30** 起，插件使用 [OpenRouter 公开模型目录](https://openrouter.ai/api/v1/models) 的 token 参考价，补齐 OpenRouter 完整模型 id 的计费。原始实现来自 [@GnaneshKunal 的 PR #156](https://github.com/Han-1413141/dsh-cost-meter/pull/156)。

## 价格来源与刷新

- 内置四模型快照（2026-09-17；2026-09-18 复核一致）：meta/muse-spark-1.3-contributor、google/gemini-3.8-flash、qwen/qwen3.8-flash、z-ai/glm-5.3-flash。
- 启动导入历史后、每小时，以及「设置 → 费用」的价格同步会请求公开目录，无需 OpenRouter Key。价格按 USD/token 转为 USD/百万 token，计入美元账本，展示时再按配置换算币种。
- 输入和输出必须是有限非负数；可选缓存读取/写入价格同样校验。免费模型的零价格保留；-1 聚合路由、缺失单价、空白、非法数值和溢出值跳过。完整 id 精确匹配，:free 等变体不会与付费型号混配；目录也不参与其他厂商的模糊匹配。
- 新模型加入本地价格表；已由目录管理且未被手改的条目自动更新，目录未返回的旧条目保留。上次写入的价格指纹随账本保存，因此重启后仍保护手改价格和已有自定义条目；显式价格映射继续有效。
- 刷新并发合并，总超时 20 秒（含响应体），最多两次网络尝试，响应体上限 4 MiB，拒绝重定向。失败保留本地价格，卸载取消在途请求并阻止迟到响应写入。
- DeepSeek 官方同步和 OpenRouter 刷新各自报告结果。DeepSeek 同步失败时也会尝试 OpenRouter，返回的状态包含成功更新的目录价格。

## 旧账回填

只修复 OpenRouter **零费用**桶，包括日汇总和会话汇总；不重算其他厂商、已有非零费用或显式映射的桶。离线时先按内置快照补算，首次成功拉取目录后再补齐其他可识别模型，并记下 pricing-openrouter-v1。后续目录价格变化只用于后续计费，不反复改写历史。

回填使用当前可用的参考价估算，不代表历史账单的实际成交价。此目录接入覆盖 token 费用；供应商路由、长上下文档位、图片、音频、搜索或按次收费可能需要不同口径，不能据此声称与 OpenRouter 账单逐笔一致。模型字段定义见 [OpenRouter 官方 API 文档](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)。

## 验证

test/openrouter-pricing.mjs 覆盖目录解析、免费与付费变体隔离、零费用定向回填、离线后恢复、自定义价格跨重启保留、并发与设置竞争、HTTP/格式/空目录/超大响应失败、响应体超时、卸载、启动及每小时刷新，以及真实服务的两路同步结果和已构建客户端 codec。

## English

Version **1.7.30** adds token reference pricing from the public OpenRouter model catalog, based on [PR #156](https://github.com/Han-1413141/dsh-cost-meter/pull/156). Four built-in models provide offline coverage. Startup, manual price sync and hourly refresh update the directory without an API key.

Prices convert from USD per token to USD per million tokens. Exact full ids keep paid/free variants separate; aggregate routes without real prices remain unpriced. Refreshes add new entries and update only unchanged managed prices. Persisted fingerprints protect custom edits across restarts; missing catalog entries remain available locally.

Concurrent refreshes share one request. A 20-second total deadline covers the response body, with at most two network attempts and a 4 MiB body limit. Failures retain local prices; unload cancels requests and blocks late writes. DeepSeek sync and OpenRouter refresh report independent outcomes, including updated state when only OpenRouter succeeds.

Backfill touches only zero-cost OpenRouter buckets, preserving other providers, existing charges and explicit mappings. Offline startup covers snapshot models; the first successful catalog refresh completes the migration. Later price changes do not rewrite recorded history. Historical backfill uses current reference rates, and token estimates do not include all routing, context-tier, media, search or per-request charges.
