/**
 * PR 小跟班 2D 精灵(P2):手绘扁平 SVG,四种情绪由训练状态驱动。
 * 圆滚滚的小跑者:红发带 + 大眼,worried 带汗滴、cheering 举手 + 星星。
 * 后续若换成美术精灵图/建模,只需替换本组件,面板与 renderManifest 契约不动。
 */

export type CompanionMood = 'happy' | 'worried' | 'cheering' | 'neutral'

export function PersonaCompanion({ mood, size = 56 }: { mood: CompanionMood; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={`PR 小跟班(${mood})`}
      className="drop-shadow-sm"
    >
      {mood === 'cheering' && (
        <>
          <path d="M10 30 Q4 24 8 18" stroke="#7c6af7" strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M54 30 Q60 24 56 18" stroke="#7c6af7" strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M6 12 l2 4 4 1 -4 2 -1 4 -2 -4 -4 -1 4 -2 z" fill="#f0b429" />
        </>
      )}
      {mood !== 'cheering' && (
        <>
          <path d="M12 40 Q6 44 8 50" stroke="#7c6af7" strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M52 40 Q58 44 56 50" stroke="#7c6af7" strokeWidth="5" strokeLinecap="round" fill="none" />
        </>
      )}

      <ellipse cx="32" cy="36" rx="22" ry="21" fill="#8b7cf8" />
      <ellipse cx="32" cy="41" rx="13" ry="10" fill="#efeaff" />
      <path d="M11 30 Q32 20 53 30 L53 26 Q32 16 11 26 Z" fill="#e2493b" />

      {mood === 'worried' ? (
        <>
          <path d="M22 30 q3 -3 6 -1" stroke="#2c2a3a" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <path d="M42 30 q-3 -3 -6 -1" stroke="#2c2a3a" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <path d="M25 40 q7 -4 14 0" stroke="#2c2a3a" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <path d="M50 22 q4 5 0 8 q-4 -3 0 -8" fill="#7dc4f0" />
        </>
      ) : (
        <>
          <circle cx="25" cy="32" r="3" fill="#2c2a3a" />
          <circle cx="39" cy="32" r="3" fill="#2c2a3a" />
          <circle cx="26.2" cy="30.8" r="1" fill="#fff" />
          <circle cx="40.2" cy="30.8" r="1" fill="#fff" />
          {mood === 'neutral' ? (
            <path d="M27 41 h10" stroke="#2c2a3a" strokeWidth="2.4" strokeLinecap="round" />
          ) : (
            <path d={mood === 'cheering' ? 'M25 39 q7 8 14 0' : 'M26 40 q6 5 12 0'} stroke="#2c2a3a" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          )}
          <circle cx="19" cy="38" r="2.6" fill="#f3a5b4" opacity="0.85" />
          <circle cx="45" cy="38" r="2.6" fill="#f3a5b4" opacity="0.85" />
        </>
      )}

      <ellipse cx="24" cy="58" rx="6" ry="3.4" fill="#e2493b" />
      <ellipse cx="40" cy="58" rx="6" ry="3.4" fill="#e2493b" />
    </svg>
  )
}
