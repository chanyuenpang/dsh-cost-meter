# DeepSeek billing currency / DeepSeek 计价币种

## English

**Display currency** changes how amounts are shown. **Official price currency** selects the DeepSeek price table fetched by Sync. USD prices multiplied by a display exchange rate are not the official CNY prices.

For a CNY account, open **Settings → Cost → Prices → Official price sync**, choose **CNY**, wait for auto-save, then click **Sync from official docs** and apply. The CNY hint includes a button to select CNY; this selection alone does not fetch prices or reprice history. Check the sync result: if the CNY page is unavailable and syncing falls back to USD, the hint remains. Switching the table's currency uses the existing history recalculation; sessions without complete logs retain their previous cost basis. No setting changes merely because the hint appears.

For the September 2026 Flash off-peak rates, USD prices of $0.003 / $0.15 / $0.60 correspond to CNY prices of ¥0.02 / ¥1 / ¥4 per million cache-read / uncached-input / output tokens. Multiplying the USD prices by 7.2 gives ¥0.0216 / ¥1.08 / ¥4.32, 8% above that CNY table. The ratio is a comparison of those published prices, not a market exchange rate or a universal rule for every model. Sources: [DeepSeek USD prices](https://api-docs.deepseek.com/quick_start/pricing/) and [DeepSeek CNY prices](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/).

Use the matching official table when comparing bills. Changing the global exchange rate also affects other providers' displayed USD charges. Check the model, pricing window, cache tokens and settlement time: in [issue #157](https://github.com/Han-1413141/dsh-cost-meter/issues/157), one balance test settled after about four minutes; that observation is not a guaranteed settlement interval.

## 中文

**显示币种**只决定金额如何展示；**官方价格币种**决定同步哪套 DeepSeek 价格。美元价格乘以显示汇率，不等于官方人民币报价。

人民币账户请进入**设置 → 费用 → 价格 → 官方价格同步**，选择 **CNY**，等待自动保存，再点击同步并应用。提示中的按钮可以直接选择 CNY；仅选择币种不会抓取价格或重算历史。同步后应查看结果：若人民币页面不可用、回退到美元表，提示仍然保留。价目表币种切换沿用既有历史重算流程，日志不完整的会话保留原计价口径。出现提示本身不会修改设置。

以 2026 年 9 月 Flash 谷价为例，每百万缓存读取／未命中输入／输出为 $0.003／$0.15／$0.60，对应官方 ¥0.02／¥1／¥4；美元报价乘以 7.2 后是 ¥0.0216／¥1.08／¥4.32，比这套人民币价高 8%。这个比值只描述这些报价，不是市场汇率，也不适用于所有模型。来源见上方 DeepSeek 中英文官方价格页。

对账应选择匹配的官方价格表；修改全局汇率还会影响其他厂商美元费用的显示。同时核对模型、峰谷时段、缓存 tokens 和结算时间。#157 报告的一次余额实验约四分钟后才结算，这是个别观测，不是固定结算周期。
