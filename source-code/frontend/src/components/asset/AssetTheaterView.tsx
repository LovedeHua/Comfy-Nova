/**
 * 资产影院模式
 *
 * 取代原来的详情弹窗：中间是舞台（图片/视频原样展示），右侧是提示词与元信息，
 * 底部轨道展示筛选后的全部资产，点击即切换。左右方向键翻页，Esc 退出。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Grid, useGridRef, type CellComponentProps } from 'react-window'
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ChevronRight,
  Copy,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PanelTopClose,
  PanelTopOpen,
  Star,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAssetStore } from '@/stores/useAssetStore'
import { useChromeStore, type ChromeRegion } from '@/stores/useChromeStore'
import { useElementSize } from '@/hooks/useElementSize'
import { useImageZoomPan } from '@/hooks/useImageZoomPan'
import { AssetInfoPanel } from './AssetInfoPanel'
import type { AssetInfoPanelProps } from './AssetInfoPanel'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Asset } from '@/mocks/asset'

interface AssetTheaterViewProps {
  asset: Asset
  assets: Asset[]
  categoryPath?: string
  onNavigate: (asset: Asset) => void
  onClose: () => void
  onUpdate: AssetInfoPanelProps['onUpdate']
  onDelete: AssetInfoPanelProps['onDelete']
  onOpenLocation: AssetInfoPanelProps['onOpenLocation']
}

interface StripCellData {
  assets: Asset[]
  activeId: string
  onNavigate: (asset: Asset) => void
  /** 拖动结束时为真：本次 click 不应切换资产 */
  shouldSuppressClick: () => boolean
}

const STRIP_GAP = 6

/** 胶片条容器高度（可拖动调整，持久化到 localStorage） */
const STRIP_BAR_MIN = 60
const STRIP_BAR_MAX = 240
const STRIP_BAR_DEFAULT = 76
const STRIP_BAR_STORAGE_KEY = 'theater-strip-height'

/** 读取上次保存的胶片条高度，越界值收敛到允许区间 */
function readStoredStripBarHeight(): number {
  const raw = Number(localStorage.getItem(STRIP_BAR_STORAGE_KEY))
  if (!Number.isFinite(raw) || raw <= 0) return STRIP_BAR_DEFAULT
  return Math.min(STRIP_BAR_MAX, Math.max(STRIP_BAR_MIN, raw))
}

const CHROME_REGIONS: ChromeRegion[] = ['nav', 'filter', 'detail']

/** 图标表示"这次点击要做什么"：可见时是收起，收起时是展开 */
const CHROME_ICONS: Record<ChromeRegion, { hide: LucideIcon; show: LucideIcon }> = {
  nav: { hide: PanelLeftClose, show: PanelLeftOpen },
  filter: { hide: PanelTopClose, show: PanelTopOpen },
  detail: { hide: PanelRightClose, show: PanelRightOpen }
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

export function AssetTheaterView({
  asset,
  assets,
  categoryPath,
  onNavigate,
  onClose,
  onUpdate,
  onDelete,
  onOpenLocation
}: AssetTheaterViewProps) {
  const { t } = useTranslation()
  const { exportWorkflow, exportWorkflowToPath, exportToPromptLibrary, toggleFavorite } = useAssetStore()
  const chromeHidden = useChromeStore((state) => state.hidden)
  const toggleChrome = useChromeStore((state) => state.toggle)

  const currentIndex = useMemo(
    () => assets.findIndex((item) => item.id === asset.id),
    [assets, asset.id]
  )
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex >= 0 && currentIndex < assets.length - 1
  const [stripSizeRef, stripSize] = useElementSize<HTMLDivElement>()
  // useElementSize 返回的是回调 ref，读不到 .current；
  // 另存一份真 ref 用于挂滚轮/拖动监听。
  const stripContainerRef = useRef<HTMLDivElement | null>(null)
  const stripRef = useCallback((node: HTMLDivElement | null) => {
    stripContainerRef.current = node
    stripSizeRef(node)
  }, [stripSizeRef])
  const gridRef = useGridRef(null)
  // 原图是否已加载完成：切换资产时必须复位，否则会沿用上一张的 true 导致
  // 新图直接以"已加载"外观出现，实际还在下载。
  const [isFullLoaded, setIsFullLoaded] = useState(false)
  // 悬浮栏收起状态：收起后仅顶部中间留一个鼠标靠近才显现的箭头
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false)
  const [isArrowHover, setIsArrowHover] = useState(false)
  const [scaleLabel, setScaleLabel] = useState(1)
  // 底部胶片条容器高度：可拖动上边缘调整，缩略图按容器高度自适应缩放
  const [stripBarHeight, setStripBarHeight] = useState(readStoredStripBarHeight)
  const [isResizingStrip, setIsResizingStrip] = useState(false)
  const stripResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)

  const {
    transform,
    canPan,
    isPanning,
    reset: resetZoom,
    zoomTo,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    endPan,
    handleDoubleClick
  } = useImageZoomPan({ onScaleChange: setScaleLabel })


  useEffect(() => {
    setIsFullLoaded(false)
    // 切换资产时必须回到适应窗口，否则会沿用上一张的缩放与位移，
    // 看起来像"新图被放大到了奇怪的位置"。
    resetZoom()
  }, [asset.id, resetZoom])


  const goPrev = useCallback(() => {
    if (hasPrev) onNavigate(assets[currentIndex - 1])
  }, [assets, currentIndex, hasPrev, onNavigate])

  const goNext = useCallback(() => {
    if (hasNext) onNavigate(assets[currentIndex + 1])
  }, [assets, currentIndex, hasNext, onNavigate])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 输入框里不拦截，否则在备注/标签里打字会误触发翻页
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return
      if (target?.isContentEditable) return

      switch (event.key) {
        case 'ArrowLeft':
          goPrev()
          break
        case 'ArrowRight':
          goNext()
          break
        // Backspace / Backspace 别名：用户语义里的"后退"，在影院模式下就是退出
        case 'Backspace':
          onClose()
          break
        case 'Escape':
          onClose()
          break
        case '+':
        case '=':
          event.preventDefault()
          zoomTo(transform.scale * 1.25)
          break
        case '-':
        case '_':
          event.preventDefault()
          zoomTo(transform.scale / 1.25)
          break
        case '0':
          event.preventDefault()
          resetZoom()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goPrev, goNext, onClose, zoomTo, resetZoom, transform.scale])

  // 鼠标侧键/浏览器后退：进入影院时压一条 history 占位，后退事件被拦截后
  // 转为关闭影院。否则后退会把整个应用路由弹走，而用户预期只是退出全屏浮层。
    // Radix 弹层（Dialog/Popover）打开时 react-remove-scroll 会把 body 设为
  // pointer-events:none；若弹层未正常卸载（外部受控 open 卡住、异常关闭），
  // body 锁残留，整页点击失效 —— 胶片条"点不动拖不动"的元凶。
  // 影院挂载期间守护：检测到 body 被锁且页面上没有仍打开的 Radix 弹层时，
  // 强制恢复 body 可交互。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const body = document.body
      if (getComputedStyle(body).pointerEvents !== 'none') return
      // 仍有"可见的" Radix 弹层时不抢（那是弹层自己的合法锁）。
      // 判定可见性而非存在性：display:none 的残留 DOM（data-state 仍是 open）
      // 不能算数，否则锁死永不恢复。
      const anyDialogOpen = Array.from(document.querySelectorAll('[role=dialog][data-state=open], [role=alertdialog][data-state=open]'))
        .some(d => (d as HTMLElement).offsetParent !== null || d.getClientRects().length > 0)
      const anyRadixPopup = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'))
        .some(d => (d as HTMLElement).offsetParent !== null || d.getClientRects().length > 0)
      if (anyDialogOpen || anyRadixPopup) return
      body.style.pointerEvents = 'auto'
      document.documentElement.style.pointerEvents = 'auto'
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  // 鼠标侧键/浏览器后退：进入影院时压一条 history 占位，后退事件被拦截后
  // 后退操作被拦下转为关闭影院，避免把整个应用路由弹回资产库外。
  useEffect(() => {
    if (typeof window.history.pushState !== 'function') return
    window.history.pushState({ theater: true }, '')
    const handlePopState = () => onClose()
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      // 组件卸载时若占位还在历史里（用户用 Esc/关闭按钮退出的情形），
      // 后退一格把它消费掉，保证历史栈不残留
      if (window.history.state?.theater) window.history.back()
    }
  }, [onClose])



  // 胶片条的滚轮横向滚动与拖动
  //
  // react-window 的 Grid 自己只处理纵向滚动，而这里是一行横向列表：
  // 滚轮的 deltaY 需要转成横向位移，拖动也没有现成实现。
  // 做法是直接改 Grid 滚动容器的 scrollLeft —— 它是普通 DOM，
  // 比驱动 Grid 的滚动 API 更直接，也不会打断虚拟化。
  const stripScrollRef = useRef<HTMLElement | null>(null)
  const stripDragState = useRef<{ startX: number; startScrollLeft: number; moved: boolean; pointerId: number } | null>(null)
  // 拖动结束时置位，让紧随其后的 click 不触发切换
  const suppressStripClickRef = useRef(false)
  const [isStripDragging, setIsStripDragging] = useState(false)

  useEffect(() => {
    const container = stripContainerRef.current
    if (!container) return

    // Grid 的滚动容器是带 overflow 的那个子节点，取第一个可横向滚动的后代
    const findScroller = (): Element | null => {
      const nodes = container.querySelectorAll<HTMLElement>('*')
      for (const node of nodes) {
        if (node.scrollWidth > node.clientWidth + 1) return node
      }
      return nodes.length ? nodes[nodes.length - 1] : null
    }
    stripScrollRef.current = findScroller() as HTMLElement | null

    const onWheel = (event: WheelEvent) => {
      const scroller = stripScrollRef.current ?? (findScroller() as HTMLElement | null)
      if (!scroller) return
      // 竖向滚轮转横向；已经是横向手势（触控板）就直接用 deltaX
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      event.preventDefault()
      scroller.scrollLeft += delta
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [assets.length])

  /** 找 Grid 的真实滚动容器；带缓存，找不到时重扫（Grid 是延迟渲染的） */
  const resolveStripScroller = useCallback((): HTMLElement | null => {
    if (stripScrollRef.current && stripScrollRef.current.isConnected) return stripScrollRef.current
    const container = stripContainerRef.current
    if (!container) return null
    for (const node of container.querySelectorAll<HTMLElement>('*')) {
      if (node.scrollWidth > node.clientWidth + 1) {
        stripScrollRef.current = node
        return node
      }
    }
    return null
  }, [])

  const handleStripPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // Grid 在条挂载后才渲染，挂载时找不到滚动容器是常态；
    // 按下此刻动态解析，绝不因时序问题把拖动/点击吞掉。
    const scroller = resolveStripScroller()
    if (!scroller) return
    stripDragState.current = {
      startX: event.clientX,
      startScrollLeft: scroller.scrollLeft,
      moved: false,
      pointerId: event.pointerId
    }
    // 这里故意不 setPointerCapture：一旦捕获，浏览器会把后续 click 的 target
    // 改成捕获元素，缩略图按钮的 onClick 全部失效（点击切换就死了）。
    // capture 推迟到 move 里确认是拖动后再执行，纯点击不受影响。
    // 拖动中的鬼拖由 move 里的 buttons===0 兜底处理。
  }, [])

  const handleStripPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = stripDragState.current
    const scroller = stripScrollRef.current
    if (!state || !scroller) return
    // 兜底：某些环境下 capture 会失效（如浏览器扩展拦截）。此时指针滑出容器
    // 期间 buttons 会归零，借它识别"键已经松了"，终止鬼拖。
    if (event.buttons === 0) {
      stripDragState.current = null
      setIsStripDragging(false)
      return
    }
    // 确认进入拖动（位移超阈值）才捕获指针：此后滑出容器 move 仍路由到这里，
    // 松手必收 pointerup。捕获会让 click target 变成本容器，但拖动后本来
    // 就要抑制 click，正好。
    if (state.moved && !event.currentTarget.hasPointerCapture(state.pointerId)) {
      try { event.currentTarget.setPointerCapture(state.pointerId) } catch { /* 元素已卸载 */ }
    }
    const dx = event.clientX - state.startX
    // 超过阈值才算拖动，否则视为点击（否则轻点和拖动会互相吞掉）
    if (Math.abs(dx) > 3) state.moved = true
    if (state.moved) scroller.scrollLeft = state.startScrollLeft - dx
  }, [])

  const handleStripPointerUp = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    const state = stripDragState.current
    if (state && event && event.currentTarget.hasPointerCapture?.(state.pointerId)) {
      try { event.currentTarget.releasePointerCapture(state.pointerId) } catch { /* 已释放则忽略 */ }
    }
    stripDragState.current = null
    setIsStripDragging(false)
    // 拖动结束后标记一下，避免这一下点击被当成"切换资产"
    if (state?.moved) {
      suppressStripClickRef.current = true
      window.setTimeout(() => { suppressStripClickRef.current = false }, 0)
    }
  }, [])

  // 胶片条高度调整：拖动手柄上下移动改变高度，松手落盘，双击复位
  const handleStripResizeDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    stripResizeRef.current = { startY: event.clientY, startHeight: stripBarHeight }
    setIsResizingStrip(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [stripBarHeight])

  const handleStripResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = stripResizeRef.current
    if (!state) return
    event.preventDefault()
    // 往上拖 = 变高，所以用 startY - clientY 的差值
    const next = Math.min(
      STRIP_BAR_MAX,
      Math.max(STRIP_BAR_MIN, state.startHeight + (state.startY - event.clientY))
    )
    setStripBarHeight(next)
  }, [])

  const handleStripResizeUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!stripResizeRef.current) return
    stripResizeRef.current = null
    setIsResizingStrip(false)
    // 落盘：下次进入影院沿用这个高度
    localStorage.setItem(STRIP_BAR_STORAGE_KEY, String(stripBarHeight))
    try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch { /* 忽略 */ }
  }, [stripBarHeight])

  const handleStripResizeReset = useCallback(() => {
    setStripBarHeight(STRIP_BAR_DEFAULT)
    localStorage.setItem(STRIP_BAR_STORAGE_KEY, String(STRIP_BAR_DEFAULT))
  }, [])

  // 预取前后各一张的原图。左右切换时绝大多数情况下都能命中浏览器缓存，
  // 从而把"切换后等解码"挪到"切换时已经解好"。
  // 只预取相邻各一张：再多会同时把多张 4K 图压进内存，反而更吃资源。
  useEffect(() => {
    if (currentIndex < 0) return
    const neighbours = [assets[currentIndex - 1], assets[currentIndex + 1]]
    const images = neighbours
      .filter((item): item is typeof asset => !!item && item.type !== 'video' && !!item.url)
      .map((item) => {
        const img = new Image()
        img.src = item.url as string
        return img
      })
    return () => {
      // 主动断开引用，帮助浏览器尽早回收预取图
      for (const img of images) img.src = ''
    }
  }, [assets, currentIndex])

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('asset.toast.copySuccess'))
    } catch {
      toast.error(t('asset.toast.copyFailed'))
    }
  }, [t])

  const handleExportToWorkflow = useCallback(async () => {
    const result = await exportWorkflow(asset.id)
    if (result.success) {
      toast.success(t('asset.toast.exportSuccess'))
    } else {
      toast.error(t('asset.toast.exportFailed'))
    }
  }, [asset.id, exportWorkflow, t])

  const handleExportToLocal = useCallback(async () => {
    try {
      const saveResult = await window.pywebview.api.save_file_dialog(
        `${asset.filename.replace(/\.[^.]+$/, '')}_workflow.json`,
        'JSON files (*.json)'
      )

      if (saveResult.success && saveResult.path) {
        const result = await exportWorkflowToPath(asset.id, saveResult.path)
        if (result.success) {
          toast.success(t('asset.toast.exportSuccess'))
        } else {
          toast.error(t('asset.toast.exportFailed'))
        }
      }
    } catch {
      toast.error(t('asset.toast.exportFailed'))
    }
  }, [asset.filename, asset.id, exportWorkflowToPath, t])

  const handleImportToPromptLibrary = useCallback(async () => {
    const result = await exportToPromptLibrary(asset.id)
    if (result.success) {
      toast.success(t('asset.toast.importToPromptLibrarySuccess'))
    } else if (result.error_message === 'no_prompt_detected') {
      toast.warning(t('asset.noPromptDetected'))
    } else {
      toast.error(result.error_message || t('asset.toast.importToPromptLibraryFailed'))
    }
  }, [asset.id, exportToPromptLibrary, t])



  // 行高 = 容器高 − 1px 上边框 − 8px 横向滚动条。
  // 滚动条（.scrollbar-thin 固定 8px）会吃掉滚动容器的可用高度；不扣掉的话
  // 格子会被顶出可视区，表现为"缩略图底部显示不全"。
  const STRIP_BORDER = 1
  const STRIP_SCROLLBAR = 8
  const stripRowInnerHeight = Math.max(
    1,
    stripBarHeight - STRIP_BORDER - STRIP_SCROLLBAR
  )

  // 格子边长：行高减去上下 GAP（保持正方形，且与行高同源推导）
  const stripCellSize = useMemo(
    () => Math.max(32, stripRowInnerHeight - STRIP_GAP),
    [stripRowInnerHeight]
  )

  // 轨道跟随当前资产滚动。
  // 关键：只在选中项已经完全移出可视区时才滚动 —— 之前无条件 scrollToCell
  // + columnAlign:'center'，导致每点一张列表都被拉到居中，看起来"位置一直变"。
  useEffect(() => {
    const scroller = stripScrollRef.current
    if (!scroller || currentIndex < 0) return

    const cellW = stripCellSize + STRIP_GAP
    const cellLeft = currentIndex * cellW
    const cellRight = cellLeft + cellW
    const viewLeft = scroller.scrollLeft
    const viewRight = viewLeft + scroller.clientWidth

    // 已在视野内（留一点余量）就不动
    const margin = cellW / 2
    if (cellLeft >= viewLeft - margin && cellRight <= viewRight + margin) return

    // 不可见时最小幅度滚动，把它带到最近的边缘，而不是居中
    const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
    const target =
      cellLeft < viewLeft
        ? cellLeft - STRIP_GAP          // 向左移入
        : cellRight - scroller.clientWidth + STRIP_GAP  // 向右移入
    scroller.scrollLeft = Math.min(Math.max(0, target), maxLeft)
  }, [currentIndex, stripCellSize])

  const stripCellData: StripCellData = useMemo(() => ({
    assets,
    activeId: asset.id,
    onNavigate,
    shouldSuppressClick: () => suppressStripClickRef.current
  }), [assets, asset.id, onNavigate])

  const StripCell = useCallback(({ columnIndex, style }: CellComponentProps<StripCellData>) => {
    const item = stripCellData.assets[columnIndex]
    if (!item) return null

    const isActive = item.id === stripCellData.activeId

    return (
      // 用原生 div 而非 Button：Button 自带 h-9 px-4 py-2，与 size-full 冲突，
      // 选中态切换边框时会把内容挤动，表现为"点击时缩略图大小跳一下"。
      // 外层固定盒子尺寸，选中态用 ring（不占布局）而非 border 宽度变化。
      <div style={{ ...style, padding: STRIP_GAP / 2 }}>
        <div
          role="button"
          title={item.filename}
          onClick={() => {
            if (stripCellData.shouldSuppressClick()) return
            stripCellData.onNavigate(item)
          }}
          className={cn(
            // 不裁剪这一层：ring 向外画，overflow-hidden 会把它切掉。
            // 圆角裁切交给内部 img。
            'box-border size-full cursor-pointer rounded-md bg-surface-active',
            'transition-[box-shadow,opacity,transform] duration-150',
            // 选中态：主色 2px 外环（ring 画在元素外侧，不会被 img 盖住；
            // 用 ring 而非 border，盒子尺寸恒定，点击不位移）+ 轻微提亮
            // 选中环 3px 更醒目；未选中态同宽度透明环占位，
            // 保证两态盒模型完全一致、切换不位移。
            isActive
              ? 'ring-[3px] ring-primary brightness-105'
              : 'ring-[3px] ring-transparent hover:opacity-85 hover:ring-border-strong/70'
          )}
        >
          <img
            src={item.thumbnail}
            alt={item.filename}
            loading="lazy"
            decoding="async"
            draggable={false}
            // object-contain：胶片条格子是正方形，用 cover 会把竖图的上下、
            // 横图的左右裁掉，看起来"图片显示不全"。contain 保证整图可见，
            // 空白处由格子底色填充。
            className="size-full rounded-md bg-black/20 object-contain"
          />
        </div>
      </div>
    )
  }, [stripCellData])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-theater">
      <div className="flex min-h-0 flex-1">
        <div className="group/stage relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-theater">
          {asset.type === 'video' ? (
            <video
              key={asset.id}
              src={asset.url}
              controls
              preload="metadata"
              className="max-h-full max-w-full rounded-lg"
            >
              {t('asset.detail.videoNotSupported')}
            </video>
          ) : (
            /*
             * 舞台：滚轮缩放、按住拖动平移、双击在适应窗口与 2 倍之间切换。
             *
             * 图片分两层渲染：缩略图先铺底（几十 KB，网格里已缓存），原图加载
             * 完成再淡入覆盖，避免每次切换都盯着空白等一张 4K 图解码。
             * 缩放/位移作用在同一个 wrapper 上，两层始终对齐。
             */
            <div
              className={cn(
                // absolute inset-0 而不是 h-full/w-full：父级有 p-6，
                // 用 h-full 会被内边距顶出可视区，导致滚轮锚点整体偏移。
                'absolute inset-0 flex items-center justify-center overflow-hidden',
                canPan ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
              )}
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onDoubleClick={handleDoubleClick}
            >
              {/*
                变换层用 inline-block，尺寸由缩略图撑开（原图 absolute 叠在上面）。
                这样 transform 的原点落在图片自身中心，拖动的视觉位移与鼠标位移
                一致；若用撑满父级的 block，原点会偏离图片中心，拖动会"发飘"。
              */}
              <div
                className="relative inline-block will-change-transform"
                style={{
                  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                  // 拖动时禁用过渡，否则画面会明显滞后于鼠标
                  transition: isPanning ? 'none' : 'transform 80ms ease-out'
                }}
              >
                <img
                  key={`${asset.id}-thumb`}
                  src={asset.thumbnail}
                  alt=""
                  aria-hidden
                  draggable={false}
                  className={cn(
                    'block max-h-[85vh] max-w-[85vw] select-none rounded-lg object-contain transition-opacity duration-150',
                    isFullLoaded ? 'opacity-0' : 'opacity-100'
                  )}
                />
                <img
                  key={`${asset.id}-full`}
                  src={asset.url}
                  alt={asset.filename}
                  draggable={false}
                  decoding="async"
                  onLoad={() => setIsFullLoaded(true)}
                  className={cn(
                    'absolute inset-0 size-full select-none rounded-lg object-contain transition-opacity duration-150',
                    isFullLoaded ? 'opacity-100' : 'opacity-0'
                  )}
                />
              </div>
            </div>
          )}

          {hasPrev && (
            <Button
              variant="outline"
              size="icon"
              onClick={goPrev}
              title={t('common.previous')}
              className="absolute left-3 top-1/2 size-9 -translate-y-1/2 rounded-full bg-surface/50 opacity-0 backdrop-blur-sm transition-opacity duration-200 hover:bg-surface/70 group-hover/stage:opacity-100"
            >
              <ChevronLeft className="size-5" />
            </Button>
          )}

          {hasNext && (
            <Button
              variant="outline"
              size="icon"
              onClick={goNext}
              title={t('common.next')}
              className="absolute right-3 top-1/2 size-9 -translate-y-1/2 rounded-full bg-surface/50 opacity-0 backdrop-blur-sm transition-opacity duration-200 hover:bg-surface/70 group-hover/stage:opacity-100"
            >
              <ChevronRight className="size-5" />
            </Button>
          )}

          {/* 分体工具条：左右两段贴顶，中轴缺口给恒定的切换按钮。
              按钮是容器子元素、absolute 定位到中轴 —— 两段滑出时它不动，
              实现"同一个按钮"在悬浮栏中轴切换样式。 */}
          <div className="absolute left-1/2 top-0 z-20">
          <div
            className={cn(
              'absolute right-4 top-0 flex items-center gap-0.5 rounded-bl-md border-b border-l border-border-subtle bg-surface/50 px-1.5 py-1.5 text-xs transition-colors hover:bg-surface/75',
              'transition-[transform,opacity] duration-200',
              isToolbarCollapsed ? '-translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void toggleFavorite(asset.id)}
              title={t('asset.batchFavorite')}
              className={cn('size-7 rounded-md', asset.isFavorite && 'text-warning')}
            >
              <Star className={cn('size-3.5', asset.isFavorite && 'fill-current')} />
            </Button>

            {asset.type !== 'video' && (
              <>
                <div className="mx-1 h-4 w-px bg-border-subtle" />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => zoomTo(transform.scale / 1.25)}
                  title={t('asset.theater.zoomOut')}
                  className="size-7 rounded-md"
                >
                  <ZoomOut className="size-3.5" />
                </Button>
                <button
                  type="button"
                  onClick={resetZoom}
                  title={t('asset.theater.resetZoom')}
                  className="min-w-[46px] rounded px-1 font-mono tabular-nums text-muted-foreground hover:text-foreground"
                >
                  {Math.round(scaleLabel * 100)}%
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => zoomTo(transform.scale * 1.25)}
                  title={t('asset.theater.zoomIn')}
                  className="size-7 rounded-md"
                >
                  <ZoomIn className="size-3.5" />
                </Button>
              </>
            )}
          </div>
          <div
            className={cn(
              'absolute left-4 top-0 flex items-center gap-0.5 rounded-br-md border-b border-r border-border-subtle bg-surface/50 px-1.5 py-1.5 text-xs transition-colors hover:bg-surface/75',
              'transition-[transform,opacity] duration-200',
              isToolbarCollapsed ? '-translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
            )}
          >
            {/* 不设固定宽度也不许换行：由内容撑开，4720 这类大数字不会折行 */}
            <span className="whitespace-nowrap px-1 text-center font-mono tabular-nums text-muted-foreground">
              {currentIndex + 1} / {assets.length}
            </span>

            <div className="mx-1 h-4 w-px bg-border-subtle" />

            {CHROME_REGIONS.map((region) => {
              const isHidden = chromeHidden[region]
              const Icon = isHidden ? CHROME_ICONS[region].show : CHROME_ICONS[region].hide
              return (
                <Button
                  key={region}
                  variant="ghost"
                  size="icon"
                  onClick={() => toggleChrome(region)}
                  title={`${t(isHidden ? "asset.theater.chrome.show" : "asset.theater.chrome.hide")} ${t(`asset.theater.chrome.${region}`)}`}
                  className={cn(
                    'size-7 rounded-md',
                    isHidden ? 'text-muted-foreground' : 'text-foreground'
                  )}
                >
                  <Icon className="size-3.5" />
                </Button>
              )
            })}

            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              title={t('asset.theater.exitHint')}
              className="size-7 rounded-md"
            >
              <X className="size-3.5" />
            </Button>
          </div>

          {/* 中轴切换按钮：恒定位置（悬浮栏正中），不随两段滑出。
              展开态融入工具条缺口（补齐底色与底边），收起态为独立把手。 */}
          <button
            type="button"
            onClick={() => setIsToolbarCollapsed((v) => !v)}
            aria-label={isToolbarCollapsed ? t('asset.theater.showToolbar') : t('asset.theater.hideToolbar')}
            title={isToolbarCollapsed ? t('asset.theater.showToolbar') : t('asset.theater.hideToolbar')}
            onMouseEnter={() => setIsArrowHover(true)}
            onMouseLeave={() => setIsArrowHover(false)}
            className={cn(
              'group absolute left-1/2 top-0 z-30 flex h-[41px] w-8 -translate-x-1/2 items-center justify-center',
              'pointer-events-auto text-muted-foreground outline-none',
              'transition-[background-color,color,box-shadow,transform] duration-200 ease-out',
              'focus-visible:ring-2 focus-visible:ring-primary/60',
              isToolbarCollapsed
                ? cn(
                    'h-[41px] rounded-b-md border border-x-0 border-t-0 border-border-subtle',
                    // 收起态默认隐形，悬停浮现：底色更实 + 阴影 + 轻微下沉，形成明显的可点反馈
                    isArrowHover
                      ? 'bg-surface text-foreground opacity-100 shadow-[0_4px_12px_-2px_rgba(0,0,0,0.25)]'
                      : 'bg-surface/50 opacity-0'
                  )
                : cn(
                    'border-b border-border-subtle',
                    // 展开态：融入工具条底色，悬停时提亮并透出内阴影，指示可收起
                    isArrowHover
                      ? 'bg-surface text-foreground shadow-[inset_0_-2px_0_0_hsl(var(--primary)/0.6)]'
                      : 'bg-surface/50'
                  )
            )}
          >
            {isToolbarCollapsed
              ? <ChevronDown className="size-3 transition-transform duration-200 group-hover:translate-y-0.5" />
              : <ChevronUp className="size-3 transition-transform duration-200 group-hover:-translate-y-0.5" />}
          </button>
          </div>

        </div>

        {!chromeHidden.detail && (
        <aside className="flex w-[380px] shrink-0 flex-col border-l border-border-subtle bg-surface">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-4 py-2">
            <span className="truncate text-sm font-medium text-foreground">{asset.filename}</span>
            {asset.hasWorkflow && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="shrink-0 gap-1">
                    <Download className="size-4" />
                    {t('asset.detail.exportWorkflow')}
                    <ChevronDown className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="min-w-[200px] p-1">
                  <Button
                    variant="ghost"
                    onClick={handleImportToPromptLibrary}
                    className="h-auto w-full justify-start gap-3 px-3 py-2 text-sm"
                  >
                    <BookOpen className="size-4" />
                    {t('asset.contextMenu.importToPromptLibrary')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleExportToWorkflow}
                    className="h-auto w-full justify-start gap-3 px-3 py-2 text-sm"
                  >
                    {t('asset.contextMenu.exportToWorkflow')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleExportToLocal}
                    className="h-auto w-full justify-start gap-3 px-3 py-2 text-sm"
                  >
                    {t('asset.contextMenu.exportToLocal')}
                  </Button>
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <TheaterPromptSection
              title={t('asset.detail.positivePrompt')}
              value={asset.prompt}
              emptyText={t('asset.theater.noPrompt')}
              onCopy={handleCopy}
            />

            {asset.negativePrompt && (
              <TheaterPromptSection
                title={t('asset.detail.negativePrompt')}
                value={asset.negativePrompt}
                emptyText={t('asset.theater.noPrompt')}
                onCopy={handleCopy}
              />
            )}

            <div className="border-b border-border-subtle px-4 py-3">
              <span className="mb-2 block text-xs font-medium text-muted-foreground">
                {t('asset.detail.parameters')}
              </span>
              <div className="flex flex-wrap gap-2">
                {asset.model && <ParamBadge label={t('asset.param.model')} value={asset.model} />}
                {asset.sampler && <ParamBadge label={t('asset.param.sampler')} value={asset.sampler} />}
                {asset.steps && <ParamBadge label={t('asset.param.steps')} value={String(asset.steps)} />}
                {asset.cfg && <ParamBadge label={t('asset.param.cfg')} value={String(asset.cfg)} />}
                {asset.seed && <ParamBadge label={t('asset.param.seed')} value={String(asset.seed)} />}
                <ParamBadge
                  label={t('asset.param.size')}
                  value={`${asset.width}x${asset.height}`}
                />
              </div>
            </div>

            <AssetInfoPanel
              asset={asset}
              embedded
              onClose={onClose}
              onUpdate={onUpdate}
              onDelete={onDelete}
              categoryPath={categoryPath}
              onOpenLocation={onOpenLocation}
            />
          </div>
        </aside>
        )}
      </div>

      {/* 胶片条容器：手柄绝对定位叠在上边缘，不占布局——
          放进流里会挤压 Grid 高度，导致列宽重算、滚动位置漂移 */}
      <div className="relative shrink-0">
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('asset.theater.resizeStrip')}
          title={t('asset.theater.resizeStrip')}
          className={cn(
            'group/resize absolute inset-x-0 -top-1 z-10 flex h-2 cursor-ns-resize items-center justify-center',
            isResizingStrip && 'bg-primary/20'
          )}
          onPointerDown={handleStripResizeDown}
          onPointerMove={handleStripResizeMove}
          onPointerUp={handleStripResizeUp}
          onPointerCancel={handleStripResizeUp}
          onDoubleClick={handleStripResizeReset}
        >
          <div
            className={cn(
              'h-0.5 w-10 rounded-full transition-all duration-150',
              isResizingStrip
                ? 'bg-primary'
                : 'bg-border-subtle group-hover/resize:w-14 group-hover/resize:bg-primary/70'
            )}
          />
        </div>

      <div
        ref={stripRef}
        style={{ height: stripBarHeight }}
        className={cn(
          // box-border：1px 上边框包含在 height 内，Grid 的内容区因此是 stripBarHeight-1
          'box-border border-t border-border-subtle bg-surface',
          isStripDragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
        onPointerDown={handleStripPointerDown}
        onPointerMove={handleStripPointerMove}
        onPointerUp={handleStripPointerUp}
        onPointerCancel={handleStripPointerUp}
      >
        {stripSize.width > 0 && (
          <Grid
            gridRef={gridRef}
            columnCount={assets.length}
            columnWidth={stripCellSize + STRIP_GAP}
            rowCount={1}
            rowHeight={stripRowInnerHeight}
            defaultHeight={stripRowInnerHeight}
            defaultWidth={stripSize.width}
            overscanCount={12}
            cellComponent={StripCell}
            cellProps={stripCellData}
            className="scrollbar-thin"
            style={{ overflowY: 'hidden' }}
          />
        )}
      </div>
      </div>
    </div>
  )
}

function TheaterPromptSection({
  title,
  value,
  emptyText,
  onCopy
}: {
  title: string
  value?: string
  emptyText: string
  onCopy: (text: string) => void
}) {
  return (
    <div className="border-b border-border-subtle px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        {value && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onCopy(safeString(value))}
            className="size-6"
          >
            <Copy className="size-3.5" />
          </Button>
        )}
      </div>
      {value ? (
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-xs leading-relaxed">
          {safeString(value)}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      )}
    </div>
  )
}

function ParamBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded bg-background px-2 py-1 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all font-mono text-foreground">{value}</span>
    </div>
  )
}

export default AssetTheaterView
