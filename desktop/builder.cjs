const path=require('node:path');
const root=path.resolve(__dirname,'..');
const base=require('../engines/melee/desktop/package.json').build;
module.exports={...base,
 appId:'fun.smash.opensmash',productName:'OpenSmash',
 extraMetadata:{productName:'OpenSmash',opensmashSharedLauncher:true},
 directories:{...base.directories,output:path.join(root,'build/desktop-artifacts')},
 artifactName:'OpenSmash-${version}-${os}-${arch}.${ext}',
 dmg:{...base.dmg,title:'OpenSmash ${version}'},
 nsis:{...base.nsis,artifactName:'OpenSmash-${version}-win-${arch}-Setup.${ext}'},
};
