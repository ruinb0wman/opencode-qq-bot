import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs"
import { dirname, join } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { execSync } from "child_process"

const SYSTEMD_USER_DIR = join(homedir(), ".config", "systemd", "user")
const SERVICE_FILE = join(SYSTEMD_USER_DIR, "openqq.service")

/**
 * 通过 systemd.ts 自身的文件路径反推项目根目录
 * src/systemd.ts → src/ → project root
 */
function resolveProjectDir(): string {
  const currentFile = fileURLToPath(import.meta.url)
  return dirname(dirname(currentFile))
}

export function installService(): void {
  const bunPath = process.execPath
  const projectDir = resolveProjectDir()
  const entrypointPath = join(projectDir, "bin", "openqq.js")

  if (!existsSync(entrypointPath)) {
    console.error(`错误: 未找到入口文件 ${entrypointPath}`)
    console.error("请在项目根目录下运行此命令")
    process.exit(1)
  }

  if (!existsSync(SYSTEMD_USER_DIR)) {
    mkdirSync(SYSTEMD_USER_DIR, { recursive: true })
  }

  try {
    execSync("systemctl --user show-environment", { stdio: "pipe" })
  } catch {
    console.error("错误: systemd user 模式不可用 (systemctl --user 无法执行)")
    console.error("请确保 systemd 已运行，可能需要:")
    console.error("  - loginctl enable-linger $(whoami)")
    console.error("  - 或者系统已启用 user service (libpam-systemd)")
    process.exit(1)
  }

  const envLines: string[] = []
  for (const key of ["PATH", "OPENCODE_WORK_DIR"]) {
    const val = process.env[key]
    if (val) {
      envLines.push(`Environment=${key}=${val}`)
    }
  }

  const unit = [
    "[Unit]",
    "Description=OpenCode QQ Bot",
    "Documentation=https://github.com/gbwssve/opencode-qq-bot",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${projectDir}`,
    `ExecStart=${bunPath} ${entrypointPath}`,
    "Restart=on-failure",
    "RestartSec=10",
    ...envLines,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n")

  writeFileSync(SERVICE_FILE, unit, "utf-8")
  console.log(`[systemd] 服务文件已创建: ${SERVICE_FILE}`)

  execSync("systemctl --user daemon-reload", { stdio: "inherit" })
  console.log("[systemd] daemon-reload 完成")

  execSync("systemctl --user enable openqq", { stdio: "inherit" })
  console.log("[systemd] 已启用开机自启")

  execSync("systemctl --user start openqq", { stdio: "inherit" })
  console.log("[systemd] 服务已启动")

  console.log("\n常用管理命令:")
  console.log("  systemctl --user status openqq     # 查看状态")
  console.log("  systemctl --user stop openqq       # 停止")
  console.log("  systemctl --user restart openqq    # 重启")
  console.log("  journalctl --user -u openqq -f     # 查看实时日志")
}

export function uninstallService(): void {
  try {
    execSync("systemctl --user stop openqq", { stdio: "pipe" })
    console.log("[systemd] 服务已停止")
  } catch { }

  try {
    execSync("systemctl --user disable openqq", { stdio: "pipe" })
    console.log("[systemd] 已禁用开机自启")
  } catch { }

  if (existsSync(SERVICE_FILE)) {
    unlinkSync(SERVICE_FILE)
    console.log(`[systemd] 服务文件已删除: ${SERVICE_FILE}`)
  }

  try {
    execSync("systemctl --user daemon-reload", { stdio: "pipe" })
    console.log("[systemd] daemon-reload 完成")
  } catch { }
}
