const path=require('node:path');
const root=path.resolve(__dirname,'..');
const base=require('../engines/melee/desktop/package.json').build;
module.exports={...base,
 appId:'fun.smash.opensmash',productName:'OpenSmash',
 extraMetadata:{productName:'OpenSmash',opensmashSharedLauncher:true},
 directories:{...base.directories,output:path.join(root,'build/desktop-artifacts')},
 artifactName:'OpenSmash-${version}-${os}-${arch}.${ext}',
 extraResources:[...base.extraResources,
  {from:path.join(root,'web-prototype/dist'),to:'shared-web'},
  {from:path.join(root,'desktop'),to:'launcher',filter:['site.cjs','window-policy.cjs','input.cjs']},
  {from:path.join(root,'engines/ssb64/desktop'),to:'ssb64-service',filter:['service.cjs']},
  {from:path.join(root,'build/desktop-ssb64'),to:'ssb64'},
 ],
 dmg:{...base.dmg,title:'OpenSmash ${version}'},
 nsis:{...base.nsis,artifactName:'OpenSmash-${version}-win-${arch}-Setup.${ext}'},
};
