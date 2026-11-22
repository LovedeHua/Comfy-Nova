/**
 * 资产库瀑布流网格 - 横向瀑布流布局
 */

import { useRef, useCallback, forwardRef, useImperativeHandle, useMemo, useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useAssetStore } from '@/stores/useAssetStore'
import { AssetCard } from './AssetCard'
import { AssetFolderCard } from './AssetFolderCard'
import type { Asset } from '@/mocks/asset'

export interface AssetMasonryGridRef {
  getCardRefs: () => Map<string, HTMLDivElement>
}

interface AssetMasonryGridProps {
  onImageClick?: (asset: Asset) => void
  onImageDoubleClick?: (asset: Asset) => void
  /** 卡片上的「查看」入口，进入影院模式 */
  onView?: (asset: Asset) => void
  onImageContextMenu?: (e: React.MouseEvent, asset: Asset) => void
}

const SKELETON_HEIGHTS = [320, 280, 400, 350, 260, 380, 300, 420, 340, 290, 360, 310]
const GAP = 20

export const AssetMasonryGrid = forwardRef<AssetMasonryGridRef, AssetMasonryGridProps>(
  function AssetMasonryGrid({ onImageClick, onImageDoubleClick, onView, onImageContextMenu }, ref) {
    const { t } = useTranslation()
    const { 
      isLoading, 
      getFilteredAssets, 
      getGalleryItems,
      setSelectedCategoryId,
      clearSelection,
      setBatchMode,
      isBatchMode, 
      thumbnailSize
    } = useAssetStore()
    const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
    const containerRef = useRef<HTMLDivElement>(null)
    const [columnCount, setColumnCount] = useState(4)
  // 列的实际宽度：contain-intrinsic-size 的估算必须按列宽算（卡片渲染宽度），
  // 用 thumbnailSize 估算会随窗口/布局宽度产生虚高或塌陷，
  // 表现为滚动区域与界面显示区域不同步。
  const [columnWidth, setColumnWidth] = useState(0)

    useImperativeHandle(ref, () => ({
      getCardRefs: () => cardRefs.current
    }))

    const filteredAssets = getFilteredAssets()

    const galleryItems = getGalleryItems()

    const folderItems = galleryItems.filter((item) => item.kind === 'folder')

    const registerCardRef = useCallback((id: string, el: HTMLDivElement | null) => {
      if (el) {
        cardRefs.current.set(id, el)
      } else {
        cardRefs.current.delete(id)
      }
    }, [])

    // 每张卡的 ref 回调必须按 id 缓存：若在渲染期写 `(el) => registerCardRef(asset.id, el)`，
    // 每次渲染都是新函数，memo 会因此失效，前面的稳定 props 白做。
    const cardRefCallbacks = useRef(new Map<string, (el: HTMLDivElement | null) => void>())
    const getCardRef = useCallback((id: string) => {
      const cache = cardRefCallbacks.current
      let cb = cache.get(id)
      if (!cb) {
        cb = (el: HTMLDivElement | null) => registerCardRef(id, el)
        cache.set(id, cb)
      }
      return cb
    }, [registerCardRef])

    useEffect(() => {
      const updateColumnCount = () => {
        if (containerRef.current) {
          const containerWidth = containerRef.current.offsetWidth - 48
          const count = Math.max(1, Math.floor((containerWidth + GAP) / (thumbnailSize + GAP)))
          setColumnCount(count)
          // 列宽与列数同步重算（间隙占宽：总数-1 个 GAP）
          setColumnWidth(Math.max(1, Math.floor((containerWidth - (count - 1) * GAP) / count)))
        }
      }

      updateColumnCount()
      window.addEventListener('resize', updateColumnCount)
      // 容器宽度还会随软件布局变化（分类树拖宽/收起、详情栏开关），
      // window resize 监听不到这些，必须观察容器自身尺寸。
      let observer: ResizeObserver | null = null
      if (containerRef.current && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(updateColumnCount)
        observer.observe(containerRef.current)
      }
      return () => {
        window.removeEventListener('resize', updateColumnCount)
        observer?.disconnect()
      }
    }, [thumbnailSize])

    const columns = useMemo(() => {
      const safeColumnCount = Math.max(1, columnCount)
      const result: Asset[][] = Array.from({ length: safeColumnCount }, () => [])
      const columnHeights: number[] = Array(safeColumnCount).fill(0)
      
      for (const asset of filteredAssets) {
        if (!asset || !asset.width || !asset.height) continue
        
        const minHeightIndex = columnHeights.indexOf(Math.min(...columnHeights))
        if (minHeightIndex >= 0 && result[minHeightIndex]) {
          result[minHeightIndex].push(asset)
          columnHeights[minHeightIndex] += asset.height / asset.width
        }
      }
      
      return result
    }, [filteredAssets, columnCount])

    const folderGridStyle = useMemo(() => ({
      gridTemplateColumns: `repeat(${Math.max(1, columnCount)}, minmax(0, 1fr))`
    }), [columnCount])

    const handleOpenFolder = useCallback((categoryId: string) => {
      clearSelection()
      setBatchMode(false)
      setSelectedCategoryId(categoryId)
    }, [clearSelection, setBatchMode, setSelectedCategoryId])

    const skeletonHeights = useMemo(() => SKELETON_HEIGHTS, [])

    if (isLoading) {
      return (
        <div ref={containerRef} className="flex gap-5 p-6">
          {Array.from({ length: columnCount }).map((_, colIndex) => (
            <div key={colIndex} className="flex flex-1 flex-col gap-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-lg bg-surface-active"
                  style={{ height: `${skeletonHeights[(colIndex * 3 + i) % skeletonHeights.length]}px` }}
                >
                  <div className="h-full animate-pulse rounded-lg bg-surface-active" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )
    }

    if (filteredAssets.length === 0) {
      if (folderItems.length > 0) {
        return (
          <div ref={containerRef} className="p-6">
            <div className="grid gap-5" style={folderGridStyle}>
              {folderItems.map((item) => (
                <AssetFolderCard
                  key={item.category.id}
                  category={item.category}
                  assetCount={item.assetCount}
                  onOpen={handleOpenFolder}
                />
              ))}
            </div>
          </div>
        )
      }

      return (
        <div ref={containerRef} className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-muted-foreground">{t('asset.noAssets')}</p>
          </div>
        </div>
      )
    }

    return (
      <div ref={containerRef} className="p-6">
        {folderItems.length > 0 && (
          <div className="mb-6 grid gap-5" style={folderGridStyle}>
            {folderItems.map((item) => (
              <AssetFolderCard
                key={item.category.id}
                category={item.category}
                assetCount={item.assetCount}
                onOpen={handleOpenFolder}
              />
            ))}
          </div>
        )}

        {filteredAssets.length > 0 && (
          <div className="flex gap-5">
            {columns.map((column, colIndex) => (
              <div key={colIndex} className="flex flex-1 flex-col gap-5">
                {column.map((asset) => (
                  <div
                    key={asset.id}
                    // 瀑布流是变高布局，没法直接用行虚拟化；用 content-visibility
                    // 让浏览器跳过视口外卡片的布局与绘制。contain-intrinsic-size
                    // 给一个估算高度，避免滚动条长度跳变。
                    style={{
                      contentVisibility: 'auto',
                      containIntrinsicSize: `auto ${Math.round(
                        (columnWidth || thumbnailSize) * ((asset.height || 1) / (asset.width || 1))
                      )}px`
                    } as CSSProperties}
                  >
                    <AssetCard
                      asset={asset}
                      ref={getCardRef(asset.id)}
                      // 传稳定引用：父级只把「处理哪个资产」的职责交给卡片自己，
                      // 渲染期不再新建箭头函数（包括 ref），否则 memo 会被逐个击穿。
                      onImageClick={onImageClick}
                      onImageDoubleClick={onImageDoubleClick}
                      onView={onView}
                      onImageContextMenu={onImageContextMenu}
                      isBatchMode={isBatchMode}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
)
