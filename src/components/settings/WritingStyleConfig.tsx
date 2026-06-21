import { useState, useEffect, useCallback } from 'react';
import { projectSettingsApi } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';

// 文風／類型值必須對應後端 aiHandlers.ts 的 GENRE_DIRECTIVES key。
export type Genre = '網文爽文' | '輕鬆網文' | '熱血戰鬥流' | '古風仙俠' | '嚴肅文學';

export interface WritingStyle {
  genre: Genre;
  perspective: 'first_person' | 'third_limited' | 'third_omniscient';
  tone: 'serious' | 'humorous' | 'dramatic' | 'poetic' | 'neutral';
  detailLevel: 'concise' | 'moderate' | 'elaborate';
  languageStyle: 'formal' | 'casual' | 'literary';
  /** 成人內容模式：開啟後後端注入 NSFW 授權指令。預設關閉，不影響既有專案。 */
  nsfw?: boolean;
}

const DEFAULT_STYLE: WritingStyle = {
  genre: '網文爽文',
  perspective: 'third_limited',
  tone: 'neutral',
  detailLevel: 'moderate',
  languageStyle: 'literary',
  nsfw: false,
};

interface OptionButtonProps {
  selected: boolean;
  onClick: () => void;
  label: string;
}

function OptionButton({ selected, onClick, label }: OptionButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: selected ? 'var(--color-accent-subtle)' : 'transparent',
        color: selected ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: selected ? 500 : 400,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

interface WritingStyleConfigProps {
  projectId: string;
}

export function WritingStyleConfig({ projectId }: WritingStyleConfigProps) {
  const [style, setStyle] = useState<WritingStyle>(DEFAULT_STYLE);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    projectSettingsApi.get(projectId, 'writing_style').then(result => {
      if (result.success && result.data) {
        const parsed = typeof result.data === 'object' && result.data !== null
          ? result.data as WritingStyle
          : DEFAULT_STYLE;
        setStyle({ ...DEFAULT_STYLE, ...parsed });
      }
      setLoading(false);
    });
  }, [projectId]);

  const handleChange = useCallback(
    <K extends keyof WritingStyle>(key: K, value: WritingStyle[K]) => {
      setStyle(prev => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    await projectSettingsApi.set(projectId, 'writing_style', style);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [projectId, style]);

  if (loading) {
    return <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>載入中...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {zhTW.writingStyle.title}
        </label>
        <button
          onClick={handleSave}
          style={{
            padding: '5px 12px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: saved ? 'var(--color-success)' : 'var(--color-accent)',
            color: 'white',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {saved ? '已儲存' : zhTW.systemPrompt.save}
        </button>
      </div>

      {/* Genre / 文風 — the strongest lever for web-novel vs literary tone */}
      <div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
          {zhTW.writingStyle.genre}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {([
            ['網文爽文', zhTW.writingStyle.genreWebNovel],
            ['輕鬆網文', zhTW.writingStyle.genreLightNovel],
            ['熱血戰鬥流', zhTW.writingStyle.genreBattle],
            ['古風仙俠', zhTW.writingStyle.genreXianxia],
            ['嚴肅文學', zhTW.writingStyle.genreLiterary],
          ] as const).map(([val, label]) => (
            <OptionButton
              key={val}
              selected={style.genre === val}
              onClick={() => handleChange('genre', val)}
              label={label}
            />
          ))}
        </div>
      </div>

      {/* Perspective */}
      <div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
          {zhTW.writingStyle.perspective}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <OptionButton
            selected={style.perspective === 'first_person'}
            onClick={() => handleChange('perspective', 'first_person')}
            label={zhTW.writingStyle.perspectiveFirst}
          />
          <OptionButton
            selected={style.perspective === 'third_limited'}
            onClick={() => handleChange('perspective', 'third_limited')}
            label={zhTW.writingStyle.perspectiveThirdLimited}
          />
          <OptionButton
            selected={style.perspective === 'third_omniscient'}
            onClick={() => handleChange('perspective', 'third_omniscient')}
            label={zhTW.writingStyle.perspectiveThirdOmniscient}
          />
        </div>
      </div>

      {/* Tone */}
      <div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
          {zhTW.writingStyle.tone}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {([
            ['serious', zhTW.writingStyle.toneSerious],
            ['humorous', zhTW.writingStyle.toneHumorous],
            ['dramatic', zhTW.writingStyle.toneDramatic],
            ['poetic', zhTW.writingStyle.tonePoetic],
          ] as const).map(([val, label]) => (
            <OptionButton
              key={val}
              selected={style.tone === val}
              onClick={() => handleChange('tone', val)}
              label={label}
            />
          ))}
        </div>
      </div>

      {/* Detail level */}
      <div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
          {zhTW.writingStyle.detailLevel}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {([
            ['concise', zhTW.writingStyle.detailConcise],
            ['moderate', zhTW.writingStyle.detailModerate],
            ['elaborate', zhTW.writingStyle.detailElaborate],
          ] as const).map(([val, label]) => (
            <OptionButton
              key={val}
              selected={style.detailLevel === val}
              onClick={() => handleChange('detailLevel', val)}
              label={label}
            />
          ))}
        </div>
      </div>

      {/* Language style */}
      <div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
          {zhTW.writingStyle.languageStyle}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {([
            ['formal', zhTW.writingStyle.langFormal],
            ['casual', zhTW.writingStyle.langCasual],
            ['literary', zhTW.writingStyle.langLiterary],
          ] as const).map(([val, label]) => (
            <OptionButton
              key={val}
              selected={style.languageStyle === val}
              onClick={() => handleChange('languageStyle', val)}
              label={label}
            />
          ))}
        </div>
      </div>

      {/* NSFW / 成人內容 — off by default, never injected unless explicitly enabled */}
      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!style.nsfw}
            onChange={e => handleChange('nsfw', e.target.checked)}
            style={{ marginTop: 2, cursor: 'pointer' }}
          />
          <span>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
              {zhTW.writingStyle.nsfw}
            </span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
              {zhTW.writingStyle.nsfwHint}
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
