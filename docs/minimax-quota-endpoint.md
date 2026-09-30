# MiniMax Token Plan 查询域名

接口明确返回 `current_weekly_status: 3` 时，周额度显示 **∞（无限制）**。缺失窗口或查询失败不会被视为无限量。展开的侧栏卡片直接显示 **5h 重置倒计时**，每分钟更新，不发起网络请求；悬停或键盘聚焦可查看具体重置时间和当前倒计时，收起的侧栏也保留此提示。倒计时需要接口返回重置时间；无限量窗口不参与每 1% 额度估计。

在「设置 → 费用 → 额度」展开 **MiniMax Token Plan**，编辑「查询域名（HTTPS）」。配置会随账本保存，更新插件后保留。

- **留空**：自动尝试官方端点，优先 `https://www.minimax.cn`，保留国际站 `https://www.minimax.io` 和旧国内域名 `https://www.minimaxi.com` 回退。
- **手动填写**：例如 `https://www.minimax.cn` 或可信代理的 `https://quota.example:8443`。填写完整 HTTPS 地址，只含主机和可选端口；尾部 `/` 会去掉。不能填写 API 路径、账号密码、查询参数或片段。
- 手动模式仅尝试所填域名上的 `/v1/token_plan/remains` 和旧版 `/v1/api/openplatform/coding_plan/remains`。请求失败不会切换其他域名；清空输入框可恢复自动模式。
- **MiniMax Key 会发送到填写的域名**，请只使用你信任的服务。插件拒绝重定向；代理需返回 MiniMax 兼容的 JSON 用量响应。若部署环境另有出站域名限制，需在该环境中放行自定义域名。

对应配置字段：

```json
{
  "codingPlans": {
    "minimax": {
      "enabled": true,
      "baseUrl": "https://www.minimax.cn"
    }
  }
}
```

修改域名后，下次查询使用新地址，旧缓存失效，在途旧请求被取消。关闭此来源或关闭显示也会取消请求。配置补丁中的非法地址会被拒绝；从磁盘读取到非法地址时禁用该来源，避免误向默认站点发送 Key。

2026-09-16 无凭据探测确认新国内域名、国际域名和旧国内域名的 `/v1/token_plan/remains` 均返回 JSON 登录错误（`1004`）。这只能确认接口可达，不能证明旧域名已下线或真实账号额度查询成功；本次未使用真实 MiniMax Key。

## English

When the MiniMax response explicitly reports `current_weekly_status: 3`, the weekly window displays **∞ (Unlimited)**. An absent window or a failed query is never treated as unlimited. The expanded sidebar card shows the **5h reset countdown**, updated every minute without a network request; hover or keyboard focus shows the reset timestamp and current countdown, including in the collapsed rail. Countdown display requires the API to return a reset time. Unlimited windows are excluded from per-1% quota estimates.

Open **Settings → Cost → Quota → MiniMax Token Plan** and edit **Quota origin (HTTPS)**. The setting persists in the ledger across plugin updates.

- Empty selects official endpoints automatically: `https://www.minimax.cn` first, with international and legacy mainland fallback.
- Set a complete HTTPS origin, such as `https://www.minimax.cn` or a trusted proxy at `https://quota.example:8443`. No API path, credentials, query or fragment; a trailing slash is removed.
- Explicit origins use only `/v1/token_plan/remains` and `/v1/api/openplatform/coding_plan/remains` on that origin. Failures never fall back to another origin. Clear the field to restore automatic selection.
- **Your MiniMax Key is sent to the configured origin.** Use a trusted service returning MiniMax-compatible quota JSON. Redirects are refused. Environments with additional outbound restrictions must allow the custom origin separately.
- Changing the origin invalidates cached quota and cancels the old request; late results cannot overwrite the new source. Invalid updates are rejected. Invalid persisted origins disable the source.

The JSON above uses `codingPlans.minimax.baseUrl`. Unauthenticated probes on 2026-09-16 returned MiniMax JSON login errors from all three official origins. Live account quotas were not tested.
