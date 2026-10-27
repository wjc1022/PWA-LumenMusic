# KTV 播放体验改造计划

更新日期：2026-10-27。以下状态以当前工作区为准。文末“横屏视频与按钮设置”是最新执行基准；历史测试记录不代表本轮重新验证。

## 当前实现状态

### 已实现（代码层面）
- [x] 将歌词并入完整播放器，移除独立歌词 modal；歌词在播放器内同步显示，支持 LRC 行级及逐字高亮。
- [x] 移除大封面、倍速控制和歌词手动编辑入口；保留歌词数据读取与显示。
- [x] 增加列表主动选歌行为：从首页、音乐库、收藏、歌单和本机音乐选择歌曲时请求展开播放器；迷你条控制保持原有收起语义。
- [x] 增加音乐库内按歌曲管理歌词与伴奏资源，资源操作绑定目标歌曲，并在当前歌曲更新后刷新播放状态。
- [x] 歌词改为每首歌曲一份原始文本，移除播放器和音乐库语言栏位；新 .lmp / JSON 备份使用单份文本结构，不兼容或迁移旧分栏歌词。
- [x] 放宽歌词文件选择限制，增加 UTF-8/UTF-16 读取和文本内容校验，兼容无时间戳纯文本。
- [x] 加强原唱/伴奏切换的异步加载、超时、失败回滚和竞态保护；播放失败通过播放器提示反馈。
- [x] 更新三种语言文案、播放器布局、Service Worker 应用壳清单及缓存版本。
- [x] 更新歌词同步测试，并新增音频引擎、歌词文件和浏览器测试入口文件。

### 待验证/待收尾
- [x] 已执行本轮单份歌词结构 Node 测试：39 项通过，命令见 AGENTS.md；覆盖 .lmp / JSON 原始文本往返与覆盖。
- [x] 本轮隔离 Chrome 普通模式 83 项、减少动态模式 87 项检查通过；覆盖语言控件移除、界面语言独立、再次导入覆盖及 JSON 导入保留其他歌曲。
- [x] 浏览器自动检查通过列表选歌展开、收起、暂停定位、快速切歌和资源更新后的播放行为。
- [ ] 在真实 iPhone 上验证 `.lrc`/`.txt` 文件选择、读取和保存。
- [x] 在本地回环地址验证 v14 应用壳缓存及服务器不可用时的离线重载；尚未在真实设备验收旧版本升级过程。
- [ ] 根据测试结果修正剩余问题，并在提交后更新本节状态。

## 现状与问题
原先底部迷你条、完整播放器和独立歌词面板互相切换。当前工作区已统一播放器，并移除歌词语言栏位。
现有代码具备 LRC 解析、行及逐字同步、同名文件关联、本地持久化、独立伴奏切换、保留原始 LRC 的 .lmp 导入导出；不代表所有设备均已验收。
iPhone 已反馈歌词入口无法选取 .lrc，改为 .txt 后也未出现在可选对象中。原因尚未确定。

## 统一播放器
- 移除独立歌词面板，歌词直接显示在完整播放器歌名上方，替代大封面。
- 有歌词显示滚动同步歌词；无歌词只显示“暂无歌词”，不提供添加按钮。
- 保留歌曲名、歌手、进度与时间、上一首、播放/暂停、下一首、随机、循环、收藏、队列、原唱/伴奏。
- 移除倍速按钮和面板、歌词手动编辑页面、所有资源导入与更换入口。
- 未关联伴奏时明确表示不可切换，不弹出导入入口。
- 歌词独立滚动，控制区始终可达。关闭只收起，不停止播放。

## 展开规则
| 操作 | 行为 |
| --- | --- |
| 首页、音乐库、收藏、歌单等列表主动选歌 | 播放并展开完整播放器，直接看词 |
| 点击迷你条歌曲信息 | 展开 |
| 关闭完整播放器 | 收起，音乐继续 |
| 展开时切歌或自动连播 | 保持展开并更新 |
| 收起时迷你条暂停/继续、上一首/下一首 | 保持收起 |
| 收起时自动连播或恢复播放 | 不强制展开 |
展开应反映选歌意图，不应直接绑定所有 trackchange/playstate。播放失败不得展示与实际播放不符的状态。

## 音乐库资源管理
- 每首歌提供管理入口，添加、更换歌词文件和伴奏音频。
- 目标绑定所选歌曲，不依赖当前播放歌曲；未播放的歌曲也可管理。
- 每首歌一份原始歌词文本；再次导入覆盖目标歌曲的歌词。支持任意语言、双语混排，不按界面语言选择或回退。
- 取消选择或读取失败不破坏旧资源；更新当前歌曲资源后及时刷新。
- 保留同名音频/LRC 同时导入关联，不假设可以读取未选择的相邻文件。
- 排查 iPhone 文件选择，必要时放宽 accept，读取后验证；兼容无时间戳纯文本。
- 不增加手动编辑器、资源删除或其他未确认功能。

## 布局
手机以歌词为主要区域，下方是歌曲信息、进度及控制；适配安全区域、横竖屏和较矮窗口。桌面扩大播放器及歌词空间，具体尺寸由实测决定，不重新加入大封面。延续现有视觉风格。

## 实施顺序
1. 检查音频事件、歌词生命周期及单份文本结构。
2. 接入统一播放器，移除旧面板、编辑与倍速界面。
3. 接入音乐库资源管理、失败恢复和当前歌曲刷新，排查 iPhone。
4. 从列表选歌入口接入自动展开，保留其他播放事件的收起语义。
5. 完成响应式、文案、缓存清单及版本更新。
6. 更新测试并执行浏览器验收，记录实际结果。

## 验收
- 各列表选歌直接展开；关闭不停止；迷你条操作不弹出；重新选歌会展开。
- 歌词、进度和控制共存，无独立歌词页面、封面或倍速入口。
- 播放、暂停定位、前后跳转、快速切歌和原唱/伴奏切换同步正确。
- 管理非当前歌曲不误改当前歌曲；取消/失败保留旧资源。
- 更换当前歌词后刷新显示；重载后资源仍存在。
- 中文、其他语言及双语混排、普通文本、增强 LRC 在单份文本结构中正常显示，新 .lmp / JSON 原样往返；不做旧分栏歌词兼容或迁移。
- 真实 iPhone 验证 .lrc/.txt 选择，记录系统、浏览器、文件来源及结果。
- 手机横竖屏、桌面及矮窗口不遮挡控制。
- HTTPS 或 localhost 验证应用壳更新与离线；局域网 HTTP 不作为 Service Worker 验收。

## 范围与限制
不包含人声分离、麦克风、评分、CDG、云授权或 Google Drive。伴奏需匹配原唱时间轴；更换源不承诺无缝切换。
资源按浏览器及站点来源本地保存，不跨设备或不同地址自动共享。迁移伴奏优先验证 .lmp；旧 JSON 备份只显式序列化 audioBlob，不能宣称完整支持伴奏备份。
历史测试结果不是本轮结论，未做真实设备或离线检查的项目明确标为未验证。

## 未来增值服务（2026-10-27 记录）
- [ ] 同步歌词生成：根据用户上传的歌曲提供句级同步歌词（LRC）；包含已有歌词文本的时间轴匹配，以及仅提供音频时的歌词生成与同步方向。
- [ ] 去人声伴奏生成：根据用户上传的歌曲生成去人声版伴奏，供原唱／伴奏切换使用。

以上仅记录未来服务方向，不纳入当前本地播放器改造范围；现阶段不展开技术方案、部署、定价或具体实现。

## 2026-10-27 定位回归修复
- 复现：新增音频引擎测试在旧实现中得到 8 秒，期望 45 秒（切源时拖至 30 秒，回滚时再拖至 45 秒）；原因是恢复过程始终读取切换前的 baseline.time。
- 切换操作单独维护最新目标时间；失败回滚和后续替代请求继承该目标，暂停/继续意图及源所有权检查保持有效。没有可用 duration 时保存最新比例，在元数据就绪后应用；新歌曲清除待定位操作。
- 完整播放器和迷你条原先在 duration 未就绪时直接忽略 pointerdown；现在仍接收拖动并交给引擎排队，不以 NaN 更新时间显示。
- 歌词高亮仍只读取实际 audio.currentTime；居中从 offsetTop/offsetHeight 布局坐标计算，避免把缩放/入场动画的瞬时矩形与未缩放高度混用。seeking/seeked 即使位于同一句也重新居中，使用 instant 中断平滑滚动。ResizeObserver 监听容器及歌词行，覆盖字体和换行尺寸变化。
- 本轮执行 Node 全部相关测试 43 项通过。真实 Chrome headless 普通模式 103 项、减少动态模式 107 项通过；包括进度条连续指针事件、反向及同句定位、切源等待期间定位、损坏 WAV 解码失败后的回滚期间定位、多行换行、打断平滑滚动、字号/transform 变化和窗口重排。指针事件由测试派发，仅 pointer capture 被桩替代；媒体解码与布局均由真实浏览器执行，加载窗口通过延迟元数据通知控制。
- Service Worker 更新为 lumen-shell-v15；浏览器检查新缓存模块及服务器不可用后的离线重载通过。
- 未验证：真实 iPhone/Safari、真实操作系统鼠标/触摸拖动、浏览器工具栏缩放和旧版本到 v15 的真实设备升级。未将偏移归因于歌词时间戳或音频文件；保持单份歌词结构，无旧数据兼容。

## 修正后的稳定操作场景验证（2026-10-27）
- 前一节定位于“切源加载期间拖动”的结论不代表已解释用户修正后的问题。本轮按“原唱稳定播放 → 伴奏稳定播放 → 拖动并等待原生 seeking 结束及播放稳定 → 切回原唱”执行，并做原唱侧拖动后切伴奏、反向跳转后切回的对照；没有在切源瞬间拖动。
- 新增 tests/audio-position.browser.html，通过 `node tests/browser-runner.mjs --stable-audio` 在隔离 Chrome headless 执行。同一 Blob 同时用作原唱/伴奏，仍经过真实换源及解码；通过播放器进度条事件定位至 13.15、31.15、9.15 秒。所有步骤等待 pending=false、seeking=false、paused=false、readyState>=3 后稳定播放，不依赖歌词判断。
- 同文件 WAV：生成每秒不同频率的标记音，使用 MediaElementAudioSourceNode/AnalyserNode 检测实际输出音调。避开整秒边界，以免 FFT 窗口跨两个标记产生误判。正反向切换及定位后，检测出的秒位置与 currentTime 对应，界面时间也一致。结果见 tests/audio-position-wav-result.txt。
- 同文件 MP3：使用上一级目录现有的“渕上 舞人芝居MVTVアニメようこそ実力至上主義の教室へ 2nd Seasonエンディングテーマ.mp3”同时绑定两个版本。以 AudioContext.decodeAudioData 独立解码为参考，将实际播放图中的 PCM 分析窗与参考前后 2 秒做相关匹配。最终本轮 8 个稳定采样相关系数 0.989–1.000，输出窗口末端较 currentTime 落后约 2–28 ms，没有出现秒级错位；界面时间对应实际 currentTime 的秒显示。
- MP3 切回原唱的前后 currentTime 为 13.850 → 13.850 秒；原唱拖动后切伴奏为 31.832 → 31.832 秒；反向定位后切回原唱为 9.859 → 9.859 秒。4 次切换返回时 seeking 均为 false。播放继续推进后再采样，不能把后续采样时间的正常增长当成跳转。完整数值见 tests/audio-position-mp3-result.txt。
- MP3 复跑方法（PowerShell）：先将 `$env:LUMEN_TEST_AUDIO_PATH` 设为测试 MP3 的完整路径，再运行上述 --stable-audio 命令；不设置该环境变量时运行 WAV 标记音测试。测试服务仅在明确设置此变量时提供 /__reference-audio，不复制或修改原音频。
- 结论范围：本机 Chrome 中，同文件 WAV 和该 MP3 的修正场景均未复现。前一轮修复继续保留；本轮仅新增诊断回归及结果记录，没有据此追加推测性的运行时修复，Service Worker 仍为 v15。音频引擎 Node 回归 18 项重新执行通过。
- 尚缺用户实际异常的原唱/伴奏文件对及设备信息，不能认定其时间轴不同或归因于解码。本测试验证浏览器播放图的真实解码输出，不是扬声器回录或人工听感验收，也不能排除其他浏览器/编码文件的定位问题。

## Local video (2026-10-27; supersedes audio-only scope)
- Independent mediaType audio/video records retain original files in audioBlob. Missing mediaType remains audio. Existing library data is preserved; no extraction, uploads, dependencies or build steps.
- One playsinline video element, exported as audioEl, owns both audio and video playback. Existing queue, favorite, shuffle, repeat, selection/expansion and variant race protection remain; video has no instrumental variant.
- Portrait hides the whole video lyrics region without deleting data. Landscape places lyrics beside the contained video; no lyrics gives video available width. Controls retain safe-area support and scrolling in short windows.
- Request fullscreen on playerSheetModal; unsupported/denied requests use page fill, not system fullscreen. Native video-only fullscreen cannot carry the custom HTML lyrics sidebar. Real iPhone Safari/PWA container fullscreen remains unverified.
- JSON and .lmp v2 preserve mediaType, MIME and original bytes. JSON also serializes instrumentalBlob. Old backups that already lost instrumental bytes cannot recover them. Large backups remain subject to browser memory/quota limits.
- Earlier checks: 49 Node tests, 16 video Chrome checks, existing browser 103 normal/107 reduced-motion checks passed. One rapid-drag lyric-centering assertion failed once and passed on unchanged rerun; retained as a flaky observation.
- Safari import follow-up: user reports failure after about 15 seconds. The first-frame gate could time out when Safari only preloads metadata. Import now accepts loadedmetadata, without forcing playback; metadata success does not guarantee codec support at playback. Separate read/timeout/unsupported/quota/storage messages expose actual failures. Cache is lumen-shell-v17; no new runtime modules.
- Real iPhone file selection, touch, background playback, system container fullscreen, other codecs (H.264/HEVC/MOV) and real device upgrades still require verification. Desktop iframe tests are not iPhone acceptance. Chrome fullscreen testing exercised page fill due to missing user activation.
- References: https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari and https://bugs.webkit.org/show_bug.cgi?id=197608 . Platform documentation is not device verification.

- Follow-up verification: 51 Node tests, 16 video Chrome checks and 103 existing Chrome checks passed, including v17 offline reload. Real-phone retry is still pending.

- Landscape follow-up: expanded video automatically enters page fill on landscape viewports up to 600px high. Rotation back exits only the automatic fill. Manual fill remains explicit. Compact landscape spacing keeps more height for video and controls. This is page fill, not an orientation lock or a claim of iPhone system fullscreen. Cache v18. Real iPhone retry pending.

- User landscape feedback: browser chrome plus a separate transport footer left too little video height. Phone landscape page fill now overlays title, progress and transport on the picture; lyrics remain an independent right sidebar. Safari address/tab bars cannot be hidden by CSS. Cache v19; real-device retry required.

## 横屏视频与按钮设置（2026-10-27 最新执行基准）

### 已完成（当前代码检查确认，设备验收另列）
- [x] 本地视频独立导入媒体库并持久化，使用自身音轨，不作为歌曲附件、不提取音频。
- [x] 音视频共用播放引擎，视频条目隐藏伴奏切换。
- [x] 视频竖屏隐藏整个字幕区域；纯音频继续显示歌词。
- [x] 横屏字幕位于视频右侧独立区域；无字幕时视频使用可用宽度。
- [x] 提供播放器容器全屏及页面内铺满回退；手机横屏自动页面内铺满。
- [x] 手机横屏铺满时播放控制覆盖于画面，已移除独立底部控制区对视频高度的占用。
- [x] Safari 导入等待条件已从首帧调整为元数据就绪，并区分导入失败提示（代码修复完成，真实 iPhone 重试未验收）。

### 本轮实施（已完成）
- [x] 横屏有字幕时将当前约 64:36 调整为视频/字幕约 75:25。使用共享 CSS 属性统一字幕宽度、控制区及渐变遮罩边界，考虑间距与安全区域。
- [x] 新增视频字幕开关；横屏关闭后字幕区域完全退出布局，视频使用可用宽度。竖屏仍强制隐藏视频字幕，不影响纯音频歌词或删除字幕数据。
- [x] 横屏视频播放中约 3 秒无操作后，自动隐藏进度条、时间与控制按钮及其背景遮罩；轻触画面重新显示。用于唤出控件的点击不应意外触发播放切换。
- [x] 暂停、进度拖动、菜单展开或键盘焦点位于控制区时保持显示；操作结束后重新计时。切歌、退出横屏、收起播放器时清理计时与状态。
- [x] 横屏视频按钮合并为一行，进度条位于按钮行上方并一起自动隐藏；空间不足时将低频操作收进“更多”，不横向溢出。
- [x] 在现有设置页新增“播放器按钮”设置，分别控制随机、循环、收藏、队列、原唱/伴奏、字幕、全屏按钮的显示；播放/暂停、上一首、下一首及进度条作为基础控制保留。
- [x] 按钮显示偏好本地持久化，修改后即时生效，重载后恢复，并提供“恢复默认显示”。默认保留当前按钮显示习惯，新字幕按钮默认显示；媒体类型及方向的适用条件优先于显示偏好。
- [x] 隐藏按钮只改变界面，不改变随机、循环等实际功能状态；设置页明确说明。字幕按钮可见性与字幕实际开关状态分开管理；手动关闭字幕后不得因按钮隐藏、布局重排或自动隐藏而重新开启。
- [x] 所有隐藏按钮退出焦点顺序，剩余按钮自动排布；保证触摸尺寸、键盘操作与状态提示。全屏按钮隐藏后，系统退出全屏及页面内铺满退出路径仍可用。
- [x] 更新三种语言文案、相关设计说明及 Service Worker 缓存版本；保留现有数据和未提交修改。

### 本轮验收与未解决项
- [x] 执行相关 Node 回归和浏览器检查，本轮实际结果见下方记录。
- [x] 检查字幕开/关/缺失、75:25 边界、自动隐藏/唤出、暂停/拖动/菜单保持显示、单行布局及窄屏更多菜单。
- [x] 检查每个按钮设置即时生效、持久化、恢复默认；隐藏随机/循环按钮不改变播放模式；不影响纯音频和竖屏行为。
- [ ] 分别验证系统容器全屏和页面内铺满；真实 iPhone Safari/PWA 的文件导入、横屏触摸、全屏及安全区域仍需设备验收，不以桌面模拟替代。
- [ ] 原唱/伴奏定位异常的用户实际文件对及设备复现仍未完成；既有 Chrome 同文件诊断未复现，不将其标为已解决。

本节覆盖上文“控制区始终可达”等对横屏视频常驻控制的旧表述：横屏视频改为随时可唤出，纯音频保留原行为。历史完成项保留其验证范围，不把代码修复等同于真实设备问题已解决。

### 本轮实际验证记录（2026-10-27）
- 按 AGENTS.md 的完整相关 Node 命令执行，51 项通过、0 失败；包含播放引擎换源／定位／回滚、歌词解析／同步／竞争、歌词导入与备份往返。没有沿用历史数量。
- `node tests/browser-runner.mjs --video`：隔离 Chrome headless 最终 55 项通过。使用实际录制 WebM、真实媒体解码、IndexedDB 重载及浏览器布局；新增覆盖 75:25 净宽度、控件与画面右边界、字幕开关与按钮偏好分离、七项设置即时隐藏和保存、迷你条同步、恢复默认、随机／循环状态保留、真实重载恢复显示偏好。
- 同一视频检查覆盖约 3 秒自动隐藏、唤出不切换播放、暂停／拖动／更多／队列／键盘焦点保持显示、结束操作重新计时、旋转及收起清理、重新展开恢复交互、568×320 单行无溢出、桌面横屏覆盖布局和波斯语 RTL 右侧字幕。指针和键盘由测试派发，pointer capture 使用桩；不是操作系统触摸验收。
- `node tests/browser-runner.mjs`：最终 104 项通过；`node tests/browser-runner.mjs --reduced-motion`：最终 108 项通过。覆盖原有选歌展开／收起、混合队列、歌词同步及定位、伴奏切换、资源保存、响应式，以及 `lumen-shell-v20`（含 playerPreferences.js）的缓存与服务器不可用时离线重载。
- 页面内铺满已验证：自动横屏铺满、手动退出／再次进入及容器尺寸。headless 的全屏请求没有真实用户激活，走页面内铺满回退；**系统容器全屏成功进入及系统退出仍未验收**，上方对应项继续留空。隐藏全屏按钮后仍保留关闭播放器的退出路径。
- 真实 iPhone Safari/PWA 文件导入、触摸、工具栏／安全区域、系统全屏、后台行为和旧缓存设备升级继续待验；桌面 iframe 尺寸调整不作为 iPhone 验收。用户实际原唱／伴奏文件对及设备上的定位异常继续未解决。
- 保留已有未提交修改；无新增依赖、无构建步骤、未清空媒体或歌词数据。字幕手动开关在当前播放器会话内保留，按钮显示偏好跨重载保存；恢复默认显示不会改写字幕开关或播放模式。

### 独立复核（2026-10-27）
- 应用户要求重新检查实现并运行现有测试：相关 Node 51/51、视频 Chrome 55/55、普通 Chrome 104/104、减少动态 Chrome 108/108 全部通过；非引用上次执行结果。
- 沙箱内 Chrome 因 GPU 子进程访问失败退出；获准在沙箱外使用独立临时配置运行相同浏览器测试后全部通过。未修改运行时代码或测试断言。
- 覆盖比例与边界、字幕开关、自动隐藏与交互保持显示、单行与更多菜单、七项按钮设置及重载持久化、原有歌词/伴奏行为和 v20 离线缓存。git diff --check 通过，仅提示行尾转换。
- 复核仍为现有自动化测试与代码检查，不含真实 iPhone 触摸、人工视觉验收或成功进入系统容器全屏；这些验收项继续保持未完成。

### 自动化测试静音（2026-10-27）
- 排查发现 runner 允许自动播放但未静音；video.browser.html 的 WebM 包含振荡器音轨并循环播放，audio-position.browser.html 的 WAV 生成 440–2320 Hz 标记音并曾直连输出，均可能发声。与用户实际高频声的关联尚未实机确认。
- 所有 runner 浏览器模式增加 --mute-audio；普通和视频测试媒体元素静音，定位诊断在 analyser 后通过零增益节点连接输出，保留上游 PCM/FFT 与播放状态验证。未改动产品音视频功能，未删除测试或断言。
- 按用户要求，本轮未执行播放测试；仅通过 runner 和三个浏览器测试页面脚本的语法检查及 diff 空白检查。修改后的浏览器运行结果尚未复验，之前通过数量不作为本次静音变更的验证结果。
