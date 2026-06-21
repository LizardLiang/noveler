import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { aiApi, ipcOn } from '@/lib/ipc';
import type { TestStyle, TestChunkPayload, TestScenarioDonePayload, TestErrorPayload } from '@/types/ipc';

// ===== Presets =====
interface WorldPreset {
  id: string;
  name: string;
  worldview: string;
  characterSettings: string;
}

const BUILTIN_DOUPO: WorldPreset = {
  id: 'builtin-doupo',
  name: '鬥破蒼穹',
  worldview:
    '鬥氣大陸，以鬥氣為尊。修煉者吞噬天地能量錘鍊鬥氣，境界由低至高為：鬥之氣、鬥者、鬥師、大鬥師、鬥靈、鬥王、鬥皇、鬥宗、鬥尊、鬥聖、鬥帝。\n' +
    '「異火榜」記載天地間的奇火，可助煉藥與戰鬥；煉藥師（煉丹）地位崇高。大陸勢力交織：各大家族、雲嵐宗等宗門、丹塔、以及神祕而強大的魂殿。\n' +
    '主角蕭炎自天才墜為廢柴，後得戒中神祕老者藥老相助，靠刻苦修煉與機緣重新崛起。基調為熱血成長、逆境翻身。',
  characterSettings:
    '蕭炎：主角。曾為天才卻淪為廢物，性格堅韌、重情義、好強不服輸；持有藥老所贈的儲物戒指。\n' +
    '藥塵（藥老）：戒中靈魂，曾是大陸頂尖煉藥師「藥尊者」，亦師亦友，沉穩睿智、偶爾毒舌。\n' +
    '薰兒：神祕少女，身世不凡，溫柔卻深藏實力，與蕭炎自幼有婚約。\n' +
    '納蘭嫣然：雲嵐宗天才弟子，高傲，曾退婚羞辱蕭炎，是其奮起的動力之一。\n' +
    '美杜莎女王：蛇人族女王，強大高傲，與蕭炎由敵對漸生糾葛。',
};

const PRESETS_KEY = 'noveler.testStoryPresets';
const LAST_KEY = 'noveler.testStoryLast';

function loadCustomPresets(): WorldPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WorldPreset[]) : [];
  } catch {
    return [];
  }
}

// ===== Writing-style option groups (values are the literal Chinese strings sent to the model) =====
// 文風 (genre) options MUST match the directive keys in aiHandlers.ts (TEST_GENRE_DIRECTIVES).
const STYLE_GROUPS: { key: keyof TestStyle; label: string; options: string[] }[] = [
  { key: 'genre', label: '文風／類型', options: ['網文爽文', '輕鬆網文', '熱血戰鬥流', '古風仙俠', '嚴肅文學'] },
  { key: 'perspective', label: '敘事視角', options: ['第一人稱', '第三人稱限知', '第三人稱全知'] },
  { key: 'tone', label: '語氣', options: ['熱血', '沉穩', '輕鬆詼諧', '黑暗', '戲劇張力'] },
  { key: 'detailLevel', label: '描寫細膩度', options: ['簡潔', '適中', '細膩'] },
  { key: 'languageStyle', label: '語言風格', options: ['口語', '正式', '文學'] },
];

const DEFAULT_STYLE: TestStyle = {
  genre: '網文爽文',
  perspective: '第三人稱限知',
  tone: '熱血',
  detailLevel: '適中',
  languageStyle: '口語',
  nsfw: false,
};

const SCENARIO_TITLES = ['① 早期事件', '② 中期事件', '③ 高潮／後期事件'];

type ScenarioStatus = 'idle' | 'streaming' | 'done' | 'error';
interface ScenarioResult {
  text: string;
  status: ScenarioStatus;
  error?: string;
}

function emptyResults(): ScenarioResult[] {
  return SCENARIO_TITLES.map(() => ({ text: '', status: 'idle' as ScenarioStatus }));
}

function OptionButton({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) {
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

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-secondary)',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  lineHeight: 1.6,
  outline: 'none',
  resize: 'vertical',
  fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
  display: 'block',
  marginBottom: 6,
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function TestStoryGeneratorModal({ open, onClose }: Props) {
  const [customPresets, setCustomPresets] = useState<WorldPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(BUILTIN_DOUPO.id);
  const [worldview, setWorldview] = useState(BUILTIN_DOUPO.worldview);
  const [characterSettings, setCharacterSettings] = useState(BUILTIN_DOUPO.characterSettings);
  const [guidance, setGuidance] = useState('');
  const [style, setStyle] = useState<TestStyle>(DEFAULT_STYLE);
  const [results, setResults] = useState<ScenarioResult[]>(emptyResults);
  const [generating, setGenerating] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // generating flag for cleanup-time cancel
  const generatingRef = useRef(false);
  useEffect(() => { generatingRef.current = generating; }, [generating]);

  // Restore presets + last form on first open
  useEffect(() => {
    if (!open) return;
    setCustomPresets(loadCustomPresets());
    try {
      const raw = localStorage.getItem(LAST_KEY);
      if (raw) {
        const last = JSON.parse(raw) as Partial<{ worldview: string; characterSettings: string; guidance: string; style: TestStyle }>;
        if (typeof last.worldview === 'string') setWorldview(last.worldview);
        if (typeof last.characterSettings === 'string') setCharacterSettings(last.characterSettings);
        if (typeof last.guidance === 'string') setGuidance(last.guidance);
        if (last.style) setStyle({ ...DEFAULT_STYLE, ...last.style });
      }
    } catch { /* ignore */ }
  }, [open]);

  // Stream listeners (active while modal open)
  useEffect(() => {
    if (!open) return;
    const offChunk = ipcOn<TestChunkPayload>('ai:testGenerate:chunk', (_e, data) => {
      setResults(prev => prev.map((r, idx) =>
        idx === data.scenarioIndex ? { ...r, text: r.text + data.delta, status: 'streaming' } : r,
      ));
    });
    const offScenarioDone = ipcOn<TestScenarioDonePayload>('ai:testGenerate:scenarioDone', (_e, data) => {
      setResults(prev => prev.map((r, idx) =>
        idx === data.scenarioIndex ? { ...r, status: 'done' } : r,
      ));
    });
    const offDone = ipcOn<unknown>('ai:testGenerate:done', () => {
      setGenerating(false);
    });
    const offError = ipcOn<TestErrorPayload>('ai:testGenerate:error', (_e, data) => {
      if (typeof data.scenarioIndex === 'number') {
        setResults(prev => prev.map((r, idx) =>
          idx === data.scenarioIndex ? { ...r, status: 'error', error: data.error.message } : r,
        ));
      } else {
        setGlobalError(data.error.message);
      }
      setGenerating(false);
    });
    return () => { offChunk(); offScenarioDone(); offDone(); offError(); };
  }, [open]);

  // Cancel any in-flight run if the modal unmounts
  useEffect(() => {
    return () => { if (generatingRef.current) aiApi.testGenerateCancel(); };
  }, []);

  const handleSelectPreset = useCallback((id: string) => {
    setSelectedPresetId(id);
    const preset = id === BUILTIN_DOUPO.id ? BUILTIN_DOUPO : customPresets.find(p => p.id === id);
    if (preset) {
      setWorldview(preset.worldview);
      setCharacterSettings(preset.characterSettings);
    }
  }, [customPresets]);

  const handleSaveAsPreset = useCallback(() => {
    const name = window.prompt('為這組世界觀命名：', '');
    if (!name || !name.trim()) return;
    const preset: WorldPreset = {
      id: `custom-${name.trim()}-${customPresets.length}`,
      name: name.trim(),
      worldview,
      characterSettings,
    };
    const next = [...customPresets, preset];
    setCustomPresets(next);
    setSelectedPresetId(preset.id);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, [customPresets, worldview, characterSettings]);

  const handleDeletePreset = useCallback(() => {
    if (selectedPresetId === BUILTIN_DOUPO.id) return;
    const next = customPresets.filter(p => p.id !== selectedPresetId);
    setCustomPresets(next);
    setSelectedPresetId(BUILTIN_DOUPO.id);
    setWorldview(BUILTIN_DOUPO.worldview);
    setCharacterSettings(BUILTIN_DOUPO.characterSettings);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, [customPresets, selectedPresetId]);

  const handleGenerate = useCallback(async () => {
    if (generating) return;
    setGlobalError(null);
    setResults(emptyResults());
    setGenerating(true);
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ worldview, characterSettings, guidance, style }));
    } catch { /* ignore */ }
    const result = await aiApi.testGenerate({ worldview, characterSettings, guidance, style });
    if (!result.success) {
      setGlobalError(result.error.message);
      setGenerating(false);
    }
  }, [generating, worldview, characterSettings, guidance, style]);

  const handleCancel = useCallback(() => {
    aiApi.testGenerateCancel();
    setGenerating(false);
  }, []);

  if (!open) return null;

  const isBuiltinSelected = selectedPresetId === BUILTIN_DOUPO.id;

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
        onClick={() => { if (!generating) onClose(); }}
      />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(calc(100vw - 2rem), 820px)',
          maxHeight: 'calc(100vh - 3rem)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg, 16px)',
          boxShadow: '0 24px 60px -20px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text-primary)' }}>測試寫作效果</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              以目前啟用的 AI 供應商，產生三個不同時間點的故事片段作為寫作參考
            </p>
          </div>
          <button
            onClick={() => { if (!generating) onClose(); }}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)', cursor: generating ? 'not-allowed' : 'pointer', fontSize: 20, lineHeight: 1, padding: 4 }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflow: 'hidden auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Preset selector */}
          <div>
            <label style={labelStyle}>測試用世界觀</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={selectedPresetId}
                onChange={e => handleSelectPreset(e.target.value)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-primary)',
                  fontSize: 13,
                  outline: 'none',
                }}
              >
                <option value={BUILTIN_DOUPO.id}>{BUILTIN_DOUPO.name}（內建）</option>
                {customPresets.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button onClick={handleSaveAsPreset} style={smallBtnStyle}>另存為預設</button>
              <button
                onClick={handleDeletePreset}
                disabled={isBuiltinSelected}
                style={{ ...smallBtnStyle, opacity: isBuiltinSelected ? 0.4 : 1, cursor: isBuiltinSelected ? 'not-allowed' : 'pointer' }}
              >
                刪除此預設
              </button>
            </div>
          </div>

          {/* Worldview */}
          <div>
            <label style={labelStyle}>世界觀背景</label>
            <textarea value={worldview} onChange={e => setWorldview(e.target.value)} rows={5} style={textareaStyle} placeholder="描述世界觀、力量體系、勢力與基調..." />
          </div>

          {/* Characters */}
          <div>
            <label style={labelStyle}>角色設定</label>
            <textarea value={characterSettings} onChange={e => setCharacterSettings(e.target.value)} rows={5} style={textareaStyle} placeholder="列出主要角色的性格、關係與背景..." />
          </div>

          {/* Writing style */}
          <div>
            <label style={labelStyle}>寫作風格</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {STYLE_GROUPS.map(group => (
                <div key={group.key}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>{group.label}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {group.options.map(opt => (
                      <OptionButton
                        key={opt}
                        selected={style[group.key] === opt}
                        onClick={() => setStyle(prev => ({ ...prev, [group.key]: opt }))}
                        label={opt}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* NSFW / 成人內容 toggle — off by default */}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!style.nsfw}
                onChange={e => setStyle(prev => ({ ...prev, nsfw: e.target.checked }))}
                style={{ marginTop: 2, cursor: 'pointer' }}
              />
              <span>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>成人內容（NSFW）</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  開啟後允許 AI 書寫露骨的成人／性愛內容，用於測試成人向作品的寫作效果。
                </span>
              </span>
            </label>
          </div>

          {/* Guidance */}
          <div>
            <label style={labelStyle}>引導提示詞（可選）</label>
            <textarea value={guidance} onChange={e => setGuidance(e.target.value)} rows={2} style={textareaStyle} placeholder="例如：聚焦在主角的內心掙扎、加入一場戰鬥場面..." />
          </div>

          {globalError && (
            <div style={{ fontSize: 13, color: 'var(--color-error)', padding: '8px 12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
              {globalError}
            </div>
          )}

          {/* Results */}
          {results.some(r => r.status !== 'idle') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {results.map((r, idx) => (
                <div
                  key={idx}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-bg-secondary)',
                    padding: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{SCENARIO_TITLES[idx]}</span>
                    <span style={{ fontSize: 11, color: r.status === 'error' ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}>
                      {r.status === 'streaming' ? '產生中…' : r.status === 'done' ? '完成' : r.status === 'error' ? `錯誤：${r.error ?? ''}` : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {r.text || (r.status === 'idle' ? '' : '…')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--color-border)' }}>
          {generating ? (
            <button onClick={handleCancel} style={{ ...primaryBtnStyle, background: 'var(--color-error)' }}>取消產生</button>
          ) : (
            <>
              <button onClick={onClose} style={ghostBtnStyle}>關閉</button>
              <button onClick={handleGenerate} style={primaryBtnStyle}>產生測試故事</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const smallBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontSize: 13,
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontSize: 14,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 'var(--radius-md)',
  border: 'none',
  background: 'var(--color-accent)',
  color: 'white',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
};
