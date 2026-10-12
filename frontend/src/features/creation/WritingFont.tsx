import { useState } from 'react';

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
