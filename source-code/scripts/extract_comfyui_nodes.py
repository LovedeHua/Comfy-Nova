"""
从 ComfyUI 源码提取所有内置节点清单
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

# ComfyUI 前端内置节点（不需要后端支持）
FRONTEND_BUILTIN_NODES = {
    "Reroute": {
        "class": "RerouteNode",
        "category": "frontend",
        "display_name": "Reroute",
        "description": "Redirects connections to organize workflow layout"
    },
    "Note": {
        "class": "NoteNode", 
        "category": "frontend",
        "display_name": "Note",
        "description": "Adds text notes to workflow"
    },
    "MarkdownNote": {
        "class": "MarkdownNoteNode",
        "category": "frontend",
        "display_name": "Markdown Note",
        "description": "Adds markdown formatted notes to workflow"
    }
}

def extract_node_mappings_from_file(file_path):
    """从单个文件提取 NODE_CLASS_MAPPINGS"""
    nodes = {}
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 方法1: 匹配字典定义格式
        # NODE_CLASS_MAPPINGS = {
        #     "NodeName": NodeClass,
        #     ...
        # }
        pattern1 = r'NODE_CLASS_MAPPINGS\s*=\s*\{([^}]+)\}'
        matches1 = re.findall(pattern1, content, re.DOTALL)
        
        for match in matches1:
            # 提取 "NodeName": NodeClass 格式
            node_pattern = r'"([^"]+)":\s*([A-Za-z_][A-Za-z0-9_]*)'
            node_matches = re.findall(node_pattern, match)
            for node_name, node_class in node_matches:
                nodes[node_name] = {
                    "class": node_class,
                    "source": str(file_path)
                }
        
        # 方法2: 匹配动态添加格式
        # NODE_CLASS_MAPPINGS[node_name] = node_class
        pattern2 = r'NODE_CLASS_MAPPINGS\[([^\]]+)\]\s*=\s*([A-Za-z_][A-Za-z0-9_]*)'
        matches2 = re.findall(pattern2, content)
        for node_name, node_class in matches2:
            node_name = node_name.strip('"\'')
            if node_name not in nodes:
                nodes[node_name] = {
                    "class": node_class,
                    "source": str(file_path)
                }
        
        # 方法3: 匹配列表格式后赋值
        # node_list = [NodeClass1, NodeClass2, ...]
        # for node in node_list:
        #     NODE_CLASS_MAPPINGS[node.__name__] = node
        pattern3 = r'node_list\s*=\s*\[([^\]]+)\]'
        matches3 = re.findall(pattern3, content, re.DOTALL)
        for match in matches3:
            class_names = re.findall(r'([A-Za-z_][A-Za-z0-9_]*)', match)
            for class_name in class_names:
                if class_name and class_name not in ['None', 'True', 'False']:
                    # 尝试从类定义中获取名称
                    class_pattern = rf'class\s+{class_name}[^:]*:'
                    if re.search(class_pattern, content):
                        # 使用类名作为节点名（可能不准确）
                        nodes[class_name] = {
                            "class": class_name,
                            "source": str(file_path),
                            "note": "extracted from node_list"
                        }
    
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
    
    return nodes

def extract_api_nodes_from_file(file_path):
    """从 comfy_api_nodes 格式提取节点（IO.ComfyNode 格式）"""
    nodes = {}
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 匹配 IO.ComfyNode 格式
        # class FluxProUltraImageNode(IO.ComfyNode):
        #     @classmethod
        #     def define_schema(cls) -> IO.Schema:
        #         return IO.Schema(
        #             node_id="FluxProUltraImageNode",
        #             display_name="Flux 1.1 [pro] Ultra Image",
        #             ...
        #         )
        
        # 先找到所有 IO.ComfyNode 类
        class_pattern = r'class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*IO\.ComfyNode\s*\):'
        class_matches = re.findall(class_pattern, content)
        
        for class_name in class_matches:
            # 提取 node_id
            node_id_pattern = rf'class\s+{class_name}[^:]*:.*?node_id\s*=\s*"([^"]+)"'
            node_id_match = re.search(node_id_pattern, content, re.DOTALL)
            
            # 提取 display_name
            display_name_pattern = rf'class\s+{class_name}[^:]*:.*?display_name\s*=\s*"([^"]+)"'
            display_name_match = re.search(display_name_pattern, content, re.DOTALL)
            
            # 提取 category
            category_pattern = rf'class\s+{class_name}[^:]*:.*?category\s*=\s*"([^"]+)"'
            category_match = re.search(category_pattern, content, re.DOTALL)
            
            # 提取 description
            desc_pattern = rf'class\s+{class_name}[^:]*:.*?description\s*=\s*"([^"]+)"'
            desc_match = re.search(desc_pattern, content, re.DOTALL)
            
            node_id = node_id_match.group(1) if node_id_match else class_name
            display_name = display_name_match.group(1) if display_name_match else class_name
            category = category_match.group(1) if category_match else "api"
            description = desc_match.group(1) if desc_match else ""
            
            nodes[node_id] = {
                "class": class_name,
                "source": str(file_path),
                "display_name": display_name,
                "category": category,
                "description": description
            }
    
    except Exception as e:
        print(f"Error processing API nodes in {file_path}: {e}")
    
    return nodes

def scan_comfyui_source(comfyui_path):
    """扫描 ComfyUI 源码目录"""
    all_nodes = {}
    
    comfyui_path = Path(comfyui_path)
    
    # 1. 扫描主 nodes.py
    nodes_py = comfyui_path / "nodes.py"
    if nodes_py.exists():
        nodes = extract_node_mappings_from_file(nodes_py)
        for name, info in nodes.items():
            info["category"] = "core"
        all_nodes.update(nodes)
        print(f"[core] nodes.py: {len(nodes)} nodes")
    
    # 2. 扫描 comfy_extras 目录
    comfy_extras_path = comfyui_path / "comfy_extras"
    if comfy_extras_path.exists():
        for py_file in comfy_extras_path.glob("*.py"):
            nodes = extract_node_mappings_from_file(py_file)
            for name, info in nodes.items():
                info["category"] = "extras"
            all_nodes.update(nodes)
            if nodes:
                print(f"[extras] {py_file.name}: {len(nodes)} nodes")
    
    # 3. 扫描 comfy_api_nodes 目录（新格式）
    comfy_api_nodes_path = comfyui_path / "comfy_api_nodes"
    if comfy_api_nodes_path.exists():
        for py_file in comfy_api_nodes_path.glob("nodes_*.py"):
            nodes = extract_api_nodes_from_file(py_file)
            for name, info in nodes.items():
                info["category"] = f"api/{info.get('category', 'unknown')}"
            all_nodes.update(nodes)
            if nodes:
                print(f"[api] {py_file.name}: {len(nodes)} nodes")
    
    return all_nodes


def parse_args(argv=None):
    """解析命令行参数。

    ComfyUI 根目录因机器而异，不能写死在源码里：写死盘符在别人的机器上
    只会得到一个"扫不到任何节点"的空结果，而且不会报错。

    Args:
        argv: 参数列表，None 表示使用 sys.argv。

    Returns:
        argparse.Namespace: comfyui_path 与 output 均为命令行原始字符串，尚未校验。
    """
    parser = argparse.ArgumentParser(description="从 ComfyUI 源码提取内置节点清单")
    parser.add_argument(
        "--comfyui-path",
        default=os.environ.get("COMFYUI_PATH", ""),
        help="ComfyUI 源码根目录（也可用环境变量 COMFYUI_PATH 指定）",
    )
    parser.add_argument(
        "--output",
        default="comfyui_core_nodes.json",
        help="输出 JSON 路径（默认 comfyui_core_nodes.json）",
    )
    return parser.parse_args(argv)


def resolve_comfyui_path(raw_path):
    """校验并返回 ComfyUI 源码根目录。

    Args:
        raw_path: 命令行或环境变量给出的路径字符串。

    Returns:
        Path: 已确认存在的 ComfyUI 根目录。

    Raises:
        SystemExit: 未提供路径、路径不存在、或目录里没有 nodes.py。
    """
    if not raw_path:
        print("[错误] 未指定 ComfyUI 目录。", file=sys.stderr)
        print("       请用 --comfyui-path <目录> 或设置环境变量 COMFYUI_PATH。", file=sys.stderr)
        raise SystemExit(2)

    comfyui_path = Path(raw_path).expanduser()
    if not comfyui_path.is_dir():
        print(f"[错误] 目录不存在: {comfyui_path}", file=sys.stderr)
        raise SystemExit(2)
    if not (comfyui_path / "nodes.py").is_file():
        print(f"[错误] {comfyui_path} 下没有 nodes.py，可能不是 ComfyUI 源码根目录。", file=sys.stderr)
        raise SystemExit(2)

    return comfyui_path


def main(argv=None):
    args = parse_args(argv)
    comfyui_path = resolve_comfyui_path(args.comfyui_path)
    
    print("=" * 60)
    print("ComfyUI 内置节点提取工具")
    print(f"源码目录: {comfyui_path}")
    print("=" * 60)
    
    all_nodes = {}
    
    # 0. 添加前端内置节点
    for name, info in FRONTEND_BUILTIN_NODES.items():
        all_nodes[name] = info
    print(f"[frontend] builtin: {len(FRONTEND_BUILTIN_NODES)} nodes")
    
    # 1-3. 扫描后端节点
    all_nodes.update(scan_comfyui_source(comfyui_path))
    
    print("=" * 60)
    print(f"总计: {len(all_nodes)} 个内置节点")
    print("=" * 60)
    
    # 按类别统计
    categories = {}
    for name, info in all_nodes.items():
        cat = info.get("category", "unknown")
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(name)
    
    for cat, nodes in categories.items():
        print(f"\n[{cat}] {len(nodes)} nodes:")
        for node in sorted(nodes)[:10]:
            display_name = all_nodes[node].get("display_name", node)
            print(f"  - {node}: {display_name}")
        if len(nodes) > 10:
            print(f"  ... and {len(nodes) - 10} more")
    
    # 保存到 JSON
    output_path = Path(args.output)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            "version": "extracted",
            "total": len(all_nodes),
            "categories": {k: len(v) for k, v in categories.items()},
            "nodes": all_nodes
        }, f, indent=2, ensure_ascii=False)
    
    print(f"\n已保存到: {output_path}")


if __name__ == "__main__":
    main()
