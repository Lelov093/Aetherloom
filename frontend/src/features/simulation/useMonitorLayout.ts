import {useEffect,useState,useRef,type PointerEvent} from 'react';
const defaults={log:true,inspector:true,left:238,right:300};
export function useMonitorLayout(){
 const [stored,setStored]=useState<typeof defaults>(()=>{try{return {...defaults,...JSON.parse(localStorage.getItem('aetherloom:monitor-layout')||'{}')}}catch{return defaults}});
 const [narrow,setNarrow]=useState(()=>window.matchMedia('(max-width:1100px)').matches);
 const [drawer,setDrawer]=useState<'log'|'inspector'>();
 const drag=useRef<{x:number;width:number;side:'left'|'right'}|undefined>(undefined);
 useEffect(()=>{const mq=window.matchMedia('(max-width:1100px)');const change=()=>{setNarrow(mq.matches);setDrawer(undefined)};mq.addEventListener('change',change);return()=>mq.removeEventListener('change',change)},[]);
 useEffect(()=>{try{localStorage.setItem('aetherloom:monitor-layout',JSON.stringify(stored))}catch{}},[stored]);
 const layout={...stored,log:narrow?drawer==='log':stored.log,inspector:narrow?drawer==='inspector':stored.inspector};
 function set(next:Partial<typeof defaults>){
  if(narrow){if(next.log)setDrawer('log');else if(next.inspector)setDrawer('inspector');else if(next.log===false||next.inspector===false)setDrawer(undefined);const {left,right}=next;if(left!==undefined||right!==undefined)setStored(old=>({...old,...(left!==undefined?{left}:{}),...(right!==undefined?{right}:{})}));}
  else setStored(old=>({...old,...next}));
 }
 function resize(side:'left'|'right',value:number){setStored(old=>({...old,[side]:Math.min(side==='left'?340:400,Math.max(side==='left'?200:260,value))}))}
 function start(side:'left'|'right',e:PointerEvent<HTMLButtonElement>){e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,width:layout[side],side}}
 function move(e:PointerEvent<HTMLButtonElement>){if(drag.current){const {side,x,width}=drag.current;resize(side,width+(e.clientX-x)*(side==='left'?1:-1))}}
 return {layout,set,narrow,resize,start,move,end:()=>{drag.current=undefined}};
}
