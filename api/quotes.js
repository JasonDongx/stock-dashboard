// Vercel Serverless Function - 行情数据获取
// 使用 iconv-lite 正确解码 GBK 编码的腾讯行情接口数据
// K线数据并行获取 + 超时保护，避免 Vercel 函数超时

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

function toNum(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function round2(val) {
  if (val === null || val === undefined) return null;
  return Math.round(val * 100) / 100;
}

// 获取 URL 内容（支持 GBK），带超时
async function fetchUrl(url, isGBK = false, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: controller.signal,
    });
    if (isGBK) {
      const buffer = Buffer.from(await resp.arrayBuffer());
      return iconv.decode(buffer, "gbk");
    }
    return await resp.text();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 解析腾讯行情数据
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

// 获取单只股票的日K线（并行调用时使用）
async function fetchKlineSingle(code, days = 280) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},day,,${days}`;
  try {
    const text = await fetchUrl(url, false, 8000);
    if (!text) return [];
    const data = JSON.parse(text);
    const klineData = data.data || {};
    for (const key in klineData) {
      if (klineData[key].day) return klineData[key].day;
    }
  } catch (e) {
    // 静默失败
  }
  return [];
}

// 计算去年末收盘价
function calcYearStartPrice(klineData, currentYear) {
  const lastYear = currentYear - 1;
  const lastYearRows = klineData.filter((r) => r[0].startsWith(String(lastYear)));
  if (lastYearRows.length > 0) {
    return parseFloat(lastYearRows[lastYearRows.length - 1][2]);
  }
  return null;
}

// 从K线数据计算所有衍生指标
function calcKlineMetrics(kline, price, currentYear) {
  let yearHigh = null, yearLow = null, ytdChange = null;

  if (kline && kline.length > 0) {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const recent = kline.filter((r) => {
      try {
        return new Date(r[0]) >= oneYearAgo;
      } catch {
        return false;
      }
    });
    if (recent.length > 0) {
      yearHigh = Math.max(...recent.map((r) => parseFloat(r[3])).filter((n) => !isNaN(n)));
      yearLow = Math.min(...recent.map((r) => parseFloat(r[4])).filter((n) => !isNaN(n)));
    }
    const yearStart = calcYearStartPrice(kline, currentYear);
    if (yearStart && price) {
      ytdChange = ((price - yearStart) / yearStart) * 100;
    }
  }

  return { yearHigh, yearLow, ytdChange };
}

function stripCode(code) {
  return code.replace(/^(sh|sz|hk)/, "");
}

// 抓取 A股/港股
async function fetchAShareData() {
  const currentYear = new Date().getFullYear();

  // 1. 批量获取实时行情
  const codes = A_STOCKS.map((s) => s.code).join(",");
  const raw = await fetchUrl(`https://qt.gtimg.cn/q=${codes}`, true, 10000);
  const quotes = parseQuoteData(raw);

  // 2. 并行获取所有K线数据
  const klinePromises = A_STOCKS.map((s) => fetchKlineSingle(s.code, 280));
  const klineResults = await Promise.all(klinePromises);

  // 3. 合并数据
  const stocks = A_STOCKS.map((stock, i) => {
    const fields = quotes[stock.code];
    if (!fields || fields.length < 40) {
      return {
        code: stripCode(stock.code),
        name: stock.name,
        market: stock.market,
        currency: stock.currency,
        error: "数据暂缺",
      };
    }

    try {
      const price = toNum(fields[3]);
      const prevClose = toNum(fields[4]);

      let changePct = toNum(fields[32]);
      if ((changePct === null || changePct === 0) && price && prevClose) {
        changePct = ((price - prevClose) / prevClose) * 100;
      }

      // 市盈率TTM
      let peTtm = null;
      if (stock.market === "A股") {
        peTtm = toNum(fields[39]);
      } else {
        peTtm = toNum(fields[57]);
      }

      // K线衍生指标
      const kline = klineResults[i];
      const { yearHigh, yearLow, ytdChange } = calcKlineMetrics(kline, price, currentYear);

      const drawdown = yearHigh && price ? ((price - yearHigh) / yearHigh) * 100 : null;
      const rally = yearLow && price ? ((price - yearLow) / yearLow) * 100 : null;

      return {
        code: stripCode(stock.code),
        name: fields[1] || stock.name,
        market: stock.market,
        currency: stock.currency,
        price: round2(price),
        prev_close: round2(prevClose),
        change_pct: round2(changePct),
        pe_ttm: peTtm !== null ? (peTtm > 0 ? round2(peTtm) : "亏损") : null,
        year_high: round2(yearHigh),
        year_low: round2(yearLow),
        drawdown: round2(drawdown),
        rally: round2(rally),
        ytd_change: round2(ytdChange),
      };
    } catch (e) {
      return {
        code: stripCode(stock.code),
        name: stock.name,
        market: stock.market,
        currency: stock.currency,
        error: "数据暂缺",
      };
    }
  });

  return {
    update_time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
    stocks,
  };
}

// 抓取美股
async function fetchUsStockData() {
  const currentYear = new Date().getFullYear();

  // 1. 批量获取实时行情
  const codes = US_STOCKS.map((s) => s.code).join(",");
  const raw = await fetchUrl(`https://qt.gtimg.cn/q=${codes}`, true, 10000);
  const quotes = parseQuoteData(raw);

  // 2. 并行获取所有K线数据（仅为 ytd_change）
  // 先从实时行情提取股票完整代码
  const stockData = US_STOCKS.map((stock) => {
    const key = stock.code.toLowerCase();
    let fields = null;
    for (const k in quotes) {
      if (k.toLowerCase() === key) {
        fields = quotes[k];
        break;
      }
    }
    return { stock, fields };
  });

  // 并行获取K线
  const klinePromises = stockData.map(({ fields }) => {
    if (!fields || fields.length < 3) return Promise.resolve([]);
    const fullCode = fields[2] || "";
    return fetchKlineSingle(`us${fullCode}`, 320);
  });
  const klineResults = await Promise.all(klinePromises);

  // 3. 合并数据
  const stocks = stockData.map(({ stock, fields }, i) => {
    if (!fields || fields.length < 50) {
      return {
        ticker: stock.ticker,
        name: stock.name,
        currency: "美元",
        error: "数据暂缺",
      };
    }

    try {
      const price = toNum(fields[3]);
      const prevClose = toNum(fields[4]);

      let changePct = toNum(fields[32]);
      if ((changePct === null || changePct === 0) && price && prevClose) {
        changePct = ((price - prevClose) / prevClose) * 100;
      }

      const peTtm = toNum(fields[39]);
      // 52周高低直接从实时行情获取
      const week52High = toNum(fields[48]);
      const week52Low = toNum(fields[49]);

      // K线只为算 ytd_change
      const kline = klineResults[i];
      let ytdChange = null;
      if (kline && kline.length > 0 && price) {
        const yearStart = calcYearStartPrice(kline, currentYear);
        if (yearStart) {
          ytdChange = ((price - yearStart) / yearStart) * 100;
        }
      }

      const drawdown = week52High && price ? ((price - week52High) / week52High) * 100 : null;
      const rally = week52Low && price ? ((price - week52Low) / week52Low) * 100 : null;

      return {
        ticker: stock.ticker,
        name: fields[1] || stock.name,
        currency: "美元",
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
    } catch (e) {
      return {
        ticker: stock.ticker,
        name: stock.name,
        currency: "美元",
        error: "数据暂缺",
      };
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
      const data = await fetchAShareData();
      res.status(200).json(data);
    } else if (type === "us") {
      const data = await fetchUsStockData();
      res.status(200).json(data);
    } else {
      const [aData, usData] = await Promise.all([fetchAShareData(), fetchUsStockData()]);
      res.status(200).json({ a_share: aData, us_stock: usData });
    }
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: error.message });
  }
}
