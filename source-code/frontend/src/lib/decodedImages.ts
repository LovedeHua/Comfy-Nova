/**
 * 已解码原图 URL 的进程内缓存。
 *
 * 影院首帧要不要先铺缩略图，取决于当前原图是否已解码：
 *  - 已解码 → 首帧直接显示高清层，用户看不到任何过渡
 *  - 未解码 → 先铺 512px 缩略图，原图就绪后淡入
 *
 * 放在模块级而不是组件内，是为了让"进入影院前预解码"的页面代码
 * 和"影院内渲染"的组件代码共享同一份状态。
 */
const decodedImageUrls = new Set<string>()

export function markImageDecoded(url: string | undefined | null): void {
  if (url) decodedImageUrls.add(url)
}

export function isImageDecoded(url: string | undefined | null): boolean {
  return !!url && decodedImageUrls.has(url)
}
