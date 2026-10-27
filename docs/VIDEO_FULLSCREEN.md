# Video fullscreen and responsive controls (2026-10-27)

The button requests container fullscreen, then screen.orientation.lock('landscape'). The page immediately provides a landscape surface, including a 90-degree rotated sheet in a portrait viewport. Unsupported or rejected native APIs retain this surface; no device rotation or OS orientation setting change is required. The second tap, close, or native fullscreen exit clears page fill and rotation and releases the orientation lock. The manifest keeps portrait-primary as the installed app default.

Native fullscreen and orientation lock are separate, permission/platform-dependent APIs. Mobile browsers commonly require fullscreen before orientation lock. Safari/iOS and installed PWA behavior varies by OS/version; feature presence alone is insufficient, so rejected promises are handled. Page fill cannot remove browser chrome, and CSS rotation does not change the OS screen orientation. Exiting restores the ordinary viewport layout and releases the lock; a browser may return to the physical device orientation rather than portrait. No real Android or iPhone device was available for this run.

Controls are measured in their actual row using intrinsic button widths and the computed gap. Safe areas, the subtitle sidebar, translations, preferences and resized containers affect the available width. Optional actions move from the end into More only until the row fits, retaining their order; previous/play/next remain directly accessible. Buttons retain at least 44px touch targets and an 8px gap. Extremely small containers can scroll the core row. ResizeObserver and language/font updates recalculate the layout. Rotated seeking uses the screen Y coordinate; video retains object-fit:contain.

Validation: 52 Node tests, 107 base Chromium browser checks (including offline v24 reload), and 60 video Chromium browser checks passed. Video checks cover portrait, landscape, denied-native CSS entry/exit, rotated touch seeking, contain sizing, 1000px all-actions layout, 568px overflow, subtitle/sidebar changes, RTL, auto-hide, preferences and audio/video transitions. Browser output was muted. Real mobile native fullscreen, system orientation lock and installed-PWA transitions still need device acceptance testing.

References:
- https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen
- https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock
