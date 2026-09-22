#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
行情数据抓取脚本
抓取 A股/港股 和 美股行情数据，生成 JSON 文件供网站展示
"""

import urllib.request
import json
import re
import os
from datetime import datetime, timedelta

# 代理配置：默认直连，需要时通过环境变量指定，例如：
#   PROXY_URL=http://127.0.0.1:18080 python3 fetch_data.py
PROXY = os.environ.get("PROXY_URL", "")
if PROXY:
    proxy_handler = urllib.request.ProxyHandler({
        "http": PROXY,
        "https": PROXY
    })
    opener = urllib.request.build_opener(proxy_handler)
else:
    opener = urllib.request.build_opener()

# 数据输出目录
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)


def fetch_url(url, encoding="utf-8"):
    """获取 URL 内容"""
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        with opener.open(req, timeout=15) as resp:
            data = resp.read()
            return data.decode(encoding, errors="replace")
    except Exception as e:
        print(f"请求失败 {url}: {e}")
        return None


def parse_tencent_quote(raw_text):
    """解析腾讯行情接口返回的 GBK 数据"""
    result = {}
    if not raw_text:
        return result
    pattern = r'v_([^=]+)="([^"]*)"'
    for match in re.finditer(pattern, raw_text):
        code = match.group(1)
        fields = match.group(2).split("~")
        result[code] = fields
    return result


def fetch_daily_kline(code, days=320):
    """获取日K数据"""
    url = f"https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param={code},day,,,{days}"
    text = fetch_url(url, "utf-8")
    if not text:
        return []
    try:
        data = json.loads(text)
        kline_data = data.get("data", {})
        for key in kline_data:
            if "day" in kline_data[key]:
                return kline_data[key]["day"]
    except Exception as e:
        print(f"解析K线失败 {code}: {e}")
    return []


def calc_year_start_price(kline_data, current_year):
    """计算去年末收盘价（今年来涨幅基准）"""
    last_year = current_year - 1
    last_year_closes = [
        row for row in kline_data
        if row[0].startswith(str(last_year))
    ]
    if last_year_closes:
        return float(last_year_closes[-1][2])
    return None


def fetch_a_share_data():
    """抓取 A股/港股 行情数据"""
    current_year = datetime.now().year

    # A股 + 港股 股票列表
    stocks = [
        {"code": "sh600519", "name": "贵州茅台", "market": "A股", "currency": "元"},
        {"code": "sh600036", "name": "招商银行", "market": "A股", "currency": "元"},
        {"code": "sz000333", "name": "美的集团", "market": "A股", "currency": "元"},
        {"code": "sh600900", "name": "长江电力", "market": "A股", "currency": "元"},
        {"code": "sh601318", "name": "中国平安", "market": "A股", "currency": "元"},
        {"code": "sz300750", "name": "宁德时代", "market": "A股", "currency": "元"},
        {"code": "hk09992", "name": "泡泡玛特", "market": "港股", "currency": "港元"},
        {"code": "hk00700", "name": "腾讯控股", "market": "港股", "currency": "港元"},
        {"code": "hk01810", "name": "小米集团-W", "market": "港股", "currency": "港元"},
        {"code": "hk01364", "name": "古茗", "market": "港股", "currency": "港元"},
        {"code": "hk00981", "name": "中芯国际", "market": "港股", "currency": "港元"},
    ]

    # 获取实时行情
    codes = ",".join([s["code"] for s in stocks])
    url = f"https://qt.gtimg.cn/q={codes}"
    raw = fetch_url(url, "gbk")
    quotes = parse_tencent_quote(raw)

    result = {
        "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "stocks": []
    }

    for stock in stocks:
        code = stock["code"]
        fields = quotes.get(code)
        if not fields or len(fields) < 40:
            result["stocks"].append({
                "code": code.replace("sh", "").replace("sz", "").replace("hk", ""),
                "name": stock["name"],
                "market": stock["market"],
                "currency": stock["currency"],
                "error": "数据暂缺"
            })
            continue

        try:
            name = fields[1]
            price = float(fields[3])
            prev_close = float(fields[4])
            change_pct = float(fields[32]) if fields[32] else 0.0

            # 市盈率TTM：A股索引39，港股索引57
            if stock["market"] == "A股":
                pe_ttm = float(fields[39]) if len(fields) > 39 and fields[39] else None
            else:
                pe_ttm = float(fields[57]) if len(fields) > 57 and fields[57] else None

            # 获取日K数据计算近一年高低和今年来涨幅
            kline = fetch_daily_kline(code, 280)

            year_high = None
            year_low = None
            year_start_price = None
            ytd_change = None

            if kline:
                # 近一年（365天）的高低点
                one_year_ago = datetime.now() - timedelta(days=365)
                recent_kline = [
                    row for row in kline
                    if datetime.strptime(row[0], "%Y-%m-%d") >= one_year_ago
                ]
                if recent_kline:
                    year_high = max(float(row[3]) for row in recent_kline)
                    year_low = min(float(row[4]) for row in recent_kline)

                # 今年来涨幅
                year_start_price = calc_year_start_price(kline, current_year)
                if year_start_price:
                    ytd_change = (price - year_start_price) / year_start_price * 100

            # 距高点回落 / 距低点涨幅
            drawdown = None
            rally = None
            if year_high:
                drawdown = (price - year_high) / year_high * 100
            if year_low:
                rally = (price - year_low) / year_low * 100

            result["stocks"].append({
                "code": code.replace("sh", "").replace("sz", "").replace("hk", ""),
                "name": name,
                "market": stock["market"],
                "currency": stock["currency"],
                "price": round(price, 2),
                "prev_close": round(prev_close, 2),
                "change_pct": round(change_pct, 2),
                "pe_ttm": round(pe_ttm, 2) if pe_ttm and pe_ttm > 0 else ("亏损" if pe_ttm and pe_ttm < 0 else None),
                "year_high": round(year_high, 2) if year_high else None,
                "year_low": round(year_low, 2) if year_low else None,
                "drawdown": round(drawdown, 2) if drawdown is not None else None,
                "rally": round(rally, 2) if rally is not None else None,
                "ytd_change": round(ytd_change, 2) if ytd_change is not None else None,
            })
        except Exception as e:
            print(f"处理 {stock['name']} 失败: {e}")
            result["stocks"].append({
                "code": code.replace("sh", "").replace("sz", "").replace("hk", ""),
                "name": stock["name"],
                "market": stock["market"],
                "currency": stock["currency"],
                "error": "数据暂缺"
            })

    return result


def fetch_us_stock_data():
    """抓取 美股 行情数据"""
    current_year = datetime.now().year

    # 美股股票列表
    stocks = [
        {"code": "usAAPL", "name": "苹果", "ticker": "AAPL"},
        {"code": "usMSFT", "name": "微软", "ticker": "MSFT"},
        {"code": "usNVDA", "name": "英伟达", "ticker": "NVDA"},
        {"code": "usAMZN", "name": "亚马逊", "ticker": "AMZN"},
        {"code": "usGOOGL", "name": "谷歌-A", "ticker": "GOOGL"},
        {"code": "usMETA", "name": "Meta Platforms", "ticker": "META"},
        {"code": "usTSLA", "name": "特斯拉", "ticker": "TSLA"},
        {"code": "usAVGO", "name": "博通", "ticker": "AVGO"},
        {"code": "usTSM", "name": "台积电", "ticker": "TSM"},
        {"code": "usSKHY", "name": "SK海力士", "ticker": "SKHY"},
        {"code": "usPDD", "name": "拼多多", "ticker": "PDD"},
        {"code": "usSPCX", "name": "SpaceX", "ticker": "SPCX"},
        {"code": "usBRK.B", "name": "伯克希尔B", "ticker": "BRK.B"},
        {"code": "usKO", "name": "可口可乐", "ticker": "KO"},
        {"code": "usMCD", "name": "麦当劳", "ticker": "MCD"},
        {"code": "usCOST", "name": "好市多", "ticker": "COST"},
        {"code": "usWMT", "name": "沃尔玛", "ticker": "WMT"},
        {"code": "usTCOM", "name": "携程", "ticker": "TCOM"},
        {"code": "usBKNG", "name": "Booking", "ticker": "BKNG"},
        {"code": "usEXPE", "name": "Expedia", "ticker": "EXPE"},
    ]

    # 获取实时行情
    codes = ",".join([s["code"] for s in stocks])
    url = f"https://qt.gtimg.cn/q={codes}"
    raw = fetch_url(url, "gbk")
    quotes = parse_tencent_quote(raw)

    result = {
        "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "stocks": []
    }

    for stock in stocks:
        code_key = stock["code"].lower()
        # 腾讯接口返回的key可能是小写
        fields = None
        for k in quotes:
            if k.lower() == code_key:
                fields = quotes[k]
                break

        if not fields or len(fields) < 50:
            result["stocks"].append({
                "ticker": stock["ticker"],
                "name": stock["name"],
                "currency": "美元",
                "error": "数据暂缺"
            })
            continue

        try:
            name = fields[1]
            price = float(fields[3])
            prev_close = float(fields[4])
            change_pct = float(fields[32]) if fields[32] else 0.0

            # 市盈率TTM
            pe_ttm = float(fields[39]) if len(fields) > 39 and fields[39] else None

            # 52周最高/最低
            week52_high = float(fields[48]) if len(fields) > 48 and fields[48] else None
            week52_low = float(fields[49]) if len(fields) > 49 and fields[49] else None

            # 获取日K计算今年来涨幅
            # 代码后缀从实时行情返回的索引2获取
            full_code = fields[2] if len(fields) > 2 else stock["ticker"]
            kline_code = f"us{full_code}"
            kline = fetch_daily_kline(kline_code, 320)

            year_start_price = None
            ytd_change = None
            if kline:
                year_start_price = calc_year_start_price(kline, current_year)
                if year_start_price:
                    ytd_change = (price - year_start_price) / year_start_price * 100

            # 距高点回撤 / 距低点涨幅
            drawdown = None
            rally = None
            if week52_high:
                drawdown = (price - week52_high) / week52_high * 100
            if week52_low:
                rally = (price - week52_low) / week52_low * 100

            result["stocks"].append({
                "ticker": stock["ticker"],
                "name": name,
                "currency": "美元",
                "price": round(price, 2),
                "prev_close": round(prev_close, 2),
                "change_pct": round(change_pct, 2),
                "pe_ttm": round(pe_ttm, 2) if pe_ttm and pe_ttm > 0 else ("亏损" if pe_ttm and pe_ttm < 0 else None),
                "week52_high": round(week52_high, 2) if week52_high else None,
                "week52_low": round(week52_low, 2) if week52_low else None,
                "drawdown": round(drawdown, 2) if drawdown is not None else None,
                "rally": round(rally, 2) if rally is not None else None,
                "ytd_change": round(ytd_change, 2) if ytd_change is not None else None,
            })
        except Exception as e:
            print(f"处理 {stock['name']} 失败: {e}")
            result["stocks"].append({
                "ticker": stock["ticker"],
                "name": stock["name"],
                "currency": "美元",
                "error": "数据暂缺"
            })

    return result


def main():
    print(f"代理设置: {PROXY if PROXY else '直连（如需代理请设置环境变量 PROXY_URL）'}")
    print("正在抓取 A股/港股 行情数据...")
    a_data = fetch_a_share_data()
    a_path = os.path.join(DATA_DIR, "a_share.json")
    with open(a_path, "w", encoding="utf-8") as f:
        json.dump(a_data, f, ensure_ascii=False, indent=2)
    print(f"A股/港股数据已保存到 {a_path}，共 {len(a_data['stocks'])} 只股票")

    print("\n正在抓取 美股 行情数据...")
    us_data = fetch_us_stock_data()
    us_path = os.path.join(DATA_DIR, "us_stock.json")
    with open(us_path, "w", encoding="utf-8") as f:
        json.dump(us_data, f, ensure_ascii=False, indent=2)
    print(f"美股数据已保存到 {us_path}，共 {len(us_data['stocks'])} 只股票")

    print("\n数据抓取完成！")


if __name__ == "__main__":
    main()
