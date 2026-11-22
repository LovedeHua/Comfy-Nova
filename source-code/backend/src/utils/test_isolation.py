"""
测试隔离的写保护。

`--test-mode` 或 test 环境（`deploy_env.is_write_guard_enabled()` 为真）下，
对真实 ComfyUI 根的一切写入都要被拒绝，避免验证过程改动用户的实际环境。
本模块只提供这一道判断，不参与任何路径解析——真源是 `deploy_env`，
不要在这里另外读环境变量或配置文件，否则两处判断会漂移。
"""

from typing import Optional

from backend.src.core import deploy_env
from backend.src.utils.logger import app_logger as logger


def guard_write(action: str) -> Optional[str]:
    """检查当前是否允许执行写操作。

    调用方约定：返回 None 表示放行；返回非空字符串表示拒绝，
    该字符串直接作为面向用户的错误信息传回前端。

    Args:
        action: 用户可读的动作名（如「安装插件」「切换 ComfyUI 版本」），
            用于拼出「已拒绝：<action> 会写入真实 ComfyUI 环境」这类提示。

    Returns:
        None 表示允许；否则为拒绝原因。
    """
    if not deploy_env.is_write_guard_enabled():
        return None

    reason = (
        f"当前处于测试隔离模式，已拒绝「{action}」："
        "该操作会写入真实 ComfyUI 环境。"
        "去掉 --test-mode（或切到 dev 环境）后重试。"
    )
    logger.warning(f"[TestIsolation] 拒绝写操作: {action}")
    return reason
