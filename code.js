/**
 * PantonLEELab · Fit to Parent (AE-style)
 * 功能：
 * - Fit（适合复合）：保持比例，把选中节点完整塞进容器（contain）并居中
 * - Fit Width（适合宽度）：保持比例，宽度撑满容器并居中
 * - Fit Height（适合高度）：保持比例，高度撑满容器并居中
 *
 * 容器规则（你刚刚确认要加的）：
 * 1) 若选区里同时选中了“恰好 1 个容器” + 其他多个节点
 *    → 用这个容器作为目标容器；其余节点都 fit 到它里面（容器自身不缩放）
 *    → 为了安全，要求“其他节点必须是该容器的直接子层”，否则跳过并提示
 * 2) 否则：每个节点都 fit 到自己的 parent
 */

// ------------------------------
// 1) 启动并展示 UI 面板
// ------------------------------
// __html__ 会由 Figma 在运行时注入为 ui.html 的内容。
// 这里控制面板尺寸：你后面想更紧凑/更宽都可以改。
figma.showUI(__html__, { width: 360, height: 560 });

// ------------------------------
// 2) 工具函数：尺寸/容器识别
// ------------------------------

/**
 * 判断一个节点是否具备 width/height。
 * 注意：并非所有 BaseNode 都有这两个字段。
 */
function hasSize(node) {
  return node && typeof node.width === 'number' && typeof node.height === 'number';
}

/**
 * 判断一个 SceneNode 是否可以作为“容器候选”。
 * 这里把 Frame/Component/Instance/Section/Group 都算容器。
 */
function isContainerCandidate(node) {
  if (!node) return false;
  var t = node.type;
  var isCandidate =
    t === 'FRAME' ||
    t === 'COMPONENT' ||
    t === 'INSTANCE' ||
    t === 'SECTION' ||
    t === 'GROUP';
  return isCandidate && hasSize(node);
}

function getNodeDepth(node) {
  // 用来在多个可用容器里选“更深层”的那个
  var d = 0;
  var p = node.parent;
  while (p) {
    d++;
    p = p.parent;
  }
  return d;
}

function isDescendantOf(node, ancestor) {
  // 判断 node 是否在 ancestor 之下（任意后代层级）
  var p = node.parent;
  while (p) {
    if (p.id === ancestor.id) return true;
    p = p.parent;
  }
  return false;
}

function getContainerFromSelection(selection) {
  // 选区只有 0/1 个节点时，不启用“选中容器模式”
  if (!selection || selection.length <= 1) {
    return { container: null, targets: selection ? selection.slice() : [] };
  }

  var candidates = selection.filter(isContainerCandidate);
  if (candidates.length === 0) {
    return { container: null, targets: selection.slice() };
  }

  // 过滤出“能包含所有其他选中节点”的容器
  var valid = candidates.filter(function (c) {
    return selection.every(function (n) {
      return n.id === c.id || isDescendantOf(n, c);
    });
  });

  if (valid.length === 0) {
    // 没有任何容器能包含所有选中节点 → 回退 parent 模式
    return { container: null, targets: selection.slice() };
  }

  // 若有多个可用容器，选最深的那个（更接近用户想要的“当前容器”）
  valid.sort(function (a, b) { return getNodeDepth(b) - getNodeDepth(a); });
  var container = valid[0];
  var targets = selection.filter(function (n) { return n.id !== container.id; });
  return { container: container, targets: targets };
}

/**
 * 回退逻辑：没有选中容器时，用 node.parent 当容器。
 */
function getParentContainer(node) {
  var p = node.parent;
  return p && hasSize(p) ? p : null;
}

// ------------------------------
// 3) 工具函数：计算缩放/resize/居中
// ------------------------------

/**
 * 计算缩放系数 s。
 * - fit：s = min(pw/w, ph/h)
 * - fitWidth：s = pw/w
 * - fitHeight：s = ph/h
 */
function computeScale(mode, pw, ph, w, h) {
  if (w <= 0 || h <= 0) return 1;
  if (mode === 'fit') return Math.min(pw / w, ph / h);
  if (mode === 'fitWidth') return pw / w;
  return ph / h; // fitHeight
}

/**
 * 尝试 resize。
 * - 优先用 resizeWithoutConstraints（如果存在），能更少受 constraints 影响
 * - 否则用 resize
 */
function resizeNode(node, w, h) {
  var ww = Math.max(0.01, w);
  var hh = Math.max(0.01, h);

  try {
    if (typeof node.resizeWithoutConstraints === 'function') {
      node.resizeWithoutConstraints(ww, hh);
      return true;
    }
    if (typeof node.resize === 'function') {
      node.resize(ww, hh);
      return true;
    }
  } catch (e) {
    // 某些节点（比如 instance 内部、或被强约束）可能抛错，直接视为失败
  }

  return false;
}

/**
 * 判断父容器是否为 Auto Layout。
 * - Auto Layout 下子项默认由布局系统控制位置，直接改 x/y 可能无效
 */
function parentIsAutoLayout(p) {
  return (
    (p.type === 'FRAME' || p.type === 'COMPONENT' || p.type === 'INSTANCE') &&
    'layoutMode' in p &&
    p.layoutMode !== 'NONE'
  );
}

/**
 * 将 node 在 parent 内居中。
 * - 若 parent 是 Auto Layout：尽量把 node 设为 ABSOLUTE，才能手动设 x/y
 */
function centerInParent(node, parent) {
  if (parentIsAutoLayout(parent)) {
    if ('layoutPositioning' in node) {
      try {
        node.layoutPositioning = 'ABSOLUTE';
      } catch (e) {
        // 不可设置则忽略
      }
    }
  }

  try {
    node.x = (parent.width - node.width) / 2;
    node.y = (parent.height - node.height) / 2;
  } catch (e) {
    // 少数情况下 x/y 不可写，忽略
  }
}

// ------------------------------
// 4) 核心逻辑：对选区执行 Fit
// ------------------------------

function fitSelection(mode) {
  var selection = figma.currentPage.selection;

  if (!selection || selection.length === 0) {
    figma.notify('请选择至少一个图层 / Frame');
    return;
  }

  var resolved = getContainerFromSelection(selection);
  var container = resolved.container;
  var targets = resolved.targets;

  var okCount = 0;
  var skipCount = 0;
  var skipNotDirectChild = 0;

  for (var i = 0; i < targets.length; i++) {
    var node = targets[i];

    // 目标容器：优先用“选中容器模式”，否则用 node.parent
    var targetContainer = container || getParentContainer(node);
    if (!targetContainer) {
      skipCount++;
      continue;
    }

    // 安全约束：如果是“选中容器模式”，要求 node 必须是容器的直接子层。
    // 否则 x/y 居中会落在错误的坐标系里（你后续要支持后代/跨层级时再升级）。
    if (container && (!node.parent || node.parent.id !== container.id)) {
      skipCount++;
      skipNotDirectChild++;
      continue;
    }

    var s = computeScale(mode, targetContainer.width, targetContainer.height, node.width, node.height);
    var newW = node.width * s;
    var newH = node.height * s;

    var ok = resizeNode(node, newW, newH);
    if (!ok) {
      skipCount++;
      continue;
    }

    centerInParent(node, targetContainer);
    okCount++;
  }

  var modeName = mode === 'fit' ? 'Fit' : mode === 'fitWidth' ? 'Fit Width' : 'Fit Height';

  var msg = modeName + ' 完成：成功 ' + okCount + ' 个';
  if (skipCount) msg += '，跳过 ' + skipCount + ' 个';
  if (skipNotDirectChild) msg += '（其中 ' + skipNotDirectChild + ' 个不是容器的直接子层）';

  figma.notify(msg);
}

// ------------------------------
// 5) UI -> 插件：消息接收
// ------------------------------

// ------------------------------
// 5.1) 行高预设逻辑（v1）
// ------------------------------

var LINE_HEIGHT_PRESETS = ['auto', 'smart', '1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.8', '2.0'];
var GLOW_PRESETS = ['softWhite', 'spectrum'];
var GLOW_INTENSITIES = ['low', 'medium', 'high'];

function isLineHeightPreset(value) {
  return typeof value === 'string' && LINE_HEIGHT_PRESETS.indexOf(value) !== -1;
}

function isGlowPreset(value) {
  return typeof value === 'string' && GLOW_PRESETS.indexOf(value) !== -1;
}

function isGlowIntensity(value) {
  return typeof value === 'string' && GLOW_INTENSITIES.indexOf(value) !== -1;
}

function isLineHeightContainer(node) {
  return (
    node &&
    (node.type === 'FRAME' ||
      node.type === 'GROUP' ||
      node.type === 'COMPONENT' ||
      node.type === 'INSTANCE')
  );
}

function collectTextNodes(node, bucket) {
  if (!node) return;
  if (node.type === 'TEXT') {
    bucket.push(node);
    return;
  }
  if ('children' in node && node.children) {
    for (var i = 0; i < node.children.length; i++) {
      collectTextNodes(node.children[i], bucket);
    }
  }
}

function roundToHalf(value) {
  return Math.round(value * 2) / 2;
}

var SMART_DOMINANCE_RATIO = 0.7;

function isLatinLetter(char) {
  return /[A-Za-z]/.test(char);
}

function isCjkChar(char) {
  return /[\u4E00-\u9FFF]/.test(char);
}

function getSmartLineHeightScale(text) {
  if (!text) return null;

  var latinCount = 0;
  var cjkCount = 0;

  for (var i = 0; i < text.length; i++) {
    var char = text[i];
    if (isLatinLetter(char)) {
      latinCount += 1;
      continue;
    }
    if (isCjkChar(char)) {
      cjkCount += 1;
    }
  }

  var total = latinCount + cjkCount;
  if (total === 0) return null;

  var latinRatio = latinCount / total;
  var cjkRatio = cjkCount / total;

  if (latinRatio >= SMART_DOMINANCE_RATIO) return 1.2;
  if (cjkRatio >= SMART_DOMINANCE_RATIO) return 1.5;
  return null;
}

function dedupeById(nodes) {
  var map = {};
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (!n || !n.id) continue;
    if (!map[n.id]) {
      map[n.id] = true;
      out.push(n);
    }
  }
  return out;
}

async function applyLineHeightPreset(preset) {
  var selection = figma.currentPage.selection;

  if (!selection || selection.length === 0) {
    figma.notify('请选择至少一个图层 / Frame');
    return;
  }

  var collected = [];
  for (var i = 0; i < selection.length; i++) {
    var node = selection[i];
    if (!node) continue;

    if (node.type === 'TEXT') {
      collected.push(node);
      continue;
    }

    if (isLineHeightContainer(node)) {
      collectTextNodes(node, collected);
    }
  }

  var textNodes = dedupeById(collected);

  if (textNodes.length === 0) {
    figma.notify('未找到可用文本图层');
    return;
  }

  var okCount = 0;
  var skipCount = 0;

  for (var j = 0; j < textNodes.length; j++) {
    var t = textNodes[j];

    // v1：跳过 mixed
    if (t.fontSize === figma.mixed || t.fontName === figma.mixed) {
      skipCount++;
      continue;
    }

    try {
      await figma.loadFontAsync(t.fontName);
    } catch (e) {
      skipCount++;
      continue;
    }

    if (preset === 'auto') {
      t.lineHeight = { unit: 'AUTO' };
    } else if (preset === 'smart') {
      var smartScale = getSmartLineHeightScale(t.characters);
      if (!smartScale) {
        skipCount++;
        continue;
      }
      var smartPx = roundToHalf(Number(t.fontSize) * smartScale);
      t.lineHeight = { unit: 'PIXELS', value: smartPx };
    } else {
      var scale = Number(preset);
      var px = roundToHalf(Number(t.fontSize) * scale);
      t.lineHeight = { unit: 'PIXELS', value: px };
    }

    okCount++;
  }

  var actionLabel = preset === 'smart' ? '智能行高' : '行高预设';
  var msg = actionLabel + '完成：成功 ' + okCount + ' 个';
  if (skipCount) msg += '，跳过 ' + skipCount + ' 个';
  figma.notify(msg);
}

function isGlowSupportedNode(node) {
  return (
    node &&
    (node.type === 'TEXT' ||
      node.type === 'VECTOR' ||
      node.type === 'RECTANGLE' ||
      node.type === 'ELLIPSE' ||
      node.type === 'POLYGON' ||
      node.type === 'STAR' ||
      node.type === 'LINE' ||
      node.type === 'BOOLEAN_OPERATION')
  );
}

function cloneNode(node) {
  if (!node || typeof node.clone !== 'function') return null;
  try {
    return node.clone();
  } catch (e) {
    return null;
  }
}

function toPaintColor(rgb, opacity) {
  return { type: 'SOLID', color: rgb, opacity: opacity };
}

function setSolidFill(node, rgb, opacity) {
  if (!node || !('fills' in node)) return;
  try {
    node.fills = [toPaintColor(rgb, opacity)];
  } catch (e) {}
}

function setLinearGradientFill(node, stops) {
  if (!node || !('fills' in node)) return;
  try {
    node.fills = [{
      type: 'GRADIENT_LINEAR',
      gradientStops: stops,
      gradientTransform: [
        [0.7071, 0.7071, -0.2071],
        [-0.7071, 0.7071, 0.5]
      ]
    }];
  } catch (e) {}
}

function setStroke(node, rgb, opacity, weight) {
  if (!node || !('strokes' in node)) return;
  try {
    node.strokes = [toPaintColor(rgb, opacity)];
    if ('strokeWeight' in node) {
      node.strokeWeight = weight;
    }
  } catch (e) {}
}

function setGlowEffects(node, shadows) {
  if (!node || !('effects' in node)) return;
  try {
    node.effects = shadows.map(function (shadow) {
      return {
        type: 'DROP_SHADOW',
        color: { r: shadow.rgb.r, g: shadow.rgb.g, b: shadow.rgb.b, a: shadow.opacity },
        offset: { x: shadow.offsetX || 0, y: shadow.offsetY || 0 },
        radius: shadow.radius,
        spread: 0,
        visible: true,
        blendMode: 'SCREEN'
      };
    });
  } catch (e) {}
}

function setNodeBlendMode(node, blendMode) {
  if (!node || !('blendMode' in node)) return;
  try {
    node.blendMode = blendMode;
  } catch (e) {}
}

function applyWwdcGlowLayerStyle(layerName, node, preset, intensity) {
  var tone = preset === 'spectrum' ? {
    base: { r: 0.16, g: 0.17, b: 0.2 },
    edge: { r: 0.97, g: 0.99, b: 1 },
    core: { r: 0.9, g: 0.94, b: 1 },
    outer: { r: 0.5, g: 0.61, b: 0.95 },
    fringeCool: { r: 0.52, g: 0.66, b: 1 },
    fringeWarm: { r: 1, g: 0.76, b: 0.62 }
  } : {
    base: { r: 0.18, g: 0.18, b: 0.19 },
    edge: { r: 0.99, g: 0.99, b: 0.98 },
    core: { r: 1, g: 0.96, b: 0.9 },
    outer: { r: 0.79, g: 0.83, b: 0.92 },
    fringeCool: { r: 0.62, g: 0.72, b: 0.95 },
    fringeWarm: { r: 1, g: 0.84, b: 0.72 }
  };

  var intensityStyle = intensity === 'low' ? {
    baseOpacity: 0.96,
    edgeOpacity: 0.9,
    edgeWeight: 1.15,
    edgeHalo: 1.8,
    coreFill: 0.42,
    coreGlowOpacity: 0.46,
    coreRadius: 5,
    outerFill: 0.08,
    outerGlowOpacity: 0.16,
    outerRadius: 16,
    fringeFill: 0.06,
    fringeGlowOpacity: 0.12,
    fringeRadius: 6,
    fringeOffset: 0.5
  } : intensity === 'high' ? {
    baseOpacity: 0.9,
    edgeOpacity: 0.86,
    edgeWeight: 1.25,
    edgeHalo: 2.5,
    coreFill: 0.52,
    coreGlowOpacity: 0.62,
    coreRadius: 9,
    outerFill: 0.14,
    outerGlowOpacity: 0.26,
    outerRadius: 34,
    fringeFill: 0.12,
    fringeGlowOpacity: 0.2,
    fringeRadius: 11,
    fringeOffset: 1.2
  } : {
    baseOpacity: 0.93,
    edgeOpacity: 0.88,
    edgeWeight: 1.2,
    edgeHalo: 2.1,
    coreFill: 0.48,
    coreGlowOpacity: 0.54,
    coreRadius: 7,
    outerFill: 0.11,
    outerGlowOpacity: 0.21,
    outerRadius: 24,
    fringeFill: 0.09,
    fringeGlowOpacity: 0.16,
    fringeRadius: 8,
    fringeOffset: 0.8
  };

  if (layerName === 'Base') {
    setLinearGradientFill(node, [
      { position: 0, color: Object.assign({}, tone.base, { a: 0.98 }) },
      {
        position: 0.56,
        color: {
          r: tone.base.r + 0.06,
          g: tone.base.g + 0.06,
          b: tone.base.b + 0.065,
          a: 0.95
        }
      },
      {
        position: 1,
        color: {
          r: Math.min(1, tone.base.r + 0.16),
          g: Math.min(1, tone.base.g + 0.16),
          b: Math.min(1, tone.base.b + 0.17),
          a: 0.9
        }
      }
    ]);
    setStroke(node, tone.base, 0.62, 0.75);
    setGlowEffects(node, []);
    setNodeBlendMode(node, 'NORMAL');
    node.opacity = intensityStyle.baseOpacity;
    return;
  }
  if (layerName === 'Stroke Highlight') {
    setLinearGradientFill(node, [
      { position: 0, color: Object.assign({}, tone.edge, { a: 0.13 }) },
      { position: 0.4, color: Object.assign({}, tone.edge, { a: 0.05 }) },
      { position: 1, color: Object.assign({}, tone.edge, { a: 0.02 }) }
    ]);
    setStroke(node, tone.edge, intensityStyle.edgeOpacity, intensityStyle.edgeWeight);
    setGlowEffects(node, [{
      rgb: tone.edge,
      opacity: Math.min(0.45, intensityStyle.edgeHalo * 0.17),
      radius: intensityStyle.edgeHalo * 0.92,
      offsetX: -0.9,
      offsetY: -0.9
    }, {
      rgb: tone.outer,
      opacity: intensity === 'low' ? 0.08 : intensity === 'high' ? 0.14 : 0.11,
      radius: intensityStyle.edgeHalo * 0.95,
      offsetX: 0.8,
      offsetY: 0.8
    }]);
    setNodeBlendMode(node, 'SCREEN');
    node.opacity = 0.98;
    return;
  }
  if (layerName === 'Glow Core') {
    setSolidFill(node, tone.core, intensityStyle.coreFill);
    setStroke(node, tone.core, 0.18, 0.9);
    setGlowEffects(node, [{
      rgb: tone.core,
      opacity: intensityStyle.coreGlowOpacity,
      radius: intensityStyle.coreRadius,
      offsetX: -0.8,
      offsetY: -0.8
    }, {
      rgb: tone.fringeWarm,
      opacity: intensity === 'low' ? 0.1 : intensity === 'high' ? 0.18 : 0.14,
      radius: intensityStyle.coreRadius * 0.65,
      offsetX: -0.4,
      offsetY: -0.4
    }]);
    setNodeBlendMode(node, 'SCREEN');
    node.opacity = 0.78;
    return;
  }
  if (layerName === 'Glow Outer') {
    setSolidFill(node, tone.outer, intensityStyle.outerFill);
    setGlowEffects(node, [{
      rgb: tone.outer,
      opacity: intensityStyle.outerGlowOpacity,
      radius: intensityStyle.outerRadius
    }, {
      rgb: tone.outer,
      opacity: intensity === 'high' ? 0.1 : 0.07,
      radius: intensityStyle.outerRadius * 1.35,
      offsetX: 1.2,
      offsetY: 1.2
    }, {
      rgb: tone.fringeCool,
      opacity: intensity === 'low' ? 0.09 : intensity === 'high' ? 0.16 : 0.12,
      radius: intensityStyle.outerRadius * 0.72,
      offsetX: 1.6,
      offsetY: 1.6
    }]);
    setNodeBlendMode(node, 'SCREEN');
    node.opacity = 0.58;
    return;
  }

  setSolidFill(node, tone.fringeCool, intensityStyle.fringeFill);
  setGlowEffects(node, [{
    rgb: tone.fringeCool,
    opacity: intensityStyle.fringeGlowOpacity,
    radius: intensityStyle.fringeRadius,
    offsetX: intensityStyle.fringeOffset,
    offsetY: intensityStyle.fringeOffset * 0.8
  }, {
    rgb: tone.fringeWarm,
    opacity: intensity === 'low' ? 0.05 : intensity === 'high' ? 0.1 : 0.07,
    radius: intensityStyle.fringeRadius * 0.9,
    offsetX: -intensityStyle.fringeOffset * 0.85,
    offsetY: -intensityStyle.fringeOffset * 0.6
  }]);
  setNodeBlendMode(node, 'SCREEN');
  node.opacity = intensity === 'low' ? 0.38 : intensity === 'high' ? 0.55 : 0.46;
}

function applyWwdcGlow(preset, intensity) {
  var selection = figma.currentPage.selection;
  if (!selection || selection.length === 0) {
    figma.notify('请选择文本或支持的形状图层');
    return;
  }

  var okCount = 0;
  var skipUnsupportedCount = 0;
  var skipNoParentCount = 0;
  var createdGroups = [];

  for (var i = 0; i < selection.length; i++) {
    var node = selection[i];
    if (!isGlowSupportedNode(node)) {
      skipUnsupportedCount++;
      continue;
    }
    if (!node.parent || !('appendChild' in node.parent)) {
      skipNoParentCount++;
      continue;
    }

    var parent = node.parent;
    var layerSequence = ['Glow Outer', 'Chromatic Fringe', 'Glow Core', 'Stroke Highlight', 'Base'];
    var layers = [];

    for (var j = 0; j < layerSequence.length; j++) {
      var layerName = layerSequence[j];
      var cloned = cloneNode(node);
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

    var glowGroup = figma.group(layers, parent);
    glowGroup.name = 'WWDC Glow / ' + node.name;
    try {
      glowGroup.x = node.x;
      glowGroup.y = node.y;
    } catch (e) {}

    createdGroups.push(glowGroup);
    okCount++;
  }

  if (createdGroups.length > 0) {
    figma.currentPage.selection = createdGroups;
    figma.viewport.scrollAndZoomIntoView(createdGroups);
  }

  var msg = 'WWDC Glow 完成：成功 ' + okCount + ' 个';
  if (skipUnsupportedCount) msg += '，跳过不支持 ' + skipUnsupportedCount + ' 个';
  if (skipNoParentCount) msg += '，跳过无父级 ' + skipNoParentCount + ' 个';
  figma.notify(msg);
}

/**
 * ui.html 里会通过：
 * parent.postMessage({ pluginMessage: { type: 'fit' } }, '*')
 * 发送消息到这里。
 */
figma.ui.onmessage = async function (msg) {
  if (!msg || typeof msg.type !== 'string') {
    // 静默忽略无效消息，避免刷屏
    return;
  }

  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }

  if (msg.type === 'fit' || msg.type === 'fitWidth' || msg.type === 'fitHeight') {
    fitSelection(msg.type);
    // 不 closePlugin：让面板常驻
    return;
  }

  if (msg.type === 'lineHeightPreset') {
    var preset = msg.preset;
    if (isLineHeightPreset(preset)) {
      await applyLineHeightPreset(preset);
    }
    return;
  }

  if (msg.type === 'applyWwdcGlow') {
    if (isGlowPreset(msg.preset) && isGlowIntensity(msg.intensity)) {
      applyWwdcGlow(msg.preset, msg.intensity);
    }
    return;
  }

  return;
};
