# FBA 利润速算器（Amazon FBA Profit Calculator）

在亚马逊商品页侧边自动注入一个利润计算面板。输入采购价、头程运费、售价，立即算出扣除 **FBA 配送费、平台佣金、关税、仓储费、增值税** 之后的净利润与利润率。支持美国、欧洲、日本等 8 个站点费率一键切换。

> **这就是可发布版本。** 本仓库同时是源码仓库与发布仓库，`src/` 目录即已构建完成的扩展本体，可直接加载。

---

## 目录

- [快速安装](#快速安装chrome--edge)
- [激活码](#激活码)
- [使用方式](#使用方式)
- [计算口径](#计算口径)
- [支持的站点](#支持的站点)
- [打包为 zip / crx](#打包为-zip--crx)
- [开发与测试](#开发与测试)
- [项目结构](#项目结构)
- [技术要点](#技术要点)
- [常见问题](#常见问题)

---

## 快速安装（Chrome / Edge）

1. 打开浏览器，地址栏输入 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 打开右上角的 **「开发者模式」**
3. 点击 **「加载已解压的扩展程序」**
4. 选择本项目的 **`src`** 文件夹（注意：选 `src`，不是项目根目录）
5. 安装完成，工具栏会出现蓝色上升箭头图标

> 首次安装会自动打开欢迎页。在商品页面板或弹窗中输入激活码即可解锁全部功能。
>
> ⚠️ **Chrome 155+ 稳定版已禁止命令行侧载**（`--load-extension is not allowed in Google Chrome, ignoring.`），因此只能按上面步骤手动加载。打包为 `.crx` 需在企业策略环境下部署，见 [打包为 zip / crx](#打包为-zip--crx)。

---

## 激活码

本工具采用**一次性授权**模式，首版激活码硬编码在源码中。

| 项 | 值 |
|---|---|
| 默认激活码 | `123456aB!`（区分大小写，注意末尾为感叹号） |
| 校验方式 | FNV-1a 变体哈希 + 盐，源码中不出现明文比对 |
| 存储位置 | `chrome.storage.local`（本机持久，不上传） |
| 生效范围 | 面板与弹窗共享同一激活状态 |

激活后：

- **面板**：锁屏消失，进入完整计算界面
- **弹窗**：右上角显示「已激活」，并提供「取消激活」按钮，便于在另一台设备上重新授权

激活码在 `src/lib/license.js` 中维护：

```js
const SALT = 'fba::2026::v1';
const VALID_FINGERPRINTS = ['3b65584d7ab911f6'];
```

新增或更换激活码后，需同步更新该数组（见 [开发与测试](#开发与测试) 中的哈希生成方法）。

---

## 使用方式

### 一、商品页侧边面板（主要用法）

访问任意亚马逊商品详情页，例如：

```
https://www.amazon.com/dp/B0XXXXXXXX
https://www.amazon.co.uk/dp/B0XXXXXXXX
https://www.amazon.de/dp/B0XXXXXXXX
https://www.amazon.co.jp/dp/B0XXXXXXXX
```

页面右侧会自动浮出面板，并且：

| 自动抓取 | 说明 |
|---|---|
| 售价 | 从页面价格区块读取，自动识别小数点格式（欧洲站逗号分隔） |
| 站点 | 按域名自动识别，佣金率 / 费率 / 币种同步切换 |
| 重量与尺寸 | 从商品详情表解析，自动换算为站点所需单位（支持 lb/kg/oz/g 与 in/cm/mm） |
| 类目 | 从面包屑导航推断，匹配费率表里的佣金类目 |
| ASIN | 从 URL 或页面提取，显示在面板上 |

你只需要手动补 **采购价** 和 **头程运费**，结果实时刷新。

**面板交互**：

- 拖动标题栏可移动面板位置
- `—` 折叠为悬浮球（点击悬浮球展开）
- `✕` 关闭面板（可在扩展弹窗里重新开启）
- 顶部站点芯片 / 类目芯片可点击切换
- 主输出区在币种金额下方同步显示 **人民币折算值**

### 二、弹窗主控台

点击工具栏图标打开，包含三个标签页：

- **速算**：不依赖商品页，手动输入随时测算；支持「复制结果」一键导出文本
- **设置**：总开关、目标利润率预警、默认站点、面板位置、人民币显示开关、全局汇率表、按站点覆盖费率、配置导入导出
- **费率速查**：快速浏览各站点的佣金表、FBA 分段费与基础税率

---

## 计算口径

```
售价（含税，欧洲/日本先剥离 VAT）
 ├─ 增值税 VAT           欧洲 19–22% / 日本 10%
 ├─ 平台佣金             = 售价 × 类目佣金率（默认 15%）
 ├─ FBA 配送费           = 按重量查站点分段表
 ├─ 月度仓储费           = 体积(cm³) × 单价 × 周转月数（10–12 月为旺季价）
 ├─ 关税                 = (采购价 + 头程) × 关税率
 ├─ 采购成本             = 采购价（单件）
 ├─ 头程运费             = 单件头程
 └─ 其他费用             = 广告分摊 / 测评等
 = 净利润
```

同时输出：

- **利润率** = 净利润 ÷ 不含税净收入
- **ROI** = 净利润 ÷ (采购价 + 头程)
- **盈亏平衡价** = 使净利润恰好为 0 的售价（反解方程）
- **目标利润率下的最高采购价**（反解方程）
- **人民币折算** = 净利润 × 汇率（默认 USD 7.15 / GBP 9.05 / EUR 7.75 / JPY 0.0475 / CAD 5.25）

> **颜色约定**：按中国习惯，盈利显示为红色，亏损显示为绿色。
>
> **取整策略**：中间过程保留完整精度，仅在最终输出时取整，避免误差累积。

---

## 支持的站点

| 站点 | 域名 | 货币 | VAT/消费税 | 默认关税 |
|---|---|---|---|---|
| 美国 | amazon.com | USD | — | 7.5% |
| 英国 | amazon.co.uk | GBP | 20% | 4% |
| 德国 | amazon.de | EUR | 19% | 4% |
| 法国 | amazon.fr | EUR | 20% | 4% |
| 意大利 | amazon.it | EUR | 22% | 4% |
| 西班牙 | amazon.es | EUR | 21% | 4% |
| 日本 | amazon.co.jp | JPY | 10% | 3% |
| 加拿大 | amazon.ca | CAD | 5% | 6% |

另有 13 个站点的域名权限已在 `manifest.json` 中声明（荷兰、瑞典、波兰、墨西哥、澳洲、新加坡、印度、阿联酋、巴西、土耳其、沙特、埃及、比利时），可在「设置 → 按站点覆盖费率」中手动校准后使用。

### 费率准确性说明（重要）

内置费率基准为 **2024–2025 年亚马逊公开费率**，仅作为默认参考值。以下因素会导致实际费用与计算结果有偏差：

- 亚马逊不定期调整佣金率、FBA 配送费与仓储费
- 实际 FBA 费受**尺寸分段**（标准/大件/轻小）、**体积重**、**低库存附加费**、**旺季附加费**等影响
- 关税税率取决于具体 HS 编码、申报价值与原产国
- VAT 存在进项抵扣，本工具按净销项简化处理

**建议**：在「设置 → 按站点覆盖费率」中按你自己店铺后台的真实费率校准后再用于决策。所有覆盖值保存在浏览器本地，不会上传。

---

## 打包为 zip / crx

`src/` 目录本身即已构建产物，打包即发布。

### 打包 zip（用于分发或上架）

**Windows（PowerShell）：**

```powershell
Compress-Archive -Path .\src\* -DestinationPath .\dist\fba-profit-calculator-1.0.0.zip -Force
```

**macOS / Linux：**

```bash
mkdir -p dist
cd src && zip -r ../dist/fba-profit-calculator-1.0.0.zip . -x '*.DS_Store' && cd ..
```

### 打包 crx（企业策略部署）

`.crx` 需要 Chrome 私钥签名。在 Chrome 155+ 中，本地打包含私钥的 `.crx` 仅能通过企业策略（`ExtensionInstallForcelist`）或 Chrome for Testing 安装，普通用户请直接使用上面的 zip + 手动加载方式。

```bash
# 生成私钥（仅首次）
openssl genrsa -out key.pem 2048

# 打包（需 Chrome for Testing 或 chromium）
chrome --pack-extension=./src --pack-extension-key=./key.pem
# 产物：src.crx（与 src.pem 同级）
```

> ⚠️ `key.pem` 请妥善保管并**不要提交到仓库**（已在 `.gitignore` 中排除）。密钥泄露等同扩展 ID 被他人冒用。

### 发布前检查清单

```bash
# 1. 计算引擎自检（63 项断言）
node tests/selftest.js

# 2. 浏览器端集成测试（46 项断言，需 Chrome）
npm run test:browser

# 3. 安装前体检（31 项：清单/文件/图标/语法）
npm run verify:install
```

三项全绿后再打包发布。

---

## 开发与测试

```bash
# 计算引擎自检 —— 63 项断言，零依赖
node tests/selftest.js

# 浏览器端集成测试 —— 真实 Chrome 中运行 46 项断言
npm run test:browser          # 等价于: node tools/run-browser-tests.js

# 安装引导 + 安装后自动验证
npm run verify:install        # 等价于: node tools/install-and-verify.js

# 重新生成图标（16/32/48/128，零依赖手写 PNG 编码）
node tools/make-icons.js
```

> 浏览器端测试依赖 `ws`。若全局未安装，使用隔离运行时：
> ```bash
> NODE_PATH="C:/Users/<你>/.workbuddy-ai/binaries/node/workspace/node_modules" node tools/run-browser-tests.js
> ```

### 测试覆盖范围

**`tests/selftest.js`（Node，63 项）**

站点识别（含 `amazon.com.mx` 不被误判为美国站的边界）、美国站手工核算、德国站 VAT 剥离、日本站分段费、美国站递增段位、仓储费淡旺季、盈亏平衡价反解精度、目标利润率反解、负利润预警、字符串输入解析、未知站点回退、最低佣金下限（$0.30）、激活码校验与持久化、人民币换算与汇率覆盖。

**`tests/fixtures/panel-verify.html` + `tools/run-browser-tests.js`（真实 Chrome，46 项）**

模块加载、激活码校验、面板注入（Shadow DOM）、未激活锁屏、错误码拒绝、正确码解锁、激活后站点芯片/类目芯片渲染、售价/重量/尺寸/ASIN 自动抓取、实时计算与人民币折算、多站点切换（US↔JP 币种与单位联动）、存储持久化。

### 更换激活码

```bash
# 生成新激活码的指纹（与 lib/license.js 中 hash() 算法一致）
node -e "
const SALT='fba::2026::v1', code='你的新激活码';
let h=0x811c9dc5;
const s=SALT+'\u0001'+code;
for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}
console.log(code+' => '+h.toString(16).padStart(16,'0'));
"
```

把输出填入 `src/lib/license.js` 的 `VALID_FINGERPRINTS`，并同步更新 `tests/selftest.js` 与 `tests/fixtures/panel-verify.html` 中的测试用例。

---

## 项目结构

```
fba-profit-calculator/
├── src/                          ← 加载扩展时选择这个目录（= 已构建产物）
│   ├── manifest.json             Manifest V3 配置
│   ├── background.js             Service Worker（默认值初始化、标签页查询）
│   ├── lib/
│   │   ├── sites.js              多站点费率数据 + 域名识别
│   │   ├── cn.js                 人民币折算、类目中英映射、汇率表
│   │   ├── license.js            激活码校验与授权状态（哈希校验）
│   │   ├── calculator.js         纯函数计算引擎（无 DOM 依赖）
│   │   └── storage.js            设置持久化封装（chrome.storage.sync）
│   ├── content/
│   │   └── panel.js              商品页侧边面板（Shadow DOM 隔离）
│   ├── popup/
│   │   ├── popup.html/css/js     主控台（速算 / 设置 / 费率速查）
│   │   └── welcome.html          安装后欢迎页
│   └── icons/                    16 / 32 / 48 / 128 图标
├── tests/
│   ├── selftest.js               计算引擎自检（63 项断言）
│   └── fixtures/
│       └── panel-verify.html     浏览器端集成测试页（46 项断言）
├── tools/
│   ├── run-browser-tests.js      在真实 Chrome 中跑集成测试 + 截图
│   ├── install-and-verify.js     安装引导 + 安装后自动验证（31 项体检）
│   └── make-icons.js             图标生成脚本（零依赖，手写 PNG 编码）
├── demo/
│   └── index.html                独立演示页（无需安装即可体验算法）
└── package.json
```

---

## 技术要点

- **Manifest V3**，`content_scripts` 静态注入，无需 `tabs` 权限
- **Shadow DOM** 完全隔离面板样式：既不被亚马逊页面 CSS 污染，也不污染页面
- **计算引擎纯函数化**：`calculator.js` 不依赖 DOM，可在 Node 中直接测试
- **单次取整**：中间过程保留完整精度，仅在最终输出时取整，避免误差累积
- **严格后缀域名匹配**：`host === pattern || host.endsWith('.' + pattern)`，避免 `amazon.com.mx` 被误判为美国站
- **解析式反解**：盈亏平衡价与最高采购价用代数反解而非迭代，结果精确
- 面板监听 `chrome.storage.onChanged`，弹窗改设置后面板**实时同步**
- 针对亚马逊 SPA 路由做 URL 轮询，跳转到新商品页自动重新抓取
- 图标由零依赖手写 PNG 编码器生成（3× 超采样抗锯齿）

---

## 常见问题

**面板没有出现？**

- 确认当前页面是商品详情页（URL 含 `/dp/` 或 `/gp/product/`）
- 检查扩展弹窗右上角开关是否开启
- 刷新页面重试（部分页面加载较慢）

**提示「需要激活码」？**

- 输入 `123456aB!`。注意区分大小写，末尾是英文感叹号
- 在弹窗「取消激活」后可换码重新激活

**重量/尺寸是空的？**

- 亚马逊并非所有商品都公开重量尺寸，属正常现象，可手动填写
- 不填则 FBA 配送费无法匹配准确分段，工具会给出提示

**想用自己的费率？**

- 「设置 → 按站点覆盖费率」，选择站点后填写佣金率、关税率、VAT、汇率并保存

**人民币折算汇率不对？**

- 「设置 → 全局汇率」统一调整，或对单个站点做覆盖

**为什么净利润和我自己算的不一样？**

- 检查是否勾选了「计入月度仓储费」（默认开启，会让结果偏低）
- 检查关税率字段是否填了自定义值
- 欧洲/日本站售价含税，工具会先剥离 VAT，这是与「售价直接减成本」算法差异的主要来源

---

## 私有仓库发布

本仓库设计为**私有**。`.gitignore` 已排除以下内容：

| 排除项 | 原因 |
|---|---|
| `key.pem` / `*.pem` | crx 签名私钥，泄露会导致扩展 ID 被冒用 |
| `dist/` | 打包产物，按需生成即可 |
| `node_modules/` | 依赖，可由 `package.json` 还原 |
| `tests/fixtures/*.png` | 测试运行产生的截图 |

```bash
# 首次发布
git init
git add .
git commit -m "feat: FBA 利润速算器 v1.0.0"
git branch -M main
git remote add origin git@github.com:<你的账号>/fba-profit-calculator.git
git push -u origin main

# 后续更新
git add -A && git commit -m "chore: ..." && git push
```

> 若使用 HTTPS 而非 SSH，需配置 Personal Access Token（`gh auth login` 或 Git 凭据管理器）。

---

## 许可证

私有项目，未经授权禁止分发。
