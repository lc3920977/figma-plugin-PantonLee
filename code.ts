/**
 * PantonLEELab - Fit to Parent (AE-style)
 *
 * 目标：在 Figma 里实现类似 After Effects 的：
 * - 适合复合（Fit）
 * - 适合复合宽度（Fit Width）
 * - 适合复合高度（Fit Height）
 *
 * 说明：
 * - Figma 插件无法把功能塞进原生右键菜单，所以我们用一个常驻 UI 面板放 3 个按钮。
 * - 插件侧（code.ts）负责读选区、计算缩放、resize、居中对齐；
 * - UI 侧（ui.html）负责按钮点击/快捷键，并通过 postMessage 把命令发给插件。
 */

// ------------------------------
// 1) 启动并展示 UI 面板
// ------------------------------
// __html__ 是打包工具（或模板）把 ui.html 内联到代码中的变量。
// showUI 的第二个参数可以控制面板大小。
figma.showUI(__html__, { width: 360, height: 560 });

// ------------------------------
// 2) 类型与工具函数
// ------------------------------

type FitMode = 'fit' | 'fitWidth' | 'fitHeight';
type LineHeightPreset =
  | 'auto'
  | 'smart'
  | '1.0'
  | '1.1'
  | '1.2'
  | '1.3'
  | '1.4'
  | '1.5'
  | '1.6'
  | '1.8'
  | '2.0';
type GlowPreset = 'softWhite' | 'spectrum';
type GlowIntensity = 'low' | 'medium' | 'high';

type PluginMessage =
  | { type: 'fit' }
  | { type: 'fitWidth' }
  | { type: 'fitHeight' }
  | { type: 'close' }
  | { type: 'lineHeightPreset'; preset: LineHeightPreset }
  | { type: 'applyWwdcGlow'; preset: GlowPreset; intensity: GlowIntensity };

const LINE_HEIGHT_PRESETS: LineHeightPreset[] = [
  'auto',
  'smart',
  '1.0',
  '1.1',
  '1.2',
  '1.3',
  '1.4',
  '1.5',
  '1.6',
  '1.8',
  '2.0',
];
const GLOW_PRESETS: GlowPreset[] = ['softWhite', 'spectrum'];
const GLOW_INTENSITIES: GlowIntensity[] = ['low', 'medium', 'high'];

function isLineHeightPreset(value: unknown): value is LineHeightPreset {
  return typeof value === 'string' && LINE_HEIGHT_PRESETS.includes(value as LineHeightPreset);
}

function isGlowPreset(value: unknown): value is GlowPreset {
  return typeof value === 'string' && GLOW_PRESETS.includes(value as GlowPreset);
}

function isGlowIntensity(value: unknown): value is GlowIntensity {
  return typeof value === 'string' && GLOW_INTENSITIES.includes(value as GlowIntensity);
}

/**
 * 判断一个节点是否“有尺寸”（width/height）。
 * - Figma 中很多节点都有 width/height，但 BaseNode 并不保证。
 */
function hasSize(node: BaseNode): node is BaseNode & { width: number; height: number } {
  return 'width' in node && 'height' in node;
}

/**
 * 选区里我们允许作为“容器”的节点类型。
 * - Frame / Component / Instance：最常见容器
 * - Section：也有尺寸
 * - Group：也有尺寸（但注意 group 的坐标/布局相对特殊）
 */
function isContainerCandidate(
  node: SceneNode
): node is SceneNode & { width: number; height: number } {
  const t = node.type;
  const isCandidate =
    t === 'FRAME' ||
    t === 'COMPONENT' ||
    t === 'INSTANCE' ||
    t === 'SECTION' ||
    t === 'GROUP';
  return isCandidate && hasSize(node);
}

/**
 * 规则：支持“同时选 1 个容器 + 多个子层”。
 * - 若选区里 (selection.length > 1) 且“恰好只有 1 个容器候选”
 *   → 把它当容器；其余当 targets；容器自身不参与缩放。
 * - 否则 → container 为 null，targets 就是 selection（回退到每个节点 fit 到自己的 parent）
 */
function getNodeDepth(node: BaseNode): number {
  // 用来在多个可用容器里做排序；一般用于“选更深层/更贴近用户当前操作的容器”。
  let d = 0;
  let p = node.parent;
  while (p) {
    d++;
    p = p.parent;
  }
  return d;
}

function isDescendantOf(node: BaseNode, ancestor: BaseNode): boolean {
  // 判断 node 是否在 ancestor 之下（任意后代层级）
  let p = node.parent;
  while (p) {
    if (p.id === ancestor.id) return true;
    p = p.parent;
  }
  return false;
}

function getContainerFromSelection(selection: readonly SceneNode[]): {
  container: (SceneNode & { width: number; height: number }) | null;
  targets: SceneNode[];
} {
  // 选区 <= 1 个节点时，不启用“选中容器模式”
  if (selection.length <= 1) {
    return { container: null, targets: [...selection] };
  }

  const candidates = selection.filter(isContainerCandidate);
  if (candidates.length === 0) {
    return { container: null, targets: [...selection] };
  }

  // 找出“能包含所有其他选中节点”的容器（也就是：其他节点必须是它的后代）
  const valid = candidates.filter((c) =>
    selection.every((n) => n.id === c.id || isDescendantOf(n, c))
  );

  if (valid.length === 0) {
    // 没有任何容器能包含所有选中节点 → 回退到 parent 模式
    return { container: null, targets: [...selection] };
  }

  // 若有多个 valid（比较少见，比如选区里同时包含多个祖先容器），优先选“最深”的那个
  valid.sort((a, b) => getNodeDepth(b) - getNodeDepth(a));
  const container = valid[0];
  const targets = selection.filter((n) => n.id !== container.id);
  return { container, targets };
}

/**
 * 回退逻辑：如果没有“选中容器”，则默认用 node.parent 作为容器。
 */
function getParentContainer(node: SceneNode): (BaseNode & { width: number; height: number }) | null {
  const p = node.parent;
  return p && hasSize(p) ? p : null;
}

/**
 * 计算缩放系数 s。
 * - Fit：保持比例，把内容完整塞进容器（类似 contain）
 * - Fit Width：宽度撑满容器
 * - Fit Height：高度撑满容器
 */
function computeScale(mode: FitMode, pw: number, ph: number, w: number, h: number): number {
  if (w <= 0 || h <= 0) return 1;
  if (mode === 'fit') return Math.min(pw / w, ph / h);
  if (mode === 'fitWidth') return pw / w;
  return ph / h; // fitHeight
}

/**
 * resize：优先使用 resizeWithoutConstraints（如果存在），否则用 resize。
 * - 这么做的原因：很多节点在约束/自动布局下 resize 会更“顺滑”。
 */
function resizeNode(node: SceneNode, w: number, h: number): boolean {
  const ww = Math.max(0.01, w);
  const hh = Math.max(0.01, h);

  try {
    const anyNode = node as any;
    if (typeof anyNode.resizeWithoutConstraints === 'function') {
      anyNode.resizeWithoutConstraints(ww, hh);
      return true;
    }
    if (typeof anyNode.resize === 'function') {
      anyNode.resize(ww, hh);
      return true;
    }
  } catch {
    // 某些节点（尤其在 Instance 内、或被布局系统强约束）可能会抛错
  }

  return false;
}

/**
 * 判断父容器是否为 Auto Layout。
 * - 如果父容器是 Auto Layout，子项的 x/y 往往会被布局系统接管。
 */
function parentIsAutoLayout(p: BaseNode): p is FrameNode | ComponentNode | InstanceNode {
  return (
    (p.type === 'FRAME' || p.type === 'COMPONENT' || p.type === 'INSTANCE') &&
    'layoutMode' in p &&
    (p as any).layoutMode !== 'NONE'
  );
}

/**
 * 居中对齐到父容器。
 * - 若父容器是 Auto Layout：把子项设为 ABSOLUTE（若该属性存在），才能手动设置 x/y。
 */
function centerInParent(node: SceneNode, parent: BaseNode & { width: number; height: number }) {
  if (parentIsAutoLayout(parent)) {
    const anyNode = node as any;
    if ('layoutPositioning' in anyNode) {
      try {
        anyNode.layoutPositioning = 'ABSOLUTE';
      } catch {
        // 并不是所有节点都允许设置这个属性
      }
    }
  }

  try {
    node.x = (parent.width - node.width) / 2;
    node.y = (parent.height - node.height) / 2;
  } catch {
    // 在少数场景（例如坐标被锁定/不可写）可能失败，忽略即可
  }
}

// ------------------------------
// 3) 核心逻辑：对选区执行 Fit
// ------------------------------

function fitSelection(mode: FitMode) {
  const selection = figma.currentPage.selection;

  if (!selection.length) {
    figma.notify('请选择至少一个图层 / Frame');
    return;
  }

  const { container, targets } = getContainerFromSelection(selection);

  let okCount = 0;
  let skipCount = 0;
  let skipNotDirectChild = 0;

  for (const node of targets) {
    // 决定容器：优先用“选中容器”，否则用 node.parent
    const targetContainer = container ?? getParentContainer(node);
    if (!targetContainer) {
      skipCount++;
      continue;
    }

    // 若是“选中容器模式”，我们先做一个安全约束：目标必须是容器的直接子层。
    // 这样能保证 x/y 居中对齐不会因为跨层级坐标系而出错。
    if (container && node.parent?.id !== container.id) {
      skipCount++;
      skipNotDirectChild++;
      continue;
    }

    const s = computeScale(mode, targetContainer.width, targetContainer.height, node.width, node.height);
    const newW = node.width * s;
    const newH = node.height * s;

    const ok = resizeNode(node, newW, newH);
    if (!ok) {
      skipCount++;
      continue;
    }

    centerInParent(node, targetContainer);
    okCount++;
  }

  const modeName = mode === 'fit' ? 'Fit' : mode === 'fitWidth' ? 'Fit Width' : 'Fit Height';

  let msg = `${modeName} 完成：成功 ${okCount} 个`;
  if (skipCount) msg += `，跳过 ${skipCount} 个`;
  if (skipNotDirectChild) msg += `（其中 ${skipNotDirectChild} 个不是容器的直接子层）`;

  figma.notify(msg);
}

// ------------------------------
// 4) 行高预设逻辑
// ------------------------------

function isLineHeightContainer(
  node: SceneNode
): node is FrameNode | GroupNode | ComponentNode | InstanceNode {
  return (
    node.type === 'FRAME' ||
    node.type === 'GROUP' ||
    node.type === 'COMPONENT' ||
    node.type === 'INSTANCE'
  );
}

function collectTextNodes(node: SceneNode, bucket: TextNode[]) {
  if (node.type === 'TEXT') {
    bucket.push(node);
    return;
  }

  if ('children' in node) {
    for (const child of node.children) {
      collectTextNodes(child, bucket);
    }
  }
}

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

const SMART_DOMINANCE_RATIO = 0.7;

function isLatinLetter(char: string): boolean {
  return /[A-Za-z]/.test(char);
}

function isCjkChar(char: string): boolean {
  return /[\u4E00-\u9FFF]/.test(char);
}

function getSmartLineHeightScale(text: string): number | null {
  if (!text) return null;

  let latinCount = 0;
  let cjkCount = 0;

  for (const char of text) {
    if (isLatinLetter(char)) {
      latinCount += 1;
      continue;
    }
    if (isCjkChar(char)) {
      cjkCount += 1;
    }
  }

  const total = latinCount + cjkCount;
  if (total === 0) return null;

  const latinRatio = latinCount / total;
  const cjkRatio = cjkCount / total;

  if (latinRatio >= SMART_DOMINANCE_RATIO) return 1.2;
  if (cjkRatio >= SMART_DOMINANCE_RATIO) return 1.5;
  return null;
}

async function applyLineHeightPreset(preset: LineHeightPreset) {
  const selection = figma.currentPage.selection;

  if (!selection.length) {
    figma.notify('请选择至少一个图层 / Frame');
    return;
  }

  const collected: TextNode[] = [];
  for (const node of selection) {
    if (node.type === 'TEXT') {
      collected.push(node);
      continue;
    }
    if (isLineHeightContainer(node)) {
      collectTextNodes(node, collected);
    }
  }

  const uniqueTextNodes = Array.from(new Map(collected.map((node) => [node.id, node])).values());

  if (!uniqueTextNodes.length) {
    figma.notify('未找到可用文本图层');
    return;
  }

  let okCount = 0;
  let skipCount = 0;

  for (const node of uniqueTextNodes) {
    if (node.fontSize === figma.mixed || node.fontName === figma.mixed) {
      skipCount++;
      continue;
    }

    try {
      await figma.loadFontAsync(node.fontName);
    } catch {
      skipCount++;
      continue;
    }

    if (preset === 'auto') {
      node.lineHeight = { unit: 'AUTO' };
    } else if (preset === 'smart') {
      const scale = getSmartLineHeightScale(node.characters);
      if (!scale) {
        skipCount++;
        continue;
      }
      const px = roundToHalf((node.fontSize as number) * scale);
      node.lineHeight = { unit: 'PIXELS', value: px };
    } else {
      const scale = Number(preset);
      const px = roundToHalf((node.fontSize as number) * scale);
      node.lineHeight = { unit: 'PIXELS', value: px };
    }

    okCount++;
  }

  const actionLabel = preset === 'smart' ? '智能行高' : '行高预设';
  let msg = `${actionLabel}完成：成功 ${okCount} 个`;
  if (skipCount) msg += `，跳过 ${skipCount} 个`;
  figma.notify(msg);
}

type GlowSupportedNode = TextNode | VectorNode | RectangleNode | EllipseNode | PolygonNode | StarNode | LineNode | BooleanOperationNode;

function isGlowSupportedNode(node: SceneNode): node is GlowSupportedNode {
  return (
    node.type === 'TEXT' ||
    node.type === 'VECTOR' ||
    node.type === 'RECTANGLE' ||
    node.type === 'ELLIPSE' ||
    node.type === 'POLYGON' ||
    node.type === 'STAR' ||
    node.type === 'LINE' ||
    node.type === 'BOOLEAN_OPERATION'
  );
}

function cloneNode<T extends SceneNode>(node: T): T | null {
  const cloneFn = (node as unknown as { clone?: () => T }).clone;
  if (typeof cloneFn !== 'function') return null;
  try {
    return cloneFn.call(node);
  } catch {
    return null;
  }
}

function toPaintColor(rgb: { r: number; g: number; b: number }, opacity: number): SolidPaint {
  return { type: 'SOLID', color: rgb, opacity };
}

function setSolidFill(node: SceneNode, rgb: { r: number; g: number; b: number }, opacity: number) {
  const anyNode = node as unknown as { fills?: Paint[] };
  if (!('fills' in anyNode)) return;
  try {
    anyNode.fills = [toPaintColor(rgb, opacity)];
  } catch {
    // ignore unsupported fill assignment
  }
}

function setStroke(
  node: SceneNode,
  rgb: { r: number; g: number; b: number },
  opacity: number,
  weight: number
) {
  const anyNode = node as unknown as { strokes?: Paint[]; strokeWeight?: number };
  if (!('strokes' in anyNode)) return;
  try {
    anyNode.strokes = [toPaintColor(rgb, opacity)];
    if ('strokeWeight' in anyNode) {
      anyNode.strokeWeight = weight;
    }
  } catch {
    // ignore unsupported stroke assignment
  }
}

function setGlowEffects(
  node: SceneNode,
  rgb: { r: number; g: number; b: number },
  opacity: number,
  radius: number
) {
  const anyNode = node as unknown as { effects?: Effect[] };
  if (!('effects' in anyNode)) return;
  try {
    anyNode.effects = [
      {
        type: 'DROP_SHADOW',
        color: { r: rgb.r, g: rgb.g, b: rgb.b, a: opacity },
        offset: { x: 0, y: 0 },
        radius,
        spread: 0,
        visible: true,
        blendMode: 'SCREEN',
      },
    ];
  } catch {
    // ignore unsupported effects assignment
  }
}

function applyWwdcGlowLayerStyle(
  layerName: string,
  node: SceneNode,
  preset: GlowPreset,
  intensity: GlowIntensity
) {
  const intensityScale = intensity === 'low' ? 0.75 : intensity === 'high' ? 1.35 : 1;
  const coreColor = preset === 'spectrum' ? { r: 1, g: 0.98, b: 0.94 } : { r: 1, g: 0.99, b: 0.97 };
  const outerColor = preset === 'spectrum' ? { r: 0.78, g: 0.82, b: 1 } : { r: 1, g: 1, b: 1 };
  const fringeColor = { r: 0.6, g: 0.7, b: 1 };

  if (layerName === 'Base') {
    (node as BlendMixin).opacity = 0.92;
    return;
  }
  if (layerName === 'Stroke Highlight') {
    setStroke(node, { r: 1, g: 1, b: 1 }, 0.7, 1 * intensityScale);
    (node as BlendMixin).opacity = 0.92;
    return;
  }
  if (layerName === 'Glow Core') {
    setSolidFill(node, coreColor, 0.4);
    setGlowEffects(node, coreColor, 0.5, 8 * intensityScale);
    (node as BlendMixin).opacity = 0.8;
    return;
  }
  if (layerName === 'Glow Outer') {
    setSolidFill(node, outerColor, 0.26);
    setGlowEffects(node, outerColor, 0.35, 24 * intensityScale);
    (node as BlendMixin).opacity = 0.6;
    return;
  }

  setSolidFill(node, fringeColor, preset === 'spectrum' ? 0.22 : 0.14);
  setGlowEffects(node, fringeColor, preset === 'spectrum' ? 0.24 : 0.18, 12 * intensityScale);
  (node as BlendMixin).opacity = 0.45;
}

function applyWwdcGlow(preset: GlowPreset, intensity: GlowIntensity) {
  const selection = figma.currentPage.selection;
  if (!selection.length) {
    figma.notify('请选择文本或支持的形状图层');
    return;
  }

  let okCount = 0;
  let skipUnsupportedCount = 0;
  let skipNoParentCount = 0;
  const createdGroups: SceneNode[] = [];

  for (const node of selection) {
    if (!isGlowSupportedNode(node)) {
      skipUnsupportedCount++;
      continue;
    }
    if (!node.parent || !('appendChild' in node.parent)) {
      skipNoParentCount++;
      continue;
    }

    const parent = node.parent as ChildrenMixin;
    const layerSequence = ['Glow Outer', 'Chromatic Fringe', 'Glow Core', 'Stroke Highlight', 'Base'] as const;
    const layers: SceneNode[] = [];

    for (const layerName of layerSequence) {
      const cloned = cloneNode(node);
      if (!cloned) continue;
      cloned.name = layerName;
      applyWwdcGlowLayerStyle(layerName, cloned, preset, intensity);
      parent.appendChild(cloned);
      layers.push(cloned);
    }

    if (layers.length === 0) {
      skipUnsupportedCount++;
      continue;
    }

    const glowGroup = figma.group(layers, parent);
    glowGroup.name = `WWDC Glow / ${node.name}`;
    try {
      glowGroup.x = node.x;
      glowGroup.y = node.y;
    } catch {
      // ignore position errors
    }

    createdGroups.push(glowGroup);
    okCount++;
  }

  if (createdGroups.length > 0) {
    figma.currentPage.selection = createdGroups;
    figma.viewport.scrollAndZoomIntoView(createdGroups);
  }

  let msg = `WWDC Glow 完成：成功 ${okCount} 个`;
  if (skipUnsupportedCount) msg += `，跳过不支持 ${skipUnsupportedCount} 个`;
  if (skipNoParentCount) msg += `，跳过无父级 ${skipNoParentCount} 个`;
  figma.notify(msg);
}

// ------------------------------
// 5) 接收 UI 面板消息
// ------------------------------

// UI 侧会用 parent.postMessage({ pluginMessage: { type: 'fit' } }, '*') 发送消息。
figma.ui.onmessage = async (msg: PluginMessage | { type?: string; [key: string]: unknown }) => {
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'close':
      figma.closePlugin();
      return;
    case 'fit':
    case 'fitWidth':
    case 'fitHeight':
      fitSelection(msg.type);
      // 注意：这里不 closePlugin，这样面板可以一直留着，方便连续操作。
      return;
    case 'lineHeightPreset':
      if (isLineHeightPreset((msg as PluginMessage).preset)) {
        await applyLineHeightPreset((msg as PluginMessage).preset);
      }
      return;
    case 'applyWwdcGlow':
      if (
        isGlowPreset((msg as PluginMessage).preset) &&
        isGlowIntensity((msg as PluginMessage).intensity)
      ) {
        applyWwdcGlow((msg as PluginMessage).preset, (msg as PluginMessage).intensity);
      }
      return;
    default:
      // 兜底：未知消息类型 → 安全忽略
      return;
  }
};
