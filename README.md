# PantonLEELab · Figma 插件

**UI 设计师的 Figma 插件工具集**  
聚焦「高频但原生不顺手」的设计操作，做一些真正省心、省时间的小工具。

---

## ✨ 功能一览

### 1️⃣ 自动适配到容器（Fit to Parent）

在 Figma 中实现类似 **After Effects 的 Fit 行为**，快速让图层适配父级容器。

**支持三种模式：**

- **适合复合（Fit）**  
  等比缩放，使图层完整适配父容器
- **适合宽度（Fit Width）**  
  宽度对齐父容器，高度等比缩放
- **适合高度（Fit Height）**  
  高度对齐父容器，宽度等比缩放

**使用方式：**

- 用法 1（单选）  
  选中任意图层 → 点击按钮
- 用法 2（多选）  
  在同一容器内选中多个子层 → 自动按父级容器适配

**快捷键（插件窗口激活时）：**

- `1` → Fit  
- `2` → Fit Width  
- `3` → Fit Height  

---

### 2️⃣ 智能行高 + 行高预设（Smart Line Height & Presets）

为文本行高提供**语义化预设**与**智能判断**，减少中英文排版的手动计算。

#### 🧠 智能行高（Smart）
- 自动判断文本语言：
  - 中文为主 → 使用 **1.5x** 行高
  - 英文为主 → 使用 **1.2x** 行高
- 支持真实使用场景的中英文混排（如 AI / OS 等术语）
- 行高结果自动按 **0.5px** 步进取整，保证视觉稳定

#### 快速按钮
- **智能行高**：推荐默认入口
- **Auto**：恢复字体默认行高

#### 预设列表（可下拉选择）
- `1.0` — 紧凑排版 / 数据密集
- `1.1` — 英文 UI 小字号
- `1.2` — EN 推荐 / 英文正文
- `1.3` — 英文偏松 / 副标题
- `1.4` — 中文 UI 偏紧
- `1.5` — 中文段落舒适
- `1.6` — 中文衬线 / 长文
- `1.8` — 阅读无障碍
- `2.0` — 超松 / 强阅读性

**使用说明：**

- 可直接选中文本
- 或选中 Frame / Group / Component，**递归处理内部所有文本**
- 以下情况会被自动跳过，并在提示中汇总数量：
  - 混合字号（mixed fontSize）
  - 混合字体（mixed fontName）
  - 无法明确判断中英文主导的文本
- 行高数值自动按 **0.5px** 步进取整

---

### 3️⃣ Android XML 转 SVG

把 Android VectorDrawable XML 转换为标准 SVG 与可复用的 SVG `<symbol>`。
插件面板中该功能位于独立的 `Android XML` 页签，旧的适配/行高功能位于 `基础工具` 页签。

**支持输入：**

- 直接粘贴 `<vector>` XML 文本
- 从本地选择一个或多个 `.xml` 文件并自动填入输入框
- 可同时选择或粘贴 Android 颜色资源 XML，用来解析 `@color/...`
- 未解析的资源色默认使用 `#FF00FF` 兜底，可在 UI 中修改
- 自定义 `symbol id`，默认 `icon-converted`

**输出内容：**

- 标准 SVG
- SVG Symbol
- SVG 预览
- 一键插入单个或批量 SVG 到当前 Figma 画布
- 批量导入时，Figma 图层名与原始 XML 文件名保持一致
- warning 提示（遇到暂不支持的 Android XML 属性时继续转换）

**MVP 已支持：**

- `<vector>` 的 `width` / `height` / `viewportWidth` / `viewportHeight`
- `<path>` 的 `pathData` / `fillColor` / `fillAlpha` / `strokeColor` / `strokeAlpha` / `strokeWidth` / `strokeLineCap` / `strokeLineJoin` / `strokeMiterLimit`
- `fillType="evenOdd"`
- `#AARRGGBB` 色值转 `#RRGGBB` + opacity
- `@color/...` 优先通过上传或粘贴的颜色资源 XML 解析，未找到时 warning 并用可配置兜底色
- 支持 `<resources><color name="...">#...</color></resources>` 与 `res/color/*.xml` selector 默认色解析
- `?attr/...` 资源引用 warning，并用可配置兜底色
- `<group>` 的 translate / scale / rotation / pivot 基础转换
- `<aapt:attr name="android:fillColor">` 里的 linear gradient 转 SVG `<linearGradient>`
- `<clip-path android:pathData="...">` 转 SVG `<clipPath>` 并应用到后续 path

---

## 🛠 技术说明（简要）

- Figma Plugin API
- `code.ts`：插件主逻辑（TypeScript）
- `ui.html`：插件面板 UI
- 支持多选、递归遍历、安全兜底处理

---

## 🚧 Roadmap（可能会做）

- ✅ 文本语言自动判断（EN / ZH）已完成（v2.0）
- 可自定义行高预设
- 文本相关的更多高频操作工具
- 插件内状态记忆（最近使用的预设）

---

## 📄 License

MIT License

---

如果你是 UI 设计师，希望这个插件能帮你 **少点计算、多点专注设计** 🙂
