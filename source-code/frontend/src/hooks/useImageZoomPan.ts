/**
 * 图片缩放与平移
 *
 * 影院模式的舞台需要像看图软件一样操作：滚轮缩放、按住拖动平移、
 * 双击在「适应窗口」与「原始大小」之间切换。
 *
 * 坐标系约定：x / y 是相对舞台中心的像素偏移，缩放围绕舞台中心进行。
 * 这样缩放与平移互不干扰，拖动时的位移永远等于鼠标位移。
 */

import { useCallback, useRef, useState } from 'react'

const MIN_SCALE = 0.1
const MAX_SCALE = 8
/** 滚轮每 100 单位滚动的缩放倍率 */
const WHEEL_ZOOM_STEP = 0.0015
/** 判定「是否处于适应窗口」的容差 */
const FIT_EPSILON = 1e-3

export interface Transform {
  scale: number
  x: number
  y: number
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 }

interface UseImageZoomPanOptions {
  /** 变换变化时回调，便于外层显示当前倍率 */
  onScaleChange?: (scale: number) => void
}

export function useImageZoomPan(options: UseImageZoomPanOptions = {}) {
  const { onScaleChange } = options
  const [transform, setTransform] = useState<Transform>(IDENTITY)
  const [isPanning, setIsPanning] = useState(false)

  // 用 ref 读最新值，避免把 transform 放进事件回调依赖里反复重绑
  const transformRef = useRef(transform)
  transformRef.current = transform

  const panState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  const reset = useCallback(() => {
    setTransform(IDENTITY)
    onScaleChange?.(1)
  }, [onScaleChange])

  const zoomTo = useCallback((nextScale: number, anchor?: { x: number; y: number }) => {
    setTransform((prev) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
      if (Math.abs(scale - prev.scale) < FIT_EPSILON) return prev

      // 以锚点为中心缩放：锚点在内容坐标系里的位置保持不动，
      // 否则放大时画面会往左上角跑，需要用户反复补拖动。
      //
      // 数学依据：屏幕上某点 P 对应的内容坐标是 (P - offset) / scale，
      // 要求缩放前后不变即 (P - x0)/s0 = (P - x1)/s1，解得
      // x1 = P - (P - x0) * (s1/s0)。
      if (!anchor) {
        onScaleChange?.(scale)
        return { ...prev, scale }
      }
      const ratio = scale / prev.scale
      onScaleChange?.(scale)
      return {
        scale,
        x: anchor.x - (anchor.x - prev.x) * ratio,
        y: anchor.y - (anchor.y - prev.y) * ratio
      }
    })
  }, [onScaleChange])

  /**
   * 滚轮缩放
   *
   * 锚点以「舞台中心」为原点计算：event.clientX 是视口坐标，
   * 减掉舞台矩形左上角再减去一半宽高，得到相对中心的偏移。
   * 这与 transform 的 x/y 同一基准，缩放后光标下的内容才不会漂移。
   */
  const handleWheel = useCallback((event: React.WheelEvent<HTMLElement>) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const anchor = {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2
    }
    const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_STEP)
    zoomTo(transformRef.current.scale * factor, anchor)
  }, [zoomTo])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    // 只响应主键；中键/右键留给上层（右键菜单）
    if (event.button !== 0) return
    const current = transformRef.current
    // 任何倍率下都允许拖动：缩小状态下也需要挪动画面（看图软件的通行做法）。
    // 只在真正按下并移动后才进入拖动态，轻点不会触发。
    panState.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const state = panState.current
    if (!state) return

    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    // 超过阈值才标记为拖动态，避免按住不动就让光标变抓取
    if (!isPanning && Math.abs(dx) + Math.abs(dy) > 3) {
      setIsPanning(true)
    }
    setTransform((prev) => ({
      ...prev,
      x: state.originX + dx,
      y: state.originY + dy
    }))
  }, [isPanning])

  const endPan = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!panState.current) return
    panState.current = null
    setIsPanning(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // 指针已经离开元素时释放会抛错，忽略即可
    }
  }, [])

  /** 双击：适应窗口 <-> 2 倍之间切换 */
  const handleDoubleClick = useCallback(() => {
    setTransform((prev) => {
      const next = prev.scale > 1 + FIT_EPSILON ? 1 : 2
      onScaleChange?.(next)
      return next === 1 ? IDENTITY : { scale: next, x: 0, y: 0 }
    })
  }, [onScaleChange])

  return {
    transform,
    isPanning,
    // 只要不是 1:1 就允许拖动（放大或缩小后都需要挪画面）
    canPan: Math.abs(transform.scale - 1) > FIT_EPSILON,
    isFitToWindow: Math.abs(transform.scale - 1) <= FIT_EPSILON && Math.abs(transform.x) < 0.5 && Math.abs(transform.y) < 0.5,
    reset,
    zoomTo,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    endPan,
    handleDoubleClick
  }
}
