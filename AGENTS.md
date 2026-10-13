# AGENTS.md — stock-dashboard

腾讯行情看板（A/港/美 35 只自选标的），纯静态前端 + Vercel Serverless API。GitHub: JasonDongx/stock-dashboard。

## 每日行情总结（stock-summary skill）

当用户要求「行情看板总结」「行情总结」「每日行情」等时：

1. 读 `skills/stock-summary/SKILL.md` —— 里面有输出模板、排版硬规则、指标口径、数据源陷阱，**必须严格遵守，勿自行发挥**。
2. 执行 `python3 skills/stock-summary/compute.py`（约 40 秒，无额外依赖）。
3. 按模板输出四段纯榜单：①今年以来涨幅前8 ②距近1年最高点回撤前8 ③距近2年 ④距近3年。
4. 修改覆盖标的或格式时，先改 `skills/stock-summary/` 内文件再跑。

## 项目关键口径

- 标的清单以 `fetch_data.py` 的 STOCKS 为准（35 只 = A股7 / 港股8 / 美股20，含 ETF 03441/03442）。
- 所有历史价格计算用**前复权 K 线**（腾讯 ifzq 接口：A 股 `fqkline`、港股 `hkfqkline`、美股 `usfqkline` 带 .OQ/.N 后缀），拆股/除权自动换算。
- YTD 基准 = 2025-12-31 真实收盘价（内嵌在代码中），禁止凭印象填数。
- 上市不足对应年数的标的（长鑫/古茗/SKHY/SPCX 等）区间指标自动隐藏。
- 美股后缀：TCOM/COST/EXPE/BKNG 等为 .OQ；TSM/BRK.B/KO/MCD/WMT 为 .N。后缀错会只返回假数据。

## 部署

- Vercel 自动部署 master 分支；`api/` 为 Serverless Functions（/api/quotes 实时报价）。
- 前端纯 HTML/CSS/JS 无构建步骤。
