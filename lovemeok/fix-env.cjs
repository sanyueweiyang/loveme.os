// 简单环境修复脚本：
// - 确保项目根目录下存在 .env
// - 默认使用局域网 IP 地址，方便手机和电脑同步调试

const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(process.cwd(), ".env");
// 这里改成了你的局域网 IP
const TARGET_LINE = 'VITE_API_BASE_URL="http://192.168.5.62:3000"';

function ensureEnv() {
  try {
    let content = "";

    if (!fs.existsSync(ENV_PATH)) {
      content = `${TARGET_LINE}\n`;
      fs.writeFileSync(ENV_PATH, content, "utf8");
      console.log('[fix-env] 创建 .env 并写入手机调试地址:', TARGET_LINE);
      return;
    }

    content = fs.readFileSync(ENV_PATH, "utf8");

    // 注意：如果你想强制更新成 IP 地址，可以手动删掉 .env 文件再运行
    if (/^VITE_API_BASE_URL\s*=/m.test(content)) {
      console.log("[fix-env] 已检测到 VITE_API_BASE_URL。提示：如需更改为手机调试 IP，请先手动删除 .env 文件。");
      return;
    }

    const hasTrailingNewline = content.endsWith("\n");
    const toAppend = (hasTrailingNewline ? "" : "\n") + TARGET_LINE + "\n";
    fs.writeFileSync(ENV_PATH, content + toAppend, "utf8");
    console.log("[fix-env] 已在 .env 末尾追加手机调试地址:", TARGET_LINE);
  } catch (err) {
    console.error("[fix-env] 处理 .env 失败:", err);
  }
}

ensureEnv();