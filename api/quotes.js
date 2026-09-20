// Vercel Serverless Function - 行情数据获取
// 数据源：腾讯行情接口 qt.gtimg.cn（GBK编码，iconv-lite解码）
// 52周高低直接读行情字段；YTD用2025年末收盘价常量计算（不依赖K线接口）

const iconv = require("iconv-lite");

// A股/港股股票列表
const A_STOCKS = [
  { code: "sh600519", name: "贵州茅台", market: "A股", currency: "元" },
  { code: "sh600036", name: "招商银行", market: "A股", currency: "元" },
  { code: "sz000333", name: "美的集团", market: "A股", currency: "元" },
  { code: "sh600900", name: "长江电力", market: "A股", currency: "元" },
  { code: "sh601318", name: "中国平安", market: "A股", currency: "元" },
  { code: "hk09992", name: "泡泡玛特", market: "港股", currency: "港元" },
  { code: "hk00700", name: "腾讯控股", market: "港股", currency: "港元" },
  { code: "hk01810", name: "小米集团-W", market: "港股", currency: "港元" },
  { code: "hk01364", name: "古茗", market: "港股", currency: "港元" },
  { code: "hk00981", name: "中芯国际", market: "港股", currency: "港元" },
];

// 美股股票列表
const US_STOCKS = [
  { code: "usAAPL", name: "苹果", ticker: "AAPL" },
  { code: "usMSFT", name: "微软", ticker: "MSFT" },
  { code: "usNVDA", name: "英伟达", ticker: "NVDA" },
  { code: "usAMZN", name: "亚马逊", ticker: "AMZN" },
  { code: "usGOOGL", name: "谷歌-A", ticker: "GOOGL" },
  { code: "usMETA", name: "Meta Platforms", ticker: "META" },
  { code: "usTSLA", name: "特斯拉", ticker: "TSLA" },
  { code: "usAVGO", name: "博通", ticker: "AVGO" },
  { code: "usTSM", name: "台积电", ticker: "TSM" },
  { code: "usSKHY", name: "SK海力士", ticker: "SKHY" },
  { code: "usPDD", name: "拼多多", ticker: "PDD" },
  { code: "usSPCX", name: "SpaceX", ticker: "SPCX" },
  { code: "usBRK.B", name: "伯克希尔B", ticker: "BRK.B" },
  { code: "usKO", name: "可口可乐", ticker: "KO" },
  { code: "usMCD", name: "麦当劳", ticker: "MCD" },
  { code: "usCOST", name: "好市多", ticker: "COST" },
  { code: "usWMT", name: "沃尔玛", ticker: "WMT" },
];

// 2025年末收盘价（2025-12-31实际收盘，历史固定数据；null=当年未上市）
const YE2025_CLOSE = {
  sh600519: 1377.18,
  sh600036: 42.10,
  sz000333: 78.15,
  sh600900: 27.19,
  sh601318: 68.40,
  hk09992: 187.70,
  hk00700: 599.00,
  hk01810: 39.30,
  hk01364: 24.78,
  hk00981: 71.45,
  AAPL: 271.86,
  MSFT: 483.62,
  NVDA: 186.50,
  AMZN: 230.82,
  GOOGL: 313.00,
  META: 660.09,
  TSLA: 449.72,
  AVGO: 346.10,
  TSM: 303.89,
  SKHY: null, // 2026-07-10上市
  PDD: 113.39,
  SPCX: null, // 2026-06-12上市
  "BRK.B": 502.65,
  KO: 69.91,
  MCD: 305.63,
  COST: 862.34,
  WMT: 111.41,
};

function toNum(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function round2(val) {
  if (val === null || val === undefined) return null;
  return Math.round(val * 100) / 100;
}

async function fetchUrl(url, isGBK = false, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: controller.signal,
    });
    if (isGBK) {
      const buffer = Buffer.from(await resp.arrayBuffer());
      return iconv.decode(buffer, "gbk");
    }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseQuoteData(rawText) {
  const result = {};
  if (!rawText) return result;
  const regex = /v_([^=]+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(rawText)) !== null) {
    result[match[1]] = match[2].split("~");
  }
  return result;
}

function stripCode(code) {
  return code.replace(/^(sh|sz|hk)/, "");
}

function buildStock(base, fields, price, peTtm, week52High, week52Low, ytdBase) {
  const prevClose = toNum(fields[4]);

  let changePct = toNum(fields[32]);
  if ((changePct === null || changePct === 0) && price && prevClose) {
    changePct = ((price - prevClose) / prevClose) * 100;
  }

  const ytdChange =
    ytdBase && price ? ((price - ytdBase) / ytdBase) * 100 : null;
  const drawdown = week52High && price ? ((price - week52High) / week52High) * 100 : null;
  const rally = week52Low && price ? ((price - week52Low) / week52Low) * 100 : null;

  return {
    ...base,
    price: round2(price),
    prev_close: round2(prevClose),
    change_pct: round2(changePct),
    pe_ttm: peTtm !== null ? (peTtm > 0 ? round2(peTtm) : "亏损") : null,
    week52_high: round2(week52High),
    week52_low: round2(week52Low),
    drawdown: round2(drawdown),
    rally: round2(rally),
    ytd_change: round2(ytdChange),
  };
}

async function fetchAShareData() {
  const codes = A_STOCKS.map((s) => s.code).join(",");
  const raw = await fetchUrl(`https://qt.gtimg.cn/q=${codes}`, true);
  const quotes = parseQuoteData(raw);

  const stocks = A_STOCKS.map((stock) => {
    const fields = quotes[stock.code];
    const base = {
      code: stripCode(stock.code),
      name: stock.name,
      market: stock.market,
      currency: stock.currency,
    };
    if (!fields || fields.length < 69) {
      return { ...base, error: "数据暂缺" };
    }
    try {
      const price = toNum(fields[3]);
      // A股：PE=[39] 52周高=[67] 52周低=[68]；港股：PE=[57] 52周高=[48] 52周低=[49]
      const isA = stock.code.startsWith("sh") || stock.code.startsWith("sz");
      const peTtm = isA ? toNum(fields[39]) : toNum(fields[57]);
      const w52h = isA ? toNum(fields[67]) : toNum(fields[48]);
      const w52l = isA ? toNum(fields[68]) : toNum(fields[49]);
      return {
        ...buildStock(base, fields, price, peTtm, w52h, w52l, YE2025_CLOSE[stock.code]),
        name: fields[1] || stock.name,
      };
    } catch {
      return { ...base, error: "数据暂缺" };
    }
  });

  return {
    update_time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
    stocks,
  };
}

async function fetchUsStockData() {
  const codes = US_STOCKS.map((s) => s.code).join(",");
  const raw = await fetchUrl(`https://qt.gtimg.cn/q=${codes}`, true);
  const quotes = parseQuoteData(raw);

  const stocks = US_STOCKS.map((stock) => {
    let fields = null;
    for (const k of Object.keys(quotes)) {
      if (k.toLowerCase() === stock.code.toLowerCase()) {
        fields = quotes[k];
        break;
      }
    }
    const base = {
      ticker: stock.ticker,
      name: stock.name,
      currency: "美元",
    };
    if (!fields || fields.length < 50) {
      return { ...base, error: "数据暂缺" };
    }
    try {
      const price = toNum(fields[3]);
      // 美股：PE=[39] 52周高=[48] 52周低=[49]
      const peTtm = toNum(fields[39]);
      const w52h = toNum(fields[48]);
      const w52l = toNum(fields[49]);
      return {
        ...buildStock(base, fields, price, peTtm, w52h, w52l, YE2025_CLOSE[stock.ticker]),
        name: fields[1] || stock.name,
      };
    } catch {
      return { ...base, error: "数据暂缺" };
    }
  });

  return {
    update_time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
    stocks,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const { type } = req.query;

  try {
    if (type === "a") {
      res.status(200).json(await fetchAShareData());
    } else if (type === "us") {
      res.status(200).json(await fetchUsStockData());
    } else {
      const [aData, usData] = await Promise.all([fetchAShareData(), fetchUsStockData()]);
      res.status(200).json({ a_share: aData, us_stock: usData });
    }
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: error.message });
  }
}
