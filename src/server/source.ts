import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { File, SOURCE_DEFAULT_UPDATE_INTERVAL } from '@/constants'
import { sourceLog } from '@/utils/log4js'
import { toMD5, checkAndCreateDirSync } from '@/utils'
import { aesEncrypt } from '@/utils/tools'
import { getServerId, getUserName } from '@/user'

interface SourceState {
  name: string
  md5: string
  updateTime: number
  size: number
}

let wss: LX.SocketServer | null = null
let config: LX.SourceServiceConfig | null = null
let sourceDir: string | null = null
let scriptContent: string | null = null
let scriptState: SourceState | null = null
let checking = false

// 从音源脚本头部的注释中解析 @name 信息，解析规则与客户端一致
const parseSourceName = (script: string): string => {
  const result = /^\/\*[\S|\s]+?\*\//.exec(script)
  if (!result) return ''
  const rxp = /^\s?\*\s?@(\w+)\s(.+)$/
  for (const line of result[0].split(/\r?\n/)) {
    const match = rxp.exec(line)
    if (match && match[1] == 'name') return match[2].trim().substring(0, 128)
  }
  return ''
}

const readStateFile = (): Partial<SourceState> => {
  try {
    return JSON.parse(fs.readFileSync(path.join(sourceDir!, File.sourceInfoJSON)).toString())
  } catch {
    return {}
  }
}

const saveSource = (content: string) => {
  const state: SourceState = {
    name: parseSourceName(content),
    md5: toMD5(content),
    updateTime: Date.now(),
    size: Buffer.byteLength(content),
  }
  fs.writeFileSync(path.join(sourceDir!, File.sourceScriptFile), content)
  fs.writeFileSync(path.join(sourceDir!, File.sourceInfoJSON), JSON.stringify(state, null, 2))
  scriptContent = content
  scriptState = state
}

// 下载音源文件，支持重定向跳转
const downloadSource = (url: string, redirects = 5): Promise<string> => new Promise((resolve, reject) => {
  const handleResponse = (res: http.IncomingMessage) => {
    if (res.statusCode == null) {
      reject(new Error('response status is null'))
      return
    }
    if (res.statusCode >= 300 && res.statusCode <= 399 && res.headers.location) {
      res.resume()
      if (redirects <= 0) {
        reject(new Error('too many redirects'))
        return
      }
      downloadSource(new URL(res.headers.location, url).toString(), redirects - 1).then(resolve, reject)
      return
    }
    if (res.statusCode != 200) {
      res.resume()
      reject(new Error(`download source failed, status: ${res.statusCode}`))
      return
    }
    let data = ''
    res.setEncoding('utf8')
    res.on('data', chunk => { data += chunk })
    res.on('end', () => { resolve(data) })
    res.on('error', reject)
  }
  const request = url.startsWith('https://') ? https.get(url, { timeout: 30 * 1000 }, handleResponse) : http.get(url, { timeout: 30 * 1000 }, handleResponse)
  request.on('timeout', () => {
    request.destroy(new Error('download source timeout'))
  })
  request.on('error', reject)
})

const checkSourceUpdate = async() => {
  if (checking || !config || !sourceDir) return
  checking = true
  try {
    sourceLog.info('checking source update:', config.url)
    const content = await downloadSource(config.url)
    if (scriptState && toMD5(content) == scriptState.md5) {
      sourceLog.info('source is up to date')
      return
    }
    saveSource(content)
    sourceLog.info(`source updated: ${scriptState!.name || 'unnamed'} md5: ${scriptState!.md5} size: ${scriptState!.size}`)
    pushSourceToAllClients()
  } catch (err: any) {
    sourceLog.error('check source update failed:', err?.message ?? err)
  } finally {
    checking = false
  }
}

/**
 * 生成音源下载地址的访问签名。签名基于登录用户与其设备 clientId 计算，
 * 只有通过同步服务登录的客户端才会经由推送通道获得该地址
 */
const buildSourceSignature = (username: string, clientId: string): string => {
  return createHmac('sha256', getServerId()).update(`${username}:${clientId}`).digest('hex').substring(0, 32)
}

// 构建推送给客户端的音源下载地址，真实音源地址不会下发给客户端
const buildSourceUrl = (client: LX.Socket): string | null => {
  const username = client.userInfo?.name
  const clientId = client.keyInfo?.clientId
  if (!username || !clientId) return null
  const query = config!.publicAccess
    ? ''
    : `?u=${encodeURIComponent(username)}&d=${clientId}&k=${buildSourceSignature(username, clientId)}`
  const target = `/source/script${query}`
  if (client.hostInfo?.host) return `${client.hostInfo.proto}://${client.hostInfo.host}${target}`
  return target
}

/**
 * 校验音源下载请求的登录信息：签名必须由本服务为已登录的用户+设备签发
 */
export const checkSourceAccess = (username: unknown, clientId: unknown, signature: unknown): boolean => {
  if (config?.publicAccess) return true
  if (typeof username != 'string' || !username) return false
  if (typeof clientId != 'string' || !clientId) return false
  if (typeof signature != 'string' || signature.length != 32) return false
  // 设备必须已完成登录（登录时才会记录 clientId 与用户的绑定关系）
  if (getUserName(clientId) != username) return false
  const expected = Buffer.from(buildSourceSignature(username, clientId), 'hex')
  let actual: Buffer
  try {
    actual = Buffer.from(signature, 'hex')
  } catch {
    return false
  }
  return actual.length == expected.length && timingSafeEqual(actual, expected)
}

export const pushSourceToClient = async(client: LX.Socket) => {
  if (!scriptContent || !scriptState || !client.isReady || !client.feature.source) return
  const url = buildSourceUrl(client)
  if (url == null) {
    sourceLog.warn('push source skipped, client is not logged in:', client.keyInfo?.deviceName ?? '')
    return
  }
  const action: LX.Sync.Source.ActionSource = {
    action: 'source_update',
    data: {
      url: config!.encryptUrl ? aesEncrypt(url, client.keyInfo.key) : url,
      md5: scriptState.md5,
      updateTime: scriptState.updateTime,
      encrypted: !!config!.encryptUrl,
    },
  }
  await client.remote.onSourceSyncAction(action).catch(err => {
    sourceLog.error(`push source to client failed: ${client.userInfo?.name ?? ''} ${client.keyInfo?.deviceName ?? ''}`, err?.message ?? err)
  })
}

export const pushSourceToAllClients = () => {
  if (!wss || !scriptContent) return
  for (const client of wss.clients) void pushSourceToClient(client)
}

export const setSourceSocketServer = (_wss: LX.SocketServer | null) => {
  wss = _wss
}

export const initSourceService = (config_: LX.SourceServiceConfig | null) => {
  config = config_
  sourceDir = path.join(global.lx.dataPath, File.sourceDir)
  checkAndCreateDirSync(sourceDir)

  // 加载本地缓存的音源文件，避免启动初期下载失败导致音源不可用
  const stateFile = readStateFile()
  const scriptPath = path.join(sourceDir, File.sourceScriptFile)
  if (fs.existsSync(scriptPath) && stateFile.md5) {
    scriptContent = fs.readFileSync(scriptPath).toString()
    scriptState = {
      name: stateFile.name ?? '',
      md5: stateFile.md5,
      updateTime: stateFile.updateTime ?? 0,
      size: stateFile.size ?? Buffer.byteLength(scriptContent),
    }
  }

  if (!config) {
    sourceLog.info('source service disabled (SOURCE_URL not set)')
    return
  }
  sourceLog.info(`source service started, update interval: ${config.updateInterval} min, encrypt url: ${config.encryptUrl}`)
  sourceLog.info(config.publicAccess
    ? 'source download is public (/source/script), anonymous access allowed'
    : 'source download requires login, access urls will be pushed to logged-in clients only')
  if (scriptState) {
    sourceLog.info(`source loaded from cache: ${scriptState.name || 'unnamed'} md5: ${scriptState.md5}`)
  }
  void checkSourceUpdate()
  setInterval(() => { void checkSourceUpdate() }, config.updateInterval * 60 * 1000)
}

// 以下方法供 HTTP 路由使用
export const getSourceInfo = (): (SourceState & { encrypted: boolean }) | null => {
  if (!scriptState) return null
  return { ...scriptState, encrypted: !!config?.encryptUrl }
}

export const getSourceScript = (): string | null => {
  return scriptContent
}

export const isSourceEnabled = (): boolean => {
  return !!scriptContent
}
