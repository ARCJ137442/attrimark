# Attrimark — AI 内容溯源编辑器

## .attrimark 文件

本项目中的文档使用 `.attrimark` 格式存储（JSON 结构），包含段落内容和字符级归因信息。

**请勿直接编辑 .attrimark 文件**，否则归因数据会丢失。请使用下面的 CLI 命令操作。

## 读取文档

```bash
# 输出纯 Markdown 内容
bun run src/cli/index.ts read <file.attrimark>

# 输出完整 JSON 结构（含归因信息）
bun run src/cli/index.ts read <file.attrimark> --json
```

## 编辑文档

```bash
# 创建段落（默认 author=agent）
bun run src/cli/index.ts block create <file.attrimark> -c "段落内容"

# 更新段落
bun run src/cli/index.ts block update <file.attrimark> <block-id> -c "新内容"

# 局部替换
bun run src/cli/index.ts block patch <file.attrimark> <block-id> --old "旧文本" --new "新文本"

# 拆分段落
bun run src/cli/index.ts block split <file.attrimark> <block-id> --pos <字符位置>

# 合并段落
bun run src/cli/index.ts block merge <file.attrimark> <源block-id> --target <目标block-id>
```

## 查看信息

```bash
# 文档统计
bun run src/cli/index.ts stats <file.attrimark>

# 段落列表
bun run src/cli/index.ts block list <file.attrimark>
```

## 为什么不能直接编辑

Attrimark 的核心功能是**确定性 AI 内容溯源**：通过 CLI 编辑的内容自动标记为 `agent`，通过 Web UI 编辑的标记为 `human`。直接编辑文件会绕过这个追踪机制。
