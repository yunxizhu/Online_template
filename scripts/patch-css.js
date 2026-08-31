const fs=require('fs');
const base='c:/Users/Galaxy/OneDrive/桌面/lianji/Online_template';

function patchStyle(rel){
  const path=base+'/'+rel;
  let css=fs.readFileSync(path,'utf8');
  const eol=css.includes('\r\n')?'\r\n':'\n';

  // Modify .las-playfield to single column
  css=css.replace(
    /\.las-playfield\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:[^}]*\}/,
    `.las-playfield { display: block; /* restructured: me-panel moved to top bar */ }`
  );

  const appendStyles=fs.readFileSync(base+'/scripts/styles.txt','utf8');
  css=css+appendStyles;
  fs.writeFileSync(path, css, 'utf8');
  console.log('patched css', rel);
}

patchStyle('mobile/www/games/lasidao/style.css');
patchStyle('public/games/lasidao/style.css');
