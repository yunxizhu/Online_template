'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const srcPath = path.join(
  __dirname,
  '..',
  '卡拉斯坦游戏说明书（16页A5·A4合订打印版）.html'
);
const outPath = srcPath; // overwrite in place
const bakPath = path.join(
  __dirname,
  '..',
  '卡拉斯坦游戏说明书（A4备份-转换前）.html'
);
const picDir = path.join(
  __dirname,
  '..',
  'server',
  'games',
  'lasidao',
  'resourse',
  'picture'
);

// alt → 源文件（与功能卡同规格重编码：宽 420、JPEG q82）
const ALT_FILES = {
  丰收: 'gongnengka_fengshou.png',
  遥控骰子: 'gongnengka_yaokongtouzi.png',
  驱逐: 'gongnengka_quzhu.png',
  强化: 'gongnengka_qianghua.png',
  征召: 'gongnengka_zhengzhao.png',
  重抽: 'gongnengka_chongchou.png',
  强盗来袭: 'gongnengka_qiangdaolaixi.png',
  福利房: 'gongnengka_fulifang.png',
  收留: 'gongnengka_shouliu.png',
  商队来临: 'gongnengka_shangduilailin.png',
  抢劫: 'gongnengka_qiangjie.png',
  拆迁: 'gongnengka_chaiqian.png',
  木头工坊: 'jianzhuka_mutougongfang.png',
  石头工坊: 'jianzhuka_shitougongfang.png',
  小麦工坊: 'jianzhuka_xiaomaigongfang.png',
  铁矿工坊: 'jianzhuka_tiekuanggongfang.png',
  许愿井: 'jianzhuka_xuyuanjin.png',
  宫殿: 'jianzhuka_gongdian.png',
  学堂: 'jianzhuka_xuetang.png',
  集市: 'jianzhuka_jishi.png',
  囚徒困境: 'shijianka_qiutukunjing.png',
  颗粒无收: 'shijianka_keliwushou.png',
  抵抗南蛮: 'shijianka_diyunanman.png',
  晴空万里: 'shijianka_qingkongwanli.png',
  以身入局: 'shijianka_yishenruju.png',
  一山不容二虎: 'shijianka_yishanburongerhu.png',
  幸运一抽: 'shijianka_manghe.png',
  渔翁得利: 'shijianka_yuwengdeli.png',
  先到先得: 'shijianka_xiandaoxiande.png',
  低保户: 'shijianka_dibaohu.png',
  召回: 'shijianka_zhaohui.png',
  围魏救赵: 'shijianka_weiweijiuzhao.png',
  传送: 'shijianka_chuansong.png',
  吃不了兜着走: 'shijianka_chibuliaodouzhezou.png',
  雇佣军: 'shijianka_guyongjun.png',
};

let html = fs.existsSync(srcPath) ? fs.readFileSync(srcPath, 'utf8') : '';

// Backup once
if (html && !fs.existsSync(bakPath)) {
  fs.writeFileSync(bakPath, html, 'utf8');
  console.log('backup written');
}

let uriByAlt;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-cards-'));
const encodePy = path.join(tmpDir, 'encode.py');
const mapJson = path.join(tmpDir, 'alt-files.json');
const uriJson = path.join(tmpDir, 'data-uris.json');
fs.writeFileSync(
  encodePy,
  `
from PIL import Image
import base64, json, os, sys
pic_dir, mapping_path, out_path, width, quality = sys.argv[1:6]
width, quality = int(width), int(quality)
with open(mapping_path, 'r', encoding='utf-8') as f:
    mapping = json.load(f)
out = {}
for alt, fname in mapping.items():
    src = os.path.join(pic_dir, fname)
    im = Image.open(src).convert('RGB')
    w, h = im.size
    nh = max(1, round(h * width / w))
    im = im.resize((width, nh), Image.Resampling.LANCZOS)
    from io import BytesIO
    buf = BytesIO()
    im.save(buf, format='JPEG', quality=quality, optimize=True)
    out[alt] = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False)
`.trimStart(),
  'utf8'
);
fs.writeFileSync(mapJson, JSON.stringify(ALT_FILES, null, 0), 'utf8');
try {
  execFileSync(
    'python',
    [encodePy, picDir, mapJson, uriJson, '420', '82'],
    { stdio: 'inherit' }
  );
  uriByAlt = JSON.parse(fs.readFileSync(uriJson, 'utf8'));
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
console.log('images re-encoded from source:', Object.keys(uriByAlt).length);

function img(alt) {
  if (!uriByAlt[alt]) throw new Error('missing image for ' + alt);
  // 正文不内嵌 base64，图片数据集中在文末，便于阅读排版结构
  return `<img data-card="${alt}" alt="${alt}" src="">`;
}

function page(id, headRight, bodyInner, pageNo, total = 16, extraClass = '') {
  const cls = extraClass ? ` page ${extraClass}` : ' page';
  return `<!-- ===================== 第 ${pageNo} 页 ===================== -->
<section class="${cls.trim()}" id="${id}">
  <div class="frame">
    <span class="cr tl"></span><span class="cr tr"></span><span class="cr bl"></span><span class="cr br"></span>
    <header class="page-head">
      <span class="brand">卡拉斯坦 · 游戏说明书</span>
      <span>${headRight}</span>
    </header>
${bodyInner}
    <footer class="page-foot">
      <span>卡拉斯坦 · 游戏说明书 · A5</span>
      <span>第 ${pageNo} 页 / 共 ${total} 页</span>
    </footer>
  </div>
</section>`;
}

function fc(alt, name, ph, eff, nt) {
  const phClass = ph === '生产' ? 'prod' : 'build';
  return `      <div class="fc">
        <div class="face">${img(alt)}</div>
        <div class="fc-body">
          <div class="hd"><span class="nm">${name}</span><span class="ph ${phClass}">${ph}</span></div>
          <div class="eff">${eff}</div>${nt ? `\n          <div class="nt">${nt}</div>` : ''}
        </div>
      </div>`;
}

function ec(alt, name, trg, eff) {
  return `      <div class="ec">
        <div class="face">${img(alt)}</div>
        <div class="ec-body">
          <div class="hd"><span class="nm">${name}</span><span class="trg">${trg}</span></div>
          <div class="eff">${eff}</div>
        </div>
      </div>`;
}

function res(alt, name, out, cost) {
  return `      <div class="res">
        <div class="face">${img(alt)}</div>
        <div class="nm">${name}</div>
        <div class="cost">造价 ${cost}</div>
        <div class="out">${out}</div>
      </div>`;
}

let css = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>卡拉斯坦 · 游戏说明书（16 页 A5 · A4 合订打印版）</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%232f241a'/%3E%3Crect x='17' y='25' width='30' height='23' rx='2' fill='none' stroke='%23c9a24b' stroke-width='3'/%3E%3Cpath d='M24 48v-9a8 8 0 0 1 16 0v9' fill='none' stroke='%23c9a24b' stroke-width='3'/%3E%3Ccircle cx='32' cy='34' r='2.6' fill='%239c3b28'/%3E%3C/svg%3E">
<link rel="stylesheet" href="https://miaoda.feishu.cn/fonts/css2?family=Noto+Serif+SC:wght@600;700;900&family=Noto+Sans+SC:wght@400;500;700&display=swap">
<style>
:root{
  --parch:#f6efdf;
  --paper:#fbf6ea;
  --ink:#3a2a18;
  --ink2:#6b5638;
  --gold:#b8893a;
  --gold2:#8a6426;
  --red:#9c3b28;
  --green:#2f5d4a;
  --blue:#33556e;
  --purple:#5d4a7a;
  --line:#d3b67e;
}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{background:#241e18;}
body{
  font-family:"Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  color:var(--ink);
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
.sheet{
  display:flex;flex-direction:column;align-items:center;gap:18px;padding:20px 12px;
  min-width:148mm;
}
/* A5 页面：字号与元素尺寸保持原 A4 版可读大小 */
.page{
  position:relative;width:148mm;height:210mm;flex:0 0 auto;overflow:hidden;
  background:
    radial-gradient(120% 85% at 18% 0%, rgba(255,253,244,.95), rgba(255,253,244,0) 55%),
    radial-gradient(105% 75% at 92% 100%, rgba(212,174,112,.30), rgba(212,174,112,0) 60%),
    var(--parch);
  box-shadow:0 8px 28px rgba(0,0,0,.55);
  padding:5mm;
}
.frame{
  position:relative;width:100%;height:100%;
  border:1.2mm solid var(--gold2);
  outline:.35mm solid var(--line);outline-offset:-1.8mm;
  padding:5.5mm 5.5mm 4.5mm;
  display:flex;flex-direction:column;
}
.cr{position:absolute;width:5.5mm;height:5.5mm;border-color:var(--gold);border-style:solid;z-index:2;}
.cr.tl{top:.8mm;left:.8mm;border-width:1.2mm 0 0 1.2mm;}
.cr.tr{top:.8mm;right:.8mm;border-width:1.2mm 1.2mm 0 0;}
.cr.bl{bottom:.8mm;left:.8mm;border-width:0 0 1.2mm 1.2mm;}
.cr.br{bottom:.8mm;right:.8mm;border-width:0 1.2mm 1.2mm 0;}
.page-head{
  display:flex;justify-content:space-between;align-items:baseline;
  font-size:2.5mm;letter-spacing:.1em;color:var(--ink2);
  border-bottom:.3mm solid var(--line);padding-bottom:1.6mm;margin-bottom:3mm;
}
.page-head .brand{font-weight:700;color:var(--gold2);letter-spacing:.16em;}
.page-foot{
  margin-top:auto;padding-top:2mm;border-top:.3mm solid var(--line);
  display:flex;justify-content:space-between;
  font-size:2.4mm;color:var(--ink2);letter-spacing:.08em;
}
.sec-h{display:flex;align-items:center;gap:2.2mm;margin:0 0 2.8mm;}
.sec-h .sec-no{
  flex:0 0 auto;width:7.6mm;height:7.6mm;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(155deg,var(--gold),var(--gold2));color:#fff;
  font-family:"Noto Serif SC",serif;font-weight:700;font-size:3.8mm;border-radius:1.5mm;
  box-shadow:0 .35mm 1mm rgba(138,100,38,.45);
}
.sec-h .t{font-family:"Noto Serif SC",serif;font-size:4.4mm;font-weight:700;letter-spacing:.06em;}
.sec-h .rule{flex:1;height:.35mm;background:linear-gradient(90deg,var(--line),rgba(211,182,126,0));}
.sec-h .cnt{
  font-size:2.5mm;color:var(--ink2);background:#f0e6cd;border:.3mm solid var(--line);
  padding:.4mm 1.6mm;border-radius:.9mm;white-space:nowrap;
}
.kv{width:100%;border-collapse:collapse;table-layout:fixed;}
.kv th{
  width:28%;text-align:left;font-weight:700;background:#ece0c2;color:var(--ink);
  padding:2.2mm 2.4mm;font-size:3.2mm;border:.3mm solid var(--line);
}
.kv td{padding:2.2mm 2.4mm;font-size:3.1mm;border:.3mm solid var(--line);background:rgba(255,253,246,.6);line-height:1.5;}
.step{
  display:flex;gap:3mm;margin-bottom:3.2mm;padding:3.2mm 3mm;
  border:.35mm solid var(--line);border-radius:1.8mm;
  background:linear-gradient(180deg,rgba(255,253,246,.85),rgba(244,235,214,.65));
}
.step-no{
  flex:0 0 auto;width:8.5mm;height:8.5mm;border-radius:50%;
  background:linear-gradient(155deg,var(--red),#7c2c1c);color:#fff;
  display:flex;align-items:center;justify-content:center;
  font-family:"Noto Serif SC",serif;font-weight:700;font-size:4mm;
  box-shadow:0 .35mm 1mm rgba(124,44,28,.4);
}
.step-body{flex:1;min-width:0;}
.step-title{
  font-family:"Noto Serif SC",serif;font-weight:700;font-size:3.6mm;
  display:flex;align-items:center;gap:2mm;margin-bottom:1mm;
}
.step-title em{
  font-style:normal;font-size:2.4mm;font-weight:500;color:#fff;
  background:var(--green);padding:.35mm 1.5mm;border-radius:.9mm;letter-spacing:.04em;
}
.step-body p,.step-body li{font-size:3mm;line-height:1.55;}
.step-body ul,.step-body ol{margin-left:4.5mm;margin-top:.6mm;}
.step-body li{margin-bottom:.55mm;}
.sub-note{
  margin-top:1.4mm;padding:1.6mm 2.2mm;background:#f3e9d2;
  border-left:.9mm solid var(--gold);border-radius:0 1.2mm 1.2mm 0;
  font-size:2.85mm;line-height:1.5;
}
.flowbar{
  display:flex;align-items:center;justify-content:space-between;
  padding:2.4mm 1.6mm;background:#f0e6cd;border:.35mm solid var(--line);border-radius:1.8mm;
  margin:2.5mm 0;
}
.flowbar .it{flex:1;text-align:center;font-size:2.6mm;font-weight:700;color:var(--ink2);}
.flowbar .ar{flex:0 0 auto;color:var(--gold2);font-weight:800;padding:0 1mm;}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:3mm;}
.act{
  border:.4mm solid var(--line);border-radius:1.8mm;padding:3.4mm 3mm;
  background:linear-gradient(180deg,rgba(255,253,246,.92),rgba(245,237,216,.78));
  border-top:1.1mm solid var(--gold);
}
.act.span2{grid-column:1 / -1;}
.act .nm{
  font-family:"Noto Serif SC",serif;font-weight:700;font-size:3.8mm;
  display:flex;align-items:center;gap:2mm;margin-bottom:1.6mm;flex-wrap:wrap;
}
.act .bdg{
  font-family:"Noto Sans SC",sans-serif;font-size:2.3mm;font-weight:500;color:#fff;
  background:var(--green);padding:.35mm 1.5mm;border-radius:.9mm;white-space:nowrap;
}
.act .bdg.any{background:var(--blue);}
.act .bdg.alw{background:var(--gold2);}
.act .row{display:flex;gap:1.8mm;font-size:3mm;line-height:1.5;margin-top:1.2mm;}
.act .row .k{flex:0 0 auto;color:var(--gold2);font-weight:700;}
.caps{border:.4mm solid var(--line);border-radius:1.8mm;background:linear-gradient(180deg,#f6eed8,#f0e4c6);padding:2.8mm 3mm;margin-top:2.5mm;}
.caps .cap-t{font-family:"Noto Serif SC",serif;font-weight:700;font-size:3.3mm;color:var(--gold2);margin-bottom:1.8mm;letter-spacing:.05em;}
.caps .cap-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2mm;}
.caps .cap{background:rgba(255,253,246,.78);border:.3mm solid var(--line);border-radius:1.2mm;padding:2mm 1.6mm;text-align:center;}
.caps .cap.span2{grid-column:span 2;}
.caps .cap b{display:block;font-size:2.3mm;color:var(--ink2);font-weight:500;margin-bottom:.5mm;}
.caps .cap span{font-family:"Noto Serif SC",serif;font-weight:700;font-size:3.1mm;color:var(--red);}
.face{
  flex:0 0 auto;width:18mm;height:29.1mm;
  border-radius:2.2mm;overflow:hidden;
  border:.3mm solid rgba(138,100,38,.45);background:#eadcbd;
  box-shadow:0 .4mm 1.1mm rgba(58,42,24,.22);
}
.face img{display:block;width:100%;height:100%;object-fit:cover;}
.fc-grid{display:grid;grid-template-columns:1fr;gap:2.4mm;}
.fc{
  border:.35mm solid var(--line);border-radius:1.6mm;padding:2.4mm 2.6mm;
  background:rgba(255,253,246,.68);
  display:flex;gap:2.4mm;align-items:flex-start;
}
.fc-body{flex:1;min-width:0;}
.fc .face{width:20mm;height:32.33mm;border-radius:2.4mm;}
.fc .hd{display:flex;align-items:center;gap:1.8mm;margin-bottom:1mm;flex-wrap:wrap;}
.fc .nm{font-family:"Noto Serif SC",serif;font-weight:700;font-size:3.5mm;letter-spacing:.02em;}
.fc .cnt{font-size:2.4mm;color:var(--ink2);background:#f0e6cd;border:.3mm solid var(--line);padding:.25mm 1.3mm;border-radius:.8mm;white-space:nowrap;}
.fc .ph{font-size:2.3mm;font-weight:500;color:#fff;padding:.25mm 1.4mm;border-radius:.8mm;white-space:nowrap;}
.fc .ph.prod{background:var(--red);}
.fc .ph.build{background:var(--green);}
.fc .eff{font-size:2.9mm;line-height:1.52;}
.fc .nt{
  font-size:2.65mm;color:var(--ink2);margin-top:.8mm;
  background:#f3e9d2;border-left:.7mm solid var(--gold);
  padding:.35mm 1.4mm;border-radius:0 .7mm .7mm 0;line-height:1.45;
}
.legend{display:flex;gap:3.5mm;align-items:center;font-size:2.5mm;color:var(--ink2);margin-bottom:2.6mm;}
.legend .sw{display:inline-block;width:3mm;height:3mm;border-radius:.6mm;vertical-align:-.4mm;margin-right:1mm;}
.ec-grid{display:grid;grid-template-columns:1fr;gap:2.4mm;}
.ec{
  border:.35mm solid var(--line);border-radius:1.6mm;padding:2.4mm 2.6mm;
  background:rgba(255,253,246,.68);border-left:1.4mm solid var(--purple);
  display:flex;gap:2.4mm;align-items:flex-start;
}
.ec-body{flex:1;min-width:0;}
.ec .face{width:20mm;height:32.33mm;border-radius:2.4mm;}
.ec .hd{display:flex;align-items:center;gap:1.8mm;margin-bottom:1mm;flex-wrap:wrap;}
.ec .nm{font-family:"Noto Serif SC",serif;font-weight:700;font-size:3.5mm;letter-spacing:.02em;}
.ec .cnt{font-size:2.4mm;color:var(--ink2);background:#f0e6cd;border:.3mm solid var(--line);padding:.25mm 1.3mm;border-radius:.8mm;white-space:nowrap;}
.ec .eff{font-size:2.9mm;line-height:1.52;}
.ec .trg{
  font-size:2.3mm;font-weight:500;color:#fff;background:var(--purple);
  padding:.25mm 1.4mm;border-radius:.8mm;white-space:nowrap;
}
.step.compact{margin-bottom:1.8mm;padding:2mm 2.4mm;}
.step.compact .step-body p,.step.compact .step-body li{font-size:2.85mm;line-height:1.45;}
.kv.tight th,.kv.tight td{padding:1.7mm 2mm;font-size:2.95mm;}
.diff.tight li{margin-bottom:.7mm;font-size:2.85mm;line-height:1.45;}
.remind.tight{margin-bottom:1.8mm;padding:1.6mm 2.2mm;font-size:2.65mm;}
.remind{
  margin-bottom:2.6mm;padding:2.2mm 2.6mm;border:.35mm solid var(--line);border-radius:1.8mm;
  background:linear-gradient(180deg,#f6eed8,#f0e4c6);
  font-size:2.8mm;line-height:1.55;display:flex;gap:2.4mm;
}
.remind .rk{flex:0 0 auto;font-family:"Noto Serif SC",serif;font-weight:700;color:var(--gold2);font-size:3mm;padding-top:.15mm;}
.remind .rb{flex:1;min-width:0;display:flex;flex-direction:column;gap:.55mm;}
.remind .rb p{margin:0;}
.res-row{display:grid;grid-template-columns:repeat(6,1fr);gap:2mm;margin-bottom:2.4mm;}
.res{
  grid-column:span 2;
  border:.35mm solid var(--line);border-radius:1.6mm;padding:2mm 1.6mm 2.2mm;text-align:center;
  background:linear-gradient(180deg,rgba(255,253,246,.9),rgba(245,237,216,.8));
}
.res:nth-child(4){grid-column:2 / span 2;}
.res:nth-child(5){grid-column:4 / span 2;}
.res .face{width:22mm;height:35.57mm;border-radius:2.6mm;margin:0 auto 1.1mm;}
.res .nm{font-family:"Noto Serif SC",serif;font-weight:700;font-size:2.9mm;margin-bottom:.25mm;}
.res .qty{font-size:2.15mm;color:var(--ink2);margin-bottom:.35mm;}
.res .cost{font-size:2.25mm;color:var(--gold2);font-weight:700;line-height:1.3;margin-bottom:.4mm;}
.res .out{font-size:2.35mm;color:var(--green);font-weight:700;line-height:1.3;}
.page.decor .page-head,.page.decor .page-foot{border-color:rgba(211,182,126,.45);}
.page.decor .decor-main{flex:1;justify-content:center;}
.decor-main{display:flex;flex-direction:column;align-items:center;text-align:center;gap:3mm;padding:0 8mm;}
.decor-mark{
  font-family:"Noto Serif SC",serif;font-size:18mm;font-weight:900;letter-spacing:.2em;
  color:rgba(138,100,38,.22);line-height:1;
}
.decor-sub{font-size:3mm;letter-spacing:.35em;color:rgba(107,86,56,.55);font-weight:600;}
.decor-line{width:42mm;height:.35mm;background:linear-gradient(90deg,transparent,var(--line),transparent);}
.b-grid{display:grid;grid-template-columns:1fr;gap:2.6mm;}
.bc{
  border:.4mm solid var(--line);border-radius:1.8mm;padding:2.4mm 2.6mm;
  background:linear-gradient(180deg,rgba(255,253,246,.92),rgba(245,237,216,.78));
  border-top:1.1mm solid var(--gold);
  display:flex;flex-direction:row;align-items:flex-start;gap:2.4mm;
}
.bc .face{width:22mm;height:35.57mm;border-radius:2.6mm;flex:0 0 auto;}
.bc-body{flex:1;min-width:0;}
.bc .nm{font-family:"Noto Serif SC",serif;font-weight:700;font-size:3.4mm;display:flex;align-items:center;gap:1.8mm;margin-bottom:1mm;}
.bc .cnt{font-size:2.4mm;color:var(--ink2);}
.bc .row{display:flex;flex-direction:column;align-items:flex-start;gap:.4mm;font-size:2.75mm;line-height:1.45;margin-top:.7mm;}
.bc .row .k{color:var(--gold2);font-weight:700;}
.team-grid{display:grid;grid-template-columns:1fr;gap:2mm;margin-bottom:2mm;}
.team-box{border:.4mm solid var(--line);border-radius:1.8mm;padding:2.2mm 2.6mm;background:rgba(255,253,246,.7);}
.team-box .tb-t{font-family:"Noto Serif SC",serif;font-weight:700;font-size:3.2mm;color:var(--blue);margin-bottom:1mm;display:flex;align-items:center;gap:1.6mm;}
.team-box .tb-t::before{content:"";width:2.2mm;height:2.2mm;background:var(--blue);border-radius:.5mm;display:inline-block;}
.team-box.solo .tb-t{color:var(--green);}
.team-box.solo .tb-t::before{background:var(--green);}
.team-box p,.team-box li{font-size:2.85mm;line-height:1.45;}
.diff{border:.4mm solid var(--line);border-radius:1.8mm;padding:2.2mm 2.6mm;background:rgba(255,253,246,.7);}
.diff .tb-t{font-family:"Noto Serif SC",serif;font-weight:700;font-size:3.2mm;color:var(--red);margin-bottom:1mm;display:flex;align-items:center;gap:1.6mm;}
.diff .tb-t::before{content:"";width:2.2mm;height:2.2mm;background:var(--red);border-radius:.5mm;display:inline-block;}
.diff li{font-size:2.8mm;line-height:1.45;margin-left:4.5mm;margin-bottom:.7mm;}
.diff li b{color:var(--ink);}
.qk{width:100%;border-collapse:collapse;table-layout:fixed;font-size:2.85mm;}
.qk th{
  width:36%;text-align:left;background:#ece0c2;color:var(--ink);
  padding:1.7mm 2mm;border:.3mm solid var(--line);font-weight:700;font-size:2.75mm;
}
.qk td{padding:1.7mm 2mm;border:.3mm solid var(--line);background:rgba(255,253,246,.55);line-height:1.45;font-size:2.75mm;}
.cover-main{display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:8mm;flex:1;justify-content:center;}
.cover-kicker{font-size:3mm;letter-spacing:.45em;color:var(--gold2);font-weight:700;margin-bottom:4mm;}
.cover-title{
  font-family:"Noto Serif SC",serif;font-size:14mm;font-weight:900;letter-spacing:.14em;
  color:var(--ink);line-height:1.1;
  text-shadow:0 .6mm 0 rgba(138,100,38,.28);
}
.cover-en{font-size:3.1mm;letter-spacing:.5em;color:var(--gold2);margin-top:2.2mm;font-weight:600;}
.cover-emble{margin:5mm 0 4.5mm;}
.cover-sub{
  font-family:"Noto Serif SC",serif;font-size:3.6mm;letter-spacing:.22em;color:var(--red);
  border-top:.35mm solid var(--line);border-bottom:.35mm solid var(--line);
  padding:2mm 6mm;
}
.cover-tag{margin-top:3.5mm;font-size:2.6mm;color:var(--ink2);letter-spacing:.14em;}
.fill{flex:1;min-height:2mm;}
@media print{
  @page{size:A4 landscape;margin:0;}
  html,body{background:#fff;}
  .sheet{
    padding:0;gap:0;min-width:0;
    display:flex;flex-direction:row;flex-wrap:wrap;
    width:297mm;
  }
  .page{
    box-shadow:none;width:148.5mm;height:210mm;margin:0;
    break-inside:avoid;page-break-inside:avoid;
  }
  .page:nth-child(2n){break-after:page;page-break-after:always;}
  .page:last-child{break-after:auto;page-break-after:auto;}
}
@media screen and (max-width:700px){
  body{overflow-x:auto;}
}
</style>
</head>
<body>
<div class="sheet">
`;

const pages = [];

// P1 Cover
pages.push(page('p1', 'A5 · OFFICIAL RULEBOOK', `
    <div class="cover-main">
      <div class="cover-kicker">策略经营 · 卡牌 · 骰子</div>
      <h1 class="cover-title">卡拉斯坦</h1>
      <div class="cover-en">C A R A S T A N</div>
      <div class="cover-emble">
        <svg width="210" height="92" viewBox="0 0 400 176" aria-hidden="true">
          <rect x="34" y="86" width="62" height="62" rx="9" fill="#fbf6ea" stroke="#8a6426" stroke-width="7"/>
          <circle cx="52" cy="104" r="6" fill="#9c3b28"/>
          <circle cx="78" cy="104" r="6" fill="#9c3b28"/>
          <circle cx="65" cy="130" r="6" fill="#9c3b28"/>
          <g fill="none" stroke="#8a6426" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
            <rect x="160" y="52" width="80" height="96" rx="6"/>
            <rect x="146" y="36" width="26" height="28" rx="4"/>
            <rect x="180" y="24" width="20" height="20" rx="4"/>
            <rect x="204" y="24" width="20" height="20" rx="4"/>
            <rect x="230" y="36" width="26" height="28" rx="4"/>
            <path d="M176 148 v-32 q0-20 24-20 t24 20 v32"/>
          </g>
          <rect x="304" y="86" width="62" height="62" rx="9" fill="#fbf6ea" stroke="#8a6426" stroke-width="7"/>
          <circle cx="322" cy="104" r="6" fill="#2f5d4a"/>
          <circle cx="348" cy="104" r="6" fill="#2f5d4a"/>
          <circle cx="322" cy="130" r="6" fill="#2f5d4a"/>
          <circle cx="348" cy="130" r="6" fill="#2f5d4a"/>
        </svg>
      </div>
      <div class="cover-sub">游戏说明书 · 官方规则手册</div>
      <div class="cover-tag">适用于各自为战与 2v2 · A5 合订版</div>
    </div>
`, 1));

// P2 Overview + 游戏模式（同页）
pages.push(page('p2', '概览 · 游戏模式', `
    <div class="sec-h">
      <span class="sec-no">一</span><span class="t">游戏概览</span>
      <span class="rule"></span><span class="cnt">总览</span>
    </div>
    <table class="kv tight" style="margin-bottom:2mm;">
      <tr><th>游戏人数</th><td>各自为战 2–5 人 ／ 2v2 固定 4 人</td></tr>
      <tr><th>游戏类型</th><td>策略经营 · 卡牌 · 骰子</td></tr>
      <tr><th>核心机制</th><td>生产派遣 → 抵消结算 → 建造发育 → 争夺分数</td></tr>
      <tr><th>获胜条件</th><td>各自为战先达 10 分 ／ 2v2 队伍合计先达 15 分</td></tr>
    </table>
    <div class="flowbar" style="margin:0 0 2mm;">
      <span class="it">准备</span><span class="ar">→</span>
      <span class="it">生产</span><span class="ar">→</span>
      <span class="it">结算</span><span class="ar">→</span>
      <span class="it">弃牌</span><span class="ar">→</span>
      <span class="it">建造</span><span class="ar">→</span>
      <span class="it">下轮</span>
    </div>
    <div class="sec-h">
      <span class="sec-no">二</span><span class="t">游戏模式</span>
      <span class="rule"></span><span class="cnt">两种</span>
    </div>
    <div class="team-grid">
      <div class="team-box solo">
        <div class="tb-t">各自为战</div>
        <p><b>人数：</b>2–5 人，人人为敌。　<b>获胜：</b>个人先达 <b>10 分</b>（唯一胜者）。</p>
        <p><b>信息：</b>对手只见手牌数量；暗置仅本人可见，建造后公开。</p>
      </div>
      <div class="team-box">
        <div class="tb-t">2v2</div>
        <p><b>人数：</b>固定 4 人，队友<b>对角坐</b>。　<b>获胜：</b>队伍合计 ≥ <b>15 分</b>全队胜。</p>
        <p><b>差异：</b>可互看队友手牌与暗置；队友同格同效力仍会抵消。</p>
      </div>
    </div>
`, 2));

// P3 start config
pages.push(page('p3', '起始配置', `
    <div class="sec-h">
      <span class="sec-no">三</span><span class="t">起始配置</span>
      <span class="rule"></span><span class="cnt">开局资源</span>
    </div>
    <table class="kv tight" style="margin-bottom:2.4mm;">
      <tr><th>村民</th><td>3 人（其中 1 名强化村民：强化结算计 1.5，普通骰计 1）</td></tr>
      <tr><th>房子</th><td>2 间（每间容纳 2 名村民）</td></tr>
      <tr><th>手牌扩展</th><td>4 个（每个扩展 +2 手牌上限）</td></tr>
      <tr><th>建筑扩展</th><td>2 个（每个扩展 +1 建筑格子）</td></tr>
      <tr><th>功能扩展</th><td>2 个（每个扩展 +1 功能格子）</td></tr>
    </table>
    <div class="caps">
      <div class="cap-t">基础上限速记</div>
      <div class="cap-grid">
        <div class="cap"><b>村民上限</b><span>15 人</span></div>
        <div class="cap"><b>强化骰上限</b><span>5 枚</span></div>
        <div class="cap"><b>住房容量</b><span>每间 2 人</span></div>
        <div class="cap"><b>资源上限（初始）</b><span>8</span></div>
        <div class="cap span2"><b>建筑格 / 功能格（初始）</b><span>各 2</span></div>
      </div>
    </div>
    <div class="remind tight" style="margin-top:2.4mm;">
      <span class="rk">开局</span>
      <span>确认座位与模式后按上表发放，再进入第一轮「决定先手」。两种模式其余流程相同。</span>
    </div>
`, 3));

// P4 flow ①–⑥（保持单页）
pages.push(page('p4', '游戏流程', `
    <div class="sec-h">
      <span class="sec-no">四</span><span class="t">游戏流程</span>
      <span class="rule"></span><span class="cnt">①–⑥</span>
    </div>
    <div class="step compact">
      <div class="step-no">①</div>
      <div class="step-body">
        <div class="step-title">决定先手 <em>仅第一轮</em></div>
        <p>各投两枚骰，最高者先手；并列则重投。也可约定年龄最小者先手。</p>
      </div>
    </div>
    <div class="step compact">
      <div class="step-no">②</div>
      <div class="step-body">
        <div class="step-title">准备阶段 <em>每轮开始</em></div>
        <p><b>资源卡</b>按解锁提示放置；<b>事件牌</b> 1–6 格各 1 张不可重复；<b>功能/建筑牌</b>按解锁提示放置不可重复（重复则弃置重翻）。</p>
      </div>
    </div>
    <div class="step compact">
      <div class="step-no">③</div>
      <div class="step-body">
        <div class="step-title">生产阶段</div>
        <p>上轮最后完成生产者开始，轮流：投骰 → 选一点数将该点数全部骰放入对应格（或跳过）→ 下一位，直至用完。</p>
        <div class="sub-note"><b>跳过 2 选 1：</b>① 爆 1 骰换任选 1 资源；② 弃 2 张资源卡可不爆骰跳过。<b>交易：</b>自己回合（生产/建造）随时可与任意玩家交易！（你可以在放骰子前小小地威胁一下）</div>
      </div>
    </div>
    <div class="step compact">
      <div class="step-no">④</div>
      <div class="step-body">
        <div class="step-title">生产结算</div>
        <p><b>前置</b>雇佣军效果 → <b>抵消</b>同格同效力互抵（强化 1.5 / 普通 1）→ <b>分发</b>第一名大份、第二名小份。</p>
      </div>
    </div>
    <div class="step compact">
      <div class="step-no">⑤</div>
      <div class="step-body">
        <div class="step-title">弃牌阶段</div>
        <p>资源/建筑/功能卡超上限则弃置；再处理「囚徒困境」弃牌（若有）。</p>
      </div>
    </div>
    <div class="step compact" style="margin-bottom:1.6mm;">
      <div class="step-no">⑥</div>
      <div class="step-body">
        <div class="step-title">建造阶段</div>
        <p>先结算已建生产建筑产出。再由本轮最先完成生产者开始，任意顺序：建造建筑 / 发动功能卡 / 常驻功能。全员完成后进入下轮准备。</p>
      </div>
    </div>
`, 4));

// P5 permanent actions
pages.push(page('p5', '常驻功能', `
    <div class="sec-h">
      <span class="sec-no">五</span><span class="t">常驻功能</span>
      <span class="rule"></span><span class="cnt">建造阶段 · 5 项</span>
    </div>
    <div class="actions">
      <div class="act">
        <div class="nm">建造房子 <span class="bdg">限 1 次 / 回合</span></div>
        <div class="row"><span class="k">消耗</span><span>2 木 · 2 石 · 1 铁</span></div>
        <div class="row"><span class="k">效果</span><span>房子 +1、+1 胜利分</span></div>
        <div class="row"><span class="k">注</span><span>每间房子容纳 2 名村民</span></div>
      </div>
      <div class="act">
        <div class="nm">繁殖村民 <span class="bdg">限 1 次 / 回合</span></div>
        <div class="row"><span class="k">消耗</span><span>等于当前村民数的小麦</span></div>
        <div class="row"><span class="k">效果</span><span>村民 +1（上限 15）</span></div>
        <div class="row"><span class="k">条件</span><span>需至少 1 个住房空位</span></div>
      </div>
      <div class="act">
        <div class="nm">购买功能卡 <span class="bdg any">不限次数</span></div>
        <div class="row"><span class="k">消耗</span><span>1 木 · 1 石 · 1 小麦 · 1 铁</span></div>
        <div class="row"><span class="k">效果</span><span>从合堆顶抽 3 张，选 1 保留</span></div>
      </div>
      <div class="act">
        <div class="nm">扩建 <span class="bdg any">不限次数</span></div>
        <div class="row"><span class="k">消耗</span><span>1 木 · 1 石</span></div>
        <div class="row"><span class="k">效果</span><span>三选一：建筑格 / 功能卡格 / 资源卡位</span></div>
      </div>
      <div class="act span2">
        <div class="nm">集市兑换 <span class="bdg alw">建造阶段可用</span></div>
        <div class="row"><span class="k">默认银行</span><span>任意资源 3:1</span></div>
        <div class="row"><span class="k">比例</span><span>1 座集市 → 2:1　｜　≥2 座集市 → 1:1</span></div>
        <div class="row"><span class="k">注</span><span>兑换比例最多 1:1</span></div>
      </div>
    </div>
`, 5));

// P6–P8 function cards
pages.push(page('p6', '功能卡效果', `
    <div class="sec-h">
      <span class="sec-no">六</span><span class="t">功能卡效果</span>
      <span class="rule"></span><span class="cnt">1/3</span>
    </div>
    <div class="legend">
      <span><span class="sw" style="background:var(--red);"></span>生产阶段发动</span>
      <span><span class="sw" style="background:var(--green);"></span>建造阶段发动</span>
    </div>
    <div class="fc-grid">
${fc('丰收', '丰收', '建造', '任选 3 个资源获得。')}
${fc('遥控骰子', '遥控骰子', '生产', '可无视投掷结果，转而选择任意数量的投掷派遣到任意板块上')}
${fc('驱逐', '驱逐', '生产', '将任意板块的 1 枚骰子<b>派遣</b>到另一板块。')}
${fc('强化', '强化', '建造', '<b>强化</b> 1 枚未强化骰子（最多 5 枚）。', '强化骰结算计 1.5')}
    </div>
`, 6));

pages.push(page('p7', '功能卡效果', `
    <div class="sec-h">
      <span class="sec-no">六</span><span class="t">功能卡效果</span>
      <span class="rule"></span><span class="cnt">续 · 2/3</span>
    </div>
    <div class="fc-grid">
${fc('征召', '征召', '建造', '下一轮生产阶段<b>临时</b>村民 +2，生产结束后消失。')}
${fc('重抽', '重抽', '建造', '从功能卡堆顶抽 3 张选 1 保留，其余弃入弃牌堆。', '获取后若超出手牌上限须先弃置')}
${fc('强盗来袭', '强盗来袭', '生产', '在任意板块放置至多 2 枚中立骰。', '不可分开两个板块放置')}
${fc('福利房', '福利房', '建造', '获得 1 间免费房子<br>仅+2人口上限，<b>不加胜利点数</b>')}
    </div>
`, 7));

pages.push(page('p8', '功能卡效果', `
    <div class="sec-h">
      <span class="sec-no">六</span><span class="t">功能卡效果</span>
      <span class="rule"></span><span class="cnt">续 · 3/3</span>
    </div>
    <div class="fc-grid">
${fc('收留', '收留', '建造', '立即获得 1 名村民（不消耗小麦）。', '<b>无住房空位则不可用</b>')}
${fc('商队来临', '商队来临', '建造', '本回合可 1:1 兑换；<br>已建 ≥2 座集市额外 +1 分。')}
${fc('抢劫', '抢劫', '建造', '二选一：<br>① 选一名有资源卡的玩家，随机夺取最多 2 张；<br>② 选一名有未建造卡 / 功能卡的玩家，<b>由其</b>选择 1 张交给你。')}
${fc('拆迁', '拆迁', '建造', '选一名有已建造建筑的玩家发动，<b>由其</b>选择一座变为未建造。', '分数立即消失；未建造独占一格，若爆牌须弃 1 张。')}
    </div>
`, 8));

// P9 production buildings（造价取 decks.js 贫档工坊 / 许愿井）
pages.push(page('p9', '建筑卡 · 生产', `
    <div class="sec-h">
      <span class="sec-no">七</span><span class="t">建筑卡</span>
      <span class="rule"></span><span class="cnt">生产建筑</span>
    </div>
    <div class="remind tight" style="margin-bottom:2mm;">
      <span class="rk">叠放</span>
      <span>未建造建筑不可叠加；已建造的相同建筑可叠加。</span>
    </div>
    <div class="sec-h" style="margin-bottom:1.8mm;">
      <span class="t" style="font-size:3.4mm;">生产建筑</span>
      <span class="rule"></span>
    </div>
    <div class="res-row">
${res('木头工坊', '木头工坊', '产出 1 木 / 轮', '1 石 · 1 铁')}
${res('石头工坊', '石头工坊', '产出 1 石 / 轮', '1 木 · 1 铁')}
${res('小麦工坊', '小麦工坊', '产出 1 小麦 / 轮', '1 木 · 1 石')}
${res('铁矿工坊', '铁矿工坊', '产出 1 铁 / 轮', '1 木 · 1 石 · 1 铁')}
${res('许愿井', '许愿井', '任选 1 资源 / 轮', '1 木 · 1 石 · 1 麦 · 1 铁')}
    </div>
    <div class="remind tight">
      <span class="rk">注</span>
      <div class="rb">
        <p>建造阶段开始时自动产出，不参与弃牌判定。</p>
        <p>同种叠放越多产能越高。<b>（1 / 2 / 3 / 4 座 → 总产量 1 / 3 / 6 / 10）</b></p>
      </div>
    </div>
`, 9));

// P10 special buildings
pages.push(page('p10', '建筑卡 · 特殊', `
    <div class="sec-h">
      <span class="sec-no">七</span><span class="t">建筑卡</span>
      <span class="rule"></span><span class="cnt">特殊建筑</span>
    </div>
    <div class="b-grid">
      <div class="bc">
        <div class="face">${img('宫殿')}</div>
        <div class="bc-body">
          <div class="nm">宫殿（+2）</div>
          <div class="row"><span class="k">造价</span><span>2 木头 · 2 石头 · 1 小麦 · 1 铁矿</span></div>
          <div class="row"><span class="k">效果</span><span>建成即 +2 分</span></div>
          <div class="row"><span class="k">注意</span><span>分数跟随建筑，仅建造状态下得分；被拆迁 / 翻回未建则立刻失去</span></div>
        </div>
      </div>
      <div class="bc">
        <div class="face">${img('学堂')}</div>
        <div class="bc-body">
          <div class="nm">学堂（+1）</div>
          <div class="row"><span class="k">造价</span><span>无需建造（入手即生效）</span></div>
          <div class="row"><span class="k">效果</span><span>获得即 +1 分，并弃入弃牌堆</span></div>
          <div class="row"><span class="k">注意</span><span>不占建筑格，是稳定拿分手段</span></div>
        </div>
      </div>
      <div class="bc">
        <div class="face">${img('集市')}</div>
        <div class="bc-body">
          <div class="nm">集市</div>
          <div class="row"><span class="k">造价</span><span>1 木头 · 1 石头 · 1 小麦</span></div>
          <div class="row"><span class="k">效果</span><span>提升兑换比例：1 座 → 2:1；≥2 座 → 1:1（上限）</span></div>
          <div class="row"><span class="k">联动</span><span>「商队来临」在已建 ≥2 座集市时可额外 +1 分；≥3 座可争夺「商业巨擘」称号</span></div>
        </div>
      </div>
    </div>
    <div class="remind tight" style="margin-top:2.4mm;">
      <span class="rk">称号</span>
      <span>强化军队 / 商业巨擘 / 工坊主：各需对应组件 ≥3，+2 分，更多者可抢。详见速查页。</span>
    </div>
`, 10));

const eventList = [
  ['囚徒困境', '上场+派遣+结算', '上场放 1 中立骰；任意玩家派遣时再放 1 枚；结算后最后一名弃 n 张资源（n = 第一名骰子数）。'],
  ['颗粒无收', '派遣', '成为最大者时改放歉收标记；标记格结算无收获。'],
  ['抵抗南蛮', '结算后', '结算后，还有≥2/3/4个骰子的玩家获得+1胜利点数（从名次高者开始获得）'],
  ['晴空万里', '派遣', '任选与派遣骰子数量相同的资源获得。'],
  ['以身入局', '上场+派遣', '上场放 3 中立骰；派遣时可将派遣骰子数量的中立骰移到任意格。'],
  ['一山不容二虎', '结算', '第二名不获小份，第一名额外获小份。'],
  ['幸运一抽', '上场+结算', '上场暗置功能卡堆顶 1 张；结算后第一名获得。'],
  ['渔翁得利', '派遣+结算', '派遣成为最大者任选 n 资源（n = 归属者数）；结算第三名额外获前两名之和。'],
  ['先到先得', '持续', '1–3 / 4–6 / 7+ 轮抽出 3 / 5 / 7 张暗置随机资源；放满 2 / 3 / 4 村民即获得。'],
  ['低保户', '上场', '分数最低的玩家随机获得 2 / 3 / 4 资源（按轮次）。'],
  ['召回', '派遣', '将场上自己的 1 枚骰子收回手中。<span style="color:var(--ink2);">不可召回本次刚放置的。</span>'],
  ['围魏救赵', '上场+派遣', '上场在周边格各放 1 中立骰；派遣时集中其他中立骰到本格。'],
  ['传送', '派遣', '成为最大者可将任意骰子传送到任意有板块的格。<span style="color:var(--ink2);">仅传送自己的骰时触发目标格派遣事件。</span>'],
  ['吃不了兜着走', '上场+结算', '上场暗置 2 资源；结算后第一名跳过弃牌并获得。'],
  ['雇佣军', '生产判定前', '上场放 2 雇佣骰；全员放置后唯一第一名投掷并放置。'],
];

// P11–P14 events：与功能卡同尺寸卡面，一行一张，每页 4 张
const eventChunks = [
  eventList.slice(0, 4),
  eventList.slice(4, 8),
  eventList.slice(8, 12),
  eventList.slice(12, 15),
];
eventChunks.forEach((chunk, i) => {
  const pageNo = 11 + i;
  const cntLabel = i === 0 ? '1/4' : `续 · ${i + 1}/4`;
  const outro = i === eventChunks.length - 1 ? `
    <div class="remind tight" style="margin-top:2mm;">
      <span class="rk">规则</span>
      <span>每轮向 1–6 号格各放 1 张事件牌，不可重复。除「先到先得」外，派遣效果须在自己回合且落下的是自己的骰。同名不可同时上场。</span>
    </div>` : '';
  pages.push(page(`p${pageNo}`, '事件卡', `
    <div class="sec-h">
      <span class="sec-no">八</span><span class="t">事件卡</span>
      <span class="rule"></span><span class="cnt">${cntLabel}</span>
    </div>
    <div class="ec-grid">
${chunk.map(([n, t, e]) => ec(n, n, t, e)).join('\n')}
    </div>${outro}
`, pageNo));
});

// P15 quick ref
pages.push(page('p15', '关键规则速查', `
    <div class="sec-h">
      <span class="sec-no">九</span><span class="t">关键规则速查</span>
      <span class="rule"></span><span class="cnt">速查表</span>
    </div>
    <table class="qk">
      <tr><th>获胜分数</th><td>各自为战 10 分 ／ 2v2 队伍合计 15 分</td></tr>
      <tr><th>强化骰上限</th><td>5 枚（开局自带 1 枚）　｜　效力 1.5（普通骰为 1）</td></tr>
      <tr><th>村民上限</th><td>15 人　｜　住房容量：每间 2 人</td></tr>
      <tr><th>资源上限初始</th><td>8（每次扩建资源卡位 +2）</td></tr>
      <tr><th>建筑格 / 功能卡上限</th><td>初始均为 2</td></tr>
      <tr><th>建造房子</th><td>2 木 2 石 1 铁 ／ 限 1 次 / 回合</td></tr>
      <tr><th>繁殖村民</th><td>消耗 = 当前村民数小麦 ／ 限 1 次 / 回合</td></tr>
      <tr><th>购买功能卡</th><td>1 木 1 石 1 麦 1 铁</td></tr>
      <tr><th>扩建</th><td>1 木 1 石 ／ 不限次数</td></tr>
      <tr><th>称号「强化军队」</th><td>强化村民 ≥3，+2 分（更多者可抢）</td></tr>
      <tr><th>称号「商业巨擘」</th><td>集市 ≥3，+2 分（更多者可抢）</td></tr>
      <tr><th>称号「工坊主」</th><td>工坊 + 许愿井 ≥3，+2 分（更多者可抢）</td></tr>
      <tr><th>学堂</th><td>入手即 +1 分，免费，不占格</td></tr>
      <tr><th>宫殿分数</th><td>跟随建筑，拆迁 / 未建后失去</td></tr>
      <tr><th>暗置牌</th><td>取得后仅获得者（及队友）可见，建造后公开</td></tr>
      <tr><th>交易</th><td>自己回合（生产/建造）任意时候可与任意玩家交易</td></tr>
    </table>
`, 15));

// P16 装饰底页（凑满 4 的倍数）
pages.push(page('p16', 'END', `
    <div class="decor-main">
      <div class="decor-mark">卡拉斯坦</div>
      <div class="decor-line"></div>
      <div class="decor-sub">C A R A S T A N</div>
      <div class="cover-emble" style="margin:4mm 0 0;">
        <svg width="180" height="78" viewBox="0 0 400 176" aria-hidden="true">
          <rect x="34" y="86" width="62" height="62" rx="9" fill="#fbf6ea" stroke="#8a6426" stroke-width="7" opacity=".55"/>
          <g fill="none" stroke="#8a6426" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity=".55">
            <rect x="160" y="52" width="80" height="96" rx="6"/>
            <path d="M176 148 v-32 q0-20 24-20 t24 20 v32"/>
          </g>
          <rect x="304" y="86" width="62" height="62" rx="9" fill="#fbf6ea" stroke="#8a6426" stroke-width="7" opacity=".55"/>
        </svg>
      </div>
    </div>
`, 16, 16, 'decor'));

const imgPayload = JSON.stringify(uriByAlt);
const imgLoader = `
<!-- ===== 卡面图片数据（折叠区：单行 JSON，不插入正文） ===== -->
<script type="application/json" id="card-images">${imgPayload}</script>
<script>
(function () {
  var map = JSON.parse(document.getElementById('card-images').textContent);
  document.querySelectorAll('img[data-card]').forEach(function (el) {
    var src = map[el.getAttribute('data-card')];
    if (src) el.src = src;
  });
})();
</script>
`;

function saddleOrder(n) {
  const out = [];
  for (let s = 0; s < n / 4; s++) {
    out.push(n - 2 * s, 1 + 2 * s, 2 + 2 * s, n - 1 - 2 * s);
  }
  return out;
}
const imposed = saddleOrder(pages.length).map((n) => pages[n - 1]);
const screenOrderCss = pages.map((_, i) => `#p${i + 1}{order:${i + 1};}`).join('');
css = css.replace(
  '@media print{',
  `/* saddle-screen-order */\n@media screen{\n  ${screenOrderCss}\n}\n@media print{`
);
css = css.replace(
  '游戏说明书（16 页 A5 · A4 合订打印版）',
  '游戏说明书（16 页 A5 · A4 骑马订拼版）'
);
const out = css + imposed.join('\n\n') + '\n\n</div>\n' + imgLoader + '</body>\n</html>\n';
fs.writeFileSync(outPath, out, 'utf8');
console.log('written', outPath);
console.log('pages', pages.length);
console.log('size MB', (Buffer.byteLength(out, 'utf8') / 1024 / 1024).toFixed(2));
