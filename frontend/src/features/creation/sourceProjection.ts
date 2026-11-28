import type { Node } from '@tiptap/pm/model';

// Match the persisted plain-text projection, including nested list separators.
function sourceSegments(doc: Node) {
  const segments: {from:number;to:number;start:number;end:number;value:string}[] = [];
  let length = 0;
  function walk(node:Node, pos:number) {
    if (node.isText || node.type.name==='hardBreak') {
      const value = node.isText ? node.text! : '\n';
      const start = length;
      length += Array.from(value).length;
      segments.push({from:pos,to:pos+node.nodeSize,start,end:length,value});
      return;
    }
    const separator = ['paragraph','heading','codeBlock'].includes(node.type.name) ? '' : '\n';
    node.forEach((child,offset,index)=>{
      if(index)length += separator.length;
      walk(child, pos + (node.type.name==='doc' ? 0 : 1) + offset);
    });
  }
  walk(doc,0);
  return segments;
}

export function sourceSelection(doc:Node, from:number, to:number) {
  const selected=sourceSegments(doc).filter(s=>s.from<to&&s.to>from);
  if(!selected.length)return undefined;
  const first=selected[0], last=selected[selected.length-1];
  const start=first.start+Array.from(first.value.slice(0,Math.max(0,from-first.from))).length;
  const end=last.start+Array.from(last.value.slice(0,to-last.from)).length;
  return end>start ? {start,end} : undefined;
}

export function sourcePositions(doc: Node, start: number, end: number) {
  if (start >= end) return undefined;
  const segments = sourceSegments(doc);
  const first = segments.find(part => part.start <= start && start < part.end);
  const last = segments.find(part => part.start < end && end <= part.end);
  if (!first || !last) return undefined;
  return {
    from: first.from + Array.from(first.value).slice(0, start - first.start).join('').length,
    to: last.from + Array.from(last.value).slice(0, end - last.start).join('').length,
  };
}
