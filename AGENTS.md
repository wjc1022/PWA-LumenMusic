# Agent 工作约定

## 项目约束
- 开发对象是本目录 Lumen；../karaoke-stage 仅为只读实现参考。
- 修改前阅读 docs/KTV_PLAN.md 和 docs/LRC_DESIGN.md，以实际工作区和本轮验证确定完成状态。
- 保持原生 HTML/CSS/JavaScript，无框架、无新增依赖、无构建步骤，使用静态 HTTP 服务。
- 导入媒体和歌词保持本地；云接入不在本轮范围内。
- 先检查实际代码与工作区改动，保留用户已有修改。

## 已确认要求
- 合并完整播放器与歌词面板，移除大封面，在歌名上方直接显示同步歌词。
- 无歌词只显示“暂无歌词”，播放器没有添加、更换或导入资源入口。
- 歌词及伴奏的添加、更换放在音乐库，绑定明确目标歌曲。
- 移除歌词手动编辑页面和倍速界面；保留已有纯文本歌词读取能力。
- 从歌曲列表主动选歌时自动展开；收起后的迷你条操作与自动连播不强制展开。
- 保留进度、播放控制、随机、循环、收藏、队列及原唱／伴奏切换。
- 手机适配安全区域；桌面扩大歌词和播放空间，不沿用明显偏窄的手机卡片。

## 数据与运行
- 每首歌只保存一份原始歌词文本：lyrics store 的记录为 { songId, text }，Lyrics.save(songId, text) 覆盖该歌曲的歌词。
- 不保留 EN/FA 分栏设计，不做旧歌词结构兼容、回退或迁移；不主动清空音乐库或其他媒体数据。
- 旧“保留纯文本编辑”要求被新需求替代：保留数据及显示，不保留编辑页面。
- 歌词支持任意语言及双语混排；界面语言只影响文案，不选择或转换歌词。
- .lmp v2 歌词文件为 { id, text }；JSON v2 备份歌词为 { songId, text }。原始文本、逐字标签与空白原样往返，不导出语言分栏或派生行数组。
- audio.currentTime 是唯一歌词时钟，不累计独立时间。
- 异步读取防止旧歌曲结果覆盖新状态；音频版本切换保留位置与播放状态。
- 新运行时模块加入 sw.js，发布应用壳变更时更新缓存版本。
- 不主动委派子 Agent，除非用户明确要求；获授权后按互不重叠职责分工，由主 Agent 集成。

## 验证
- 解析器：node --test tests/lrc.test.mjs
- 现有相关测试：node --experimental-vm-modules --test tests/lrc.test.mjs tests/lmp-lyrics.test.mjs tests/lyrics-modal.test.mjs tests/import-lyrics.test.mjs tests/audio-engine.test.mjs tests/lyric-file.test.mjs tests/transfer-lyrics.test.mjs
- 根据统一播放器结构更新旧 modal 测试，保留同步、竞争、单份歌词覆盖及新结构打包往返覆盖。
- 验证选歌展开、收起、暂停定位、切歌、资源管理、持久化、响应式和离线行为。
- 桩测试不替代浏览器，桌面测试不证明真实 iPhone 文件选择兼容。
- 汇报实际检查与未验证项，不沿用历史测试通过数量。
