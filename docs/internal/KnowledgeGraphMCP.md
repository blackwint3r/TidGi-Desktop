---
创建日期: 2026-06-05
最后修改日期: 2026-06-05
状态: 成熟
抽象级别: 3
相关文档:
  - ../MCP.md
  - ../../src/services/mcpServer/kbTools.ts
  - ../../src/services/knowledgeGraph/index.ts
  - ../../src/services/knowledgeGraph/operations.ts
  - ../../src/services/knowledgeGraph/rdfAdapter.ts
tags:
  - ghost-kb
  - mcp
  - knowledge-graph
  - architecture
---

# Ghost KB Knowledge Graph MCP

本文档描述 Ghost KB MCP 的当前架构、工具语义和未来缓存路线。

## 当前读写模型

当前实现不是长期维护一个内存 RDF 数据库，也不是让 TiddlyWiki 去同步一个内存三元组库。

当前模型是：

```text
TiddlyWiki = 唯一持久化源
查询 = 每次从 TiddlyWiki 读取 tiddler 字段，临时构建 Graph { triples }
写入 = 通过操作层校验后，直接写回 TiddlyWiki 字段
RDF/N3 Store = 由当前 Graph 临时转换出的标准 RDF 视图
```

也就是：

```text
读：TiddlyWiki -> 临时 Graph { triples } -> 查询 / 断言 / 推理 / 序列化
写：agent 输入 triple -> Operation Layer 决策 -> TiddlyWiki field update
```

这意味着每次查询看到的是 TiddlyWiki 当时的状态快照。写入后不会维护一份长期内存 graph，而是下次查询时重新从 TiddlyWiki 构建图。

## 模块边界

```text
MCP Tools
  -> Graph Registry：选择知识库 graph
  -> Ref Resolver：把 GHOST / kb:GHOST / 完整 URI 统一成规范 URI
  -> Knowledge Operation Layer：查询断言、写入决策、删除决策
  -> TiddlyWiki Sender：真实读写 tiddler
  -> RDF Adapter：按需把 Graph { triples } 转成 RDFJS Quad / N3 Store / RDF 文本
```

### TiddlyWiki

TiddlyWiki 是 source of truth。所有持久化事实仍然来自 tiddler fields。

### Graph `{ triples }`

Graph 是运行时查询快照，不是权威存储。

它由当前 wiki 的 tiddler 字段映射而来，例如：

```text
GHOST 状态 成熟
GHOST tags 开发文档
GHOST content ...
```

### Assertion

Assertion 是带语义的事实视图，不只是三元组。

它会说明：

- `kind`: `explicit` / `derived` / `virtual`
- `provenance`: 事实来源，例如 tiddler 字段、规则、系统状态
- `writable`: agent 是否允许直接写入或删除

系统字段和身份字段会被标记为不可写，例如：

```text
created / modified / revision / title / localName
```

### RDF Adapter

RDF Adapter 不改变存储模型。

它只负责按需转换：

```text
Graph { triples }
  -> RDFJS Quad[]
  -> N3.Store
  -> Turtle / N-Triples / N3 text
```

用途是让后续推理、序列化和测试使用标准 RDF 结构。

## MCP 工具语义

### Graph 工具

- `kb_list_graphs`: 列出可用知识库 graph。
- `kb_get_current_graph`: 获取当前 MCP graph。
- `kb_set_current_graph`: 设置当前 MCP graph。

注意：

```text
workspaceId = TidGi 内部路由句柄
graphUri = RDF 层知识库身份
prefix = 当前 graph 下 node/property 的默认 URI 前缀
```

agent 应优先使用 graph name / graphUri / node ref，而不是依赖随机 workspaceId。

### 查询工具

旧的 `kb_query` 已废弃。查询入口拆成明确工具：

- `kb_query_triples`: 查询三元组/断言，带默认 `limit = 50`。
- `kb_find_nodes`: 按属性条件查 node list，带默认 `limit = 20`。
- `kb_get_node`: 获取单个 node 的邻域视图。
- `kb_explain`: 解释事实来源和可写性。

普通查询不再接受 `rules` 参数。规则应来自知识库内的 Rule 节点，由推理器按 graph 配置加载。

### `kb_get_node` 返回字段

`kb_get_node` 返回的是 agent 友好的 node 邻域视图。

```text
properties = 当前 node 作为 subject 的事实
inbound = 当前 node 作为 object 被其他 node 引用的事实
assertions = properties + inbound，并附带来源、类型、可写性
```

例如：

```text
properties:
  GHOST 状态 成熟
  GHOST tags 开发文档

inbound:
  SomeNote relatedTo GHOST
  AnotherNote tags GHOST

assertions:
  上面这些事实 + explicit/derived/virtual + provenance + writable
```

agent 修改知识库时应以 `assertions.writable` 为准，而不是只看三元组是否存在。

### 写入工具

- `kb_write`: 写入一个显式事实。
- `kb_delete`: 删除一个显式事实。

写删都会先走 Knowledge Operation Layer：

```text
proposeWrite / proposeDelete
  -> 找到匹配 assertion
  -> assertion.writable === false 时拒绝
  -> allowed 时写回 TiddlyWiki
```

因此 derived / virtual / system-managed 字段会通过同一套机制被拒绝。

## 当前缓存策略

当前只保留少量辅助内存状态，例如：

```text
当前选中的 graph
object property declaration 摘要
系统状态辅助信息
```

这些不是完整三元组缓存，也不是长期 RDF store。

当前选择这种模式是为了保证语义简单：

```text
TiddlyWiki 永远是最新事实源
查询快照可丢弃
写入路径单一
不会出现内存 graph 与 tiddler 字段谁更权威的问题
```

## 未来路线：高性能 graph cache

如果后续知识库变大，或者推理器成本明显上升，可以引入高性能缓存层。

未来可选路线：

```text
TiddlyWiki tiddlers
  -> graph cache builder
  -> in-memory RDF store / indexed Triple store
  -> query / reasoner / serializer
```

但这需要明确处理同步和失效问题。

### 推荐设计原则

1. TiddlyWiki 仍然是 source of truth。
2. Cache 只是可重建的派生产物。
3. Cache 必须有明确 invalidation 机制。
4. 写入成功后，应按最小范围更新或失效相关 node。
5. 推理结果应与显式事实分层保存，不能混成同一类事实。
6. Cache 不应绕过 Operation Layer 的只读策略。

### 可能的缓存粒度

```text
Graph-level cache:
  一个 wiki graph 对应一个完整 RDF store。

Node-level cache:
  只缓存常访问 node 的 outbound/inbound/assertions。

Rule/reasoner cache:
  缓存规则编译结果或 derived assertion 结果。

Serialization cache:
  缓存 Turtle / N-Triples 导出文本。
```

### 失效触发

未来需要监听或接入这些变更源：

```text
tiddler 创建 / 修改 / 删除
workspace 切换
当前 selected graph 改变
Rule 节点变化
property declaration 变化
系统状态变化
```

### 不应提前做的事

在没有性能证据前，不建议直接引入长期内存 RDF DB。否则会引入：

- 双写一致性问题
- stale cache 问题
- 规则推理撤回问题
- 多 graph 切换时的缓存隔离问题
- 测试复杂度上升

当前快照式查询模型更适合先把语义层做正确。

## 当前已明确废弃的接口

- `kb_query`
- `kb_get_entry`
- query-time `rules`
- explain-time `rules`

对应替代：

```text
kb_query -> kb_query_triples / kb_find_nodes
kb_get_entry -> kb_get_node
rules 参数 -> graph 内 Rule 节点 + reasoner backend
```

## 测试边界

当前相关测试覆盖：

```text
graph registry
ref resolver
assertion writability
operation decision
MCP tool schema
node query
RDF adapter
```

运行：

```bash
pnpm exec vitest run \
  src/services/knowledgeGraph/__tests__/graphRegistry.test.ts \
  src/services/knowledgeGraph/__tests__/refResolver.test.ts \
  src/services/knowledgeGraph/__tests__/assertions.test.ts \
  src/services/knowledgeGraph/__tests__/operations.test.ts \
  src/services/knowledgeGraph/__tests__/reasoner.test.ts \
  src/services/knowledgeGraph/__tests__/rdfAdapter.test.ts \
  src/services/mcpServer/__tests__/kbTools.test.ts
```