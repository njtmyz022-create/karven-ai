import {existsSync,mkdirSync,readdirSync,readFileSync,statSync,writeFileSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';

function replaceRequired(path,from,to){
 const source=readFileSync(path,'utf8');
 if(!source.includes(from))throw new Error(`Expected upstream branding text was not found in ${path}`);
 writeFileSync(path,source.replaceAll(from,to));
}

function removeRequired(path,value){
 const source=readFileSync(path,'utf8');
 if(!source.includes(value))throw new Error(`Expected upstream asset route was not found in ${path}`);
 writeFileSync(path,source.replaceAll(value,''));
}

function replaceVisibleBranding(directory){
 for(const name of readdirSync(directory)){
  const path=join(directory,name);
  if(statSync(path).isDirectory()){replaceVisibleBranding(path);continue;}
  if(!/\.(?:ts|tsx|html|svg)$/.test(name))continue;
  const source=readFileSync(path,'utf8');
  const branded=source.replaceAll('Cline Hub','KARVIN AI').replaceAll('https://github.com/cline/cline/issues/new','https://github.com/njtmyz022-create/karven-ai/issues/new');
  if(branded!==source)writeFileSync(path,branded);
 }
}

export function rebrandClineHub(sourceDir){
 const root=resolve(sourceDir),webview=join(root,'apps/cline-hub/src/webview'),app=join(webview,'src/App.tsx');
 if(!existsSync(app))throw new Error(`Cline Hub source was not found at ${root}`);
 replaceRequired(join(webview,'index.html'),'<title>Cline Hub</title>','<title>KARVIN AI</title>');
 replaceRequired(app,'Cline Hub','KARVIN AI');
 replaceRequired(app,'src="/cline-logo-filled.svg"','src="/karvin-mark.svg"');
 replaceRequired(app,'https://github.com/cline/cline/issues/new','https://github.com/njtmyz022-create/karven-ai/issues/new');
 replaceRequired(join(webview,'src/vscode.ts'),'Cline Hub server','KARVIN AI service');
 replaceRequired(join(root,'apps/cline-hub/src/server/http.ts'),'Cline Hub webview is not built. Run `bun run build:webview` from apps/cline-hub.','KARVIN AI interface is not built. Run scripts/build-ide.sh before starting the platform.');
 const server=join(root,'apps/cline-hub/src/server.ts');
 for(const asset of ['\t"/icon.png",\n','\t"/icon.ico",\n','\t"/32x32.png",\n','\t"/cline-logo-filled.svg",\n'])removeRequired(server,asset);
 replaceRequired(server,'Cline Hub dashboard','KARVIN AI workspace');
 replaceVisibleBranding(webview);
 const mark=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#6cae68" d="M32 3 61 32 32 61 3 32z"/><path fill="#f4f7ef" d="M32 17 47 32 32 47 17 32z"/><path fill="#17352d" d="M32 25 39 32 32 39 25 32z"/></svg>\n`;
 const publicDir=join(webview,'public');mkdirSync(publicDir,{recursive:true});
 for(const name of ['karvin-mark.svg','favicon.svg','icon.svg'])writeFileSync(join(publicDir,name),mark);
 for(const name of ['cline-logo-filled.svg','icon.png','icon.ico','32x32.png']){const oldAsset=join(publicDir,name);if(existsSync(oldAsset))unlinkSync(oldAsset);}
 return {sourceDir:root,brand:'KARVIN AI'};
}

if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href){
 const root=process.argv[2];
 if(!root)throw new Error('Usage: node scripts/rebrand-cline-hub.mjs <Cline source directory>');
 rebrandClineHub(root);
}
