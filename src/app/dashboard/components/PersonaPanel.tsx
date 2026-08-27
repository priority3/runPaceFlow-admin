'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Frown, Meh, PartyPopper, RefreshCw, Smile } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * 数字分身面板:three.js + VRM 渲染用户分身,周围浮动「已生效记忆」tag 气泡,
 * PR 小跟班以 2D 徽章形态陪同(P5 再建模)。
 * 数据源:GET /api/persona(读 pr-agent 投影进共享库的 persona_state,本面板零业务判断)。
 * 设计:pr-agent/claudedocs/persona-avatar-design.md
 */

interface PersonaTrait {
  key: string
  value: unknown
  confidence: number
  source: { kind: string; refId?: string }
}
interface PersonaTag {
  id: string
  type: string
  label: string
  content: string
  confidence: number
}
interface PersonaPayload {
  traits: PersonaTrait[]
  renderManifest: {
    user: { model: string; scale: number; expression: 'neutral' | 'happy' | 'tired'; props: string[] }
    companion: { sprite: 'happy' | 'worried' | 'cheering' | 'neutral'; bubble: string | null }
    tags: PersonaTag[]
  }
  updatedAt: string
}

/** 模型变体 → 静态资源;变体文件缺失时 loadVrm 内回落 base。 */
const MODEL_FILES: Record<string, string> = {
  base: '/persona/avatar-c.vrm',
  'body-slim': '/persona/avatar-c-slim.vrm',
  'body-strong': '/persona/avatar-c-strong.vrm',
}

const TAG_TYPE_CLASS: Record<string, string> = {
  injury: 'border-amber-300 bg-amber-50 text-amber-800',
  correction: 'border-rose-300 bg-rose-50 text-rose-800',
  goal: 'border-sky-300 bg-sky-50 text-sky-800',
  habit: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  risk_pattern: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  preference: 'border-violet-300 bg-violet-50 text-violet-800',
  relationship_note: 'border-violet-300 bg-violet-50 text-violet-800',
}
const TAG_TYPE_LABEL: Record<string, string> = {
  injury: '伤病',
  correction: '纠正',
  goal: '目标',
  habit: '习惯',
  risk_pattern: '风险',
  preference: '偏好',
  relationship_note: '关系',
}

/** 气泡槽位:左右交替、错落分布,最多 10 个(与投影端 tags 上限一致)。 */
const TAG_SLOTS: Array<React.CSSProperties> = [
  { top: '6%', left: '2%' },
  { top: '12%', right: '2%' },
  { top: '28%', left: '1%' },
  { top: '34%', right: '1%' },
  { top: '50%', left: '2%' },
  { top: '56%', right: '2%' },
  { top: '70%', left: '4%' },
  { top: '74%', right: '4%' },
  { top: '86%', left: '8%' },
  { top: '88%', right: '8%' },
]

const COMPANION_ICON = { happy: Smile, worried: Frown, cheering: PartyPopper, neutral: Meh } as const

function traitValue(traits: PersonaTrait[], key: string): unknown {
  return traits.find(t => t.key === key)?.value
}

/** 底部身体档案 chips:只显示已有的特征,缺省不占位。 */
function buildChips(traits: PersonaTrait[]): string[] {
  const chips: string[] = []
  const height = Number(traitValue(traits, 'body.height_cm'))
  if (Number.isFinite(height) && height > 0) chips.push(`身高 ${height}cm`)
  const weight = Number(traitValue(traits, 'body.weight_kg'))
  if (Number.isFinite(weight) && weight > 0) chips.push(`体重 ${weight}kg`)
  const build = String(traitValue(traits, 'body.build') ?? '')
  if (build) chips.push(`体型 ${{ slim: '偏瘦', standard: '标准', strong: '健壮' }[build] ?? build}`)
  const recovery = String(traitValue(traits, 'state.recovery') ?? '')
  if (recovery) chips.push(`恢复 ${{ good: '良好', okay: '一般', poor: '偏差' }[recovery] ?? recovery}`)
  const load = String(traitValue(traits, 'state.training_load') ?? '')
  if (load) chips.push(`训练 ${{ idle: '休整中', recovering: '恢复中', steady: '稳定', high: '高负荷' }[load] ?? load}`)
  return chips
}

export function PersonaPanel({ onOpenPr }: { onOpenPr?: () => void }) {
  const [data, setData] = useState<PersonaPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<PersonaTag | null>(null)
  const [modelStatus, setModelStatus] = useState('模型加载中…')

  const mountRef = useRef<HTMLDivElement>(null)
  // three 对象经动态 import 获得,类型在卸载/应用回调间穿梭,统一收进一个 ref 包。
  const sceneRef = useRef<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vrm: any
    applyManifest: (user: PersonaPayload['renderManifest']['user']) => void
    dispose: () => void
  } | null>(null)

  const fetchPersona = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/persona', { cache: 'no-store' })
      const json = await res.json()
      setData((json.persona as PersonaPayload) ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchPersona()
  }, [fetchPersona])

  // three.js 场景:挂载时初始化一次;persona 数据到达/变化时经 applyManifest 应用外观。
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let cancelled = false
    let cleanup: (() => void) | null = null

    const init = async () => {
      // Reason: three + three-vrm 合计 ~700KB,动态 import 让它只随本面板加载,不进 dashboard 首包。
      const [THREE, { OrbitControls }, { GLTFLoader }, { VRMLoaderPlugin, VRMUtils }] = await Promise.all([
        import('three'),
        import('three/examples/jsm/controls/OrbitControls.js'),
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('@pixiv/three-vrm'),
      ])
      if (cancelled) return

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(30, mount.clientWidth / mount.clientHeight, 0.1, 30)
      camera.position.set(0, 1.25, 2.9)
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
      mount.appendChild(renderer.domElement)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.set(0, 0.95, 0)
      controls.enableDamping = true
      controls.minDistance = 1.6
      controls.maxDistance = 4.5
      controls.maxPolarAngle = Math.PI / 1.9

      scene.add(new THREE.AmbientLight(0xffffff, 0.95))
      const sun = new THREE.DirectionalLight(0xffffff, 1.5)
      sun.position.set(1, 2, 2)
      scene.add(sun)
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(1.05, 48),
        new THREE.MeshBasicMaterial({ color: 0xe9e7e1 }),
      )
      disc.rotation.x = -Math.PI / 2
      scene.add(disc)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let vrm: any = null

      const setBone = (name: string, z: number) => {
        const node = vrm?.humanoid?.getNormalizedBoneNode(name)
        if (node) node.rotation.set(0, 0, z)
      }
      const applyRelaxedPose = () => {
        setBone('leftUpperArm', 1.15)
        setBone('rightUpperArm', -1.15)
        setBone('leftLowerArm', 0.18)
        setBone('rightLowerArm', -0.18)
      }

      const loadVrm = async (url: string) => {
        const loader = new GLTFLoader()
        loader.register(parser => new VRMLoaderPlugin(parser))
        const gltf = await loader.loadAsync(url, e => {
          if (e.total) setModelStatus(`模型加载中 ${Math.round((e.loaded / e.total) * 100)}%`)
        })
        return gltf.userData.vrm
      }

      const applyManifest = (user: PersonaPayload['renderManifest']['user']) => {
        if (!vrm) return
        vrm.scene.scale.setScalar(user.scale || 1)
        const manager = vrm.expressionManager
        if (manager) {
          try {
            manager.setValue('happy', user.expression === 'happy' ? 0.6 : 0)
            manager.setValue('sad', user.expression === 'tired' ? 0.35 : 0)
          } catch {
            /* 模型缺该表情通道则忽略 */
          }
        }
      }

      try {
        const model = data?.renderManifest.user.model ?? 'base'
        const url = MODEL_FILES[model] ?? MODEL_FILES.base
        try {
          vrm = await loadVrm(url)
        } catch {
          // 变体文件尚未制作 → 回落 base(renderManifest 契约允许前端降级)。
          if (url !== MODEL_FILES.base) vrm = await loadVrm(MODEL_FILES.base)
          else throw new Error('模型加载失败')
        }
        if (cancelled) {
          VRMUtils.deepDispose(vrm.scene)
          return
        }
        VRMUtils.rotateVRM0(vrm)
        scene.add(vrm.scene)
        applyRelaxedPose()
        setModelStatus('')
      } catch (e) {
        setModelStatus(`模型加载失败:${e instanceof Error ? e.message : '未知错误'}`)
      }

      sceneRef.current = {
        vrm,
        applyManifest,
        dispose: () => {
          if (vrm) VRMUtils.deepDispose(vrm.scene)
          renderer.dispose()
          renderer.domElement.remove()
        },
      }
      if (data) applyManifest(data.renderManifest.user)

      const clock = new THREE.Clock()
      renderer.setAnimationLoop(() => {
        const dt = clock.getDelta()
        const t = clock.elapsedTime
        if (vrm) {
          vrm.update(dt)
          // 待机呼吸 + 周期眨眼(P2 换 VRMA 动画)。
          const chest = vrm.humanoid?.getNormalizedBoneNode('chest')
          if (chest) chest.rotation.x = Math.sin(t * 1.6) * 0.015
          try {
            vrm.expressionManager?.setValue('blink', Math.max(0, 1 - Math.abs((t % 4.4) - 0.12) * 18))
          } catch {
            /* ignore */
          }
        }
        controls.update()
        renderer.render(scene, camera)
      })

      const resize = () => {
        camera.aspect = mount.clientWidth / mount.clientHeight
        camera.updateProjectionMatrix()
        renderer.setSize(mount.clientWidth, mount.clientHeight)
      }
      const observer = new ResizeObserver(resize)
      observer.observe(mount)

      cleanup = () => {
        observer.disconnect()
        renderer.setAnimationLoop(null)
        sceneRef.current?.dispose()
        sceneRef.current = null
      }
    }

    void init().catch(e => setModelStatus(`3D 初始化失败:${e instanceof Error ? e.message : '未知错误'}`))
    return () => {
      cancelled = true
      cleanup?.()
    }
    // Reason: 场景只随挂载建一次;数据变化走下面的 applyManifest effect,避免整场景重建闪烁。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (data) sceneRef.current?.applyManifest(data.renderManifest.user)
  }, [data])

  const manifest = data?.renderManifest
  const CompanionIcon = COMPANION_ICON[manifest?.companion.sprite ?? 'neutral']
  const chips = data ? buildChips(data.traits) : []

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">数字分身</h2>
          <p className="text-muted-foreground text-xs mt-1">
            由 PR 已生效的记忆与身体数据投影而成
            {data ? ` · 更新于 ${new Date(data.updatedAt).toLocaleString('zh-CN')}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={fetchPersona}
          disabled={loading}
          className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          刷新
        </button>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          数据加载失败:{error}
        </div>
      )}

      {!loading && !error && !data && (
        <div className="bg-card text-muted-foreground rounded-lg border p-8 text-center text-sm shadow-sm">
          还没有分身投影。pr-agent 升级到含 persona 的版本并完成一次投影后,这里就会出现你的数字分身;
          也可对 pr-agent 调用 <code className="bg-muted rounded px-1">POST /api/pr/persona/reproject</code> 手动生成。
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="bg-card relative overflow-hidden rounded-lg border shadow-sm" style={{ height: 560 }}>
          <div ref={mountRef} className="absolute inset-0" />

          {modelStatus && (
            <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
              {modelStatus}
            </div>
          )}

          {manifest?.tags.map((tag, index) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => setSelected(tag)}
              style={TAG_SLOTS[index] ?? TAG_SLOTS[TAG_SLOTS.length - 1]}
              className={cn(
                'absolute animate-pulse-none rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition-transform hover:scale-105',
                TAG_TYPE_CLASS[tag.type] ?? 'border-slate-300 bg-slate-50 text-slate-700',
                selected?.id === tag.id && 'ring-2 ring-offset-1 ring-slate-400',
              )}
            >
              {tag.label}
            </button>
          ))}

          {manifest && (
            <div className="absolute right-3 bottom-3 flex items-end gap-2">
              {manifest.companion.bubble && (
                <div className="bg-background/95 text-muted-foreground max-w-[180px] rounded-lg rounded-br-sm border px-3 py-2 text-xs leading-relaxed shadow-sm">
                  {manifest.companion.bubble}
                </div>
              )}
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-violet-300 bg-violet-100 text-violet-700 shadow-sm"
                title="PR 小跟班"
              >
                <CompanionIcon className="h-6 w-6" />
              </div>
            </div>
          )}

          {chips.length > 0 && (
            <div className="absolute bottom-3 left-3 flex max-w-[70%] flex-wrap gap-1.5">
              {chips.map(chip => (
                <span key={chip} className="bg-background/95 text-muted-foreground rounded-full border px-2.5 py-1 text-xs shadow-sm">
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card rounded-lg border p-4 shadow-sm">
          {selected ? (
            <div className="space-y-3">
              <span
                className={cn(
                  'inline-block rounded border px-1.5 py-0.5 text-xs',
                  TAG_TYPE_CLASS[selected.type] ?? 'border-slate-300 bg-slate-50 text-slate-700',
                )}
              >
                {TAG_TYPE_LABEL[selected.type] ?? selected.type}
              </span>
              <p className="text-sm leading-relaxed">{selected.content}</p>
              <p className="text-muted-foreground text-xs">置信 {selected.confidence.toFixed(2)} · 已生效记忆</p>
              <button
                type="button"
                onClick={onOpenPr}
                className="w-full rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                去 PR 伙伴面板管理
              </button>
            </div>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              点击人物周围的气泡
              <br />
              查看这条记忆的详情
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
