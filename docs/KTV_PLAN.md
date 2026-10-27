# KTV 播放体验改造计划

更新日期：2026-10-27。以本节“媒体与日常属性分离”作为最新存储执行基准；后文旧版本记录仅供追溯，历史测试数量不代表本轮结果。

## 普通音频字幕与播放器收起（v33）

- 普通音频现在显示字幕开关，可关闭和重新开启歌词；收起后重新展开保留本次会话的开关状态，不改写歌词数据。视频仍遵守方向限制。
- 移除额外菜单入口，音频与视频统一使用上方 X 收起播放器；将关闭按钮层级统一设为 6，避免被歌词区域遮挡。收起后使用原页面菜单切换页面，播放继续。
- 应用壳缓存更新为 v33。本轮隔离静音 Chrome 普通模式 130/130（含 X 位置命中、收起后媒体库导航、字幕开关及离线重载），视频专项 61/61；git diff --check 通过。真实 iPhone 未验证。

## 列表媒体类型统一（v31）

- 原因：共享歌曲行的 showMediaType 默认关闭，只有 Library 显式开启，导致 Home 同一条目没有音频／视频标识。现改为共享组件默认显示，Home 的继续收听、收藏快捷列表、完整媒体库，以及收藏、歌单和本机库使用相同标识与样式。各页面的列表范围和操作不变，不新增媒体读取。
- 应用壳及诊断标记更新为 v31。实际验证：AGENTS.md 指定的七个 Node 测试文件 55/55；隔离静音 Chrome 普通模式 123/123、视频模式 61/61，覆盖各页面音频标识、Home 视频标识、窄屏长标题和 v31 离线重载；git diff --check 通过。未进行真实 iPhone 或人工视觉验收。

## 媒体与日常属性分离（2026-10-27，v29）

### 导入保存失败回归修复（v30）

- 新增资源时曾直接调用 `crypto.randomUUID()`，在该 API 不可用的环境（例如部分局域网 HTTP 访问）中，事务开始前即抛出 TypeError，被误归类为一般保存失败。改为复用 `generateId('media')` 的现有回退路径；不改变数据库版本或清空数据。
- 应用壳和诊断标记更新为 v30。实际重新验证：相关 Node 64/64；隔离静音 Chrome 存储专项 36/36，整个专项禁用 randomUUID，覆盖媒体导入、伴奏替换和 JSON / .lmp 恢复；普通播放器及 v30 离线缓存回归 119/119。设备上原始错误尚未取得，不能仅凭通用提示断定这是唯一原因；真实 iPhone 未复验。

**升级提醒：本版本将 lumen-db 升到版本 2，删除旧对象表和应用资料库，需重新导入媒体。没有旧数据迁移、转换、回退或双写。旧 JSON / .lmp 备份不能用于恢复本版本。** 不删除用户原始媒体、下载文件或备份文件。开发验证使用隔离 Chrome 临时配置与测试数据库，没有清空用户当前浏览器资料。

### 最终结构与调用边界

| 对象表 | 内容 |
| --- | --- |
| songs | id、歌曲资料、dateAdded、sourceFingerprint、mediaType / MIME、audioMediaId / instrumentalMediaId / coverMediaId；没有媒体数据、收藏或计数 |
| media | 每份主媒体、伴奏和封面独立的 `{ id, kind, value }`；音视频为 Blob / File，封面为 data URL |
| songState | `{ songId, favorite, playCount }` |
| lyrics | `{ songId, text }`，一份原始文本 |
| playlists / recents / settings | 各自资料、关系、最近播放和偏好 |

- `Songs.all/get` 仅组合资料与状态；列表使用默认图标，不读取封面或其他媒体。`Songs.withMedia` 在播放和诊断时按需读取资源；资源关联与状态在同一只读事务中读取。没有含 Blob 的持久化歌曲副本。完整导出在一个只读事务中取一致快照。
- 收藏、计数和资料更新不访问 media。计数在一个 readwrite 事务中读取最新状态、加一并写回；资料 patch 读取最新小记录，只合并指定资料字段，拒绝媒体字段，忽略状态与关联字段。
- 单首文件导入：先读取元数据和可用歌词，再用 songs / media / songState / lyrics 原子提交。批量文件按歌曲逐条提交；已成功歌曲保留，失败条目通过现有 onError / 进度统计报告。歌词读取失败仍可导入媒体并显示歌词警告。
- 资源替换：songs / media 同一事务建立新资源、更新单个关联并删除旧资源，其他资源不重新提交。删除：songs / media / songState / lyrics / recents / playlists 同一事务清理。所有写入、删除与清空以 transaction.oncomplete 为成功，拒绝请求错误、事务错误和中止；事务中没有文件读取、哈希或媒体加载等待。
- JSON `formatVersion: 3` 和 .lmp `packageFormatVersion: 3`；旧版本在写入前明确拒绝。新格式完整往返媒体、伴奏、封面、歌词、歌曲资料、收藏、计数和歌单顺序。JSON 恢复和 .lmp 恢复均先完成读取 / 解码 / ID 冲突处理，再整体原子提交；提交失败不保留部分导入。资源 ID 在本库内稳定，恢复重新分配资源 ID，.lmp 同歌曲 ID 冲突仍生成新歌曲 ID 并重映射歌单关系。
- 升级关闭本模块的旧标签连接；被其他连接阻塞时明确失败，需关闭其他标签并重载。失败的初始化 Promise 保持拒绝，不能继续写入。版本变化后关闭连接、清理运行时源与队列并提示重载。升级用 settings 中的待重置标记保证 localStorage 重置失败不会在下次启动被跳过。
- 统一重置七张表、localStorage 的 `lumen.` / `lumen-` 应用偏好与诊断、当前运行时队列和播放源。诊断内存及在途旧探测不会重新填回已清空历史。其他来源或非应用 localStorage 键不受影响。
- 没有 Playlist 交互改造、资料编辑界面、自定义字段或外部持续同步。应用壳与诊断版本均为 v29；没有新增运行模块、依赖或构建步骤。

### 本轮实际验证与限制

- `node --experimental-vm-modules --test tests/lrc.test.mjs tests/lmp-lyrics.test.mjs tests/lyrics-modal.test.mjs tests/import-lyrics.test.mjs tests/audio-engine.test.mjs tests/lyric-file.test.mjs tests/transfer-lyrics.test.mjs tests/media-diagnostics.test.mjs tests/media-timeline.test.mjs`：64/64，含逐首批量导入部分成功的准确报告。
- 隔离静音 Chrome：普通播放器 119/119、视频 60/60、诊断 14/14。覆盖选择展开、收起、定位、切歌、伴奏替换及回滚、资源持久化、响应式和 v29 离线重载。按需读取引入异步选歌，浏览器断言等待目标媒体实际载入。
- 新增 `node tests/browser-runner.mjs --storage`：35/35。真实 IndexedDB 验证旧版清空、新装与升级结构相同、40 次并发计数、日常更新零媒体读写、失败导入 / 替换 / 删除 / 整体恢复回滚、初始化中止与阻塞、失败后禁止写入、新 JSON / .lmp 全资源往返、旧格式拒绝、本地偏好重置失败后重试、版本变化自动关连接、清空事务回滚及运行时队列重置。
- Chrome 在沙箱内因 GPU 权限无法启动，以上浏览器验证在获准的沙箱外独立临时配置执行，保留 `--mute-audio`，测试播放器 muted。没有播放到扬声器。
- 未验证真实 iPhone / Safari 的用户手势播放、文件选择、缓存升级、多日持久化与 PWA 重启。拆分规避日常更新重提交媒体，不证明此前 NotFoundError 或播放停滞根因已解决，也不恢复既有不可读字节。没有用桌面结果替代 iPhone 验收。

## iPhone PWA Blob 审查与取证（2026-10-27，v23）

真实 iPhone 根因尚待确认。约 74.6 MB video/mp4 曾播放、首尾读取及独立元数据成功，后续大小/MIME 正常但首尾均为 NotFoundError，同时主播放器/独立元素 code=4、readyState=0、networkState=3。这证明当时底层数据不可读，不能证明编码不支持、永久删除或按钮偏好导致。没有新增依赖、迁移、清空、覆盖故障资源或自动重试。

### 实际调用链
- importService.importFiles 分类文件；视频用独立静音元素等待元数据，音频经 metadataService。主媒体 audioBlob 和 attachInstrumental 的 instrumentalBlob 直接保存原始 File，没有完整拷贝物化。临时元数据 URL 在结束/错误/超时释放。
- songs 写入集中于 database/db.js 的 put：Songs.add（本地导入、.lmp 恢复）、Songs.update（伴奏更新）、setFavorite、incrementPlayCount、importAllRaw（JSON 恢复）。歌词单独写 lyrics。JSON 按同 ID 整条覆盖；.lmp 冲突生成新 ID。导出读取/序列化，不重写 songs，下载 URL 独立所有。
- 收藏/计数从 DB 读整条，修改字段后 put；仅元数据变更也重写两个大 Blob。伴奏先重读 Songs.get，不直接保存传入的列表旧对象；读取与 put 仍是不同事务。update/add 接受整条对象，JSON 接受备份快照：存在并发旧快照覆盖其他更新的结构风险，尚无设备前后证据将其关联到 Blob 不可读。本轮不分库、不迁移。
- 播放入口使用队列/列表内存对象。新增播放前 DB 读取仅留证，不等待、不替换源，保留用户激活时机。计数后更新当前内存对象，selectionRevision 防旧请求覆盖新歌；refreshCurrentSong 更新队列，仅正在使用的伴奏被替换时换源。
- audioEngine 拥有一个 playsinline video 元素（audioEl）。loadSongIntoElement 暂停、增加源修订号、取消旧等待、释放旧 URL 并创建新 URL；切换/回滚有所有权与有界等待；终止失败清源并释放 URL。playerSheet 初始化将媒体元素放入 videoHost 一次，布局只移动按钮。独立诊断元素不调用 play，结束时移除监听、清源、load、remove、revoke。
- 按钮设置只写 localStorage lumen.playerButtons，派发 playerbuttonschange；监听器只调整按钮可见性/父容器、菜单、布局及控件隐藏计时。字幕状态独立，无媒体 DB 写入、换源、Blob 改写、播放模式变更或 URL 释放。主题/语言写 settings，睡眠计时器控制播放；数据面板导入/清空是其他显式操作，不由按钮设置触发。本轮未触发清空。

### 确定性缺陷与假设
- 已证实：put 原先在 request.onsuccess resolve，没等 transaction.oncomplete，请求成功后事务中止仍可能报告成功。最小修复为等待 complete，并拒绝 request error、transaction error/abort；桩回归验证“请求成功尚不 resolve；随后 abort 必须 reject”。没有改变记录结构/Blob/存储方案，也未证明此缺陷是 iPhone NotFoundError 根因。
- 已修正新增波斯语诊断文案的字面 ???，以及中文“对象存在即文件存在”的误导；区分对象存在、首尾可读取、元数据可加载。清理 LRC 设计文档 currentTime 后的问号。
- 待设备验证：原始 File 后备数据生命周期、整条 Blob 重写、并发旧快照、平台持久化异常与故障的关系。本轮没有引用未经查证的 WebKit 行为，也未把平台外部问题认定为本项目原因。

### 有界诊断
- 复用 inspectBlob/exception/sanitize，新增 mediaTimeline：固定捕获条目 ID、开始/完成时间、会话 ID、关联 op、资源字段、File/Blob 类别、大小/MIME、首尾各最多 64 字节读取结果与异常 name/message。写前与提交后重读共用 op，覆盖导入、伴奏更新、收藏、计数、JSON 恢复。播放前/用户检查/资源读取通过 Songs.get 留证。无原始字节、内容、临时 URL、文件名或完整本地路径。
- 不等待探测来播放或写入，不自动重试/重导入/重保存。每次探测 3 秒可记录 probeTimeout（不是 NotFoundError）；最多 12 个在途操作，未完成读取继续占槽，超限跳过，不无界排队。重启前未完成的探测可能没有记录，历史并非完整审计日志。
- localStorage 最多 80 条资源记录、96000 个 UTF-16 code units（字符串载荷约 192 KB 上限），单字符串有界，加载前检查容量；超限淘汰最旧完成记录。存储拒绝/配额/序列化失败不影响产品，当前会话保留有界内存记录。探测成功不证明完整性。
- “本地资源诊断”按目标 ID 显示历史；复制报告包含历史、当前检查、独立加载结果和上次播放失败。异步结果固定绑定目标；历史按开始时间排序，加载结果有时间/目标/资源字段，上次失败有 belongsToSelected。NotFoundError 提示“Blob 对象存在，但底层数据当前无法读取”。appCache=v23，新模块加入 SW。

### 实际验证
- Node 命令：`node --experimental-vm-modules --test tests/media-timeline.test.mjs tests/media-diagnostics.test.mjs tests/lrc.test.mjs tests/lmp-lyrics.test.mjs tests/lyrics-modal.test.mjs tests/import-lyrics.test.mjs tests/audio-engine.test.mjs tests/lyric-file.test.mjs tests/transfer-lyrics.test.mjs`：61/61。覆盖成功→NotFoundError、DB 读取失败、请求成功后事务中止、延迟结果目标绑定、记录数量/容量、存储拒绝、元数据清理/取消、复制成功及回退。
- 静音 Chrome：--diagnostics 14/14、普通 107/107、--video 55/55。包括提交后重读时间线、复制报告会话/条目/op、七项按钮偏好零 songs 写事务、源/模式保留、所存媒体大小/计数/收藏保留，以及 v23 新模块缓存与离线重载。额外验证浏览器内可读→双端 NotFoundError 桩、DB 读取失败，以及真实 put 请求成功后中止事务：保存拒绝且无记录。诊断测试旧字符串等待误匹配历史 recordExists，改为等待 live.recordExists 后复跑通过，未删除断言。
- 沙箱内 Chrome GPU 访问失败；获准沙箱外独立临时配置执行，全部保留 --mute-audio，测试播放器 muted。未执行可能可听的非静音测试。减少动态专项及真实 iPhone 本轮未复验；桌面通过不代表 iPhone 已解决。

### iPhone 单变量对照流程
1. 确认报告 appCache=v23，选择目标，检查并复制基线。已有故障条目先留报告，不覆盖导入；测试全新导入另用测试条目并记录 ID。
2. A：导入测试条目后不播放、不改设置/收藏，检查并复制；关闭 PWA 后重启，再检查同 ID、检查主媒体加载并复制。
3. B：从可读基线开始，只播放后关闭重启；不改按钮/收藏，再检查同 ID 并复制。
4. C：从可读基线开始，不重启、不切收藏，只改一项按钮显示偏好；立即检查同 ID、检查加载并复制。
5. D：从可读基线开始，不改按钮、不重启，只切一次收藏；立即检查同 ID、检查加载并复制。
6. 每次只改变一个条件，记录系统版本、PWA/Safari、文件选择来源、目标 ID。任一失败后停止后续条件，直接复制含时间线的报告；不清空数据或重导入“验证恢复”。直到取得前后证据，真实 iPhone 根因尚待确认。

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

## 本地资源诊断（2026-10-27）
- 设置页新增“本地资源诊断”。明确显示目标标题和 ID，默认当前条目；“检查”通过 Songs.get 重新读取数据库，不依赖播放器内存。分别报告记录缺失、数据库异常、媒体类型、保存 MIME、主媒体/可选伴奏 Blob 类型和大小、首尾各最多 64 字节的读取状态及独立异常、当前源是否为 Blob URL、实际 MediaError 和状态。无伴奏不视为主媒体损坏。
- “检查媒体加载”可选择主媒体或可选伴奏，从最新数据库记录建立临时 URL 和独立静音媒体元素，仅 preload=metadata/load，不调用 play；10 秒超时、目标切换取消与修订号防护，所有终止路径清理监听器、媒体源及 URL。检查不修改播放器、媒体记录或存储权限。
- 音频引擎保留原有失败处理、回滚和竞态控制，额外保存最近一次失败时间、目标 ID、阶段、原异常 name/message、MediaError、readyState/networkState 和 Blob 摘要。单条有界 localStorage 记录跨重启保留，写入失败不影响播放，可清除；不保存临时 URL，不自动重试或推定编码问题。界面分开显示现场结果和上次失败，报告标明错误是否属于所选条目。
- 复制报告含应用壳版本 v21、来源 origin、浏览器、检查时间和各项结果；复制失败提供只读可选中文本。报告不包含媒体内容、原始字节、文件标题/完整本地路径或临时 URL。中/英/波斯语说明强调：部分可读不证明完整性/编码支持；元数据成功不保证实际播放，失败/超时不能证明资源被清理。新模块加入 SW 清单。
- 实际验证：相关 Node 测试 59/59 通过（含新增诊断与失败记录测试），覆盖记录缺失、数据库错误、无效/空 Blob、首尾部分读取失败、元数据成功/错误/超时、清理、取消/修订号和复制回退。`node tests/browser-runner.mjs --diagnostics` 静音 Chrome 8/8 通过：默认目标、最新数据库读取、真实元数据成功/损坏媒体错误、探测不调用 play、报告无 URL，以及检查期间当前播放源/状态/队列保留、播放时间继续推进。
- `node tests/browser-runner.mjs` 静音 Chrome 104/104 通过，覆盖既有歌词/换源/定位、资源重载和 v21 离线重载。所有 runner 模式保留 --mute-audio，测试播放器也 muted。沙箱内 Chrome GPU 访问失败，使用获准的隔离临时配置在沙箱外完成浏览器验证。git diff --check 通过（仅行尾转换提示）。未执行真实 iPhone 或减少动态/视频专项复验。
- [ ] iPhone PWA 关闭再启动后的媒体故障原因仍未确认，未标记解决。请在故障出现后进入设置，选择发生问题的条目，先“检查”，再选择主媒体并“检查媒体加载”，复制同一份含现场检查、加载结果和上次失败记录的诊断报告；如问题只涉及伴奏，另选可选伴奏检查并复制报告。不要为诊断清空网站数据或重新导入。

## 播放中途停滞检测（2026-10-27，v25）
- 已确认代码缺口：运行中仅监听 error 和 play 拒绝，不能发现无错误但 currentTime 停止前进。按钮 play/pause 状态不证明媒体实际推进；真实设备停滞根因尚未确定。
- 新增每秒检查媒体时钟；前台播放连续 15 秒不推进时，记录 playback-stalled（位置、时长、缓冲区、paused/seeking 和原有媒体状态），暂停并显示播放失败。正常暂停、后台与版本恢复过程不计入；定位事件重置计时。
- 不自动循环重试。用户再次点击播放，复用有界恢复流程重新建立当前源并恢复位置，允许视频原资源重载。沿用暂停意图、换歌取消与失败回滚保护，不修改媒体数据库。
- SW 和诊断缓存标记统一更新为 v25，保留工作区已有横屏修改。
- Node 相关回归 63/63，其中新增中途静默停滞留证、明确点击后恢复，以及正常进度和暂停不误报。真实 iPhone、底层文件读取和仅画面冻结但媒体时钟仍推进的情况未验证。
- 静音 Chrome 视频回归 60/60；沙箱内 GPU 初始化失败，沙箱外隔离配置运行通过。此浏览器回归验证既有视频/横屏交互，静默停滞恢复由 Node 桩测试验证，尚未在真实设备复现。


## Library interface update (2026-10-27, v28)
- Added a named-resource deletion dialog with Cancel/Delete, retaining the existing removal callback. No queue/playlist cleanup or individual resource removal was added.
- Resource actions read persisted lyrics and instrumental data, use Add/Replace labels and emphasize replacement after successful saves. Video retains its instrumental restriction.
- Library titles carry textual audio/video badges based on mediaType; long titles truncate without changing row backgrounds. All three locales and shell/diagnostic cache versions were updated.
- Actual validation: related Node tests 54/54; isolated muted Chrome 119/119, including deletion cancellation/confirmation, persisted state on reentry, video restrictions, 320px long-title badge bounds in both themes, resource persistence and offline reload. Chrome GPU startup failed inside the sandbox; the isolated run outside it passed. git diff --check passed with line-ending notices only.
- Not verified: real iPhone/Safari file selection, touch, safe areas, device cache upgrades, or manual visual review. Desktop automated layout checks do not establish those results.

## 数据存储、歌曲资料与歌单改造规划（2026-10-27，待实施）

本节整理本轮讨论。用户已确认需要改造数据库结构、改进 Playlist、提供歌曲资料及追加属性编辑，并支持这些资料导出。本轮只记录计划，不修改运行代码、不执行数据库升级或数据迁移；以下建议结构与交互细节尚未全部定案。

### 故障证据与当前结构

- 用户提供的 v28 iPhone 报告：同一歌曲主媒体约 74.6 MB，13:11:52.716 的数据库读取及 13:11:52.917 的 play-count-before 首尾可读；13:11:53.012 的 play-count-committed-read 首尾均为 NotFoundError。后续持续不可读，再次写计数时报 Error preparing Blob/File data to be stored in object store，最终出现 playback-stalled。
- 当前 incrementPlayCount、setFavorite 都读取 songs 整条记录，修改小字段后 put 整条，包含主媒体、伴奏和封面；伴奏替换也写回整条歌曲。计数更新前后是当前最直接的调查范围，但异步探测的时间线不能单独证明重写导致损坏，尚不能认定真实设备根因或既有故障资源可恢复。
- IndexedDB 的 put 和 cursor.update 都替换整个记录值，没有 SQL 式单列更新。只传 { id, favorite } 会替换并丢失其他字段；封装 patch 后内部仍读全量、合并、put，也不能隔离 Blob。应通过拆分记录实现只写相关数据。
- 当前 Playlist 已参与播放：从歌单内点歌以该歌单当前显示顺序建立队列；从 Library 点歌则用当前搜索、排序后的列表替换队列。仅打开歌单不改变队列。队列没有保存来源歌单身份，歌单编辑不主动同步队列，队列也不跨重启保存。
- 当前 JSON 备份代码已同时序列化 audioBlob 与 instrumentalBlob；本文件早期“只序列化主媒体”的表述属于历史限制，不代表当前实现。localStorage 的按钮偏好和诊断记录未包含在该备份中。

### 已确认的设计目标

- [ ] 媒体与日常更新属性分离。播放计数、收藏、歌手、标签、自定义属性或歌单修改不得读取或提交媒体 Blob；媒体只在导入、明确替换、删除或完整恢复等相应操作中写入。
- [ ] 主媒体、伴奏、封面独立保存和关联，替换伴奏不重写原唱；列表查询不携带大媒体记录，播放与导出按需获取资源。
- [ ] 提供歌曲资料编辑能力，支持补充歌手、标签等标准资料，以及用户主动追加自定义属性。编辑资料不默认改写原始媒体文件的内嵌标签。
- [ ] 标准资料、自定义字段定义及字段值均支持持久化、导出和再次导入，不因导出格式固定字段列表而丢失追加属性。
- [ ] 改进 Playlist 与播放队列的连接，使播放范围、顺序和来源明确，避免用户误以为播放始终来自整个 Library。
- [ ] 支持不含媒体二进制的完整资料关系文档，保留歌曲、属性、歌词、歌单及其关联；用资源引用和可用的外部链接表达媒体关系。

### 建议的数据边界（名称及最终字段待定）

| 对象表 | 建议内容 | 写入场景 |
| --- | --- | --- |
| songs | 稳定歌曲 ID、名称、歌手数组、专辑、曲风、年份、标签、时长、自定义属性、资源 ID | 资料编辑或资源关联变更 |
| media | 稳定资源 ID、Blob、MIME、大小、资源类型等；每份主媒体、伴奏、封面独立记录 | 导入、明确替换、删除、完整恢复 |
| songState | songId、收藏、播放次数等日常状态 | 收藏与计数等 |
| customFields | 稳定字段 ID、显示名称、值类型等定义 | 创建或调整自定义字段 |
| lyrics | songId、原始 text | 添加或替换歌词，保持单份原始文本契约 |
| playlists | 稳定歌单 ID、资料、有序歌曲 ID | 歌单编辑与重排 |
| recents | 最近播放信息 | 播放记录更新；是否扩展为逐次事件另行决定 |
| settings | 用户偏好 | 设置变更，需梳理与 localStorage 的边界 |
| playbackSession | 队列、来源歌单或列表、当前条目及位置等 | 若采纳会话恢复方案则保存 |

- 优先在同一 lumen-db 内拆分对象表，无须为隔离记录直接更换数据库技术或拆成多个数据库。
- 小记录内部可继续整体 put，不要求每个属性各存一条。计数的读取、加一、写回应在同一个 readwrite 事务内完成，避免并发丢失更新；其他修改同样避免旧快照整条覆盖。
- 跨表资源替换、删除及关联修改需要明确原子事务边界，写操作以事务提交完成为成功标准。升级方案需评估已有媒体迁移的读写风险，不清空资料库，不把结构拆分当作修复既有不可读字节的保证。
- 自定义字段建议采用稳定 ID 与显示名称分离的设计，字段重命名不破坏已有值；字段类型、重名规则、删除语义和筛选能力待定。

### Playlist 改进建议（交互细节待定）

- [ ] 增加明确的“播放歌单”“随机播放歌单”入口，队列保存来源类型及歌单 ID，播放器显示来源。
- [ ] 明确从 Library 点歌会建立音乐库当前列表队列，从歌单点歌会建立歌单队列；仅浏览页面不替换队列。
- [ ] 确定歌单编辑后的队列策略。讨论中的建议是保留当前队列快照，通过“重新载入歌单”应用修改，避免编辑时突然跳歌；该策略尚未由用户定案。
- [ ] 确定歌曲／歌单删除时的引用清理、当前播放处理及队列位置规则，避免悬空引用。
- [ ] 评估保存队列和位置以跨重启恢复；建议恢复后等待用户主动播放，不自动播放。是否实施及保存频率待定。

### 导出与外部资料文档

- [ ] 设计带 schema 版本的统一资料清单，保存稳定对象 ID、标准属性、自定义字段定义及值、标签、资源描述、歌单成员及顺序、原始歌词、收藏、计数和最近播放。设置及播放会话可选导出；诊断历史的导出范围另行确定，不默认混入可分享资料。
- [ ] 提供“完整备份”和“仅资料导出”：前者包含媒体文件，后者仅包含相同关系清单及资源引用。审查 JSON 与 .lmp 的一致性，避免出现资料可导出但导入忽略的情况。
- [ ] 区分本地 mediaId 与外部稳定 URL；本地 ID 只用于关联，并非另一设备可访问的下载链接，禁止把临时 blob: URL 当作长期导出地址。
- [ ] 对只有本地文件的资源，保留 ID、MIME、大小等描述，评估内容哈希用于重新关联和校验；文件名加大小的现有指纹不是内容哈希。哈希计算时机、成本及不可读资源处理待定。
- [ ] 外部编辑后回导需要区分“资料合并”与“完整恢复”。建议合并时省略字段保持原值，显式删除才清除；明确冲突、未知字段和无效引用的处理规则。
- [ ] 持续向固定外部文档写入属于独立能力：固定本地 JSON 文件还是可读写 URL／服务尚未确定，亦未确认自动同步方式。先确定清单格式，不把手动导出描述为恒常同步。

### 实施前待定与验收

- [ ] 定案对象结构、字段类型、歌单与队列策略、外部文档载体及读写方向，再制定无清空的数据升级方案。
- [ ] 验证收藏、计数、资料、标签及歌单修改期间零 media 写入；计数并发不丢失，资料更新不覆盖其他状态。
- [ ] 验证资源替换／删除的事务失败保留原关联，已有数据升级失败不误报成功，故障媒体不被诊断流程自动覆盖。
- [ ] 验证自定义属性、歌词原文、歌单顺序、用户状态在完整备份和仅资料清单中往返保留，资源缺失可明确识别并重新关联。
- [ ] 验证歌单播放范围、来源提示、队列重载及删除行为；如实现会话恢复，验证重启恢复与用户主动播放。
- 本节没有实施结果；未执行运行时测试，未验证真实 iPhone 修复，既有历史测试数量不作为本计划的验收结果。
