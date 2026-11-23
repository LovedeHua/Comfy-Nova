/**
 * 资产库页面
 */

import React, { useEffect, useMemo, useState, useCallback, useRef, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { Folder, ChevronRight } from 'lucide-react'
import {
  AssetToolbar,
  AssetCategoryTree,
  AssetMasonryGrid,
  AssetGridView,
  AssetTheaterView,
  AssetContextMenu,
  AssetBatchToolbar,
  AssetSettingsDialog,
  ScanProgressBar,
  AssetInfoPanel,
  AssetDragProvider,
  AssetDragLayer
} from '@/components/asset'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { useAssetStore } from '@/stores/useAssetStore'
import type { CategoryDeleteRequest } from '@/components/asset/AssetCategoryTree'
import { useChromeStore } from '@/stores/useChromeStore'
import { useFullscreenStore } from '@/stores/useFullscreenStore'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { Asset } from '@/mocks/asset'
import type { AssetMasonryGridRef } from '@/components/asset'
import type { AssetCategory } from '@/mocks/asset'

function getCategoryPath(
  categoryId: string,
  categories: AssetCategory[]
): AssetCategory[] {
  const path: AssetCategory[] = []
  let current = categories.find((c) => c.id === categoryId)

  while (current) {
    path.unshift(current)
    current = current.parentId
      ? categories.find((c) => c.id === current!.parentId)
      : undefined
  }

  return path
}

interface ContextMenuState {
  asset: Asset | null
  position: { x: number; y: number } | null
}

export default function AssetLibraryPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const {
    loadData,
    getFilteredAssets,
    deleteAssets,
    selectedAssetIds,
    clearSelection,
    toggleBatchMode,
    isBatchMode,
    updateAssetInfo,
    toggleFavorite,
    moveToCategory,
    assets,
    selectedCategoryId,
    setSelectedCategoryId,
    categories,
    createCategory,
    updateCategory,
    moveCategory,
    deleteCategory,
    openLocation,
    incrementalScanLibrary,
    viewMode,
    assetSource,
    setAssetSource
  } = useAssetStore()

  // 影院模式：只记 id，资产数据始终从 store 派生，改名/评分才能实时反映在舞台上
  const [theaterAssetId, setTheaterAssetId] = useState<string | null>(null)
  const chromeHidden = useChromeStore((state) => state.hidden)
  const showAllChrome = useChromeStore((state) => state.showAll)
  const [selectedInfoAsset, setSelectedInfoAsset] = useState<Asset | null>(null)
  // 保留上一次的 asset 数据，让滑出动画期间内容不消失
  const [lastInfoAsset, setLastInfoAsset] = useState<Asset | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    asset: null,
    position: null
  })
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [pendingCategoryDelete, setPendingCategoryDelete] = useState<CategoryDeleteRequest | null>(null)

  const [infoPanelPinned, setInfoPanelPinned] = useState(() => {
    return localStorage.getItem('asset-info-panel-pinned') === 'true'
  })

  const handleToggleInfoPanelPin = useCallback(() => {
    setInfoPanelPinned(prev => {
      const newValue = !prev
      localStorage.setItem('asset-info-panel-pinned', String(newValue))
      return newValue
    })
  }, [])

  const [isSelecting, setIsSelecting] = useState(false)

  const gridRef = useRef<AssetMasonryGridRef>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadData()
    incrementalScanLibrary()
  }, [loadData, incrementalScanLibrary])

  const filteredAssets = getFilteredAssets()

  const theaterAsset = useMemo(
    () => (theaterAssetId ? assets.find((a) => a.id === theaterAssetId) ?? null : null),
    [assets, theaterAssetId]
  )

  // 列表接口不下发 prompt 正文（千张规模下占约 60% 载荷），
  // 影院模式要展示正文，因此在打开时按 id 补取一次，取到的内容缓存到本地 state。
  const [theaterPrompt, setTheaterPrompt] = useState<{ positive?: string; negative?: string } | null>(null)

  useEffect(() => {
    if (!theaterAsset?.id) {
      setTheaterPrompt(null)
      return
    }
    // 列表对象里若已带正文（例如轮询进度新插入的资产）就不再请求
    if (theaterAsset.prompt || theaterAsset.negativePrompt) {
      setTheaterPrompt({ positive: theaterAsset.prompt, negative: theaterAsset.negativePrompt })
      return
    }
    if (!window.pywebview?.api?.gallery_get_asset) {
      setTheaterPrompt(null)
      return
    }

    let cancelled = false
    window.pywebview.api
      .gallery_get_asset(theaterAsset.id)
      .then((detail) => {
        if (cancelled) return
        setTheaterPrompt({
          positive: detail?.asset?.prompt,
          negative: detail?.asset?.negativePrompt
        })
      })
      .catch(() => {
        if (!cancelled) setTheaterPrompt(null)
      })

    return () => {
      cancelled = true
    }
  }, [theaterAsset?.id, theaterAsset?.prompt, theaterAsset?.negativePrompt])

  const theaterAssetWithPrompt = useMemo(
    () =>
      theaterAsset
        ? {
            ...theaterAsset,
            prompt: theaterPrompt?.positive,
            negativePrompt: theaterPrompt?.negative
          }
        : null,
    [theaterAsset, theaterPrompt]
  )

  const resolveCategoryPath = useCallback(
    (asset: Asset | null) =>
      asset?.categoryId
        ? getCategoryPath(asset.categoryId, categories).map((cat) => cat.name).join(' / ')
        : '',
    [categories]
  )

  useEffect(() => {
    if (selectedInfoAsset) {
      setLastInfoAsset(selectedInfoAsset)
    }
  }, [selectedInfoAsset])

  const infoAsset = selectedInfoAsset || lastInfoAsset
  const infoCategoryPath = resolveCategoryPath(infoAsset)

  // 进入影院模式时详情面板必须让位给舞台（固定态也一样收起），退出影院后按原状态回来
  const infoPanelInFlow = infoPanelPinned && !theaterAsset
  const infoPanelShown = !theaterAsset && (infoPanelPinned || !!selectedInfoAsset)

  // 卡片矩形快照：只在框选开始时读一次 getBoundingClientRect。
  // 之前每次 mousemove 都遍历所有卡片调 getBoundingClientRect，会强制同步布局；
  // 几千张卡片时每帧数千次 reflow，直接卡死、框选失效。
  interface CardRect { id: string; left: number; top: number; right: number; bottom: number }
  const cardRectsRef = useRef<CardRect[]>([])
  const selectionStartRef2 = useRef<{ x: number; y: number } | null>(null)
  const isSelectingRef2 = useRef(false)
  const rafRef = useRef<number | null>(null)
  const pendingSelectionEndRef = useRef<{ x: number; y: number } | null>(null)
  const baseSelectedIdsRef = useRef<Set<string>>(new Set())
  // 拖动中的临时高亮/待提交集合：用 DOM class 直接标记，避免每帧 setState
  const highlightedIdsRef = useRef<Set<string>>(new Set())
  const pendingSelectedIdsRef = useRef<Set<string> | null>(null)
  const selectionBoxRef = useRef<HTMLDivElement | null>(null)

  const updateSelectionBox = useCallback((start: { x: number; y: number }, end: { x: number; y: number }) => {
    const el = selectionBoxRef.current
    if (!el) return
    const left = Math.min(start.x, end.x)
    const top = Math.min(start.y, end.y)
    const width = Math.abs(end.x - start.x)
    const height = Math.abs(end.y - start.y)
    el.style.display = width < 5 && height < 5 ? 'none' : 'block'
    el.style.left = left + 'px'
    el.style.top = top + 'px'
    el.style.width = width + 'px'
    el.style.height = height + 'px'
  }, [])

  const handleSelectionMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (theaterAsset) return
    if ((e.target as HTMLElement).closest('[data-asset-card]')) return
    if ((e.target as HTMLElement).closest('[data-folder-card]')) return
    if ((e.target as HTMLElement).closest('button')) return
    if ((e.target as HTMLElement).closest('[data-info-panel]')) return

    // 一次性快照所有可见卡片的矩形（只读一次，后续 mousemove 纯数学计算）
    const rects: CardRect[] = []
    gridRef.current?.getCardRefs().forEach((cardEl, assetId) => {
      const r = cardEl.getBoundingClientRect()
      // content-visibility 跳过的卡片矩形为 0，跳过它们
      if (r.width <= 0 || r.height <= 0) return
      rects.push({ id: assetId, left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    })
    cardRectsRef.current = rects

    const point = { x: e.clientX, y: e.clientY }
    selectionStartRef2.current = point
    isSelectingRef2.current = true
    hasDraggedRef.current = false
    baseSelectedIdsRef.current = new Set(useAssetStore.getState().selectedAssetIds)
    blankClickFlagsRef.current = {
      wasBatchMode: useAssetStore.getState().isBatchMode,
      closeInfo: !infoPanelPinned && !!selectedInfoAsset
    }
    pendingSelectionEndRef.current = null
    // 选区框用 ref 挂载，避免 setState 引发整页重渲染
    setIsSelecting(true)
  }, [theaterAsset, infoPanelPinned, selectedInfoAsset])
  // 框选期间：mousemove 只更新选区框 DOM，选中态用 rAF 节流提交
  useEffect(() => {
    if (!isSelecting) return

    // 拖动中不做任何 setState：4000+ 卡片时每张都订阅 selectedAssetIds，
    // 每帧 setState 会让全部卡片重渲染并各自执行 includes（O(N²)），直接卡死。
    // 这里仅维护待提交集合 + 用 DOM class 直接高亮，mouseup 时一次性提交。
    const applyHighlight = (ids: Set<string>) => {
      const prev = highlightedIdsRef.current
      // 移除不再相交的
      prev.forEach((id) => {
        if (!ids.has(id)) {
          const el = gridRef.current?.getCardRefs().get(id)
          el?.classList.remove('ring-2', 'ring-success', 'ring-offset-2', 'ring-offset-background')
        }
      })
      // 添加新相交的
      ids.forEach((id) => {
        if (!prev.has(id)) {
          const el = gridRef.current?.getCardRefs().get(id)
          el?.classList.add('ring-2', 'ring-success', 'ring-offset-2', 'ring-offset-background')
        }
      })
      highlightedIdsRef.current = new Set(ids)
    }

    // 每帧根据当前选区计算相交集合（纯数学，无 DOM 读取），DOM 高亮
    const frameUpdate = () => {
      rafRef.current = null
      const start = selectionStartRef2.current
      const end = pendingSelectionEndRef.current
      if (!start || !end) return
      const left = Math.min(start.x, end.x)
      const right = Math.max(start.x, end.x)
      const top = Math.min(start.y, end.y)
      const bottom = Math.max(start.y, end.y)
      const ids = new Set(baseSelectedIdsRef.current)
      for (const r of cardRectsRef.current) {
        if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) {
          ids.add(r.id)
        }
      }
      pendingSelectedIdsRef.current = ids
      applyHighlight(ids)
    }

    const handleMouseMove = (e: MouseEvent) => {
      const start = selectionStartRef2.current
      if (!isSelectingRef2.current || !start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDraggedRef.current = true

      const end = { x: e.clientX, y: e.clientY }
      pendingSelectionEndRef.current = end
      updateSelectionBox(start, end)  // DOM 直写，零 React 渲染
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(frameUpdate)
    }

    const handleMouseUp = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
        frameUpdate()
      }
      // 一次性提交选中结果（只渲染一次，不是每帧）
      const finalIds = pendingSelectedIdsRef.current
      if (finalIds && finalIds.size > 0) {
        const store = useAssetStore.getState()
        if (!store.isBatchMode) store.setBatchMode(true)
        // 清除 DOM 临时高亮，交给 React 用 state 正确渲染
        highlightedIdsRef.current.forEach((id) => {
          const el = gridRef.current?.getCardRefs().get(id)
          el?.classList.remove('ring-2', 'ring-success', 'ring-offset-2', 'ring-offset-background')
        })
        highlightedIdsRef.current.clear()
        useAssetStore.setState({ selectedAssetIds: Array.from(finalIds) })
      } else if (!hasDraggedRef.current) {
        // 未拖动 = 单击空白：退出批量管理 / 关闭 info 面板
        const flags = blankClickFlagsRef.current
        if (flags.wasBatchMode) {
          useAssetStore.getState().setBatchMode(false)
          useAssetStore.getState().clearSelection()
        } else if (flags.closeInfo) {
          setSelectedInfoAsset(null)
        }
      }
      isSelectingRef2.current = false
      selectionStartRef2.current = null
      pendingSelectionEndRef.current = null
      pendingSelectedIdsRef.current = null
      cardRectsRef.current = []
      if (selectionBoxRef.current) selectionBoxRef.current.style.display = 'none'
      setIsSelecting(false)
    }

    document.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [isSelecting, updateSelectionBox])

  // Esc 取消框选
  useEffect(() => {
    if (!isSelecting) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        isSelectingRef2.current = false
        selectionStartRef2.current = null
        if (selectionBoxRef.current) selectionBoxRef.current.style.display = 'none'
        setIsSelecting(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isSelecting])

  const handleDropToCategory = useCallback(async (categoryId: string, assetIds: string[]) => {
    const count = assetIds.length
    
    if (categoryId === 'favorites') {
      let successCount = 0
      for (const id of assetIds) {
        const success = await toggleFavorite(id)
        if (success) successCount++
      }
      if (successCount > 0) {
        toast.success(t('asset.toast.favoriteSuccess', { count: successCount }))
      } else {
        toast.error(t('asset.toast.favoriteFailed'))
      }
      return
    }
    
    const success = await moveToCategory(assetIds, categoryId)
    if (success) {
      toast.success(t('asset.toast.moveSuccess', { count }))
    } else {
      toast.error(t('asset.toast.moveFailed'))
    }
  }, [moveToCategory, toggleFavorite, t])

  const notifyCategoryOp = useCallback((
    result: { success: boolean; error?: string },
    successKey: string,
    failedKey: string
  ) => {
    if (result.success) {
      toast.success(t(successKey))
    } else {
      toast.error(result.error || t(failedKey))
    }
    return result.success
  }, [t])

  const handleCreateCategory = useCallback(async (parentId: string | null, name: string) => {
    notifyCategoryOp(await createCategory(name, parentId ?? undefined), 'asset.toast.createCategorySuccess', 'asset.toast.createCategoryFailed')
  }, [createCategory, notifyCategoryOp])

  const handleRenameCategory = useCallback(async (id: string, name: string) => {
    notifyCategoryOp(await updateCategory(id, name), 'asset.toast.renameCategorySuccess', 'asset.toast.renameCategoryFailed')
  }, [updateCategory, notifyCategoryOp])

  const handleMoveCategory = useCallback(async (id: string, newParentId: string | null) => {
    notifyCategoryOp(await moveCategory(id, newParentId), 'asset.toast.moveCategorySuccess', 'asset.toast.moveCategoryFailed')
  }, [moveCategory, notifyCategoryOp])

  const handleDeleteCategoryRequest = useCallback((request: CategoryDeleteRequest) => {
    setPendingCategoryDelete(request)
  }, [])

  const handleConfirmDeleteCategory = useCallback(async () => {
    if (!pendingCategoryDelete) return
    const result = await deleteCategory(pendingCategoryDelete.id)
    if (result.success && selectedCategoryId === pendingCategoryDelete.id) {
      setSelectedCategoryId('all')
    }
    notifyCategoryOp(result, 'asset.toast.deleteCategorySuccess', 'asset.toast.deleteCategoryFailed')
    setPendingCategoryDelete(null)
  }, [pendingCategoryDelete, deleteCategory, selectedCategoryId, setSelectedCategoryId, notifyCategoryOp])

  // 单击延迟处理：避免悬浮 info 面板遮挡双击
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleImageClick = useCallback((asset: Asset) => {
    if (isBatchMode) return
    // 延迟执行单击，给双击留出时间
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      setSelectedInfoAsset(asset)
      clickTimerRef.current = null
    }, 250)
  }, [isBatchMode])

  const handleOpenTheater = useCallback((asset: Asset) => {
    setTheaterAssetId(asset.id)
  }, [])

  const handleImageDoubleClick = useCallback((asset: Asset) => {
    // 取消单击的延迟，防止 info 面板弹出
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    handleOpenTheater(asset)
  }, [handleOpenTheater])

  const handleContextMenu = useCallback((e: React.MouseEvent, asset: Asset) => {
    e.preventDefault()
    setContextMenu({
      asset,
      position: { x: e.clientX, y: e.clientY }
    })
  }, [])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu({ asset: null, position: null })
  }, [])

  const handleCloseTheater = useCallback(() => {
    setTheaterAssetId(null)
    // 窗体全屏时保持收起，其余情况把菜单/筛选/详情放回原位
    if (!useFullscreenStore.getState().isFullscreen) {
      showAllChrome()
    }
  }, [showAllChrome])

  const handleBatchDeleteClick = useCallback(() => {
    setPendingDeleteIds(selectedAssetIds)
    setShowDeleteConfirm(true)
  }, [selectedAssetIds])

  const handleConfirmDelete = useCallback(async () => {
    if (pendingDeleteIds.length > 0) {
      await deleteAssets(pendingDeleteIds)
      clearSelection()
      toggleBatchMode()
    }
    setShowDeleteConfirm(false)
    setPendingDeleteIds([])
  }, [pendingDeleteIds, deleteAssets, clearSelection, toggleBatchMode])

  const handleCloseInfoPanel = useCallback(() => {
    setSelectedInfoAsset(null)
  }, [])

  const handleUpdateAssetInfo = useCallback(async (
    assetId: string,
    data: { filename?: string; description?: string; tags?: string[]; rating?: number }
  ) => {
    const result = await updateAssetInfo(assetId, data)
    if (result.success && result.asset) {
      if (selectedInfoAsset?.id === assetId) {
        setSelectedInfoAsset(result.asset)
      }
    }
    return result
  }, [updateAssetInfo, selectedInfoAsset])

  const handleDeleteAsset = useCallback(async (assetId: string) => {
    const success = await deleteAssets([assetId])
    if (success) {
      setSelectedInfoAsset(null)
      if (assetId === theaterAssetId) setTheaterAssetId(null)
    }
    return success
  }, [deleteAssets, theaterAssetId])

  const getCardRefs = useCallback(() => {
    return gridRef.current?.getCardRefs() ?? new Map()
  }, [])

  // 后退关闭信息面板（RR 导航栈方案）：
  // 面板打开时压一条"面板占位"导航（同路径 push + sentinel state）；
  // 用户后退（WebView2 把鼠标侧键/Alt+Left 映射为 history.back）时
  // RR 回退一格、sentinel 消失 —— 用 ref 检测"sentinel 从有到无"的转换
  // 即后退信号，关闭面板。两个动作在同一 effect 串行处理，避免竞态：
  // 压占位 effect 与关面板 effect 分离时，popstate 后的重渲染顺序不定，
  // 会出现"关面板后重新压占位"或"后退信号被吞"的竞态（实测踩过）。
  const hadSentinelRef = useRef(false)
  useEffect(() => {
    if (theaterAsset) return
    const isPanelOpen = infoPanelPinned || !!selectedInfoAsset
    const sentinel = !!location.state?.infoPanelSentinel

    // 后退信号：上一轮有 sentinel、这一轮没有（且不是我们自己消费的）
    if (hadSentinelRef.current && !sentinel && isPanelOpen) {
      hadSentinelRef.current = false
      if (infoPanelPinned) setInfoPanelPinned(false)
      setSelectedInfoAsset(null)
      return
    }
    hadSentinelRef.current = sentinel

    if (!isPanelOpen) {
      // 面板已关：占位还在栈上就消费掉
      if (sentinel) navigate(-1)
      return
    }
    // 面板开着且栈顶没有占位 → 压一条
    if (!sentinel) {
      navigate(location.pathname, { state: { infoPanelSentinel: true } })
    }
  }, [infoPanelPinned, selectedInfoAsset, theaterAsset, location.state, location.pathname, navigate])

  // 框选拖动标记：mousedown 后鼠标实际移动过（超过阈值）置 true，
  // 框选松开触发的 click 据此跳过"点空白退出批量"，避免框选完自动退出。
  const hasDraggedRef = useRef(false)
  // 空白单击退出所需的标志：在 mousedown 时刻快照，mouseup 判定未拖动时使用。
  // 这样"点空白退出批量"完全走滚动容器的 mousedown/mouseup 配对，
  // 不依赖 click 冒泡——网格视图(react-window)与瀑布流行为一致。
  const blankClickFlagsRef = useRef({ wasBatchMode: false, closeInfo: false })

  // 卡片列表区域的空白单击退出批量/关 info 面板已统一放到滚动容器的
  // mousedown/mouseup 配对里处理（见 handleSelectionMouseDown / handleMouseUp），
  // 这样网格视图(react-window)与瀑布流行为一致，不依赖 click 冒泡时序。
  // 这里只处理"点击在工具栏/标签栏等列表之外的空白"：关闭 info 面板。
  const handlePageClick = useCallback((e: React.MouseEvent) => {
    if (theaterAsset) return
    const target = e.target as HTMLElement
    // 列表内的空白由 mousedown/mouseup 负责，跳过以免重复触发
    if (target.closest('[data-asset-scroll-container]')) return
    if (
      target.closest('[data-info-panel]') ||
      target.closest('[data-asset-card]') ||
      target.closest('[data-folder-card]') ||
      target.closest('button')
    ) return
    if (!infoPanelPinned && selectedInfoAsset) {
      setSelectedInfoAsset(null)
    }
  }, [infoPanelPinned, selectedInfoAsset, theaterAsset])

  return (
    <AssetDragProvider onDrop={handleDropToCategory}>
      <div className="flex h-full flex-col" onClick={handlePageClick}>
        {!chromeHidden.filter && (
          <AssetToolbar
            onOpenSettings={() => setShowSettings(true)}
            hideLayoutControls={!!theaterAsset}
          />
        )}


        {/* 资产来源切换：生成图库 / 输入图库，两库数据、分类、扫描路径完全隔离 */}
        {!theaterAsset && (
          <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle bg-surface px-3 py-1.5">
            <button
              onClick={() => setAssetSource('generated')}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                assetSource === 'generated'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
              )}
            >
              {t('asset.sourceTab.generated')}
            </button>
            <button
              onClick={() => setAssetSource('input')}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                assetSource === 'input'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
              )}
            >
              {t('asset.sourceTab.input')}
            </button>
          </div>
        )}

        {/* 横向用 clip、纵向用 hidden：clip 不产生滚动容器，轨道列表定位时的滚动才不会顺带把
            整行（含分类树）推出可视区；纵向仍需 hidden 保证这一层按可用高度收缩，不被内容撑高 */}
        <main className="relative flex flex-1 overflow-y-hidden overflow-x-clip">
          {!chromeHidden.nav && (
            <AssetCategoryTree
              onCreateCategory={handleCreateCategory}
              onRenameCategory={handleRenameCategory}
              onMoveCategory={handleMoveCategory}
              onDeleteCategoryRequest={handleDeleteCategoryRequest}
            />
          )}

          <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <div
              ref={scrollContainerRef}
              data-asset-scroll-container
              className={cn(
                'min-w-0 flex-1 bg-background',
                viewMode === 'grid' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'
              )}
              onMouseDown={handleSelectionMouseDown}
            >
              {selectedCategoryId &&
                selectedCategoryId !== 'all' &&
                selectedCategoryId !== 'favorites' &&
                selectedCategoryId !== 'uncategorized' && (
                  <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle bg-surface px-4 py-2">
                    {getCategoryPath(selectedCategoryId, categories).map((cat, index, path) => (
                      <Fragment key={cat.id}>
                        {index > 0 && (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedCategoryId(cat.id)}
                          className={cn(
                            'h-auto gap-1 px-2 py-1 text-sm',
                            index === path.length - 1 && 'font-medium text-primary'
                          )}
                        >
                          <Folder className="size-3.5" />
                          {cat.name}
                        </Button>
                      </Fragment>
                    ))}
                  </div>
                )}
              {viewMode === 'grid' ? (
                <AssetGridView
                  ref={gridRef}
                  onImageClick={handleImageClick}
                  onImageDoubleClick={handleImageDoubleClick}
                  onView={handleOpenTheater}
                  onImageContextMenu={handleContextMenu}
                />
              ) : (
                <AssetMasonryGrid
                  ref={gridRef}
                  onImageClick={handleImageClick}
                  onImageDoubleClick={handleImageDoubleClick}
                  onView={handleOpenTheater}
                  onImageContextMenu={handleContextMenu}
                />
              )}
            </div>

            <div
              className={cn(
                'overflow-hidden transition-all duration-300 ease-in-out',
                infoPanelInFlow
                  ? 'w-[320px] shrink-0'
                  : 'absolute right-0 top-0 z-40 h-full w-[320px] shadow-lg',
                infoPanelShown
                  ? 'translate-x-0 opacity-100'
                  : 'pointer-events-none translate-x-full opacity-0'
              )}
              data-info-panel
            >
              {(lastInfoAsset || infoPanelPinned) && (
                <AssetInfoPanel
                  asset={selectedInfoAsset || lastInfoAsset}
                  onClose={handleCloseInfoPanel}
                  onUpdate={handleUpdateAssetInfo}
                  pinned={infoPanelPinned}
                  onTogglePin={handleToggleInfoPanelPin}
                  onDelete={handleDeleteAsset}
                  categoryPath={infoCategoryPath}
                  onOpenLocation={openLocation}
                />
              )}
            </div>

            {theaterAsset && (
              <div className="absolute inset-0 z-30 flex flex-col bg-theater">
                <AssetTheaterView
                  asset={theaterAssetWithPrompt ?? theaterAsset}
                  assets={filteredAssets}
                  categoryPath={resolveCategoryPath(theaterAsset)}
                  onNavigate={(item) => setTheaterAssetId(item.id)}
                  onClose={handleCloseTheater}
                  onUpdate={handleUpdateAssetInfo}
                  onDelete={handleDeleteAsset}
                  onOpenLocation={openLocation}
                />
              </div>
            )}
          </div>
        </main>

        <AssetContextMenu
          asset={contextMenu.asset}
          position={contextMenu.position}
          onClose={handleCloseContextMenu}
        />

        <AssetBatchToolbar onDeleteConfirm={handleBatchDeleteClick} />

        <AssetSettingsDialog
          open={showSettings}
          onOpenChange={setShowSettings}
        />

        <ScanProgressBar />

        <ConfirmDialog
          open={!!pendingCategoryDelete}
          onOpenChange={(open) => { if (!open) setPendingCategoryDelete(null) }}
          title={t('asset.category.deleteTitle')}
          description={
            pendingCategoryDelete && (pendingCategoryDelete.assetCount > 0 || pendingCategoryDelete.childCount > 0)
              ? t('asset.category.deleteWithContent', {
                  name: pendingCategoryDelete.name,
                  assetCount: pendingCategoryDelete.assetCount,
                  childCount: pendingCategoryDelete.childCount
                })
              : t('asset.category.deleteConfirm', { name: pendingCategoryDelete?.name || '' })
          }
          variant="destructive"
          onConfirm={handleConfirmDeleteCategory}
        />

        <ConfirmDialog
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
          title={t('asset.confirm.deleteTitle')}
          description={t('asset.confirm.deleteDescription', { count: pendingDeleteIds.length })}
          confirmText={t('common.confirm')}
          variant="destructive"
          onConfirm={handleConfirmDelete}
        />

        <AssetDragLayer getCardRefs={getCardRefs} />

        <div
          ref={selectionBoxRef}
          className="pointer-events-none fixed z-50 hidden border-2 border-dashed border-primary bg-primary/10"
        />
      </div>
    </AssetDragProvider>
  )
}
