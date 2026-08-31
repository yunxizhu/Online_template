const fs=require('fs');
const base='c:/Users/Galaxy/OneDrive/桌面/lianji/Online_template';

function patchPanel(rel){
  const path=base+'/'+rel;
  let c=fs.readFileSync(path,'utf8');
  const eol=c.includes('\r\n')?'\r\n':'\n';
  let lines=c.split(/\r?\n/);
  const topBar=fs.readFileSync(base+'/scripts/topbar.txt','utf8').trimEnd();
  const newPlay=fs.readFileSync(base+'/scripts/playfield.txt','utf8').trimEnd();
  let out=[lines.slice(0,2).join(eol), topBar, lines.slice(7,249).join(eol), newPlay, lines.slice(367).join(eol)].join(eol);
  fs.writeFileSync(path, out, 'utf8');
  console.log('patched panel', rel);
}

patchPanel('mobile/www/games/lasidao/panel.html');
patchPanel('public/games/lasidao/panel.html');
