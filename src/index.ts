// @input:  ./config, ./opencode/*, ./qq/*, ./bridge, @opencode-ai/sdk (createOpencodeServer)
// @output: (side-effect) 启动 Bot 进程 / 安装 systemd 服务
// @pos:    根层 - 入口: 启动编排 + systemd 服务管理 CLI
import { loadConfig, ensureConfig } from "./config.js"
import { createClient, healthCheck } from "./opencode/client.js"
import { EventRouter } from "./opencode/events.js"
import { SessionManager } from "./opencode/sessions.js"
import { startGateway } from "./qq/gateway.js"
import { startBackgroundTokenRefresh, stopBackgroundTokenRefresh } from "./qq/token.js"
import { createBridge } from "./bridge.js"
import { installService, uninstallService } from "./systemd.js"

const args = process.argv.slice(2)

if (args.includes("--help") || args.includes("-h")) {
  console.log("OpenCode QQ Bot — QQ 机器人 AI 助手")
  console.log("")
  console.log("用法: openqq [选项]")
  console.log("")
  console.log("选项:")
  console.log("  --install-service     安装并启动 systemd 用户服务")
  console.log("  --uninstall-service   停止并移除 systemd 用户服务")
  console.log("  --help, -h            显示此帮助")
  process.exit(0)
}

if (args.includes("--install-service")) {
  installService()
  process.exit(0)
}

if (args.includes("--uninstall-service")) {
  uninstallService()
  process.exit(0)
}

async function main(): Promise<void> {
  await ensureConfig()
  const config = loadConfig()

  let serverClose: (() => void) | null = null

  if (!config.opencode.externalUrl) {
    const { createOpencodeServer } = await import("@opencode-ai/sdk")

    const originalCwd = config.opencode.workDir ? process.cwd() : null
    if (config.opencode.workDir) process.chdir(config.opencode.workDir)

    const server = await createOpencodeServer({ port: 4096 })
    config.opencode.baseUrl = server.url
    serverClose = server.close

    if (originalCwd) process.chdir(originalCwd)
    console.log(`[index] opencode serve 已启动: ${server.url}`)
  }

  const client = createClient(config.opencode.baseUrl)
  await healthCheck(client)

  startBackgroundTokenRefresh(config.qq.appId, config.qq.clientSecret)

  const router = new EventRouter(client)
  await router.start()

  const sessions = new SessionManager(client)
  const bridge = createBridge(config, client, router, sessions)

  const gateway = await startGateway({
    appId: config.qq.appId,
    clientSecret: config.qq.clientSecret,
    onMessage: bridge.handleMessage,
    onReady: () => {
      console.log("[index] QQ Gateway 已就绪")
    },
  })

  console.log("[index] OpenCode QQ Bot 已启动")

  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[index] 收到 ${signal}，开始退出...`)
    gateway.stop()
    router.stop()
    stopBackgroundTokenRefresh()
    serverClose?.()
    setTimeout(() => process.exit(0), 0)
  }

  process.once("SIGINT", () => shutdown("SIGINT"))
  process.once("SIGTERM", () => shutdown("SIGTERM"))
}

main().catch((error) => {
  console.error("[index] 启动失败:", error)
  stopBackgroundTokenRefresh()
  process.exit(1)
})
