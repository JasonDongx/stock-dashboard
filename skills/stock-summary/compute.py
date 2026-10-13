#!/usr/bin/env python3
# 窗口涨幅（近3/2年、YTD）+ 距1年高点回撤，统一口径输出
import urllib.request, json, time
from datetime import datetime, timedelta

US_SUFFIX = {'AAPL':'.OQ','MSFT':'.OQ','NVDA':'.OQ','AMZN':'.OQ','GOOGL':'.OQ','META':'.OQ','TSLA':'.OQ','AVGO':'.OQ','PDD':'.OQ','SPCX':'.OQ','SKHY':'.OQ','BKNG':'.OQ','TCOM':'.OQ','EXPE':'.OQ','TSM':'.N','BRK.B':'.N','KO':'.N','MCD':'.N','COST':'.OQ','WMT':'.N'}
STOCKS = [('sh600519','贵州茅台','A'),('sh600036','招商银行','A'),('sz000333','美的集团','A'),('sh600900','长江电力','A'),('sh601318','中国平安','A'),('sz300750','宁德时代','A'),('sh688825','长鑫科技','A'),('hk09992','泡泡玛特','HK'),('hk00700','腾讯控股','HK'),('hk01810','小米集团-W','HK'),('hk01364','古茗','HK'),('hk00981','中芯国际','HK'),('hk09633','农夫山泉','HK'),('hk03441','南方东西精选','HK'),('hk03442','南方港美科技','HK'),('usAAPL','苹果','US'),('usMSFT','微软','US'),('usNVDA','英伟达','US'),('usAMZN','亚马逊','US'),('usGOOGL','谷歌-A','US'),('usMETA','Meta','US'),('usTSLA','特斯拉','US'),('usAVGO','博通','US'),('usTSM','台积电','US'),('usSKHY','SK海力士','US'),('usPDD','拼多多','US'),('usSPCX','SpaceX','US'),('usBRK.B','伯克希尔B','US'),('usKO','可口可乐','US'),('usMCD','麦当劳','US'),('usCOST','好市多','US'),('usWMT','沃尔玛','US'),('usTCOM','携程','US'),('usBKNG','Booking','US'),('usEXPE','Expedia','US')]

def fetch(code, mkt):
    if mkt!='US':
        ep={'A':'fqkline','HK':'hkfqkline'}[mkt]
        url=f'https://web.ifzq.gtimg.cn/appstock/app/{ep}/get?param={code},day,,,800,qfq'
        d=json.loads(urllib.request.urlopen(url,timeout=15).read())
        k=d['data'].get(code)
        return (k.get('qfqday') or k.get('day')) if k else None
    base=code[2:]
    for c in [f'us{base}{US_SUFFIX.get(base,"")}', f'us{base}']:
        try:
            url=f'https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param={c},day,,,800,qfq'
            d=json.loads(urllib.request.urlopen(url,timeout=15).read())
            k=d['data'].get(c) or (list(d['data'].values())[0] if d['data'] else None)
            if k:
                days=k.get('qfqday') or k.get('day') or []
                if len(days)>100: return days
        except Exception: pass
        time.sleep(0.2)
    return None

out=[]
for code,name,mkt in STOCKS:
    rows=fetch(code,mkt)
    if not rows: print('FAIL',code,flush=True); continue
    last=float(rows[-1][2]); lastd=rows[-1][0]
    rec={'name':name,'code':code,'mkt':mkt,'last':lastd,'first':rows[0][0],'bars':len(rows),'lastpx':last}
    def base_px(cutoff):
        w=[r for r in rows if r[0]<cutoff]
        return float(w[-1][2]) if w else None   # 窗口起点前最后一个收盘（年末收盘）
    for y,label in ((3,'g3'),(2,'g2'),(1,'g1')):
        cutoff=(datetime.strptime(rows[-1][0],'%Y-%m-%d')-timedelta(days=int(y*365.25))).strftime('%Y-%m-%d')
        b=base_px(cutoff)
        rec[label]=round((last/b-1)*100,2) if b else None
    # YTD：2025-12-31 收盘为基
    b=base_px('2026-01-01')
    rec['ytd']=round((last/b-1)*100,2) if b else None
    # 距1年高点回撤
    cutoff=(datetime.strptime(rows[-1][0],'%Y-%m-%d')-timedelta(days=365)).strftime('%Y-%m-%d')
    w=[r for r in rows if r[0]>=cutoff]
    hi=max(float(r[2]) for r in w); hid=[r[0] for r in w if float(r[2])==hi][-1]
    rec['dd1']={'pct':round((last/hi-1)*100,2),'hi':hi,'hi_date':hid}
    out.append(rec)
    print(f"{name:9s} 3y {rec['g3']}% | 2y {rec['g2']}% | YTD {rec['ytd']}% | 距1y高点 {rec['dd1']['pct']}% (bars={len(rows)}, {rows[0][0]}起)", flush=True)
    time.sleep(0.25)

json.dump(out, open('/home/z/my-project/tmp_scripts/gain_dd.json','w'), ensure_ascii=False, indent=1)
print('saved')
