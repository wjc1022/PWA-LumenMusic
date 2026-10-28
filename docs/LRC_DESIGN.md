# 歌词解析、存储与统一播放器设计

更新日期：2026-10-27。当前工作区已统一播放器；歌词改为每首歌曲一份原始文本。

本轮 v29 存储基准覆盖下文旧版本描述：lumen-db v2 是破坏性结构升级，旧资料库清空，用户需重新导入；不迁移旧数据。lyrics 仍为 `{ songId, text }`。JSON 与 .lmp 格式版本均为 3，旧格式明确拒绝；新格式完整保存主媒体、伴奏、封面、歌词、资料、收藏、计数和歌单关系。单首导入可用歌词与歌曲资源同事务提交，完整备份恢复整体原子提交。实际验证与设备限制见 [DEVELOPMENT_HISTORY.md](history/DEVELOPMENT_HISTORY.md) 顶部最新章节。

## 解析契约
src/lyrics/lrc.mjs 导出：
- parseLrc(text)：{ lines, metadata, offsetMs }。
- 行：{ time: number | null, text: string, words?: [{ time, text }] }。单位为秒，逐字内容保留空格。
- findActiveLine(lines, seconds)、findActiveWord(words, seconds)：查找时间之前或恰好到达的最后一项，无匹配返回 -1。
支持 BOM/CRLF、任意位分钟、有效秒数、1–3 位小数、重复时间戳、元数据、增强逐字标签。正 offset 提前时间，全部解析后统一应用，不受标签位置影响。重复增强行按时间差平移逐字时间。保留带时间戳空行作为间奏及普通无时间文本；定时项稳定排序，混合文档无时间项置后。异常输入不使界面崩溃。

## 存储
继续使用 lyrics store，以 songId 为键保存 { songId, text }。Lyrics.save(songId, text) 原样保存字符串并覆盖该歌曲已有歌词，显示时解析；不保存派生行数组。
每首歌只有一份歌词。支持任意语言及双语混排，界面语言只影响文案，不参与歌词读取、回退或转换。播放器和音乐库没有歌词语言选择控件。
不实现旧 EN/FA、rawLrc 分栏或语言行数组的兼容、回退与迁移。不主动清空整个音乐库；旧结构歌词不会被读取或导出，可为歌曲重新导入一份歌词。不新增翻译或语言识别。

## 统一显示与生命周期
- 歌词位于完整播放器歌名上方，替代大封面；无独立歌词弹层。
- 无歌词只显示“暂无歌词”，无添加、更换或编辑入口。
- 歌词独立滚动，保留当前行居中、高亮及逐字状态；普通文本静态显示。
- 歌名、歌手、进度和控制共存，删除倍速界面。
- 打开、播放、暂停、定位、元数据载入、切歌和音频版本切换均按 audioEl.currentTime 同步。
- requestAnimationFrame 仅在可见且播放时运行；收起、暂停、结束后停止，不累计独立时间。
- 收起不停止音频；重新展开立即同步当前位置，不重复累积监听器。
- 异步读取使用修订号或等效防护，防止旧歌曲或旧读取结果覆盖新状态；切歌和重新载入清理旧节点及索引。
- 更换当前歌词后重新读取、解析、同步，尊重减少动态效果偏好。

## 音乐库导入
- 所有导入入口显式绑定目标 songId，不依赖当前播放歌曲或界面语言；再次导入覆盖该歌曲的唯一歌词。
- 取消不写入，读取或保存失败保留导入前的资源。
- 支持 LRC 与普通文本，无时间戳不构成拒绝理由。
- iPhone .lrc 不可选、.txt 不可见的问题尚未定位。检查过滤、来源、云文件下载状态及实际选择器行为；必要时放宽 accept，读取后验证。
- 放宽过滤后应拒绝明显非文本或无法读取的文件并反馈，避免二进制覆盖歌词；判断应兼容 Unicode 文本。
- 保留同名自动关联：忽略扩展名大小写、规范化 Unicode、有相对路径时尊重目录边界。重复匹配跳过并警告，歌词失败不撤销成功导入的音频。
- 不提供粘贴、编辑、保存文本的页面。

## 音频切换
原唱和伴奏为同一歌曲的独立本地文件，通过同一 audio 元素换源，记录位置与播放/暂停状态，待源就绪后恢复。歌词始终使用真实音频时间。
播放器只切换已有版本；音乐库负责关联及更换。快速切歌、更换资源时防止旧异步恢复落到错误歌曲，不承诺无缝切换。

## 打包结构
.lmp 的 packageFormatVersion 为 2，lyrics/<id>.json 为 { id, text }。JSON 备份的 formatVersion 为 2，lyrics 为 [{ songId, text }]。text 是唯一原始歌词字符串，包括逐字标签、offset、BOM、换行、空白与毫秒；不附带语言分栏或解析后的行数组。
导入只接受上述单份字符串结构，不将旧分栏转成文本。.lmp 中无效歌词跳过并警告，成功导入的音频保留；JSON 中不符合结构的歌词记录不写入。导入有效记录覆盖目标歌曲的歌词，不清空其他歌曲资源。
JSON 对伴奏 Blob 的序列化问题独立存在，本轮仅调整歌词结构，不宣称完整支持伴奏备份。

## 验证
解析器覆盖时间边界、反向定位、offset 顺序、重复行/逐字、空白间奏、普通文本及异常输入。
集成覆盖暂停定位、快速切歌、异步竞争、收起后停止循环、重新展开、歌词更换及音频版本切换。
验证任意语言及双语混排、原始 LRC 的新 .lmp / JSON 往返、重复导入覆盖、界面语言不影响歌词、刷新持久化、真实 iPhone 选取及离线模块。
命令及整体验收见 AGENTS.md 和 [DEVELOPMENT_HISTORY.md](history/DEVELOPMENT_HISTORY.md)。旧 lyrics-modal 测试随新结构更新，不以维持已删除 DOM 为目标。

## Video lyrics (2026-10-27)
Video records use the same songId/raw-text lyrics contract. Portrait hides the entire lyrics region without changing stored text; landscape shows a separate sidebar, hidden when lyrics are absent. Audio retains its existing display. audioEl.currentTime remains the only clock. Request container fullscreen first, otherwise use explicitly labelled page fill. Native iPhone video fullscreen does not carry custom HTML sidebars. See [DEVELOPMENT_HISTORY.md](history/DEVELOPMENT_HISTORY.md) for verification limits.

## 横屏视频控制与按钮偏好（2026-10-27）
- 横屏有字幕时按约 75:25 分配视频与字幕的净宽度；共享 `--lyrics-fraction`、间距及安全区域变量计算字幕、控件和渐变遮罩边界。RTL 界面仍将字幕放在视频右侧。
- 字幕实际开关独立于按钮可见性，当前播放器会话内保留手动选择。关闭或无字幕时侧栏退出布局；竖屏强制隐藏视频字幕，纯音频歌词不受影响，不修改原始歌词文本。
- 横屏视频控件覆盖画面，进度位于单行按钮上方；空间不足时低频操作进入“更多”，更窄时随机和循环也收纳。隐藏控件使用 inert 退出焦点顺序；关闭按钮始终可用，保留退出铺满的路径。
- 播放中空闲约 3 秒隐藏控件、时间、标题及渐变。指针操作重新计时，唤出画面的操作不切换播放。暂停、拖动、队列／更多菜单、控制区键盘焦点阻止隐藏；切歌、收起和退出横屏清理拖动、菜单及计时状态。
- 现有设置页提供七个按钮的独立显示偏好和恢复默认，使用 `lumen.playerButtons` 本地持久化并即时通知播放器；随机和收藏偏好同时应用于迷你条。默认全部显示，媒体和方向条件优先。显示设置不调用播放模式或字幕状态切换，也不改写媒体数据库。
- 新模块加入 Service Worker v20 应用壳。设备及系统全屏的验收限制以计划最新章节为准。
