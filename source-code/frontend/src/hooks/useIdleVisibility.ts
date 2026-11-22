/**
 * 空闲时淡出浮层控件
 *
 * 影院模式的控件悬浮在画面之上，长期显示会遮挡内容。
 * 这里在「鼠标静止一段时间」后隐藏、任何移动或按键时立刻恢复。
 * 只在影院这类沉浸场景使用，不做全局注入。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  /** 静止多久后自动隐藏（毫秒），默认 2500 */
  idleDelay?: number;
  /** 是否启用，false 时始终可见 */
  enabled?: boolean;
}

export function useIdleVisibility({ idleDelay = 2500, enabled = true }: Options = {}) {
  const [isVisible, setIsVisible] = useState(true)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const wake = useCallback(() => {
    setIsVisible(true)
    clearTimer()
    if (!enabled) return
    timerRef.current = window.setTimeout(() => setIsVisible(false), idleDelay)
  }, [idleDelay, enabled, clearTimer])

  useEffect(() => {
    if (!enabled) {
      setIsVisible(true)
      clearTimer()
      return
    }

    wake()
    // pointermove 已能覆盖鼠标；keydown 补上纯键盘操作（翻页/缩放）
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    return () => {
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
      clearTimer()
    }
  }, [enabled, wake, clearTimer])

  return { isVisible, wake }
}
