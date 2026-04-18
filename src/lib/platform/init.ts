// Side-effect module: importing this file triggers registration of every
// supported platform into `PLATFORM_CLIENTS`. Any server code that needs
// to iterate all platforms (cron `social-import`, multi-platform
// Strategist) should `import "@/lib/platform/init"` before calling
// `listPlatforms()` / `getPlatform()`.

import "./clients/x-client";
import "./clients/linkedin-client";
import "./clients/threads-client";
