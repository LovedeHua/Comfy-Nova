/**
 * 资产来源隔离测试
 *
 * 回归保护：切换到输入库时不能显示输出库的图片。
 * 曾经的 bug 是 loadData 用后端 settings.assetSource 覆盖了用户当前选择，
 * 造成标签与列表内容错位（输入资产里出现输出库图片）。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAssetStore } from '../useAssetStore'
import type { Asset } from '@/mocks/asset'

const createAsset = (id: string, source: 'generated' | 'input' | undefined): Asset => ({
  id,
  filename: `${id}.png`,
  filePath: `D:/gallery/${id}.png`,
  thumbnailPath: null,
  type: 'image',
  width: 100,
  height: 100,
  size: 100,
  createdAt: '2026-01-01T00:00:00.000Z',
  hasWorkflow: false,
  isFavorite: false,
  categoryId: null,
  source
})

const visibleIds = () => useAssetStore.getState().getFilteredAssets().map((asset) => asset.id)

describe('资产来源隔离', () => {
  beforeEach(() => {
    useAssetStore.setState({
      assetSource: 'generated',
      assets: [createAsset('g1', 'generated'), createAsset('g2', undefined)],
      categories: [],
      selectedCategoryId: 'all',
      searchQuery: '',
      typeFilter: [],
      onlyWithWorkflow: false,
      modelFilter: [],
      dateFilter: 'all',
      ratingFilter: 'all',
      sortBy: 'name',
      sortDir: 'asc'
    })
  })

  it('generated 库只显示 generated 资产（source 为空视为 generated）', () => {
    expect(visibleIds().sort()).toEqual(['g1', 'g2'])
  })

  it('切到 input 后即使 assets 里混着 generated 资产，也只显示 input 的', () => {
    // 模拟状态错位：assetSource 已是 input，但 assets 仍是旧库内容
    useAssetStore.setState({
      assetSource: 'input',
      assets: [
        createAsset('g1', 'generated'),
        createAsset('g2', undefined),
        createAsset('i1', 'input')
      ]
    })

    const ids = visibleIds()
    expect(ids).toEqual(['i1'])
    // 关键断言：输出库的图片不能出现在输入库
    expect(ids).not.toContain('g1')
    expect(ids).not.toContain('g2')
  })

  it('input 库为空时不显示任何输出库资产', () => {
    useAssetStore.setState({
      assetSource: 'input',
      assets: [createAsset('g1', 'generated'), createAsset('g2', undefined)]
    })

    expect(visibleIds()).toEqual([])
  })
})
