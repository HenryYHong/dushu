// Reading fonts, bundled as slices (woff2 only, see vite.config.ts). This module is loaded after the first screen is
// drawn, so its 500 KB of @font-face rules never delay first paint. The browser downloads a slice only when a page draws
// a character in it, and font-display: swap keeps the text visible in a system font until the slice arrives.
import '@fontsource/noto-serif-sc/400.css';
import '@fontsource/noto-serif-sc/700.css';
import '@fontsource/noto-serif-tc/400.css';
import '@fontsource/noto-serif-tc/700.css';
import 'lxgw-wenkai-webfont/lxgwwenkai-regular.css';
