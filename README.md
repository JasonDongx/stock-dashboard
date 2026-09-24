# 行情看板 Stock Dashboard

基于腾讯行情接口的 A股/港股/美股 行情看板网站。

## 功能

- 四大分组视图：总览（全部32只）、A股、H股、美股
- 排序切换：距1年高（默认）/ 距1年低 / 今年来 / PE
- 涨跌幅、市盈率TTM、今年来涨幅、距高点回落/距低点涨幅
- 52周/近一年价格区间可视化
- 响应式设计，支持手机查看

## 技术栈

- 前端：纯 HTML + CSS + JavaScript（无框架依赖）
- 数据接口：Vercel Serverless Function（Node.js）
- 数据来源：腾讯财经行情接口

## 本地开发

```bash
# 生成初始 JSON 数据文件（可选，用于本地开发）
# 如需代理抓取，可通过环境变量指定：PROXY_URL=http://127.0.0.1:18080 python3 fetch_data.py
python3 fetch_data.py

# 启动本地服务器
python3 -m http.server 8080
```

> 说明：`data/` 目录下的 JSON 由 `fetch_data.py` 生成，仅用于
> 本地开发调试；线上页面直接调用 `/api/quotes` 接口。

## 部署到 Vercel

1. 将此仓库 Fork 或 Push 到 GitHub
2. 在 [vercel.com](https://vercel.com) 导入该 GitHub 仓库
3. Vercel 自动识别配置，点击 Deploy 即可
4. 部署后可绑定自定义域名

## 文件结构

```
├── index.html          # 网站主页
├── api/quotes.js       # Serverless Function（行情数据获取）
├── vercel.json         # Vercel 部署配置
├── fetch_data.py       # 本地数据抓取脚本
├── data/               # 初始 JSON 数据（本地开发用）
│   ├── a_share.json
│   └── us_stock.json
└── .gitignore
```
