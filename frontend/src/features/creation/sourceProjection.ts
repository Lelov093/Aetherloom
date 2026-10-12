import type { Node } from '@tiptap/pm/model';

// Match the persisted plain-text projection, including nested list separators.
export function sourceSelection(doc:Node, from:number, to:number) {
  const segments: {from:number;to:number;start:number;end:number}[] = [];
  let length = 0;
  function walk(node:Node, pos:number) {
    if (node.isText || node.type.name==='hardBreak') {
      const value = node.isText ? node.text! : '\n';
      const start = length;
      length += Array.from(value).length;
      segments.push({from:pos,to:pos+node.nodeSize,start,end:length});
      return;
    }
    const separator = ['paragraph','heading','codeBlock'].includes(node.type.name) ? '' : '\n';
    node.forEach((child,offset,index)=>{
      if(index)length += separator.length;
      walk(child, pos + (node.type.name==='doc' ? 0 : 1) + offset);
    });
  }
  walk(doc,0);
  const selected=segments.filter(s=>s.from<to&&s.to>from);
  if(!selected.length)return undefined;
  const first=selected[0], last=selected[selected.length-1];
  const start=first.start+Array.from(doc.textBetween(first.from,Math.max(first.from,from),'')).length;
  const end=last.end-Array.from(doc.textBetween(Math.min(last.to,to),last.to,'')).length;
  return end>start ? {start,end} : undefined;
}
