// Presentation only: no snapshots, tokens, actor knowledge or Runtime mutations.
const fs = require('node:fs/promises');
const path = require('node:path');

function sanitize(value) {
  if (!value || value.version !== 1) return null;
  const finite = (n, bound) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= bound;
  if (!value.camera || !finite(value.camera.x, 100000) || !finite(value.camera.y, 100000) ||
      !finite(value.camera.zoom, 3) || value.camera.zoom < 0.15 || !Array.isArray(value.places) || value.places.length > 1000) return null;
  if (!value.places.every(p => p && typeof p.id === 'string' && p.id.length <= 200 && finite(p.x,100000) && finite(p.y,100000))) return null;
  return { version:1, camera:{x:value.camera.x,y:value.camera.y,zoom:value.camera.zoom},
    places:value.places.map(p => ({id:p.id,x:p.x,y:p.y})) };
}

class ViewerPreferences {
  constructor(directory) { this.file=path.join(directory,'runtime-viewer-layouts.json'); this.queue=Promise.resolve(); }
  async operation(key, value) {
    // Serialize reads/writes too: a late read cannot resurrect the previous layout.
    const run=this.queue.catch(()=>{}).then(async()=>{
      let records={};
      try { records=JSON.parse(await fs.readFile(this.file,'utf8')); } catch(error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      if (!records || typeof records !== 'object' || Array.isArray(records)) records={};
      if (value === undefined) return sanitize(records[key]);
      const clean=sanitize(value);
      if (!clean) throw new Error('Invalid viewer layout');
      // Bound the local cache; these are preferences, never an authority/history archive.
      delete records[key]; records[key]=clean;
      const bounded=Object.fromEntries(Object.entries(records).slice(-128));
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      await fs.writeFile(this.file+'.tmp',JSON.stringify(bounded),'utf8');
      await fs.rename(this.file+'.tmp',this.file);
      return clean;
    });
    this.queue=run; return run;
  }
}
module.exports={ViewerPreferences,sanitize};
