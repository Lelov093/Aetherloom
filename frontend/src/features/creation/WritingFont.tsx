import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button, Dialog } from '../../components/ui';

const fonts = {
  default: { label: '默认衬线', family: 'var(--font-writing)' },
  song: { label: '宋体', family: '"SimSun", "Noto Serif SC", serif' },
  sans: { label: '无衬线', family: '"Microsoft YaHei", "Noto Sans SC", sans-serif' },
  kai: { label: '楷体', family: '"KaiTi", "STKaiti", "SimSun", serif' },
};
type Font = keyof typeof fonts;
const storageKey = 'aetherloom:writing-font';

export function useWritingFont() {
  const [font, setFont] = useState<Font>(() => {
    try { const value = localStorage.getItem(storageKey); return value && value in fonts ? value as Font : 'default'; }
    catch { return 'default'; }
  });
  function choose(value: Font) {
    setFont(value);
    try { localStorage.setItem(storageKey, value); } catch { /* Still usable for this session. */ }
  }
  return { font, family: fonts[font].family, choose };
}

export function WritingFont({ font, choose }: { font: Font; choose: (value: Font) => void }) {
  return <label className="writing-font">阅读字体<select aria-label="正文阅读字体" value={font} onChange={event => choose(event.target.value as Font)}>
    {Object.entries(fonts).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
  </select></label>;
}

const sizes = [16, 18, 20, 22] as const;
const spacings = [1.7, 1.95, 2.2] as const;
export function useReadingLayout() {
  const [layout, setLayout] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('aetherloom:reading-layout') || '{}');
      return {size: sizes.includes(saved.size) ? Number(saved.size) : 18,
        spacing: spacings.includes(saved.spacing) ? Number(saved.spacing) : 1.95};
    } catch { return {size: 18, spacing: 1.95}; }
  });
  function chooseLayout(value: typeof layout) {
    setLayout(value);
    try { localStorage.setItem('aetherloom:reading-layout', JSON.stringify(value)); } catch { /* This session remains usable. */ }
  }
  return {layout, chooseLayout};
}

export function ReadingSettings({font, choose, layout, chooseLayout}: ReturnType<typeof useWritingFont> & ReturnType<typeof useReadingLayout>) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" aria-label="阅读设置" onClick={() => setOpen(true)}><SlidersHorizontal size={16}/><span>排版</span></Button>
    {open && <Dialog title="阅读设置" onClose={() => setOpen(false)}>
      <p className="dialog-intro">选择适合你的文字节奏。设置保存在本机，不修改资料内容。</p>
      <WritingFont font={font} choose={choose}/>
      <div className="reading-setting"><span>字号</span><div role="group" aria-label="正文字号">{sizes.map(size => <Button key={size} aria-pressed={layout.size === size} onClick={() => chooseLayout({...layout, size})}>{size}</Button>)}</div></div>
      <div className="reading-setting"><span>行距</span><div role="group" aria-label="正文行距">{spacings.map((spacing,i) => <Button key={spacing} aria-pressed={layout.spacing === spacing} onClick={() => chooseLayout({...layout, spacing})}>{['紧凑','舒适','宽松'][i]}</Button>)}</div></div>
      <p className="reading-setting-preview" style={{fontFamily:fonts[font].family,fontSize:layout.size,lineHeight:layout.spacing}}>给文字一点空间，<br/>让故事缓缓展开。</p>
      <div className="dialog-actions"><Button onClick={() => {choose('default');chooseLayout({size:18,spacing:1.95});}}>恢复默认</Button><Button variant="primary" onClick={() => setOpen(false)}>完成</Button></div>
    </Dialog>}
  </>;
}
