# 插件市场热安装后账本不可用（#154）

## 修复

升级到 **1.7.29**。插件通过市场在运行中的 DSH 内加载时会补齐费用 RPC 清单，费用页可直接读取账本。首屏请求早于服务就绪时，会按 2、4、8、16、32、60 秒间隔重试，后续间隔最多 60 秒；页面隐藏时暂停轮询，恢复可见时刷新。

读取失败会显示具体错误及“刷新”按钮。成功后恢复原来的快照刷新间隔；读取失败不会创建空账本覆盖历史，也不会自动重试配置写入。

已在运行的旧代码需要先完成更新；若更新器提示重启，请按提示重新运行 `dsh web`，再刷新浏览器。

## 原因与验证

[Issue #154](https://github.com/Han-1413141/dsh-cost-meter/issues/154) 报告 Ubuntu 24.04、Node 22.23.2、DSH 0.1.5-rc.1、dshmarket 1.47.0、dsh-cost-meter 1.7.28。

检查 npm 发布的 dshmarket 1.47.0 `lib/hot.js` 可见，它把包名解析为 `file://.../lib/index.js`，再通过独立 Include 热挂载。宿主 typert-loader 扫描根 Loader 的包名入口来发现 `./typert`：独立 Include 不在该扫描树中，文件 URL 也不能按 `<包名>/package.json` 解析。因此业务服务可以加载，但 `costMeter/getState` 仍返回 `gateway/invocation-unavailable`。正常重启使用持久化的包名入口，清单才被发现。

修复仅为文件入口补注册清单。注入上下文拥有注册效果，支持 typert 服务晚到，卸载后自动撤销；已存在的清单保持原所有者，普通包名启动继续由宿主管理。

`test/market-hot-install.mjs` 使用真实 Loader、Include、typert-loader、registry、gateway 和插件，以临时目录模拟市场入口，验证失败对照、热安装读取、正常启动、服务晚到、卸载前服务未就绪、已有注册和重新挂载。检查的是宿主加载与 RPC 路径，不是对用户机器或完整市场界面会话的远程复测。

```sh
# DSH_TEST_NODE_MODULES 指向隔离安装的 DSH 依赖目录
node test/market-hot-install.mjs
node test/model-quota-cards.mjs
```

CI 单独安装报告的 DSH 0.1.5-rc.1，并将 typert-loader、registry、api-gateway 同样固定到 0.1.5-rc.1，避免 caret 依赖升级掩盖兼容问题。既有 Windows/Linux 安装流程继续验证当前宿主。

## English

Version **1.7.29** fixes missing Host RPC registration when dshmarket mounts the plugin through an independent Include using a file URL. The registration follows the plugin lifecycle, supports a registry that becomes available later, and preserves existing registrations. Normal package-name startup remains managed by the host loader.

Initial ledger reads retry with a 2–60 second backoff. The empty state displays the underlying error and a Refresh button. Successful reads restore normal polling; hidden pages skip polling, concurrent reads coalesce, and late responses after unload are ignored. Tests exercise the actual host modules and plugin in an isolated profile, rather than a full marketplace GUI session.
